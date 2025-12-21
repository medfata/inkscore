import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface BridgeVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  byPlatform: Array<{
    platform: string;
    subPlatform?: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
  }>;
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

    // Get bridge volume grouped by platform (and sub_platform if exists)
    let result;
    try {
      result = await pool.query(
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
    } catch (dbError: unknown) {
      // Table might not exist yet - return empty response
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
    let ethPrice = 3500; // Fallback price
    try {
      const priceResult = await pool.query(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      ethPrice = priceResult.rows[0]?.price_usd || 3500;
    } catch {
      // Use fallback price if eth_prices table doesn't exist
    }

    let totalEth = 0;
    let totalTxCount = 0;
    const byPlatform: BridgeVolumeResponse['byPlatform'] = [];

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

    const response: BridgeVolumeResponse = {
      totalEth,
      totalUsd: totalEth * ethPrice,
      txCount: totalTxCount,
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
