import { NextRequest, NextResponse } from 'next/server';
import { walletStatsService } from '@/lib/services/wallet-stats-service';

// GET /api/wallet/[address]/stats - Get wallet stats from Routescan
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

    const stats = await walletStatsService.getAllStats(address);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet stats' },
      { status: 500 }
    );
  }
}
