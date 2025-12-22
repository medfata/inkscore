import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/wallet/[address]/score - Get wallet score and rank
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Try to get cached score first (unless refresh is requested)
    if (!forceRefresh) {
      const cached = await pointsService.getCachedWalletScore(address);
      if (cached) {
        // Check if cache is fresh (less than 5 minutes old)
        const cacheAge = Date.now() - new Date(cached.last_updated).getTime();
        if (cacheAge < 5 * 60 * 1000) {
          return NextResponse.json(cached);
        }
      }
    }

    // Calculate fresh score
    const score = await pointsService.calculateWalletScore(address);
    return NextResponse.json(score);
  } catch (error) {
    console.error('Failed to calculate wallet score:', error);
    return NextResponse.json(
      { error: 'Failed to calculate wallet score' },
      { status: 500 }
    );
  }
}
