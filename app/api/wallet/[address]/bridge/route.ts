import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// OFT Adapter contract address for Native Bridge (USDT0)
const OFT_ADAPTER_ADDRESS = '0x1cb6de532588fca4a21b7209de7c456af8434a65';

// LayerZero Executor contract (receives bridge IN transactions)
const LZ_EXECUTOR_ADDRESS = '0xfebcf17b11376c724ab5a5229803c6e838b6eae5';

// Event signatures (topic0)
const OFT_SENT_SIGNATURE = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a';
const OFT_RECEIVED_SIGNATURE = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c';

// USDT0 has 6 decimals
const USDT0_DECIMALS = 6;

export interface BridgeVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  bridgedInUsd: number;
  bridgedInCount: number;
  bridgedOutUsd: number;
  bridgedOutCount: number;
  byPlatform: Array<{
    platform: string;
    subPlatform?: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
    bridgedInUsd?: number;
    bridgedInCount?: number;
    bridgedOutUsd?: number;
    bridgedOutCount?: number;
  }>;
}

interface OftEventLog {
  index: number;
  address: { id: string };
  topics: string[];
  data: string;
  event?: string;
}

/**
 * Parse OFTSent event data to extract amountSentLD
 * Event: OFTSent(bytes32 indexed guid, uint32 dstEid, address indexed fromAddress, uint256 amountSentLD, uint256 amountReceivedLD)
 * Data layout: dstEid (32 bytes) + amountSentLD (32 bytes) + amountReceivedLD (32 bytes)
 */
function parseOftSentAmount(data: string): bigint {
  // Remove 0x prefix
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  // amountSentLD is at offset 32 bytes (64 hex chars) after dstEid
  const amountHex = cleanData.slice(64, 128);
  return BigInt('0x' + amountHex);
}

/**
 * Parse OFTReceived event data to extract amountReceivedLD
 * Event: OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)
 * Data layout: srcEid (32 bytes) + amountReceivedLD (32 bytes)
 */
function parseOftReceivedAmount(data: string): bigint {
  // Remove 0x prefix
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  // amountReceivedLD is at offset 32 bytes (64 hex chars) after srcEid
  const amountHex = cleanData.slice(64, 128);
  return BigInt('0x' + amountHex);
}

/**
 * Extract wallet address from indexed topic (topic2 for both events)
 * The address is padded to 32 bytes, so we take the last 40 chars
 */
function extractAddressFromTopic(topic: string): string {
  const cleanTopic = topic.startsWith('0x') ? topic.slice(2) : topic;
  return '0x' + cleanTopic.slice(-40).toLowerCase();
}

// GET /api/wallet/[address]/bridge - Get bridge volume for a wallet
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const walletAddress = address.toLowerCase();

    // Initialize response data
    let totalEth = 0;
    let totalTxCount = 0;
    let bridgedInUsd = 0;
    let bridgedInCount = 0;
    let bridgedOutUsd = 0;
    let bridgedOutCount = 0;
    const byPlatform: BridgeVolumeResponse['byPlatform'] = [];

    // Get current ETH price for USD conversion (for other bridges)
    let ethPrice = 3500; // Fallback price
    try {
      const priceResult = await pool.query(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      ethPrice = priceResult.rows[0]?.price_usd || 3500;
    } catch {
      // Use fallback price if eth_prices table doesn't exist
    }

    // 1. Query Native Bridge (USDT0) from transaction_enrichment using OFT events
    // Optimized: Query specific contracts instead of scanning all logs
    // - Bridge OUT: wallet calls OFT Adapter directly (contract_address = OFT Adapter, wallet_address = user)
    // - Bridge IN: LayerZero Executor calls lzReceive (contract_address = LZ Executor, wallet in logs)
    try {
      // 1a. Bridge OUT - Query transactions where user called OFT Adapter
      const bridgeOutResult = await pool.query(
        `SELECT tx_hash, logs
         FROM transaction_enrichment
         WHERE contract_address = $1
           AND wallet_address = $2
           AND logs IS NOT NULL`,
        [OFT_ADAPTER_ADDRESS, walletAddress]
      );

      for (const row of bridgeOutResult.rows) {
        const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
        if (!Array.isArray(logs)) continue;

        for (const log of logs) {
          const logAddress = (log.address?.id || '').toLowerCase();
          const topic0 = log.topics?.[0]?.toLowerCase();
          const topic2 = log.topics?.[2];

          if (logAddress !== OFT_ADAPTER_ADDRESS) continue;
          if (topic0 !== OFT_SENT_SIGNATURE) continue;
          if (!topic2) continue;

          const eventWallet = extractAddressFromTopic(topic2);
          if (eventWallet !== walletAddress) continue;

          const amountRaw = parseOftSentAmount(log.data);
          const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);
          bridgedOutUsd += amountUsd;
          bridgedOutCount++;
        }
      }

      // 1b. Bridge IN - Query transactions from LayerZero Executor that contain wallet in logs
      // We filter by contract_address first (indexed), then check logs for wallet
      const bridgeInResult = await pool.query(
        `SELECT tx_hash, logs
         FROM transaction_enrichment
         WHERE contract_address = $1
           AND logs IS NOT NULL
           AND logs::text ILIKE $2`,
        [LZ_EXECUTOR_ADDRESS, `%${walletAddress}%`]
      );

      for (const row of bridgeInResult.rows) {
        const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
        if (!Array.isArray(logs)) continue;

        for (const log of logs) {
          const logAddress = (log.address?.id || '').toLowerCase();
          const topic0 = log.topics?.[0]?.toLowerCase();
          const topic2 = log.topics?.[2];

          if (logAddress !== OFT_ADAPTER_ADDRESS) continue;
          if (topic0 !== OFT_RECEIVED_SIGNATURE) continue;
          if (!topic2) continue;

          const eventWallet = extractAddressFromTopic(topic2);
          if (eventWallet !== walletAddress) continue;

          const amountRaw = parseOftReceivedAmount(log.data);
          const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);
          bridgedInUsd += amountUsd;
          bridgedInCount++;
        }
      }

      // Add Native Bridge (USDT0) to byPlatform if there's any activity
      if (bridgedInCount > 0 || bridgedOutCount > 0) {
        const nativeBridgeUsd = bridgedInUsd + bridgedOutUsd;
        const nativeBridgeTxCount = bridgedInCount + bridgedOutCount;

        byPlatform.push({
          platform: 'Native Bridge (USDT0)',
          ethValue: 0, // USDT0 is not ETH
          usdValue: nativeBridgeUsd,
          txCount: nativeBridgeTxCount,
          bridgedInUsd,
          bridgedInCount,
          bridgedOutUsd,
          bridgedOutCount,
        });

        totalTxCount += nativeBridgeTxCount;
      }
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.error('Error querying Native Bridge (USDT0):', errorMessage);
      // Continue with other bridges even if this fails
    }

    // 2. Query other bridges from bridge_transfers table
    try {
      const result = await pool.query(
        `SELECT 
           platform,
           sub_platform,
           SUM(eth_value) as total_eth,
           COUNT(*) as tx_count
         FROM bridge_transfers
         WHERE to_address = $1
         GROUP BY platform, sub_platform
         ORDER BY total_eth DESC`,
        [walletAddress]
      );

      for (const row of result.rows) {
        const ethValue = parseFloat(row.total_eth || '0');
        const txCount = parseInt(row.tx_count || '0');
        const usdValue = ethValue * ethPrice;

        totalEth += ethValue;
        totalTxCount += txCount;

        byPlatform.push({
          platform: row.platform,
          subPlatform: row.sub_platform || undefined,
          ethValue,
          usdValue,
          txCount,
        });
      }
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (!errorMessage.includes('does not exist')) {
        console.error('Error querying bridge_transfers:', errorMessage);
      }
      // Continue even if bridge_transfers table doesn't exist
    }

    // Calculate total USD (ETH bridges + USDT0 bridge)
    const totalUsd = (totalEth * ethPrice) + bridgedInUsd + bridgedOutUsd;

    const response: BridgeVolumeResponse = {
      totalEth,
      totalUsd,
      txCount: totalTxCount,
      bridgedInUsd,
      bridgedInCount,
      bridgedOutUsd,
      bridgedOutCount,
      byPlatform,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching bridge volume:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bridge volume' },
      { status: 500 }
    );
  }
}
