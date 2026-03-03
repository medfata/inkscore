// InkDCA Service - Fetches DCA purchase history and calculates metrics
import { priceService } from './price-service';

const INKDCA_API_BASE = 'https://inkdca.com/api';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

// Token symbol to address mapping for InkDCA
const TOKEN_SYMBOL_TO_ADDRESS: Record<string, string> = {
  'USD₮0': '0x0200c29006150606b650577bbe7b6248f58470c1', // USDT0
  'USDT0': '0x0200c29006150606b650577bbe7b6248f58470c1',
  'USDC': '0xf93d5ae5e9a3b91eb8f2962f74f8930c5d89b2b3',
  'axlUSDC': '0xeb466342c4d449bc9f53a865d5cb90586f405215',
  'ETH': '0x4200000000000000000000000000000000000006', // WETH
  'WETH': '0x4200000000000000000000000000000000000006',
  'kBTC': '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98',
  'ANITA': '0x0606fc632ee812ba970af72f8489baaa443c4b98',
};

// Known token prices (stablecoins and major tokens)
const KNOWN_TOKEN_PRICES: Record<string, number | 'eth' | 'btc'> = {
  '0x0200c29006150606b650577bbe7b6248f58470c1': 1, // USDT0
  '0xf93d5ae5e9a3b91eb8f2962f74f8930c5d89b2b3': 1, // USDC
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': 1, // axlUSDC
  '0x4200000000000000000000000000000000000006': 'eth', // WETH
  '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': 'btc', // kBTC
};

interface PurchaseHistory {
  amountIn: string;
  amountOut: string;
  sourceToken: string;
  destinationToken: string;
  txHash: string;
  timestamp: number;
  datetime: string;
  priceImpact: number;
  slippagePercent: number;
}

export interface InkDcaMetrics {
  totalRegisteredDCAs: number;
  totalSpentUSD: number;
  dcaExecutions: number;
}

// Simple in-memory cache (5 minute TTL)
const cache = new Map<string, { data: InkDcaMetrics; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Token price cache (5 minute TTL)
const tokenPriceCache = new Map<string, { price: number; timestamp: number }>();
const PRICE_CACHE_TTL = 5 * 60 * 1000;

export class InkDcaService {
  // Get token price in USD
  private async getTokenPriceUsd(tokenSymbol: string): Promise<number> {
    // Map symbol to address
    const tokenAddress = TOKEN_SYMBOL_TO_ADDRESS[tokenSymbol];
    
    if (!tokenAddress) {
      console.warn(`Unknown token symbol: ${tokenSymbol}`);
      return 0;
    }

    const addr = tokenAddress.toLowerCase();

    // Check cache first
    const cached = tokenPriceCache.get(addr);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    let price = 0;

    // Check known token prices
    const knownPrice = KNOWN_TOKEN_PRICES[addr];
    if (knownPrice !== undefined) {
      if (knownPrice === 'eth') {
        // Get ETH price from price service
        price = await priceService.getCurrentPrice();
      } else if (knownPrice === 'btc') {
        // Get BTC price from CoinGecko
        price = await this.fetchCoinGeckoPrice('bitcoin');
      } else {
        // Stablecoin
        price = knownPrice;
      }
    } else {
      // Unknown token - fetch from DexScreener
      price = await this.fetchDexScreenerPrice(addr);
    }

    // Cache the price
    tokenPriceCache.set(addr, { price, timestamp: Date.now() });

    return price;
  }

  // Fetch price from CoinGecko
  private async fetchCoinGeckoPrice(coingeckoId: string): Promise<number> {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
      );
      if (!response.ok) return 0;
      const data = await response.json() as Record<string, { usd?: number }>;
      return data[coingeckoId]?.usd || 0;
    } catch (error) {
      console.error(`Failed to fetch CoinGecko price for ${coingeckoId}:`, error);
      return 0;
    }
  }

  // Fetch price from DexScreener
  private async fetchDexScreenerPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/${tokenAddress}`);
      
      if (!response.ok) {
        console.error(`DexScreener API error: ${response.status}`);
        return 0;
      }

      const data = await response.json() as { pairs?: Array<{ chainId?: string; priceUsd?: string }> };

      // DexScreener returns pairs, find the best price on Ink chain
      if (data.pairs && Array.isArray(data.pairs)) {
        for (const pair of data.pairs) {
          // Only consider pairs on Ink chain
          if (pair.chainId !== 'ink') continue;

          const priceUsd = parseFloat(pair.priceUsd || '0');
          if (priceUsd > 0) {
            return priceUsd;
          }
        }
      }

      return 0;
    } catch (error) {
      console.error(`Failed to fetch DexScreener price for ${tokenAddress}:`, error);
      return 0;
    }
  }

  // Get InkDCA metrics for a wallet
  async getMetrics(walletAddress: string, dcaExecutions: number): Promise<InkDcaMetrics> {
    const wallet = walletAddress.toLowerCase();

    // Check cache
    const cached = cache.get(wallet);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { ...cached.data, dcaExecutions };
    }

    try {
      // Fetch purchase history from InkDCA API
      const url = `${INKDCA_API_BASE}/get-user-data?address=${walletAddress}&type=purchase-history`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`InkDCA API error: ${response.status} ${response.statusText}`);
        return { totalRegisteredDCAs: 0, totalSpentUSD: 0, dcaExecutions };
      }

      const purchaseHistory = await response.json() as PurchaseHistory[];

      // Calculate metrics
      const totalRegisteredDCAs = purchaseHistory.length;
      let totalSpentUSD = 0;

      // Calculate total spent in USD
      for (const purchase of purchaseHistory) {
        const tokenPrice = await this.getTokenPriceUsd(purchase.sourceToken);
        const amountIn = parseFloat(purchase.amountIn);
        const spentUSD = amountIn * tokenPrice;
        totalSpentUSD += spentUSD;
      }

      const metrics: InkDcaMetrics = {
        totalRegisteredDCAs,
        totalSpentUSD,
        dcaExecutions,
      };

      // Cache the result (without dcaExecutions since it comes from elsewhere)
      cache.set(wallet, { 
        data: { totalRegisteredDCAs, totalSpentUSD, dcaExecutions: 0 }, 
        timestamp: Date.now() 
      });

      return metrics;
    } catch (error) {
      console.error('Failed to fetch InkDCA metrics:', error);
      return { totalRegisteredDCAs: 0, totalSpentUSD: 0, dcaExecutions };
    }
  }
}

export const inkDcaService = new InkDcaService();
