import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// Aggressive cache for score results per wallet (5 minute TTL)
const scoreResultsCache = new Map<string, { data: any; timestamp: number }>();
const SCORE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// GET /api/wallet/[address]/score - Get wallet score and rank
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  
  try {
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const walletAddress = address.toLowerCase();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Check aggressive in-memory cache first (unless refresh is requested)
    if (!forceRefresh) {
      const cachedResult = scoreResultsCache.get(walletAddress);
      if (cachedResult && Date.now() - cachedResult.timestamp < SCORE_CACHE_TTL) {
        return NextResponse.json(cachedResult.data);
      }

      // Try database cache with extended tolerance (30 minutes)
      const cached = await pointsService.getCachedWalletScore(address);
      if (cached) {
        const cacheAge = Date.now() - new Date(cached.last_updated).getTime();
        if (cacheAge < 30 * 60 * 1000) { // 30 minutes tolerance
          // Store in memory cache for faster subsequent requests
          scoreResultsCache.set(walletAddress, { data: cached, timestamp: Date.now() });
          return NextResponse.json(cached);
        }
      }
    }

    // Calculate fresh score only if absolutely necessary
    const score = await pointsService.calculateWalletScore(address);
    
    // Store in memory cache
    scoreResultsCache.set(walletAddress, { data: score, timestamp: Date.now() });
    
    return NextResponse.json(score);
  } catch (error) {
    console.error('Failed to calculate wallet score:', error);
    
    // Return a basic empty score instead of error
    const emptyScore = {
      wallet_address: address.toLowerCase(),
      total_points: 0,
      rank: null,
      breakdown: { native: {}, platforms: {} },
      last_updated: new Date(),
    };
    
    return NextResponse.json(emptyScore);
  }
}
