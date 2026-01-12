import { assetsService, setWalletStatsCacheClearer } from './assets-service';
import { TrackedAsset } from '../types/assets';

const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn-canary.routescan.io/api';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Known BTC-pegged token addresses (lowercase)
const BTC_PEGGED_TOKENS = new Set([
  '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98', // kBTC
]);

// Legacy exports for backward compatibility (will be loaded from DB)
export let SPECIAL_NFT_COLLECTIONS: Array<{
  name: string;
  address: string;
  logo: string;
}> = [];

export let SPECIAL_TOKENS: Array<{
  name: string;
  symbol: string;
  address: string;
  logo: string;
  decimals: number;
  isStablecoin: boolean;
  tokenType: TokenType;
}> = [];

export interface NftCollectionHolding {
  name: string;
  address: string;
  logo: string;
  count: number;
}

export type TokenType = 'meme' | 'stablecoin' | 'native' | 'defi' | 'governance' | 'utility' | null;

export interface TokenHolding {
  name: string;
  symbol: string;
  address: string;
  logo: string;
  balance: number;
  usdValue: number;
  tokenType: TokenType;
}

// Cache for meme coin prices (5 minute TTL)
interface PriceCache {
  prices: Map<string, number>;
  timestamp: number;
}

let memeCoinPriceCache: PriceCache | null = null;
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for BTC price (5 minute TTL)
interface BtcPriceCache {
  price: number;
  timestamp: number;
}

let btcPriceCache: BtcPriceCache | null = null;

export interface WalletStatsData {
  balanceUsd: number;
  balanceEth: number;
  totalTxns: number;
  nftCount: number;
  ageDays: number;
  firstTxDate: string | null;
  nftCollections: NftCollectionHolding[];
  tokenHoldings: TokenHolding[];
}

// Cache for wallet stats (30 second TTL)
interface StatsCache {
  data: WalletStatsData;
  timestamp: number;
}
const walletStatsCache = new Map<string, StatsCache>();
const STATS_CACHE_TTL = 30 * 1000; // 30 seconds

// Function to clear wallet stats cache (called when assets are reordered)
export function clearWalletStatsCache(): void {
  walletStatsCache.clear();
}

export class WalletStatsService {
  // Get wallet overview (balance only - age is fetched separately for Ink chain)
  async getWalletOverview(walletAddress: string): Promise<{
    balanceUsd: number;
    balanceEth: number;
  }> {
    try {
      const url = `${ROUTESCAN_BASE_URL}/blockchain/all/address/${walletAddress}?excludedChainIds=1682324,2061,80002,4202,295&ecosystem=all`;
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Routescan API error: ${response.status}`);
      }

      const data = await response.json();

      // Find Ink chain instance
      const inkInstance = data.instances?.find((i: { chainId: string }) => i.chainId === INK_CHAIN_ID);

      let balanceUsd = 0;
      let balanceEth = 0;

      if (inkInstance?.data?.evmBalance) {
        balanceUsd = parseFloat(inkInstance.data.evmBalance.usdValue || '0');
        balanceEth = parseFloat(inkInstance.data.evmBalance.balance || '0') / 1e18;
      }

      return { balanceUsd, balanceEth };
    } catch (error) {
      console.error('Failed to fetch wallet overview:', error);
      return { balanceUsd: 0, balanceEth: 0 };
    }
  }

  // Get Ink chain transaction stats (first tx date + total count in one call)
  async getInkChainTxStats(walletAddress: string): Promise<{
    firstTxDate: string | null;
    totalTxns: number;
  }> {
    try {
      // Query oldest transaction on Ink chain (sort=asc gets first tx, count=true gets total)
      const url = `${ROUTESCAN_BASE_URL}/evm/all/transactions?fromAddresses=${walletAddress}&toAddresses=${walletAddress}&includedChainIds=${INK_CHAIN_ID}&count=true&limit=1&sort=asc`;
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Routescan API error: ${response.status}`);
      }

      const data = await response.json();

      // Get both first tx timestamp and total count from same response
      const firstTxDate =
        data.items && data.items.length > 0 ? data.items[0].timestamp || null : null;
      const totalTxns = data.count || 0;

      return { firstTxDate, totalTxns };
    } catch (error) {
      console.error('Failed to fetch Ink chain tx stats:', error);
      return { firstTxDate: null, totalTxns: 0 };
    }
  }

  // Get all NFT holdings on Ink chain (paginated to get all)
  async getAllNftHoldings(walletAddress: string): Promise<{
    totalCount: number;
    holdings: Array<{ tokenAddress: string; balance: string; type: string }>;
  }> {
    const allHoldings: Array<{ tokenAddress: string; balance: string; type: string }> = [];
    let nextToken: string | null = null;
    let totalCount = 0;

    try {
      let hasMore = true;
      while (hasMore) {
        const baseUrl = `${ROUTESCAN_BASE_URL}/evm/all/address/${walletAddress}/nft-holdings?includedChainIds=${INK_CHAIN_ID}&count=true&limit=500`;
        const fetchUrl: string = nextToken
          ? `${baseUrl}&next=${encodeURIComponent(nextToken)}`
          : baseUrl;

        const response: Response = await fetch(fetchUrl);

        if (!response.ok) {
          throw new Error(`Routescan API error: ${response.status}`);
        }

        const data: {
          count?: number;
          items?: Array<{ tokenAddress: string; balance?: string; type: string }>;
          link?: { nextToken?: string };
        } = await response.json();

        if (data.count) {
          totalCount = data.count;
        }

        if (data.items && data.items.length > 0) {
          allHoldings.push(
            ...data.items.map((item) => ({
              tokenAddress: item.tokenAddress.toLowerCase(),
              balance: item.balance || '1', // ERC721 has no balance field, default to 1
              type: item.type,
            }))
          );
        }

        // Check for pagination
        nextToken = data.link?.nextToken || null;
        hasMore = !!nextToken;
      }

      return { totalCount, holdings: allHoldings };
    } catch (error) {
      console.error('Failed to fetch NFT holdings:', error);
      return { totalCount: 0, holdings: [] };
    }
  }

  // Count holdings for special NFT collections (now loads from DB)
  async countSpecialCollections(
    holdings: Array<{ tokenAddress: string; balance: string; type: string }>
  ): Promise<NftCollectionHolding[]> {
    // Load NFT collections from database
    const nftCollections = await assetsService.getNftCollections();
    
    return nftCollections.map((collection) => {
      const collectionAddress = collection.address.toLowerCase();

      // Sum up all NFTs from this collection
      const count = holdings
        .filter((h) => h.tokenAddress === collectionAddress)
        .reduce((sum, h) => sum + parseInt(h.balance || '1', 10), 0);

      return {
        name: collection.name,
        address: collection.address,
        logo: collection.logo_url || '',
        count,
      };
    });
  }

  // Fetch BTC price from CoinGecko (with caching)
  async getBtcPrice(): Promise<number> {
    // Check cache first
    if (btcPriceCache && Date.now() - btcPriceCache.timestamp < PRICE_CACHE_TTL) {
      return btcPriceCache.price;
    }

    try {
      const response = await fetch(`${COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies=usd`);
      
      if (!response.ok) {
        console.error(`CoinGecko API error: ${response.status}`);
        return btcPriceCache?.price || 100000; // Fallback to cached or default
      }

      const data = await response.json();
      const price = data.bitcoin?.usd || 100000;

      // Update cache
      btcPriceCache = { price, timestamp: Date.now() };

      return price;
    } catch (error) {
      console.error('Failed to fetch BTC price:', error);
      return btcPriceCache?.price || 100000; // Fallback
    }
  }

  // Fetch token prices from DexScreener for tokens without Routescan prices
  async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    // Check cache first
    if (memeCoinPriceCache && Date.now() - memeCoinPriceCache.timestamp < PRICE_CACHE_TTL) {
      return memeCoinPriceCache.prices;
    }

    const prices = new Map<string, number>();

    if (tokenAddresses.length === 0) {
      return prices;
    }

    try {
      // DexScreener accepts comma-separated addresses
      const addresses = tokenAddresses.join(',');
      const response = await fetch(`${DEXSCREENER_API}/${addresses}`);

      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return prices;
      }

      const data = await response.json();

      // DexScreener returns pairs, we need to find the best price for each token
      if (data.pairs && Array.isArray(data.pairs)) {
        for (const pair of data.pairs) {
          // Only consider pairs on Ink chain (chainId: ink)
          if (pair.chainId !== 'ink') continue;

          const tokenAddress = pair.baseToken?.address?.toLowerCase();
          const priceUsd = parseFloat(pair.priceUsd || '0');

          if (tokenAddress && priceUsd > 0) {
            // Keep the highest liquidity pair's price
            const existingPrice = prices.get(tokenAddress);
            if (!existingPrice || priceUsd > existingPrice) {
              prices.set(tokenAddress, priceUsd);
            }
          }
        }
      }

      // Update cache
      memeCoinPriceCache = {
        prices,
        timestamp: Date.now(),
      };

      return prices;
    } catch (error) {
      console.error('Failed to fetch token prices:', error);
      return prices;
    }
  }

  // Legacy method for backward compatibility
  async getMemeCoinPrices(): Promise<Map<string, number>> {
    const memeCoins = await assetsService.getMemeCoins();
    return this.getTokenPrices(memeCoins.map((t) => t.address));
  }

  // Get ERC-20 token holdings on Ink chain (paginated to get all)
  async getTokenHoldings(walletAddress: string): Promise<TokenHolding[]> {
    // Map to store balance, USD value, and decimals per token address
    const tokenDataMap = new Map<string, { balance: string; usdValue: number; decimals: number }>();
    let nextToken: string | null = null;

    try {
      let hasMore = true;
      while (hasMore) {
        const baseUrl = `${ROUTESCAN_BASE_URL}/evm/all/address/${walletAddress}/erc20-holdings?includedChainIds=${INK_CHAIN_ID}&limit=500`;
        const fetchUrl: string = nextToken
          ? `${baseUrl}&next=${encodeURIComponent(nextToken)}`
          : baseUrl;

        const response: Response = await fetch(fetchUrl);

        if (!response.ok) {
          throw new Error(`Routescan API error: ${response.status}`);
        }

        const data: {
          items?: Array<{
            tokenAddress: string;
            holderBalance: string;
            valueInUsd?: number;
            token?: { 
              decimals?: number;
            };
          }>;
          link?: { nextToken?: string };
        } = await response.json();

        // Add token data to map
        if (data.items) {
          for (const item of data.items) {
            const addr = item.tokenAddress.toLowerCase();
            const existing = tokenDataMap.get(addr);
            const decimals = item.token?.decimals || 18;

            if (existing) {
              // Accumulate balance and USD value
              const newBalance = (BigInt(existing.balance) + BigInt(item.holderBalance)).toString();
              tokenDataMap.set(addr, {
                balance: newBalance,
                usdValue: existing.usdValue + (item.valueInUsd || 0),
                decimals,
              });
            } else {
              tokenDataMap.set(addr, {
                balance: item.holderBalance,
                usdValue: item.valueInUsd || 0,
                decimals,
              });
            }
          }
        }

        // Check for pagination
        nextToken = data.link?.nextToken || null;
        hasMore = !!nextToken;
      }

      // Load all tokens from database (ERC20 + meme coins)
      const allTokens = await assetsService.getAllTokens();

      // Find tokens that need price lookup (have balance but no USD value from Routescan)
      const tokensNeedingPrices = allTokens.filter((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const hasBalance = tokenData && parseFloat(tokenData.balance) > 0;
        const hasNoUsdValue = !tokenData?.usdValue || tokenData.usdValue === 0;
        // Exclude BTC-pegged tokens from DexScreener lookup (we'll use CoinGecko)
        const isBtcPegged = BTC_PEGGED_TOKENS.has(token.address.toLowerCase());
        return hasBalance && hasNoUsdValue && !isBtcPegged;
      });

      // Fetch prices from DexScreener for tokens without USD values
      const dexPrices = tokensNeedingPrices.length > 0
        ? await this.getTokenPrices(tokensNeedingPrices.map((t) => t.address))
        : new Map<string, number>();

      // Check if any BTC-pegged tokens need pricing
      const hasBtcPeggedTokens = allTokens.some((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const hasBalance = tokenData && parseFloat(tokenData.balance) > 0;
        const hasNoUsdValue = !tokenData?.usdValue || tokenData.usdValue === 0;
        return hasBalance && hasNoUsdValue && BTC_PEGGED_TOKENS.has(token.address.toLowerCase());
      });

      // Fetch BTC price if needed
      const btcPrice = hasBtcPeggedTokens ? await this.getBtcPrice() : 0;

      // Map tokens to their holdings
      return allTokens.map((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const rawBalance = tokenData?.balance || '0';
        const decimals = tokenData?.decimals || token.decimals;
        const balance = parseFloat(rawBalance) / Math.pow(10, decimals);

        // Use Routescan USD value if available, otherwise calculate from price sources
        let usdValue = tokenData?.usdValue || 0;

        if (usdValue === 0 && balance > 0) {
          const tokenAddressLower = token.address.toLowerCase();
          
          // Check if BTC-pegged token
          if (BTC_PEGGED_TOKENS.has(tokenAddressLower)) {
            usdValue = balance * btcPrice;
          } else {
            // Try to get price from DexScreener
            const dexPrice = dexPrices.get(tokenAddressLower);
            if (dexPrice) {
              usdValue = balance * dexPrice;
            }
          }
        }

        return {
          name: token.name,
          symbol: token.symbol || '',
          address: token.address,
          logo: token.logo_url || '',
          balance,
          usdValue,
          tokenType: token.token_type as TokenType, // Use DB token_type
        };
      });
    } catch (error) {
      console.error('Failed to fetch token holdings:', error);
      // Return empty holdings for all tokens from DB
      try {
        const allTokens = await assetsService.getAllTokens();
        return allTokens.map((token) => ({
          name: token.name,
          symbol: token.symbol || '',
          address: token.address,
          logo: token.logo_url || '',
          balance: 0,
          usdValue: 0,
          tokenType: token.token_type as TokenType,
        }));
      } catch {
        return [];
      }
    }
  }

  // Calculate wallet age in days
  calculateAgeDays(firstTxDate: string | null): number {
    if (!firstTxDate) return 0;

    const firstDate = new Date(firstTxDate);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - firstDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays;
  }

  // Get all wallet stats in one call (optimized: use cached data more aggressively)
  async getAllStats(walletAddress: string): Promise<WalletStatsData> {
    const wallet = walletAddress.toLowerCase();

    // Check cache first with longer TTL for performance
    const cached = walletStatsCache.get(wallet);
    if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL * 10) { // 5 minute cache instead of 30 seconds
      return cached.data;
    }

    try {
      // Pre-fetch meme coin prices before token holdings (so it's cached)
      const memePricesPromise = this.getMemeCoinPrices();

      const [overview, txStats, nftData, _, tokenHoldings] = await Promise.all([
        this.getWalletOverview(walletAddress),
        this.getInkChainTxStats(walletAddress),
        this.getAllNftHoldings(walletAddress),
        memePricesPromise, // Ensure prices are cached before getTokenHoldings uses them
        this.getTokenHoldings(walletAddress),
      ]);

      // Calculate age based on Ink chain first transaction
      const ageDays = this.calculateAgeDays(txStats.firstTxDate);

      // Count special NFT collections (now async - loads from DB)
      const nftCollections = await this.countSpecialCollections(nftData.holdings);

      const result: WalletStatsData = {
        balanceUsd: overview.balanceUsd,
        balanceEth: overview.balanceEth,
        totalTxns: txStats.totalTxns,
        nftCount: nftData.totalCount,
        ageDays,
        firstTxDate: txStats.firstTxDate,
        nftCollections,
        tokenHoldings,
      };

      // Cache the result with longer TTL
      walletStatsCache.set(wallet, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.error('Failed to fetch wallet stats, using fallback data:', error);
      
      // Return reasonable fallback data instead of throwing
      const fallbackResult: WalletStatsData = {
        balanceUsd: 0,
        balanceEth: 0,
        totalTxns: 0,
        nftCount: 0,
        ageDays: 0,
        firstTxDate: null,
        nftCollections: [],
        tokenHoldings: [],
      };

      // Cache the fallback result briefly
      walletStatsCache.set(wallet, { data: fallbackResult, timestamp: Date.now() });
      
      return fallbackResult;
    }
  }
}

export const walletStatsService = new WalletStatsService();

// Register the cache clearer with assets service
setWalletStatsCacheClearer(clearWalletStatsCache);
