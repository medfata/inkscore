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

// Cache for swap results per wallet (30 second TTL)
const swapResultsCache = new Map<string, { data: SwapVolumeResponse; timestamp: number }>();
const RESULTS_CACHE_TTL = 30 * 1000;

// Known swap contract addresses and their platform names
const SWAP_CONTRACTS: Record<string, string> = {
  '0x551134e92e537ceaa217c2ef63210af3ce96a065': 'InkySwap',
  // Add other swap contract addresses here as needed
};

// Common swap method IDs
const SWAP_METHOD_IDS = [
  '0x7ff36ab5', // swapExactETHForTokens
  '0x18cbafe5', // swapExactTokensForETH
  '0x38ed1739', // swapExactTokensForTokens
  '0xfb3bdb41', // swapETHForExactTokens
  '0x4a25d94a', // swapTokensForExactETH
  '0x8803dbee', // swapTokensForExactTokens
  '0xb6f9de95', // swapExactETHForTokensSupportingFeeOnTransferTokens
  '0x791ac947', // swapExactTokensForETHSupportingFeeOnTransferTokens
  '0x5c11d795', // swapExactTokensForTokensSupportingFeeOnTransferTokens
  '0x3593564c', // execute (Universal Router - InkySwap, Uniswap V3, etc.)
];

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

    // Get all swap transactions for this wallet, with improved volume calculation
    const result = await pool.query(
      `SELECT 
         contract_address,
         COUNT(*) as tx_count,
         SUM(COALESCE(eth_value_decimal, 0)) as total_eth,
         SUM(
           CASE 
             -- If we have total_usd_volume, use it
             WHEN total_usd_volume > 0 THEN total_usd_volume
             -- If we have token USD values, use them
             WHEN COALESCE(tokens_in_usd_total, 0) + COALESCE(tokens_out_usd_total, 0) > 0 
               THEN COALESCE(tokens_in_usd_total, 0) + COALESCE(tokens_out_usd_total, 0)
             -- For ETH transactions, convert ETH value to USD
             WHEN value::numeric > 0 THEN (value::numeric / 1e18) * COALESCE(eth_price_usd, 3500)
             -- Fallback to eth_value_decimal
             ELSE COALESCE(eth_value_decimal, 0) * COALESCE(eth_price_usd, 3500)
           END
         ) as total_usd
       FROM transaction_enrichment
       WHERE LOWER(wallet_address) = LOWER($1)
         AND method_id = ANY($2)
       GROUP BY contract_address
       ORDER BY total_usd DESC`,
      [address, SWAP_METHOD_IDS]
    );

    let totalEth = 0;
    let totalUsd = 0;
    let totalTxCount = 0;
    const byPlatform: SwapVolumeResponse['byPlatform'] = [];

    for (const row of result.rows) {
      const ethValue = parseFloat(row.total_eth || '0');
      const usdValue = parseFloat(row.total_usd || '0');
      const txCount = parseInt(row.tx_count || '0');
      const contractAddr = row.contract_address.toLowerCase();

      totalEth += ethValue;
      totalUsd += usdValue;
      totalTxCount += txCount;

      // Get platform name from known contracts or try to get from contracts table
      let platformName = SWAP_CONTRACTS[contractAddr];
      
      if (!platformName) {
        try {
          const contractResult = await pool.query(
            `SELECT name FROM contracts WHERE LOWER(address) = LOWER($1)`,
            [contractAddr]
          );
          platformName = contractResult.rows[0]?.name || 'Unknown DEX';
        } catch {
          platformName = 'Unknown DEX';
        }
      }

      byPlatform.push({
        platform: platformName,
        contractAddress: contractAddr,
        ethValue,
        usdValue,
        txCount,
      });
    }

    const response: SwapVolumeResponse = {
      totalEth,
      totalUsd,
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
