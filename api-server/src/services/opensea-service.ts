// OpenSea GraphQL API Service
// Fetches NFT activity data (buys, sales, mints) from OpenSea's GraphQL endpoint

const OPENSEA_GRAPHQL_URL = 'https://gql.opensea.io/graphql';

// GraphQL query for user activity
const USER_ACTIVITY_QUERY = `
query UseProfileActivityQuery($addresses: [Address!], $filter: ProfileActivityFilterInput, $cursor: String, $limit: Int!) {
  userActivity(
    addresses: $addresses
    filter: $filter
    cursor: $cursor
    limit: $limit
  ) {
    items {
      id
      eventTime
      type
      transactionHash
      from {
        address
      }
      to {
        address
      }
      ... on Sale {
        saleType
        price {
          token {
            unit
            symbol
          }
          usd
        }
      }
      ... on Mint {
        quantity
      }
    }
    nextPageCursor
  }
}
`;

interface OpenSeaActivity {
  id: string;
  eventTime: string;
  type: 'SALE' | 'MINT' | 'LISTING' | 'TRANSFER' | 'CANCEL_LISTING';
  transactionHash: string;
  from: { address: string };
  to: { address: string };
  saleType?: string;
  price?: {
    token: { unit: number; symbol: string };
    usd: number;
  };
  quantity?: string;
}

interface OpenSeaResponse {
  data: {
    userActivity: {
      items: OpenSeaActivity[];
      nextPageCursor: string | null;
    };
  };
}

interface ActivityCounts {
  buys: number;
  sales: number;
  mints: number;
  buyTransactions: string[];
  saleTransactions: string[];
  mintTransactions: string[];
}

export class OpenSeaService {
  // In-memory cache: wallet -> { counts, timestamp }
  private countsCache: Map<string, { counts: ActivityCounts; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Dedup lock: wallet -> in-flight promise (prevents parallel duplicate fetches)
  private inflight: Map<string, Promise<ActivityCounts>> = new Map();

  /**
   * Populate the cache externally (called when Vercel pushes OpenSea counts).
   * This prevents Express from needing to call the OpenSea API itself.
   */
  setCachedCounts(walletAddress: string, buys: number, sales: number, mints: number): void {
    const key = walletAddress.toLowerCase();
    const counts: ActivityCounts = {
      buys, sales, mints,
      buyTransactions: [], saleTransactions: [], mintTransactions: [],
    };
    this.countsCache.set(key, { counts, timestamp: Date.now() });
    console.log(`[OpenSea] Cache set externally for ${key.slice(0, 10)}: buys=${buys} sales=${sales} mints=${mints}`);
  }

  /**
   * Fetch all activity for a wallet from OpenSea GraphQL API
   * Handles pagination automatically with rate limiting and retries
   */
  async fetchWalletActivity(
    walletAddress: string,
    activityTypes: string[] = ['SALE', 'MINT'],
    chain: string = 'ink',
    filterByMarketplace: boolean = false
  ): Promise<OpenSeaActivity[]> {
    const allItems: OpenSeaActivity[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let page = 0;
    const walletLabel = walletAddress.slice(0, 10);
    const overallStart = Date.now();
    const MAX_PAGES = 30; // Safety limit: 30 pages * 50 items = 1500 items max
    const PER_PAGE_TIMEOUT_MS = 10000; // 10s timeout per API call
    const OVERALL_TIMEOUT_MS = 45000; // 45s overall — return partial results after this

    while (hasMore) {
      page++;
      if (page > MAX_PAGES) {
        console.warn(`[OpenSea] ${walletLabel} hit max pages (${MAX_PAGES}), stopping. Got ${allItems.length} items.`);
        break;
      }

      // Overall timeout: return whatever we have so far
      if (Date.now() - overallStart > OVERALL_TIMEOUT_MS) {
        console.warn(`[OpenSea] ${walletLabel} overall timeout (${OVERALL_TIMEOUT_MS}ms) after ${page - 1} pages. Returning ${allItems.length} partial items.`);
        break;
      }

      try {
        const filter: any = {
          activityTypes,
          chains: [chain],
          collectionSlugs: [],
        };

        // Only add markets filter if requested (for SALE activities)
        if (filterByMarketplace) {
          filter.markets = ['opensea'];
        } else {
          filter.markets = [];
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);

        const pageStart = Date.now();
        const response = await fetch(OPENSEA_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify({
            operationName: 'UseProfileActivityQuery',
            query: USER_ACTIVITY_QUERY,
            variables: {
              addresses: [walletAddress.toLowerCase()],
              filter,
              cursor,
              limit: 50, // Max items per page
            },
          }),
        });

        clearTimeout(timeout);

        // Handle rate limiting with exponential backoff (max 2 retries)
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 3000;
          console.warn(`[OpenSea] ${walletLabel} page ${page} rate limited (429), waiting ${waitTime}ms`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          page--; // Retry same page
          continue;
        }

        if (!response.ok) {
          console.error(`[OpenSea] ${walletLabel} page ${page} API error: ${response.status} ${response.statusText}`);
          break;
        }

        const data = await response.json() as OpenSeaResponse;
        const items = data.data?.userActivity?.items || [];

        allItems.push(...items);

        cursor = data.data?.userActivity?.nextPageCursor;
        hasMore = cursor !== null && items.length > 0;

        console.log(`[OpenSea] ${walletLabel} page ${page}: ${items.length} items in ${Date.now() - pageStart}ms (total: ${allItems.length})`);

      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.error(`[OpenSea] ${walletLabel} page ${page} timed out after ${PER_PAGE_TIMEOUT_MS}ms`);
        } else {
          console.error(`[OpenSea] ${walletLabel} page ${page} error:`, error.message || error);
        }
        break;
      }
    }

    console.log(`[OpenSea] ${walletLabel} done: ${allItems.length} items in ${page} pages, ${((Date.now() - overallStart) / 1000).toFixed(2)}s`);
    return allItems;
  }

  /**
   * Calculate buy, sale, and mint counts from activity data
   *
   * Logic:
   * - Buy: type=SALE and to.address matches wallet (count individual items)
   * - Sale: type=SALE and from.address matches wallet (count individual items)
   * - Mint: type=MINT where to.address matches wallet (count unique transactions)
   *
   * Note:
   * - Buys/Sales count individual NFT items (7 NFTs in one tx = 7 buys)
   * - Mints count unique transactions (already filtered by OpenSea marketplace at API level)
   */
  calculateActivityCounts(
    activities: OpenSeaActivity[],
    walletAddress: string
  ): ActivityCounts {
    const normalizedWallet = walletAddress.toLowerCase();

    const buys: string[] = [];
    const sales: string[] = [];
    const mintTxs = new Set<string>(); // Use Set for unique transactions

    for (const activity of activities) {
      const fromAddress = activity.from?.address?.toLowerCase();
      const toAddress = activity.to?.address?.toLowerCase();

      if (activity.type === 'SALE') {
        // Buy: wallet is the buyer (to address) - count each item
        if (toAddress === normalizedWallet) {
          buys.push(activity.transactionHash);
        }
        // Sale: wallet is the seller (from address) - count each item
        else if (fromAddress === normalizedWallet) {
          sales.push(activity.transactionHash);
        }
      } else if (activity.type === 'MINT') {
        // Mint: wallet is the minter (to address matches wallet)
        // Already filtered by OpenSea marketplace at API level
        if (toAddress === normalizedWallet) {
          mintTxs.add(activity.transactionHash);
        }
      }
    }

    return {
      buys: buys.length,
      sales: sales.length,
      mints: mintTxs.size, // Use size for unique count
      buyTransactions: buys,
      saleTransactions: sales,
      mintTransactions: Array.from(mintTxs),
    };
  }

  /**
   * Get OpenSea buy count for a wallet
   */
  async getBuyCount(walletAddress: string): Promise<number> {
    const activities = await this.fetchWalletActivity(walletAddress, ['SALE']);
    const counts = this.calculateActivityCounts(activities, walletAddress);
    return counts.buys;
  }

  /**
   * Get OpenSea sale count for a wallet
   */
  async getSaleCount(walletAddress: string): Promise<number> {
    const activities = await this.fetchWalletActivity(walletAddress, ['SALE']);
    const counts = this.calculateActivityCounts(activities, walletAddress);
    return counts.sales;
  }

  /**
   * Get OpenSea mint count for a wallet
   */
  async getMintCount(walletAddress: string): Promise<number> {
    const activities = await this.fetchWalletActivity(walletAddress, ['MINT'], 'ink', true);
    const counts = this.calculateActivityCounts(activities, walletAddress);
    return counts.mints;
  }

  /**
   * Get all counts at once (more efficient - single API call)
   * Uses in-memory cache (1hr TTL) and dedup lock to prevent parallel duplicate fetches.
   */
  async getAllCounts(walletAddress: string): Promise<ActivityCounts> {
    const key = walletAddress.toLowerCase();

    // 1. Check cache
    const cached = this.countsCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      console.log(`[OpenSea] Cache hit for ${key.slice(0, 10)}...`);
      return cached.counts;
    }

    // 2. If there's already an in-flight request for this wallet, wait for it
    const existing = this.inflight.get(key);
    if (existing) {
      console.log(`[OpenSea] Dedup: joining in-flight request for ${key.slice(0, 10)}...`);
      return existing;
    }

    // 3. Start a new fetch with a 15s timeout
    const fetchPromise = (async (): Promise<ActivityCounts> => {
      try {
        const activities = await this.fetchWalletActivity(walletAddress, ['SALE', 'MINT'], 'ink', true);
        const counts = this.calculateActivityCounts(activities, walletAddress);

        // Store in cache
        this.countsCache.set(key, { counts, timestamp: Date.now() });
        return counts;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, fetchPromise);
    return fetchPromise;
  }
}

export const openSeaService = new OpenSeaService();