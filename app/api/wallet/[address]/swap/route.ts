import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface SwapVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  byPlatform: Array<{
    platform: string;
    contractAddress: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
  }>;
}

// Cache for swap metric config (rarely changes)
interface SwapConfigCache {
  metricId: number;
  contractAddresses: string[];
  functionNames: string[];
  contractNames: Record<string, string>;
  timestamp: number;
}
let swapConfigCache: SwapConfigCache | null = null;
const CONFIG_CACHE_TTL = 60 * 1000; // 1 minute

// Cache for swap results per wallet (30 second TTL)
const swapResultsCache = new Map<string, { data: SwapVolumeResponse; timestamp: number }>();
const RESULTS_CACHE_TTL = 30 * 1000;

async function getSwapConfig(): Promise<SwapConfigCache | null> {
  if (swapConfigCache && Date.now() - swapConfigCache.timestamp < CONFIG_CACHE_TTL) {
    return swapConfigCache;
  }

  const metricResult = await pool.query(
    `SELECT id FROM analytics_metrics WHERE slug = 'swap_volume' AND is_active = true`
  );

  if (metricResult.rows.length === 0) {
    return null;
  }

  const metricId = metricResult.rows[0].id;

  const [contractsResult, functionsResult, contractsMetadataResult] = await Promise.all([
    pool.query(
      `SELECT contract_address FROM analytics_metric_contracts 
       WHERE metric_id = $1 AND include_mode = 'include'`,
      [metricId]
    ),
    pool.query(
      `SELECT function_name FROM analytics_metric_functions 
       WHERE metric_id = $1 AND include_mode = 'include'`,
      [metricId]
    ),
    pool.query(
      `SELECT address, name FROM contracts_metadata WHERE category = 'dex'`
    ),
  ]);

  const contractNames: Record<string, string> = {};
  for (const row of contractsMetadataResult.rows) {
    contractNames[row.address.toLowerCase()] = row.name;
  }

  swapConfigCache = {
    metricId,
    contractAddresses: contractsResult.rows.map(r => r.contract_address),
    functionNames: functionsResult.rows.map(r => r.function_name),
    contractNames,
    timestamp: Date.now(),
  };

  return swapConfigCache;
}

// GET /api/wallet/[address]/swap - Get swap volume for a wallet
export async function GET(
  _request: NextRequest,
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

    // Check results cache first
    const cachedResult = swapResultsCache.get(walletAddress);
    if (cachedResult && Date.now() - cachedResult.timestamp < RESULTS_CACHE_TTL) {
      return NextResponse.json(cachedResult.data);
    }

    // Get swap config (cached)
    const config = await getSwapConfig();
    if (!config || config.contractAddresses.length === 0 || config.functionNames.length === 0) {
      return NextResponse.json({
        totalEth: 0,
        totalUsd: 0,
        txCount: 0,
        byPlatform: [],
      });
    }

    // Get swap volume grouped by contract address
    let result;
    try {
      result = await pool.query(
        `SELECT 
           contract_address,
           SUM(CAST(eth_value AS NUMERIC) / 1e18) as total_eth,
           COUNT(*) as tx_count
         FROM transaction_details
         WHERE wallet_address = $1
           AND contract_address = ANY($2)
           AND function_name = ANY($3)
           AND status = 1
         GROUP BY contract_address
         ORDER BY total_eth DESC`,
        [walletAddress, config.contractAddresses, config.functionNames]
      );
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (errorMessage.includes('does not exist')) {
        return NextResponse.json({
          totalEth: 0,
          totalUsd: 0,
          txCount: 0,
          byPlatform: [],
        });
      }
      throw dbError;
    }

    // Get current ETH price for USD conversion
    let ethPrice = 3500;
    try {
      const priceResult = await pool.query(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      ethPrice = priceResult.rows[0]?.price_usd || 3500;
    } catch {
      // Use fallback price
    }

    let totalEth = 0;
    let totalTxCount = 0;
    const byPlatform: SwapVolumeResponse['byPlatform'] = [];

    for (const row of result.rows) {
      const ethValue = parseFloat(row.total_eth || '0');
      const txCount = parseInt(row.tx_count || '0');
      const usdValue = ethValue * ethPrice;
      const contractAddr = row.contract_address.toLowerCase();

      totalEth += ethValue;
      totalTxCount += txCount;

      byPlatform.push({
        platform: config.contractNames[contractAddr] || 'Unknown DEX',
        contractAddress: contractAddr,
        ethValue,
        usdValue,
        txCount,
      });
    }

    const response: SwapVolumeResponse = {
      totalEth,
      totalUsd: totalEth * ethPrice,
      txCount: totalTxCount,
      byPlatform,
    };

    // Cache the result
    swapResultsCache.set(walletAddress, { data: response, timestamp: Date.now() });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching swap volume:', error);
    return NextResponse.json(
      { error: 'Failed to fetch swap volume' },
      { status: 500 }
    );
  }
}
