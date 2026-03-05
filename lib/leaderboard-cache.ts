import { query, queryOne } from './db';

const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';
const EXPLORER_API = 'https://explorer.inkonchain.com/api/v2/tokens';
const DEAD_WALLET = '0x0000000000000000000000000000000000000000';
const BROKEN_SCORE_WALLET = '0x4C50254DaFD191bBA2A6e0517C1742Caf1426dF5';
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

const CACHE_TTL_HOURS = 5;
const STALE_THRESHOLD_HOURS = 2;
const MAX_RETRIES = 5;

interface CachedLeaderboard {
  id: number;
  leaderboard_data: any[];
  total_count: number;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

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

let isRefreshing = false;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getCachedLeaderboard(): Promise<{
  data: any[];
  isStale: boolean;
  isExpired: boolean;
} | null> {
  try {
    const row = await queryOne<CachedLeaderboard>(
      `SELECT id, leaderboard_data, total_count, expires_at, created_at, updated_at 
       FROM cached_leaderboard WHERE id = 1`
    );

    if (!row || !row.leaderboard_data || row.leaderboard_data.length === 0) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(row.expires_at);
    const isExpired = now > expiresAt;
    const staleThreshold = new Date(expiresAt.getTime() + STALE_THRESHOLD_HOURS * 60 * 60 * 1000);
    const isStale = !isExpired && now > staleThreshold;

    return {
      data: row.leaderboard_data,
      isStale,
      isExpired,
    };
  } catch (error) {
    console.error('[LeaderboardCache] Error fetching cache:', error);
    return null;
  }
}

export async function setCachedLeaderboard(leaderboard: any[]): Promise<boolean> {
  try {
    const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);

    await query(
      `INSERT INTO cached_leaderboard (id, leaderboard_data, total_count, expires_at, updated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         leaderboard_data = EXCLUDED.leaderboard_data,
         total_count = EXCLUDED.total_count,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [JSON.stringify(leaderboard), leaderboard.length, expiresAt]
    );

    console.log(`[LeaderboardCache] Cached ${leaderboard.length} entries, expires at ${expiresAt.toISOString()}`);
    return true;
  } catch (error) {
    console.error('[LeaderboardCache] Error setting cache:', error);
    return false;
  }
}

async function fetchLeaderboardFromExplorer(): Promise<any[]> {
  console.log('[LeaderboardCache] Fetching from Explorer API...');

  let allNFTs: ExplorerNFT[] = [];
  let nextPageParams: { unique_token: number } | null = null;
  let baseUrl = `${EXPLORER_API}/${NFT_CONTRACT_ADDRESS}/instances`;

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

  console.log(`[LeaderboardCache] Fetched ${allNFTs.length} total NFTs`);

  const validNFTs = allNFTs.filter(
    nft => nft.owner?.hash &&
      nft.owner.hash.toLowerCase() !== DEAD_WALLET.toLowerCase()
  );

  console.log(`[LeaderboardCache] ${validNFTs.length} valid NFTs after filtering`);

  let leaderboard = validNFTs.map((nft) => {
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

  const brokenWalletEntry = leaderboard.find(
    entry => entry.wallet_address.toLowerCase() === BROKEN_SCORE_WALLET.toLowerCase()
  );

  if (brokenWalletEntry) {
    console.log(`[LeaderboardCache] Found broken wallet, fetching correct score...`);
    try {
      const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${BROKEN_SCORE_WALLET.toLowerCase()}/score`);
      if (scoreRes.ok) {
        const scoreData: WalletScoreResponse = await scoreRes.json();
        brokenWalletEntry.score = scoreData.total_points;
        brokenWalletEntry.rank = scoreData.rank?.name || 'Unranked';
        console.log(`[LeaderboardCache] Updated broken wallet score to ${scoreData.total_points}`);
      }
    } catch (error) {
      console.error(`[LeaderboardCache] Failed to fetch correct score:`, error);
    }
  }

  leaderboard.sort((a, b) => b.score - a.score);

  return leaderboard;
}

async function refreshLeaderboardInternal(): Promise<void> {
  if (isRefreshing) {
    console.log('[LeaderboardCache] Refresh already in progress, skipping');
    return;
  }

  isRefreshing = true;

  try {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[LeaderboardCache] Refresh attempt ${attempt}/${MAX_RETRIES}`);
        const leaderboard = await fetchLeaderboardFromExplorer();
        await setCachedLeaderboard(leaderboard);
        console.log(`[LeaderboardCache] Refresh completed successfully`);
        return;
      } catch (error) {
        console.error(`[LeaderboardCache] Refresh attempt ${attempt} failed:`, error);
        if (attempt < MAX_RETRIES) {
          await sleep(attempt * 5000);
        }
      }
    }
    console.error(`[LeaderboardCache] All ${MAX_RETRIES} refresh attempts failed`);
  } finally {
    isRefreshing = false;
  }
}

export function triggerBackgroundRefresh(): void {
  console.log('[LeaderboardCache] Triggering background refresh');
  
  setImmediate(async () => {
    await refreshLeaderboardInternal();
  });
}

export async function getLeaderboardData(): Promise<{
  leaderboard: any[];
  total: number;
  source: 'cache' | 'fresh';
}> {
  const cached = await getCachedLeaderboard();

  if (!cached) {
    console.log('[LeaderboardCache] No cache found, fetching fresh data');
    const leaderboard = await fetchLeaderboardFromExplorer();
    await setCachedLeaderboard(leaderboard);
    return { leaderboard, total: leaderboard.length, source: 'fresh' };
  }

  if (!cached.isExpired && !cached.isStale) {
    console.log('[LeaderboardCache] Cache hit (valid)');
    return { leaderboard: cached.data, total: cached.data.length, source: 'cache' };
  }

  if (cached.isStale && !cached.isExpired) {
    console.log('[LeaderboardCache] Cache hit (stale), triggering background refresh');
    triggerBackgroundRefresh();
    return { leaderboard: cached.data, total: cached.data.length, source: 'cache' };
  }

  console.log('[LeaderboardCache] Cache expired (> 2 hours), fetching fresh data');
  const leaderboard = await fetchLeaderboardFromExplorer();
  await setCachedLeaderboard(leaderboard);
  return { leaderboard, total: leaderboard.length, source: 'fresh' };
}
