import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-cache';

export const revalidate = 600;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = 50;

    const { leaderboard, total, source } = await getLeaderboardData();

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLeaderboard = leaderboard.slice(startIndex, endIndex);
    const totalPages = Math.ceil(leaderboard.length / limit);

    console.log(`[Leaderboard] Returning page ${page}/${totalPages} (source: ${source})`);

    const response = NextResponse.json({
      leaderboard: paginatedLeaderboard,
      total,
      limit,
      currentPage: page,
      totalPages,
      hasMore: page < totalPages,
      source,
    });

    response.headers.set('Cache-Control', 's-maxage=600, stale-while-revalidate=300');

    return response;
  } catch (error) {
    console.error('[NFT Leaderboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
