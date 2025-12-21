const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn-canary.routescan.io/api';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

// Special NFT collections to track
export const SPECIAL_NFT_COLLECTIONS = [
  {
    name: 'Shellies',
    address: '0x1c9838cdC00fA39d953a54c755b95605Ed5Ea49c',
    logo: 'https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg',
  },
  {
    name: 'InkySquad',
    address: '0xE4e5D5170Ba5cae36D1876893D4b218E8Ed19C91',
    logo: 'https://pbs.twimg.com/profile_images/1953536918282444801/usC4AlFP_400x400.jpg',
  },
  {
    name: 'BOI',
    address: '0x63FEbFa0a5474803F4261a1628763b1B2cC3AB83',
    logo: 'https://pbs.twimg.com/profile_images/1952287497477664768/B8jJLN33_400x400.jpg',
  },
  {
    name: 'INK Bunnies',
    address: '0x4443970B315d3c08C2f962fe00770c52396AFDb7',
    logo: 'https://pbs.twimg.com/profile_images/1996167791347408896/ds6khpeY_400x400.jpg',
  },
  {
    name: 'Rekt Ink',
    address: '0x25aa78ab6785a4b0aeff5c170998992fd958d43d',
    logo: 'https://pbs.twimg.com/profile_images/1957753909713203200/jGEz5WCQ_400x400.jpg',
  },
];

export interface NftCollectionHolding {
  name: string;
  address: string;
  logo: string;
  count: number;
}

export type TokenType = 'meme' | 'stablecoin' | 'native' | 'defi' | 'governance' | 'utility' | null;

// Special ERC-20 tokens to track
export const SPECIAL_TOKENS: Array<{
  name: string;
  symbol: string;
  address: string;
  logo: string;
  decimals: number;
  isStablecoin: boolean;
  tokenType: TokenType;
}> = [
  {
    name: 'ETH',
    symbol: 'ETH',
    address: '0x4200000000000000000000000000000000000006',
    logo: 'https://pbs.twimg.com/profile_images/1878738447067652096/tXQbWfpf_400x400.jpg',
    decimals: 18,
    isStablecoin: false,
    tokenType: 'native',
  },
  {
    name: 'USDT0',
    symbol: 'USDT0',
    address: '0x0200C29006150606B650577BBE7B6248F58470c1',
    logo: 'https://pbs.twimg.com/profile_images/1879546764971188224/SQISVYwX_400x400.jpg',
    decimals: 6,
    isStablecoin: true,
    tokenType: 'stablecoin',
  },
  {
    name: 'USDC0',
    symbol: 'USDC0',
    address: '0x2D270e6886d130D724215A266106e6832161EAEd',
    logo: 'https://pbs.twimg.com/profile_images/1916937910928211968/CKblfanr_400x400.png',
    decimals: 6,
    isStablecoin: true,
    tokenType: 'stablecoin',
  },
  {
    name: 'Global Dollar',
    symbol: 'USDGLO',
    address: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D',
    logo: 'https://pbs.twimg.com/profile_images/1853549476360638464/IlD_0g8Y_400x400.png',
    decimals: 18,
    isStablecoin: true,
    tokenType: 'stablecoin',
  },
  // Meme coins
  {
    name: 'ANITA',
    symbol: 'ANITA',
    address: '0x0606FC632ee812bA970af72F8489baAa443C4B98',
    logo: 'https://pbs.twimg.com/profile_images/1948708709263089665/sCal-1rw_400x400.jpg',
    decimals: 18,
    isStablecoin: false,
    tokenType: 'meme',
  },
  {
    name: 'Cat on Ink',
    symbol: 'CAT',
    address: '0x20C69C12abf2B6F8D8ca33604DD25C700c7e70A5',
    logo: 'https://pbs.twimg.com/profile_images/1880778671398809601/DV_dS5E9_400x400.png',
    decimals: 18,
    isStablecoin: false,
    tokenType: 'meme',
  },
  {
    name: 'Purple',
    symbol: 'PURPLE',
    address: '0xD642B49d10cc6e1BC1c6945725667c35e0875f22',
    logo: 'https://pbs.twimg.com/profile_images/1887019906102853632/lbS2Mm4V_400x400.jpg',
    decimals: 18,
    isStablecoin: false,
    tokenType: 'meme',
  },
];

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

export class WalletStatsService {
  // Get wallet overview (balance only - age is fetched separately for Ink chain)
  async getWalletOverview(walletAddress: string): Promise<{
    balanceUsd: number;
    balanceEth: number;
  }> {
    try {
      const url = `${ROUTESCAN_BASE_URL}/blockchain/all/address/${walletAddress}?excludedChainIds=1682324,2061,80002,4202,295&ecosystem=all`;
      const response = await fetch(url);

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
      const response = await fetch(url);

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

  // Count holdings for special NFT collections
  countSpecialCollections(
    holdings: Array<{ tokenAddress: string; balance: string; type: string }>
  ): NftCollectionHolding[] {
    return SPECIAL_NFT_COLLECTIONS.map((collection) => {
      const collectionAddress = collection.address.toLowerCase();

      // Sum up all NFTs from this collection
      const count = holdings
        .filter((h) => h.tokenAddress === collectionAddress)
        .reduce((sum, h) => sum + parseInt(h.balance || '1', 10), 0);

      return {
        name: collection.name,
        address: collection.address,
        logo: collection.logo,
        count,
      };
    });
  }

  // Fetch meme coin prices from DexScreener
  async getMemeCoinPrices(): Promise<Map<string, number>> {
    // Check cache first
    if (memeCoinPriceCache && Date.now() - memeCoinPriceCache.timestamp < PRICE_CACHE_TTL) {
      return memeCoinPriceCache.prices;
    }

    const prices = new Map<string, number>();
    
    // Get meme coin addresses (non-stablecoin, non-ETH tokens)
    const memeCoins = SPECIAL_TOKENS.filter(t => !t.isStablecoin && t.symbol !== 'ETH');
    
    if (memeCoins.length === 0) {
      return prices;
    }

    try {
      // DexScreener accepts comma-separated addresses
      const addresses = memeCoins.map(t => t.address).join(',');
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
      console.error('Failed to fetch meme coin prices:', error);
      return prices;
    }
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

      // Fetch meme coin prices for tokens without USD value
      const memeCoinPrices = await this.getMemeCoinPrices();

      // Map special tokens to their holdings
      return SPECIAL_TOKENS.map((token) => {
        const tokenData = tokenDataMap.get(token.address.toLowerCase());
        const rawBalance = tokenData?.balance || '0';
        const decimals = tokenData?.decimals || token.decimals;
        const balance = parseFloat(rawBalance) / Math.pow(10, decimals);
        
        // Use Routescan USD value if available, otherwise calculate from DexScreener price
        let usdValue = tokenData?.usdValue || 0;
        
        if (usdValue === 0 && balance > 0) {
          // Try to get price from DexScreener for meme coins
          const dexPrice = memeCoinPrices.get(token.address.toLowerCase());
          if (dexPrice) {
            usdValue = balance * dexPrice;
          }
        }

        return {
          name: token.name,
          symbol: token.symbol,
          address: token.address,
          logo: token.logo,
          balance,
          usdValue,
          tokenType: token.tokenType, // Always use config's tokenType
        };
      });
    } catch (error) {
      console.error('Failed to fetch token holdings:', error);
      // Return empty holdings for all tokens with their configured types
      return SPECIAL_TOKENS.map((token) => ({
        name: token.name,
        symbol: token.symbol,
        address: token.address,
        logo: token.logo,
        balance: 0,
        usdValue: 0,
        tokenType: token.tokenType,
      }));
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

  // Get all wallet stats in one call (optimized: 4 API calls)
  async getAllStats(walletAddress: string): Promise<WalletStatsData> {
    const [overview, txStats, nftData, tokenHoldings] = await Promise.all([
      this.getWalletOverview(walletAddress),
      this.getInkChainTxStats(walletAddress), // Gets both first tx date AND total count
      this.getAllNftHoldings(walletAddress), // Gets all NFTs + count
      this.getTokenHoldings(walletAddress), // Gets ERC-20 token holdings with USD values from API
    ]);

    // Calculate age based on Ink chain first transaction
    const ageDays = this.calculateAgeDays(txStats.firstTxDate);

    // Count special NFT collections
    const nftCollections = this.countSpecialCollections(nftData.holdings);

    return {
      balanceUsd: overview.balanceUsd,
      balanceEth: overview.balanceEth,
      totalTxns: txStats.totalTxns,
      nftCount: nftData.totalCount,
      ageDays,
      firstTxDate: txStats.firstTxDate,
      nftCollections,
      tokenHoldings,
    };
  }
}

export const walletStatsService = new WalletStatsService();
