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

// Legacy exports for backward compatibility
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
  // Get wallet overview (balance only)
  async getWalletOverview(walletAddress: string): Promise<{
    balanceUsd: number;
    balanceEth: number;
  }> {
    try {
      const url = `${ROUTESCAN_BASE_URL}/blockchain/all/address/${walletAddress}?excludedChainIds=1682324,2061,80002,4202,295&ecosystem=all`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Routescan API error: ${response.status}`);
      }

      const data = await response.json() as {
        instances?: Array<{
          chainId: string;
          data?: {
            evmBalance?: {
              usdValue?: string;
              balance?: string;
            };
          };
        }>;
      };
      const inkInstance = data.instances?.find((i) => i.chainId === INK_CHAIN_ID);

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

  // Get Ink chain transaction stats
  async getInkChainTxStats(walletAddress: string): Promise<{
    firstTxDate: string | null;
    totalTxns: number;
  }> {
    try {
      const url = `${ROUTESCAN_BASE_URL}/evm/all/transactions?fromAddresses=${walletAddress}&toAddresses=${walletAddress}&includedChainIds=${INK_CHAIN_ID}&count=true&limit=1&sort=asc`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Routescan API error: ${response.status}`);
      }

      const data = await response.json() as {
        items?: Array<{ timestamp?: string }>;
        count?: number;
      };
      const firstTxDate = data.items && data.items.length > 0 ? data.items[0].timestamp || null : null;
      const totalTxns = data.count || 0;

      return { firstTxDate, totalTxns };
    } catch (error) {
      console.error('Failed to fetch Ink chain tx stats:', error);
      return { firstTxDate: null, totalTxns: 0 };
    }
  }


  // Get all NFT holdings on Ink chain (paginated)
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

        const data = (await response.json()) as {
          count?: number;
          items?: Array<{ tokenAddress: string; balance?: string; type: string }>;
          link?: { nextToken?: string };
        };

        if (data.count) {
          totalCount = data.count;
        }

        if (data.items && data.items.length > 0) {
          allHoldings.push(
            ...data.items.map((item) => ({
              tokenAddress: item.tokenAddress.toLowerCase(),
              balance: item.balance || '1',
              type: item.type,
            }))
          );
        }

        nextToken = data.link?.nextToken || null;
        hasMore = !!nextToken;
      }

      return { totalCount, holdings: allHoldings };
    } catch (error) {
      console.error('Failed to fetch NFT holdings:', error);
      return { totalCount: 0, holdings: [] };
    }
  }

  // Count holdings for special NFT collections
  async countSpecialCollections(
    holdings: Array<{ tokenAddress: string; balance: string; type: string }>
  ): Promise<NftCollectionHolding[]> {
    const nftCollections = await assetsService.getNftCollections();
    
    return nftCollections.map((collection) => {
      const collectionAddress = collection.address.toLowerCase();

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
    if (btcPriceCache && Date.now() - btcPriceCache.timestamp < PRICE_CACHE_TTL) {
      return btcPriceCache.price;
    }

    try {
      const response = await fetch(`${COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies=usd`);
      
      if (!response.ok) {
        console.error(`CoinGecko API error: ${response.status}`);
        return btcPriceCache?.price || 100000;
      }

      const data = await response.json() as { bitcoin?: { usd?: number } };
      const price = data.bitcoin?.usd || 100000;

      btcPriceCache = { price, timestamp: Date.now() };

      return price;
    } catch (error) {
      console.error('Failed to fetch BTC price:', error);
      return btcPriceCache?.price || 100000;
    }
  }


  // Fetch token prices from DexScreener
  async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    if (memeCoinPriceCache && Date.now() - memeCoinPriceCache.timestamp < PRICE_CACHE_TTL) {
      return memeCoinPriceCache.prices;
    }

    const prices = new Map<string, number>();

    if (tokenAddresses.length === 0) {
      return prices;
    }

    try {
      const addresses = tokenAddresses.join(',');
      const response = await fetch(`${DEXSCREENER_API}/${addresses}`);

      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return prices;
      }

      const data = await response.json() as {
        pairs?: Array<{
          chainId?: string;
          baseToken?: { address?: string };
          priceUsd?: string;
        }>;
      };

      if (data.pairs && Array.isArray(data.pairs)) {
        for (const pair of data.pairs) {
          if (pair.chainId !== 'ink') continue;

          const tokenAddress = pair.baseToken?.address?.toLowerCase();
          const priceUsd = parseFloat(pair.priceUsd || '0');

          if (tokenAddress && priceUsd > 0) {
            const existingPrice = prices.get(tokenAddress);
            if (!existingPrice || priceUsd > existingPrice) {
              prices.set(tokenAddress, priceUsd);
            }
          }
        }
      }

      memeCoinPriceCache = { prices, timestamp: Date.now() };

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

  // Get ERC-20 token holdings on Ink chain (paginated)
  async getTokenHoldings(walletAddress: string): Promise<TokenHolding[]> {
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

        const data = (await response.json()) as {
          items?: Array<{
            tokenAddress: string;
            holderBalance: string;
            valueInUsd?: number;
            token?: { decimals?: number };
          }>;
          link?: { nextToken?: string };
        };

        if (data.items) {
          for (const item of data.items) {
            const addr = item.tokenAddress.toLowerCase();
            const existing = tokenDataMap.get(addr);
            const decimals = item.token?.decimals || 18;

            if (existing) {
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

        nextToken = data.link?.nextToken || null;
        hasMore = !!nextToken;
      }

      const allTokens = await assetsService.getAllTokens();

      const tokensNeedingPrices = allTokens.filter((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const hasBalance = tokenData && parseFloat(tokenData.balance) > 0;
        const hasNoUsdValue = !tokenData?.usdValue || tokenData.usdValue === 0;
        const isBtcPegged = BTC_PEGGED_TOKENS.has(token.address.toLowerCase());
        return hasBalance && hasNoUsdValue && !isBtcPegged;
      });

      const dexPrices = tokensNeedingPrices.length > 0
        ? await this.getTokenPrices(tokensNeedingPrices.map((t) => t.address))
        : new Map<string, number>();

      const hasBtcPeggedTokens = allTokens.some((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const hasBalance = tokenData && parseFloat(tokenData.balance) > 0;
        const hasNoUsdValue = !tokenData?.usdValue || tokenData.usdValue === 0;
        return hasBalance && hasNoUsdValue && BTC_PEGGED_TOKENS.has(token.address.toLowerCase());
      });

      const btcPrice = hasBtcPeggedTokens ? await this.getBtcPrice() : 0;

      return allTokens.map((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const rawBalance = tokenData?.balance || '0';
        const decimals = tokenData?.decimals || token.decimals;
        const balance = parseFloat(rawBalance) / Math.pow(10, decimals);

        let usdValue = tokenData?.usdValue || 0;

        if (usdValue === 0 && balance > 0) {
          const tokenAddressLower = token.address.toLowerCase();
          
          if (BTC_PEGGED_TOKENS.has(tokenAddressLower)) {
            usdValue = balance * btcPrice;
          } else {
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
          tokenType: token.token_type as TokenType,
        };
      });
    } catch (error) {
      console.error('Failed to fetch token holdings:', error);
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

  // Get all wallet stats in one call
  async getAllStats(walletAddress: string): Promise<WalletStatsData> {
    const wallet = walletAddress.toLowerCase();

    // Check cache first
    const cached = walletStatsCache.get(wallet);
    if (cached && Date.now() - cached.timestamp < STATS_CACHE_TTL * 10) {
      return cached.data;
    }

    try {
      // Pre-fetch meme coin prices before token holdings
      const memePricesPromise = this.getMemeCoinPrices();

      const [overview, txStats, nftData, _, tokenHoldings] = await Promise.all([
        this.getWalletOverview(walletAddress),
        this.getInkChainTxStats(walletAddress),
        this.getAllNftHoldings(walletAddress),
        memePricesPromise,
        this.getTokenHoldings(walletAddress),
      ]);

      const ageDays = this.calculateAgeDays(txStats.firstTxDate);
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

      walletStatsCache.set(wallet, { data: result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.error('Failed to fetch wallet stats, using fallback data:', error);
      
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

      walletStatsCache.set(wallet, { data: fallbackResult, timestamp: Date.now() });
      
      return fallbackResult;
    }
  }
}

export const walletStatsService = new WalletStatsService();

// Register the cache clearer with assets service
setWalletStatsCacheClearer(clearWalletStatsCache);
