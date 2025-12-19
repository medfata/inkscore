import { NextRequest, NextResponse } from 'next/server';
import { analyticsService } from '@/lib/services/analytics-service';

// GET /api/analytics/[wallet] - Get all analytics for a wallet
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const analytics = await analyticsService.getWalletAnalytics(wallet);

    return NextResponse.json(analytics);
  } catch (error) {
    console.error('Error fetching wallet analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet analytics' },
      { status: 500 }
    );
  }
}
