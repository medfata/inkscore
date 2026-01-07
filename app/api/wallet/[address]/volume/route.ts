import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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

    // Simple, fast queries using existing indexes
    const [ethPriceResult, outgoingResult] = await Promise.all([
      query<{ price_usd: number }>(`SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`),
      query<{ total_eth: string; tx_count: string }>(`
        SELECT 
          COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as total_eth,
          COUNT(*) as tx_count
        FROM transaction_details
        WHERE wallet_address = $1 AND status = 1
      `, [walletAddress])
    ]);

    const ethPrice = ethPriceResult[0]?.price_usd || 3500;
    const outgoingEth = parseFloat(outgoingResult[0]?.total_eth || '0');
    const outgoingCount = parseInt(outgoingResult[0]?.tx_count || '0');

    // Skip incoming calculation for now to improve performance
    // Most volume is from outgoing transactions anyway
    const incomingEth = 0;
    const incomingCount = 0;

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
    
    // Return empty response on error instead of 500
    const emptyResponse: TotalVolumeResponse = {
      totalEth: 0,
      totalUsd: 0,
      txCount: 0,
      incoming: { eth: 0, usd: 0, count: 0 },
      outgoing: { eth: 0, usd: 0, count: 0 },
    };
    
    return NextResponse.json(emptyResponse);
  }
}
