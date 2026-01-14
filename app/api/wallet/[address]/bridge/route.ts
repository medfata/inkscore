import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Relay wallet handles both "Relay" and "Ink Official" based on method selectors (Bridge IN)
const RELAY_WALLET = '0xf70da97812cb96acdf810712aa562db8dfa3dbef';

// Relay deposit contract for Bridge OUT (depositNative) - shared by Relay and Ink Official
const RELAY_DEPOSIT_CONTRACT = '0x4cd00e387622c35bddb9b4c962c136462338bc31';

// Method selectors for Ink Official bridge IN
const INK_OFFICIAL_METHODS = ['0x0c6d9703', '0x5819bf3d'];

// OFT Adapter contract address for Native Bridge (USDT0) - Bridge OUT
const OFT_ADAPTER_ADDRESS = '0x1cb6de532588fca4a21b7209de7c456af8434a65';

// LayerZero Executor contract for Native Bridge (USDT0) - Bridge IN
const LZ_EXECUTOR_ADDRESS = '0xfebcf17b11376c724ab5a5229803c6e838b6eae5';

// Bungee contracts
const BUNGEE_SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';
const BUNGEE_FULFILLMENT_CONTRACT = '0x26d8da52e56de71194950689ccf74cd309761324'; // Bridge IN (PerformFulfilment)
const BUNGEE_REQUEST_CONTRACT = '0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc'; // Bridge OUT (CreateRequest)

// Event signatures
const OFT_SENT_SIGNATURE = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a';
const OFT_RECEIVED_SIGNATURE = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c';
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

// Parse OFTReceived event data to extract amountReceivedLD
// Event: OFTReceived(bytes32 indexed guid, uint32 srcEid, address indexed toAddress, uint256 amountReceivedLD)
// Data layout: srcEid (32 bytes) + amountReceivedLD (32 bytes)
function parseOftReceivedAmount(data: string): bigint {
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
  const requestStart = Date.now();
  try {
    const { address } = await params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    const walletAddress = address.toLowerCase();

    // Check cache first
    const cachedResult = bridgeResultsCache.get(walletAddress);
    if (cachedResult && Date.now() - cachedResult.timestamp < RESULTS_CACHE_TTL) {
      console.log(`[Bridge ${walletAddress}] Cache hit - returning cached result`);
      return NextResponse.json(cachedResult.data);
    }

    console.log(`[Bridge ${walletAddress}] Starting bridge volume calculation...`);

    // Initialize platform data - all platforms start with 0
    const platformData: Record<string, {
      ethValue: number;
      usdValue: number;
      txCount: number;
      bridgedInUsd?: number;
      bridgedInCount?: number;
      bridgedOutUsd?: number;
      bridgedOutCount?: number
    }> = {
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
      const priceStart = Date.now();
      const priceResult = await pool.query(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      console.log(`[Bridge ${walletAddress}] ETH price query: ${Date.now() - priceStart}ms`);
      ethPrice = priceResult.rows[0]?.price_usd || 3500;
    } catch {
      // Use fallback price
    }

    // 1. Query Relay/Ink Official bridge IN transactions
    // Use related_wallets array for fast lookup (requires migration)
    try {
      const relayInStart = Date.now();
      const relayResult = await pool.query(
        `SELECT 
           tx_hash, method_id, operations, value,
           COALESCE(eth_value_decimal, 0) as eth_value_decimal,
           COALESCE(eth_price_usd, $2) as eth_price_usd
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND (
             related_wallets @> ARRAY[$3]::text[]
             OR (operations IS NOT NULL AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(operations) AS op
               WHERE LOWER(op->'to'->>'id') = LOWER($3)
             ))
           )`,
        [RELAY_WALLET, ethPrice, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Relay/Ink IN query: ${Date.now() - relayInStart}ms (${relayResult.rows.length} rows)`);

      for (const row of relayResult.rows) {
        let operations: Operation[] = [];
        try {
          operations = typeof row.operations === 'string' ? JSON.parse(row.operations) : row.operations || [];
        } catch {
          continue;
        }

        // Verify user is recipient in operations (double-check after ILIKE)
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
        const platform = INK_OFFICIAL_METHODS.includes(methodId) ? 'Ink Official' : 'Relay';

        platformData[platform].ethValue += ethValue;
        platformData[platform].usdValue += usdValue;
        platformData[platform].txCount += 1;
        platformData[platform].bridgedInUsd = (platformData[platform].bridgedInUsd || 0) + usdValue;
        platformData[platform].bridgedInCount = (platformData[platform].bridgedInCount || 0) + 1;

        totalEth += ethValue;
        totalTxCount += 1;
        bridgedInUsd += usdValue;
        bridgedInCount += 1;
      }
    } catch (dbError: unknown) {
      console.error('Error querying Relay/Ink Official:', dbError instanceof Error ? dbError.message : dbError);
    }

    // 1b. Query Relay/Ink Official bridge OUT transactions (depositNative)
    // Both Relay and Ink Official use the same deposit contract - show on BOTH platforms
    // but only count once for totals
    try {
      const relayOutStart = Date.now();
      const relayOutResult = await pool.query(
        `SELECT tx_hash, value, method_id,
           COALESCE(eth_value_decimal, 0) as eth_value_decimal,
           COALESCE(eth_price_usd, $2) as eth_price_usd
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($3)`,
        [RELAY_DEPOSIT_CONTRACT, ethPrice, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Relay/Ink OUT query: ${Date.now() - relayOutStart}ms (${relayOutResult.rows.length} rows)`);

      // Track shared bridge OUT totals (shown on both platforms but counted once)
      let sharedBridgeOutEth = 0;
      let sharedBridgeOutUsd = 0;
      let sharedBridgeOutCount = 0;

      for (const row of relayOutResult.rows) {
        let ethValue = parseFloat(row.eth_value_decimal || '0');
        if (ethValue === 0 && row.value) {
          ethValue = Number(BigInt(row.value)) / 1e18;
        }

        const txEthPrice = parseFloat(row.eth_price_usd || String(ethPrice));
        const usdValue = ethValue * txEthPrice;

        sharedBridgeOutEth += ethValue;
        sharedBridgeOutUsd += usdValue;
        sharedBridgeOutCount += 1;
      }

      // Show bridge OUT on BOTH Relay and Ink Official (they share the same contract)
      // But only add to usdValue/totals once (on Ink Official to avoid double counting)
      if (sharedBridgeOutCount > 0) {
        // Add to Ink Official's main usdValue (counted in total)
        platformData['Ink Official'].ethValue += sharedBridgeOutEth;
        platformData['Ink Official'].usdValue += sharedBridgeOutUsd;
        platformData['Ink Official'].txCount += sharedBridgeOutCount;
        platformData['Ink Official'].bridgedOutUsd = (platformData['Ink Official'].bridgedOutUsd || 0) + sharedBridgeOutUsd;
        platformData['Ink Official'].bridgedOutCount = (platformData['Ink Official'].bridgedOutCount || 0) + sharedBridgeOutCount;

        // Show bridge OUT breakdown on Relay too (for display only, not counted in Relay's usdValue)
        platformData['Relay'].bridgedOutUsd = (platformData['Relay'].bridgedOutUsd || 0) + sharedBridgeOutUsd;
        platformData['Relay'].bridgedOutCount = (platformData['Relay'].bridgedOutCount || 0) + sharedBridgeOutCount;

        // Add to totals only ONCE
        totalEth += sharedBridgeOutEth;
        totalTxCount += sharedBridgeOutCount;
        bridgedOutUsd += sharedBridgeOutUsd;
        bridgedOutCount += sharedBridgeOutCount;
      }
    } catch (dbError: unknown) {
      console.error('Error querying Relay/Ink Official OUT:', dbError instanceof Error ? dbError.message : dbError);
    }

    // 2a. Query Native Bridge (USDT0) IN transactions (OFTReceived via LayerZero Executor)
    // Use related_wallets array for fast lookup (requires migration)
    try {
      const nativeBridgeInStart = Date.now();
      const nativeBridgeInResult = await pool.query(
        `SELECT tx_hash, logs
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND (
             related_wallets @> ARRAY[$2]::text[]
             OR (logs IS NOT NULL AND logs::text LIKE $3)
           )`,
        [LZ_EXECUTOR_ADDRESS, walletAddress, `%${walletAddress.slice(2)}%`]
      );
      console.log(`[Bridge ${walletAddress}] Native Bridge IN query: ${Date.now() - nativeBridgeInStart}ms (${nativeBridgeInResult.rows.length} rows)`);

      for (const row of nativeBridgeInResult.rows) {
        const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
        if (!Array.isArray(logs)) continue;

        for (const log of logs) {
          const logAddress = (log.address?.id || '').toLowerCase();
          const topic0 = log.topics?.[0]?.toLowerCase();
          const topic2 = log.topics?.[2];

          // Look for OFTReceived event from OFT Adapter (case-insensitive)
          if (logAddress !== OFT_ADAPTER_ADDRESS.toLowerCase()) continue;
          if (topic0 !== OFT_RECEIVED_SIGNATURE.toLowerCase()) continue;
          if (!topic2) continue;

          const eventWallet = extractAddressFromTopic(topic2);
          if (eventWallet !== walletAddress) continue;

          const amountRaw = parseOftReceivedAmount(log.data);
          const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);

          platformData['Native Bridge (USDT0)'].usdValue += amountUsd;
          platformData['Native Bridge (USDT0)'].txCount += 1;
          platformData['Native Bridge (USDT0)'].bridgedInUsd = (platformData['Native Bridge (USDT0)'].bridgedInUsd || 0) + amountUsd;
          platformData['Native Bridge (USDT0)'].bridgedInCount = (platformData['Native Bridge (USDT0)'].bridgedInCount || 0) + 1;

          totalTxCount += 1;
          bridgedInUsd += amountUsd;
          bridgedInCount += 1;
        }
      }
    } catch (dbError: unknown) {
      console.error('Error querying Native Bridge IN:', dbError instanceof Error ? dbError.message : dbError);
    }

    // 2b. Query Native Bridge (USDT0) OUT transactions
    try {
      const bridgeOutStart = Date.now();
      const bridgeOutResult = await pool.query(
        `SELECT tx_hash, logs
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($2)
           AND logs IS NOT NULL`,
        [OFT_ADAPTER_ADDRESS, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Native Bridge OUT query: ${Date.now() - bridgeOutStart}ms (${bridgeOutResult.rows.length} rows)`);

      for (const row of bridgeOutResult.rows) {
        const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
        if (!Array.isArray(logs)) continue;

        for (const log of logs) {
          const logAddress = (log.address?.id || '').toLowerCase();
          const topic0 = log.topics?.[0]?.toLowerCase();
          const topic2 = log.topics?.[2];

          if (logAddress !== OFT_ADAPTER_ADDRESS.toLowerCase()) continue;
          if (topic0 !== OFT_SENT_SIGNATURE.toLowerCase()) continue;
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

    // 3. Query Bungee bridge transactions
    // Bridge IN: PerformFulfilment contract - use related_wallets array
    // Bridge OUT: CreateRequest contract - query by wallet_address
    try {
      // 3a. Bungee Bridge IN (PerformFulfilment) - funds sent TO user
      const bungeeInStart = Date.now();
      const bungeeInResult = await pool.query(
        `SELECT tx_hash, operations, value,
           COALESCE(eth_value_decimal, 0) as eth_value_decimal,
           COALESCE(eth_price_usd, $2) as eth_price_usd
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND (
             related_wallets @> ARRAY[$3]::text[]
             OR (operations IS NOT NULL AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(operations) AS op
               WHERE LOWER(op->'to'->>'id') = LOWER($3)
             ))
           )`,
        [BUNGEE_FULFILLMENT_CONTRACT, ethPrice, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Bungee IN query: ${Date.now() - bungeeInStart}ms (${bungeeInResult.rows.length} rows)`);

      for (const row of bungeeInResult.rows) {
        let operations: Operation[] = [];
        try {
          operations = typeof row.operations === 'string' ? JSON.parse(row.operations) : row.operations || [];
        } catch {
          continue;
        }

        // Find transfer to user wallet
        const userTransfer = operations.find(op => op.to?.id?.toLowerCase() === walletAddress);
        if (!userTransfer) continue;

        let ethValue = 0;
        if (userTransfer.value) {
          ethValue = Number(BigInt(userTransfer.value)) / 1e18;
        }
        if (ethValue === 0) ethValue = parseFloat(row.eth_value_decimal || '0');

        const txEthPrice = parseFloat(row.eth_price_usd || String(ethPrice));
        const usdValue = ethValue * txEthPrice;

        platformData['Bungee'].ethValue += ethValue;
        platformData['Bungee'].usdValue += usdValue;
        platformData['Bungee'].txCount += 1;
        platformData['Bungee'].bridgedInUsd = (platformData['Bungee'].bridgedInUsd || 0) + usdValue;
        platformData['Bungee'].bridgedInCount = (platformData['Bungee'].bridgedInCount || 0) + 1;

        totalEth += ethValue;
        totalTxCount += 1;
        bridgedInUsd += usdValue;
        bridgedInCount += 1;
      }

      // 3b. Bungee Bridge OUT (CreateRequest) - user sends funds out
      const bungeeOutStart = Date.now();
      const bungeeOutResult = await pool.query(
        `SELECT tx_hash, value,
           COALESCE(eth_value_decimal, 0) as eth_value_decimal,
           COALESCE(eth_price_usd, $2) as eth_price_usd
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($3)`,
        [BUNGEE_REQUEST_CONTRACT, ethPrice, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Bungee OUT query: ${Date.now() - bungeeOutStart}ms (${bungeeOutResult.rows.length} rows)`);

      for (const row of bungeeOutResult.rows) {
        let ethValue = parseFloat(row.eth_value_decimal || '0');
        if (ethValue === 0 && row.value) {
          ethValue = Number(BigInt(row.value)) / 1e18;
        }

        const txEthPrice = parseFloat(row.eth_price_usd || String(ethPrice));
        const usdValue = ethValue * txEthPrice;

        platformData['Bungee'].ethValue += ethValue;
        platformData['Bungee'].usdValue += usdValue;
        platformData['Bungee'].txCount += 1;
        platformData['Bungee'].bridgedOutUsd = (platformData['Bungee'].bridgedOutUsd || 0) + usdValue;
        platformData['Bungee'].bridgedOutCount = (platformData['Bungee'].bridgedOutCount || 0) + 1;

        totalEth += ethValue;
        totalTxCount += 1;
        bridgedOutUsd += usdValue;
        bridgedOutCount += 1;
      }

      // 3c. Also check legacy Socket Gateway transactions
      const bungeeGatewayStart = Date.now();
      const bungeeGatewayResult = await pool.query(
        `SELECT tx_hash, logs, eth_value_decimal, total_usd_volume, value
         FROM transaction_enrichment
         WHERE LOWER(contract_address) = LOWER($1)
           AND LOWER(wallet_address) = LOWER($2)
           AND logs IS NOT NULL`,
        [BUNGEE_SOCKET_GATEWAY, walletAddress]
      );
      console.log(`[Bridge ${walletAddress}] Bungee Gateway query: ${Date.now() - bungeeGatewayStart}ms (${bungeeGatewayResult.rows.length} rows)`);

      for (const row of bungeeGatewayResult.rows) {
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
      ...(platformData[platform].bridgedInUsd !== undefined && {
        bridgedInUsd: platformData[platform].bridgedInUsd,
        bridgedInCount: platformData[platform].bridgedInCount,
      }),
      ...(platformData[platform].bridgedOutUsd !== undefined && {
        bridgedOutUsd: platformData[platform].bridgedOutUsd,
        bridgedOutCount: platformData[platform].bridgedOutCount,
      }),
    }));

    // Sort by USD value descending
    byPlatform.sort((a, b) => b.usdValue - a.usdValue);

    // Calculate total USD from all platforms (avoid double counting)
    // Sum up each platform's usdValue directly
    const totalUsd = Object.values(platformData).reduce((sum, p) => sum + p.usdValue, 0);

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

    const totalTime = Date.now() - requestStart;
    console.log(`[Bridge ${walletAddress}] TOTAL REQUEST TIME: ${totalTime}ms`);

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching bridge volume:', error);
    return NextResponse.json({ error: 'Failed to fetch bridge volume' }, { status: 500 });
  }
}
