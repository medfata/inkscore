import { NextRequest, NextResponse } from 'next/server';

const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';
const EXPLORER_API = 'https://explorer.inkonchain.com/api/v2/tokens';
const DEAD_WALLET = '0x0000000000000000000000000000000000000000';
const BROKEN_SCORE_WALLET = '0x4C50254DaFD191bBA2A6e0517C1742Caf1426dF5';
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

// Cache configuration - revalidate every 10 minutes (600 seconds)
export const revalidate = 600;

// In-memory cache (works on Vercel within each serverless instance)
let cachedLeaderboard: any[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds

interface ExplorerNFTAttribute {
  trait_type: string;
  value: string | number;
}

interface ExplorerNFTMetadata {
  attributes: ExplorerNFTAttribute[];
}

interface ExplorerNFTOwner {
  hash: string;
}

interface ExplorerNFT {
  id: string;
  image_url: string;
  metadata: ExplorerNFTMetadata;
  owner: ExplorerNFTOwner;
}

interface ExplorerResponse {
  items: ExplorerNFT[];
  next_page_params: {
    unique_token: number;
  } | null;
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
    const limit = 50;

    let leaderboard: any[];

    // Check if cache is valid
    const now = Date.now();
    const isCacheValid = cachedLeaderboard && (now - cacheTimestamp) < CACHE_DURATION;

    if (isCacheValid) {
      console.log(`[Leaderboard] Using cached data (age: ${Math.round((now - cacheTimestamp) / 1000)}s)`);
      leaderboard = cachedLeaderboard!;
    } else {
      console.log(`[Leaderboard] Cache miss or expired, fetching fresh data...`);

      // Fetch ALL NFTs from Explorer API
      let allNFTs: ExplorerNFT[] = [];
      let nextPageParams: { unique_token: number } | null = null;
      let baseUrl = `${EXPLORER_API}/${NFT_CONTRACT_ADDRESS}/instances`;

      // Fetch all pages from Explorer
      do {
        const url = nextPageParams
          ? `${baseUrl}?unique_token=${nextPageParams.unique_token}`
          : baseUrl;

        const explorerResponse = await fetch(url);
        if (!explorerResponse.ok) {
          throw new Error(`Explorer API error: ${explorerResponse.status}`);
        }

        const data: ExplorerResponse = await explorerResponse.json();
        allNFTs = [...allNFTs, ...data.items];
        nextPageParams = data.next_page_params;
      } while (nextPageParams !== null);

      console.log(`[Leaderboard] Fetched ${allNFTs.length} total NFTs`);

      // Filter out burned NFTs (owned by dead wallet)
      const validNFTs = allNFTs.filter(
        nft => nft.owner?.hash &&
          nft.owner.hash.toLowerCase() !== DEAD_WALLET.toLowerCase()
      );

      console.log(`[Leaderboard] ${validNFTs.length} valid NFTs after filtering`);

      // Extract score from metadata and build leaderboard
      leaderboard = validNFTs.map((nft) => {
        const scoreAttr = nft.metadata?.attributes?.find(
          attr => attr.trait_type === 'Score'
        );
        const rankAttr = nft.metadata?.attributes?.find(
          attr => attr.trait_type === 'Rank'
        );

        return {
          wallet_address: nft.owner.hash,
          token_id: nft.id,
          nft_image_url: nft.image_url,
          score: typeof scoreAttr?.value === 'number' ? scoreAttr.value : 0,
          rank: typeof rankAttr?.value === 'string' ? rankAttr.value : 'Unranked',
        };
      });

      // Fix score for the broken wallet by fetching from API server
      const brokenWalletEntry = leaderboard.find(
        entry => entry.wallet_address.toLowerCase() === BROKEN_SCORE_WALLET.toLowerCase()
      );

      if (brokenWalletEntry) {
        console.log(`[Leaderboard] Found broken wallet ${BROKEN_SCORE_WALLET}, fetching correct score...`);
        try {
          const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${BROKEN_SCORE_WALLET.toLowerCase()}/score`);
          if (scoreRes.ok) {
            const scoreData: WalletScoreResponse = await scoreRes.json();
            brokenWalletEntry.score = scoreData.total_points;
            brokenWalletEntry.rank = scoreData.rank?.name || 'Unranked';
            console.log(`[Leaderboard] Updated broken wallet score to ${scoreData.total_points}`);
          }
        } catch (error) {
          console.error(`[Leaderboard] Failed to fetch correct score for broken wallet:`, error);
        }
      }

      // Sort by score descending
      leaderboard.sort((a, b) => b.score - a.score);

      // Update cache
      cachedLeaderboard = leaderboard;
      cacheTimestamp = now;
      console.log(`[Leaderboard] Cache updated with ${leaderboard.length} entries`);
    }

    // Paginate the sorted results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedLeaderboard = leaderboard.slice(startIndex, endIndex);
    const totalPages = Math.ceil(leaderboard.length / limit);

    console.log(`[Leaderboard] Returning page ${page}/${totalPages}`);

    const response = NextResponse.json({
      leaderboard: paginatedLeaderboard,
      total: leaderboard.length,
      limit,
      currentPage: page,
      totalPages,
      hasMore: page < totalPages,
    });

    // Add cache headers for CDN and browser caching
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
