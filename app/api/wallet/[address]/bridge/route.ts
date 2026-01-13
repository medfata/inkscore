import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Relay wallet handles both "Relay" and "Ink Official" based on method selectors
const RELAY_WALLET = '0xf70da97812cb96acdf810712aa562db8dfa3dbef';

// Method selector for Ink Official
const INK_OFFICIAL_METHOD = '0x0c6d9703';

// OFT Adapter contract address for Native Bridge (USDT0)
const OFT_ADAPTER_ADDRESS = '0x1cb6de532588fca4a21b7209de7c456af8434a65';

// Bungee Socket Gateway contract address
const BUNGEE_SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';

// Event signatures
const OFT_SENT_SIGNATURE = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a';
const SOCKET_BRIDGE_SIGNATURE = '0x74594da9e31ee4068e17809037db37db496702bf7d8d63afe6f97949277d1609';
const SOCKET_SWAP_TOKENS_SIGNATURE = '0xb346a959ba6c0f1c7ba5426b10fd84fe4064e392a0dfcf6609e9640a0dd260d3';

const USDT0_DECIMALS = 6;

// All bridge platforms configuration
const ALL_BRIDGE_PLATFORMS = {
  'Native Bridge (USDT0)': {
    logo: 'https://pbs.twimg.com/profile_images/1879546764971188224/SQISVYwX_400x400.jpg',
    url: 'https://usdt0.to',
  },
  'Ink Official': {
    logo: 'https://inkonchain.com/favicon.ico',
    url: 'https://inkonchain.com/bridge',
  },
  'Relay': {
    logo: 'https://relay.link/favicon.ico',
    url: 'https://relay.link',
  },
  'Bungee': {
    logo: 'https://www.bungee.exchange/favicon.ico',
    url: 'https://www.bungee.exchange',
  },
};

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
    ethValue: number;
    usdValue: number;
    txCount: number;
    logo: string;
    url: string;
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

interface Operation {
  to: { id: string };
  from: { id: string };
  value: string;
  type: string;
}

function parseOftSentAmount(data: string): bigint {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  const amountHex = cleanData.slice(64, 128);
  return BigInt('0x' + amountHex);
}

function extractAddressFromTopic(topic: string): string {
  const cleanTopic = topic.startsWith('0x') ? topic.slice(2) : topic;
  return '0x' + cleanTopic.slice(-40).toLowerCase();
}

function parseSocketBridgeEvent(data: string): { amount: bigint; token: string } {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  const amountHex = cleanData.slice(0, 64);
  const amount = BigInt('0x' + amountHex);
  const tokenHex = cleanData.slice(64, 128);
  const token = '0x' + tokenHex.slice(-40).toLowerCase();
  return { amount, token };
}

// Cache for bridge results per wallet (30 second TTL)
const bridgeResultsCache = new Map<string, { data: BridgeVolumeResponse; timestamp: number }>();
const RESULTS_CACHE_TTL = 30 * 1000;


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    const walletAddress = address.toLowerCase();

    // Check cache first
    const cachedResult = bridgeResultsCache.get(walletAddress);
    if (cachedResult && Date.now() - cachedResult.timestamp < RESULTS_CACHE_TTL) {
      return NextResponse.json(cachedResult.data);
    }

    // Initialize platform data - all platforms start with 0
    const platformData: Record<string, { ethValue: number; usdValue: number; txCount: number; bridgedOutUsd?: number; bridgedOutCount?: number }> = {
      'Native Bridge (USDT0)': { ethValue: 0, usdValue: 0, txCount: 0 },
      'Ink Official': { ethValue: 0, usdValue: 0, txCount: 0 },
      'Relay': { ethValue: 0, usdValue: 0, txCount: 0 },
      'Bungee': { ethValue: 0, usdValue: 0, txCount: 0 },
    };

    let totalEth = 0;
    let totalTxCount = 0;
    let bridgedInUsd = 0;
    let bridgedInCount = 0;
    let bridgedOutUsd = 0;
    let bridgedOutCount = 0;

    // Get ETH price
    let ethPrice = 3500;
    try {
      const priceResult = await pool.query(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      ethPrice = priceResult.rows[0]?.price_usd || 3500;
    } catch {
      // Use fallback price
    }

    // 1. Query Relay/Ink Official bridge IN transactions
    try {
      const relayResult = await pool.query(
        `SELECT 
           tx_hash, method_id, operations, value,
           COALESCE(eth_value_decimal, 0) as eth_value_decimal,
           COALESCE(eth_price_usd, $2) as eth_price_usd
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND operations IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements(operations) AS op
             WHERE LOWER(op->'to'->>'id') = $3
           )`,
        [RELAY_WALLET, ethPrice, walletAddress]
      );

      for (const row of relayResult.rows) {
        let operations: Operation[] = [];
        try {
          operations = typeof row.operations === 'string' ? JSON.parse(row.operations) : row.operations || [];
        } catch {
          continue;
        }

        const userTransfer = operations.find(op => op.to?.id?.toLowerCase() === walletAddress);
        if (!userTransfer) continue;

        let ethValue = 0;
        if (userTransfer.value) {
          ethValue = Number(BigInt(userTransfer.value)) / 1e18;
        }
        if (ethValue === 0) ethValue = parseFloat(row.eth_value_decimal || '0');
        if (ethValue === 0 && row.value) ethValue = Number(BigInt(row.value)) / 1e18;

        const txEthPrice = parseFloat(row.eth_price_usd || String(ethPrice));
        const usdValue = ethValue * txEthPrice;

        // Determine platform based on method_id
        const methodId = row.method_id?.toLowerCase();
        const platform = methodId === INK_OFFICIAL_METHOD ? 'Ink Official' : 'Relay';

        platformData[platform].ethValue += ethValue;
        platformData[platform].usdValue += usdValue;
        platformData[platform].txCount += 1;

        totalEth += ethValue;
        totalTxCount += 1;
        bridgedInUsd += usdValue;
        bridgedInCount += 1;
      }
    } catch (dbError: unknown) {
      console.error('Error querying Relay/Ink Official:', dbError instanceof Error ? dbError.message : dbError);
    }


    // 2. Query Native Bridge (USDT0) OUT transactions
    try {
      const bridgeOutResult = await pool.query(
        `SELECT tx_hash, logs
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($2)
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

          platformData['Native Bridge (USDT0)'].usdValue += amountUsd;
          platformData['Native Bridge (USDT0)'].txCount += 1;
          platformData['Native Bridge (USDT0)'].bridgedOutUsd = (platformData['Native Bridge (USDT0)'].bridgedOutUsd || 0) + amountUsd;
          platformData['Native Bridge (USDT0)'].bridgedOutCount = (platformData['Native Bridge (USDT0)'].bridgedOutCount || 0) + 1;

          totalTxCount += 1;
          bridgedOutUsd += amountUsd;
          bridgedOutCount += 1;
        }
      }
    } catch (dbError: unknown) {
      console.error('Error querying Native Bridge OUT:', dbError instanceof Error ? dbError.message : dbError);
    }

    // 3. Query Bungee Socket Gateway transactions
    try {
      const bungeeResult = await pool.query(
        `SELECT tx_hash, logs, eth_value_decimal, total_usd_volume, value
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($2)
           AND logs IS NOT NULL`,
        [BUNGEE_SOCKET_GATEWAY, walletAddress]
      );

      for (const row of bungeeResult.rows) {
        const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
        if (!Array.isArray(logs)) continue;

        let hasBridgeActivity = false;
        let txUsdValue = 0;

        for (const log of logs) {
          const logAddress = (log.address?.id || '').toLowerCase();
          const topic0 = log.topics?.[0]?.toLowerCase();

          if (logAddress !== BUNGEE_SOCKET_GATEWAY) continue;

          if (topic0 === SOCKET_BRIDGE_SIGNATURE || topic0 === SOCKET_SWAP_TOKENS_SIGNATURE) {
            hasBridgeActivity = true;

            if (row.total_usd_volume && parseFloat(row.total_usd_volume) > 0) {
              txUsdValue = parseFloat(row.total_usd_volume);
            } else if (row.eth_value_decimal && parseFloat(row.eth_value_decimal) > 0) {
              txUsdValue = parseFloat(row.eth_value_decimal) * ethPrice;
            } else if (row.value && parseFloat(row.value) > 0) {
              txUsdValue = (parseFloat(row.value) / 1e18) * ethPrice;
            } else {
              try {
                const { amount, token } = parseSocketBridgeEvent(log.data);
                if (token === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
                  txUsdValue = (Number(amount) / 1e18) * ethPrice;
                }
              } catch {
                // Skip
              }
            }
            break;
          }
        }

        if (hasBridgeActivity && txUsdValue > 0) {
          platformData['Bungee'].usdValue += txUsdValue;
          platformData['Bungee'].txCount += 1;
          totalTxCount += 1;
        }
      }
    } catch (dbError: unknown) {
      console.error('Error querying Bungee:', dbError instanceof Error ? dbError.message : dbError);
    }

    // Build byPlatform array with all platforms (including those with $0)
    const byPlatform = Object.entries(ALL_BRIDGE_PLATFORMS).map(([platform, config]) => ({
      platform,
      ethValue: platformData[platform].ethValue,
      usdValue: platformData[platform].usdValue,
      txCount: platformData[platform].txCount,
      logo: config.logo,
      url: config.url,
      ...(platformData[platform].bridgedOutUsd !== undefined && {
        bridgedOutUsd: platformData[platform].bridgedOutUsd,
        bridgedOutCount: platformData[platform].bridgedOutCount,
      }),
    }));

    // Sort by USD value descending
    byPlatform.sort((a, b) => b.usdValue - a.usdValue);

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

    bridgeResultsCache.set(walletAddress, { data: response, timestamp: Date.now() });
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching bridge volume:', error);
    return NextResponse.json({ error: 'Failed to fetch bridge volume' }, { status: 500 });
  }
}
