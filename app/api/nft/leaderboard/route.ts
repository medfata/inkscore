import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboardData } from '@/lib/leaderboard-cache';

export const revalidate = 600;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const search = searchParams.get('search')?.trim().toLowerCase() || '';
    const limit = 10;

    const { leaderboard, total, source, lastUpdated } = await getLeaderboardData();

    if (search) {
      const matches = leaderboard
        .map((entry, idx) => ({ ...entry, globalRank: idx + 1 }))
        .filter(entry => entry.wallet_address.toLowerCase().includes(search));

      return NextResponse.json({
        leaderboard: matches.slice(0, 20),
        total: matches.length,
        limit,
        currentPage: 1,
        totalPages: 1,
        hasMore: false,
        source,
        lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
        isSearch: true,
      });
    }

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
      lastUpdated: lastUpdated ? lastUpdated.toISOString() : null,
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
