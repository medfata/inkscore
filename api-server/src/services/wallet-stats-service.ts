import { assetsService, setWalletStatsCacheClearer } from './assets-service';
import { TrackedAsset } from '../types/assets';
import { priceService } from './price-service';
import {
  getNftHoldingsRaw,
  getTokenHoldingsRaw,
  getWalletStats,
  isBlockscoutEnabled,
} from './blockscout-service';
import { getInflight, withInflight } from '../cache';

function assertBlockscout(): void {
  if (!isBlockscoutEnabled()) {
    throw new Error('Blockscout source disabled via BLOCKSCOUT_SOURCE=off');
  }
}
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
  openseaUrl: string | null;
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
  // Error fallbacks (all-zero) are cached briefly so a failing upstream isn't
  // hammered, but NEVER treated as facts: real data cached for 5 min,
  // degraded data for one TTL window so the next request retries the walk.
  degraded?: boolean;
}
const walletStatsCache = new Map<string, StatsCache>();
const STATS_CACHE_TTL = 30 * 1000; // 30 seconds

// Function to clear wallet stats cache (called when assets are reordered)
export function clearWalletStatsCache(): void {
  walletStatsCache.clear();
}

export class WalletStatsService {
  // Get wallet overview (native ETH balance only, via Blockscout)
  async getWalletOverview(walletAddress: string): Promise<{
    balanceUsd: number;
    balanceEth: number;
  }> {
    try {
      assertBlockscout();
      const [stats, ethPrice] = await Promise.all([
        getWalletStats(walletAddress),
        priceService.getCurrentPrice().catch(() => 3500),
      ]);
      // gwei-precision conversion avoids float dust on huge wei values
      const balanceEth = Number(BigInt(stats.ethWei || '0') / BigInt(1e9)) / 1e9;
      return { balanceUsd: balanceEth * ethPrice, balanceEth };
    } catch (error) {
      console.error('Failed to fetch wallet overview:', error);
      return { balanceUsd: 0, balanceEth: 0 };
    }
  }

  // Get Ink chain transaction stats (count + first tx, via Blockscout)
  async getInkChainTxStats(walletAddress: string): Promise<{
    firstTxDate: string | null;
    totalTxns: number;
  }> {
    try {
      assertBlockscout();
      const stats = await getWalletStats(walletAddress);
      return { firstTxDate: stats.firstSeen, totalTxns: stats.txns };
    } catch (error) {
      console.error('Failed to fetch Ink chain tx stats:', error);
      return { firstTxDate: null, totalTxns: 0 };
    }
  }


  // Get all NFT holdings on Ink chain (via Blockscout collections)
  async getAllNftHoldings(walletAddress: string): Promise<{
    totalCount: number;
    holdings: Array<{ tokenAddress: string; balance: string; type: string }>;
  }> {
    try {
      assertBlockscout();
      const holdings = await getNftHoldingsRaw(walletAddress);
      return {
        totalCount: holdings.reduce((sum, h) => sum + (h.count || 0), 0),
        holdings: holdings.map((h) => ({
          tokenAddress: h.address,
          balance: String(h.count),
          type: 'ERC-721',
        })),
      };
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
        openseaUrl: collection.opensea_slug
          ? `https://opensea.io/collection/${collection.opensea_slug}`
          : null,
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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies=usd`, { signal: controller.signal });
      clearTimeout(timeoutId);
      
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
    const priceLiquidity = new Map<string, { priceUsd: number; liquidityUsd: number }>();

    if (tokenAddresses.length === 0) {
      return prices;
    }

    try {
      const addresses = tokenAddresses.join(',');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${DEXSCREENER_API}/${addresses}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return prices;
      }

      const data = await response.json() as {
        pairs?: Array<{
          chainId?: string;
          baseToken?: { address?: string };
          priceUsd?: string;
          liquidity?: { usd?: number };
        }>;
      };

      if (data.pairs && Array.isArray(data.pairs)) {
        // Keep the price from the HIGHEST-LIQUIDITY pair per token, not the
        // highest price. Thin pools (e.g. a $0.63-liquidity Velodrome pair
        // next to a $59k InkySwap pair) can quote a stale/oscillating price;
        // picking it by value inflated or deflated holdings randomly.
        for (const pair of data.pairs) {
          if (pair.chainId !== 'ink') continue;

          const tokenAddress = pair.baseToken?.address?.toLowerCase();
          const priceUsd = parseFloat(pair.priceUsd || '0');
          const liquidityUsd = pair.liquidity?.usd || 0;

          if (tokenAddress && priceUsd > 0) {
            const existing = priceLiquidity.get(tokenAddress);
            if (!existing || liquidityUsd > existing.liquidityUsd) {
              priceLiquidity.set(tokenAddress, { priceUsd, liquidityUsd });
            }
          }
        }
        for (const [tokenAddress, { priceUsd }] of priceLiquidity) {
          prices.set(tokenAddress, priceUsd);
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

  // Get ERC-20 token holdings on Ink chain (via Blockscout).
  // USD waterfall (unchanged semantics): Blockscout exchange_rate first
  // (replaces the dead Routescan valueInUsd), then DexScreener, then BTC.
  async getTokenHoldings(walletAddress: string): Promise<TokenHolding[]> {
    const tokenDataMap = new Map<string, { balance: string; usdValue: number; decimals: number }>();

    try {
      assertBlockscout();
      const raw = await getTokenHoldingsRaw(walletAddress);
      for (const h of raw) {
        const balance = h.rawBalance || '0';
        const decimals = h.decimals || 18;
        const amount = Number(BigInt(balance)) / Math.pow(10, decimals);
        const usdValue = amount * (h.exchangeRate || 0);
        tokenDataMap.set(h.address, { balance, usdValue, decimals });
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

    // Check cache first. Degraded (error-fallback) entries expire after one
    // TTL window so a transient upstream failure doesn't serve zeros as
    // facts for the full 5-minute window — the next request retries.
    const cached = walletStatsCache.get(wallet);
    const effectiveTtl = cached?.degraded ? STATS_CACHE_TTL : STATS_CACHE_TTL * 10;
    if (cached && Date.now() - cached.timestamp < effectiveTtl) {
      return cached.data;
    }

    // Shared in-flight computation: the dashboard's direct /stats fetch and
    // the score's internal getAllStats call fire together — don't run the
    // 5-way fan-out twice.
    const statsInf = getInflight<WalletStatsData>(`walletstats:${wallet}`);
    if (statsInf) {
      try {
        return await statsInf;
      } catch {
        // Fall through and compute fresh if the shared run failed.
      }
    }

    return withInflight<WalletStatsData>(`walletstats:${wallet}`, async () => {
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

      // Degraded entry: short TTL only — zeros are a placeholder, not facts.
      walletStatsCache.set(wallet, { data: fallbackResult, timestamp: Date.now(), degraded: true });

      return fallbackResult;
    }
    });
  }
}

export const walletStatsService = new WalletStatsService();

// Register the cache clearer with assets service
setWalletStatsCacheClearer(clearWalletStatsCache);
