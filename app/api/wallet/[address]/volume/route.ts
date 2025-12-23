import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface TotalVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  incoming: {
    eth: number;
    usd: number;
    count: number;
  };
  outgoing: {
    eth: number;
    usd: number;
    count: number;
  };
}

// Cache for volume results per wallet (30 second TTL)
const volumeResultsCache = new Map<string, { data: TotalVolumeResponse; timestamp: number }>();
const RESULTS_CACHE_TTL = 30 * 1000;

// GET /api/wallet/[address]/volume - Get total volume circulated for a wallet
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
    const cachedResult = volumeResultsCache.get(walletAddress);
    if (cachedResult && Date.now() - cachedResult.timestamp < RESULTS_CACHE_TTL) {
      return NextResponse.json(cachedResult.data);
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

    // Query outgoing transactions (wallet is the sender)
    let outgoingResult;
    try {
      outgoingResult = await pool.query(
        `SELECT 
           COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as total_eth,
           COUNT(*) as tx_count
         FROM transaction_details
         WHERE wallet_address = $1
           AND status = 1`,
        [walletAddress]
      );
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (errorMessage.includes('does not exist')) {
        return NextResponse.json({
          totalEth: 0,
          totalUsd: 0,
          txCount: 0,
          incoming: { eth: 0, usd: 0, count: 0 },
          outgoing: { eth: 0, usd: 0, count: 0 },
        });
      }
      throw dbError;
    }

    // Query incoming transactions (wallet receives ETH via token transfers or direct transfers)
    // We check transaction_token_transfers where wallet is the recipient
    let incomingResult;
    try {
      incomingResult = await pool.query(
        `SELECT 
           COALESCE(SUM(
             CASE 
               WHEN token_address = '0x4200000000000000000000000000000000000006' 
               THEN COALESCE(amount_decimal, 0)
               ELSE 0 
             END
           ), 0) as total_eth,
           COUNT(DISTINCT tx_hash) as tx_count
         FROM transaction_token_transfers
         WHERE to_address = $1`,
        [walletAddress]
      );
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (errorMessage.includes('does not exist')) {
        incomingResult = { rows: [{ total_eth: '0', tx_count: '0' }] };
      } else {
        throw dbError;
      }
    }

    const outgoingEth = parseFloat(outgoingResult.rows[0]?.total_eth || '0');
    const outgoingCount = parseInt(outgoingResult.rows[0]?.tx_count || '0');
    const incomingEth = parseFloat(incomingResult.rows[0]?.total_eth || '0');
    const incomingCount = parseInt(incomingResult.rows[0]?.tx_count || '0');

    const totalEth = outgoingEth + incomingEth;
    const totalUsd = totalEth * ethPrice;

    const response: TotalVolumeResponse = {
      totalEth,
      totalUsd,
      txCount: outgoingCount + incomingCount,
      incoming: {
        eth: incomingEth,
        usd: incomingEth * ethPrice,
        count: incomingCount,
      },
      outgoing: {
        eth: outgoingEth,
        usd: outgoingEth * ethPrice,
        count: outgoingCount,
      },
    };

    // Cache the result
    volumeResultsCache.set(walletAddress, { data: response, timestamp: Date.now() });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching total volume:', error);
    return NextResponse.json(
      { error: 'Failed to fetch total volume' },
      { status: 500 }
    );
  }
}
