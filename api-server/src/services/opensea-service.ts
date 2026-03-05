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
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 500; // 500ms between requests

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

    while (hasMore) {
      try {
        // Rate limiting: ensure minimum time between requests
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.minRequestInterval) {
          await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();

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

        const response = await fetch(OPENSEA_GRAPHQL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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

        // Handle rate limiting with exponential backoff
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000; // Default 5s
          console.warn(`[OpenSea] Rate limited, waiting ${waitTime}ms before retry`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry the same request
        }

        if (!response.ok) {
          console.error(`[OpenSea] API error: ${response.status} ${response.statusText}`);
          break;
        }

        const data = await response.json() as OpenSeaResponse;
        const items = data.data?.userActivity?.items || [];

        allItems.push(...items);

        cursor = data.data?.userActivity?.nextPageCursor;
        hasMore = cursor !== null && items.length > 0;

      } catch (error) {
        console.error('[OpenSea] Error fetching activity:', error);
        break;
      }
    }

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
   */
  async getAllCounts(walletAddress: string): Promise<ActivityCounts> {
    const activities = await this.fetchWalletActivity(walletAddress, ['SALE', 'MINT'], 'ink', true);
    return this.calculateActivityCounts(activities, walletAddress);
  }
}

export const openSeaService = new OpenSeaService();