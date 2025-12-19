import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/lib/services/analytics-service';

// GET /api/analytics/[wallet]/[metric] - Get specific metric for a wallet
export async function GET(
  request: NextRequest,
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
