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
  '0xd7e72f3615aa65b92a4dbdc211e296a35512988b': 'Curve',
  '0x9b17690de96fcfa80a3acaefe11d936629cd7a77': 'DyorSwap',
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
  '0xaad348a2', // exchange (Curve)
];

// Known stablecoin addresses (lowercase) - decimals for each
const STABLECOIN_ADDRESSES: Record<string, number> = {
  '0x0200c29006150606b650577bbe7b6248f58470c1': 6, // USDT0 - 6 decimals
  '0xe343167631d89b6ffc58b88d6b7fb0228795491d': 6, // USDC - 6 decimals
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6, // USDT (if bridged)
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6, // USDC (if bridged)
};

// WETH/ETH addresses (18 decimals)
const WETH_ADDRESSES = new Set([
  '0x4200000000000000000000000000000000000006', // WETH on Ink
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH mainnet (if bridged)
]);

// Parse swap volume from logs JSON
function parseSwapVolumeFromLogs(logs: any[], ethPriceUsd: number = 3500): number {
  if (!logs || !Array.isArray(logs)) return 0;
  
  let totalUsd = 0;
  
  for (const log of logs) {
    // Look for Transfer events
    if (log.event?.startsWith('Transfer(') && log.topics?.length >= 3) {
      const tokenAddress = log.address?.id?.toLowerCase();
      const data = log.data;
      
      if (!tokenAddress || !data) continue;
      
      // Check if it's a stablecoin transfer
      const decimals = STABLECOIN_ADDRESSES[tokenAddress];
      if (decimals !== undefined) {
        try {
          // Parse the transfer amount from data (first 32 bytes after 0x)
          const amountHex = data.slice(0, 66); // 0x + 64 chars
          const amount = BigInt(amountHex);
          const usdValue = Number(amount) / Math.pow(10, decimals);
          totalUsd = Math.max(totalUsd, usdValue); // Take the larger value (in or out)
        } catch {
          // Skip if parsing fails
        }
      }
      
      // Check if it's WETH transfer
      if (WETH_ADDRESSES.has(tokenAddress)) {
        try {
          const amountHex = data.slice(0, 66);
          const amount = BigInt(amountHex);
          const ethValue = Number(amount) / 1e18;
          const usdValue = ethValue * ethPriceUsd;
          totalUsd = Math.max(totalUsd, usdValue);
        } catch {
          // Skip if parsing fails
        }
      }
    }
    
    // Also check for Swap events which have amounts in data
    if (log.event?.startsWith('Swap(') && log.data) {
      // Swap events typically have amount0In, amount1In, amount0Out, amount1Out
      // We can use the pool alias to determine token types
      const poolAlias = log.address?.alias?.toLowerCase() || '';
      if (poolAlias.includes('usd') || poolAlias.includes('usdt') || poolAlias.includes('usdc')) {
        // This is a stablecoin pool, try to extract USD amount
        try {
          // Data format: amount0In (32 bytes) + amount1In (32 bytes) + amount0Out (32 bytes) + amount1Out (32 bytes)
          const cleanData = log.data.replace('0x', '');
          if (cleanData.length >= 256) {
            const amount0In = BigInt('0x' + cleanData.slice(0, 64));
            const amount1Out = BigInt('0x' + cleanData.slice(192, 256));
            
            // Check which is the stablecoin amount (smaller decimals = stablecoin)
            // USDT0/USDC have 6 decimals, WETH has 18
            const stableAmount = amount0In > 0 ? Number(amount0In) / 1e6 : Number(amount1Out) / 1e6;
            if (stableAmount > 0 && stableAmount < 1e12) { // Sanity check
              totalUsd = Math.max(totalUsd, stableAmount);
            }
          }
        } catch {
          // Skip if parsing fails
        }
      }
    }
  }
  
  return totalUsd;
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

    // Get all swap transactions for this wallet with logs for volume calculation
    const result = await pool.query(
      `SELECT 
         contract_address,
         tx_hash,
         value,
         logs,
         COALESCE(total_usd_volume, 0) as total_usd_volume,
         COALESCE(tokens_in_usd_total, 0) as tokens_in_usd_total,
         COALESCE(tokens_out_usd_total, 0) as tokens_out_usd_total,
         COALESCE(eth_value_decimal, 0) as eth_value_decimal,
         COALESCE(eth_price_usd, 3500) as eth_price_usd
       FROM transaction_enrichment
       WHERE LOWER(wallet_address) = LOWER($1)
         AND method_id = ANY($2)`,
      [address, SWAP_METHOD_IDS]
    );

    // Aggregate results by contract address
    const platformAggregates = new Map<string, { ethValue: number; usdValue: number; txCount: number }>();

    for (const row of result.rows) {
      const contractAddr = row.contract_address.toLowerCase();
      
      // Calculate USD value - try existing columns first, then parse from logs
      let usdValue = parseFloat(row.total_usd_volume || '0');
      
      if (usdValue === 0) {
        usdValue = parseFloat(row.tokens_in_usd_total || '0') + parseFloat(row.tokens_out_usd_total || '0');
      }
      
      if (usdValue === 0 && row.logs) {
        // Parse logs JSON and extract volume
        try {
          const logs = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
          const ethPrice = parseFloat(row.eth_price_usd || '3500');
          usdValue = parseSwapVolumeFromLogs(logs, ethPrice);
        } catch {
          // If parsing fails, try ETH value fallback
        }
      }
      
      // Fallback to ETH value conversion
      if (usdValue === 0) {
        const ethValue = parseFloat(row.eth_value_decimal || '0');
        const ethPrice = parseFloat(row.eth_price_usd || '3500');
        if (ethValue > 0) {
          usdValue = ethValue * ethPrice;
        } else if (row.value) {
          // Try raw value field
          const rawValue = BigInt(row.value || '0');
          const ethFromRaw = Number(rawValue) / 1e18;
          usdValue = ethFromRaw * ethPrice;
        }
      }

      const existing = platformAggregates.get(contractAddr) || { ethValue: 0, usdValue: 0, txCount: 0 };
      existing.usdValue += usdValue;
      existing.txCount += 1;
      platformAggregates.set(contractAddr, existing);
    }

    let totalEth = 0;
    let totalUsd = 0;
    let totalTxCount = 0;
    const byPlatform: SwapVolumeResponse['byPlatform'] = [];

    for (const [contractAddr, aggregate] of platformAggregates) {
      totalEth += aggregate.ethValue;
      totalUsd += aggregate.usdValue;
      totalTxCount += aggregate.txCount;

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
        ethValue: aggregate.ethValue,
        usdValue: aggregate.usdValue,
        txCount: aggregate.txCount,
      });
    }

    // Sort by USD value descending
    byPlatform.sort((a, b) => b.usdValue - a.usdValue);

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
