import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/lib/services/analytics-service';
import { query } from '@/lib/db';

// GM contract address
const GM_CONTRACT_ADDRESS = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';

// GET /api/analytics/[wallet]/[metric] - Get specific metric for a wallet
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ wallet: string; metric: string }> }
) {
  try {
    const { wallet, metric } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Special handling for gm_count - direct native query
    if (metric === 'gm_count') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count 
        FROM transaction_details 
        WHERE contract_address = $1 
          AND wallet_address = lower($2)
      `, [GM_CONTRACT_ADDRESS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      return NextResponse.json({
        slug: 'gm_count',
        name: 'GM Count',
        icon: '👋',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      });
    }

    // For other metrics, use the existing analytics service
    // TODO: Rework this metric logic later
    const result = await analyticsService.getWalletMetric(wallet, metric);

    if (!result) {
      return NextResponse.json(
        { error: 'Metric not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching wallet metric:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet metric' },
      { status: 500 }
    );
  }
}
