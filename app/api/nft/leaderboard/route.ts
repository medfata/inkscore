import { NextRequest, NextResponse } from 'next/server';

const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';
const ROUTESCAN_API = 'https://cdn-canary.routescan.io/api/evm/57073/erc721';
const DEAD_WALLET = '0x0000000000000000000000000000000000000000';
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

interface RoutescanToken {
  tokenId: string;
  currentOwner?: {
    id: string;
    isContract: boolean;
  };
  uri256?: string;
  uri1024?: string;
}

interface RoutescanResponse {
  items: RoutescanToken[];
  count?: number;
  link?: {
    next?: string;
    nextToken?: string;
  };
}

interface WalletScoreResponse {
  wallet_address: string;
  total_points: number;
  rank: {
    name: string;
    color: string | null;
    logo_url: string | null;
  } | null;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = 10;

    // Fetch ALL NFTs from Routescan (no pagination on Routescan side)
    let allTokens: RoutescanToken[] = [];
    let nextToken: string | null = null;
    let routescanUrl = `${ROUTESCAN_API}/${NFT_CONTRACT_ADDRESS}/tokens?ecosystem=57073&limit=50&count=true`;

    console.log(`[Leaderboard] Fetching all NFTs from Routescan...`);

    // Fetch all pages from Routescan
    do {
      const url = nextToken 
        ? `${routescanUrl}&next=${encodeURIComponent(nextToken)}`
        : routescanUrl;
      
      const routescanResponse = await fetch(url);
      if (!routescanResponse.ok) {
        throw new Error(`Routescan API error: ${routescanResponse.status}`);
      }

      const data: RoutescanResponse = await routescanResponse.json();
      allTokens = [...allTokens, ...data.items];
      nextToken = data.link?.nextToken || null;
    } while (nextToken);

    console.log(`[Leaderboard] Fetched ${allTokens.length} total NFTs`);

    // Filter out burned NFTs (owned by dead wallet) and tokens without owner
    const validTokens = allTokens.filter(
      token => token.currentOwner?.id &&
        token.currentOwner.id.toLowerCase() !== DEAD_WALLET.toLowerCase()
    );

    console.log(`[Leaderboard] ${validTokens.length} valid NFTs after filtering`);

    // Fetch scores for all valid tokens
    const leaderboardWithScores = await Promise.all(
      validTokens.map(async (token) => {
        let score = 0;
        let rank = 'Unranked';

        try {
          // Fetch score from API server
          const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${token.currentOwner!.id.toLowerCase()}/score`);
          if (scoreRes.ok) {
            const scoreData: WalletScoreResponse = await scoreRes.json();
            score = scoreData.total_points;
            rank = scoreData.rank?.name || 'Unranked';
          }
        } catch (error) {
          console.error(`Failed to fetch score for wallet ${token.currentOwner!.id}:`, error);
        }

        return {
          wallet_address: token.currentOwner!.id,
          token_id: token.tokenId,
          nft_image_url: token.uri256 || token.uri1024 || '', // Use Routescan's cached image
          score,
          rank,
        };
      })
    );

    // Sort ALL entries by score descending (global sort)
    leaderboardWithScores.sort((a, b) => b.score - a.score);

    // Paginate the sorted results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLeaderboard = leaderboardWithScores.slice(startIndex, endIndex);
    const totalPages = Math.ceil(leaderboardWithScores.length / limit);

    console.log(`[Leaderboard] Returning page ${page}/${totalPages}`);

    return NextResponse.json({
      leaderboard: paginatedLeaderboard,
      total: leaderboardWithScores.length,
      limit,
      currentPage: page,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    console.error('[NFT Leaderboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
