import { query, queryOne } from '../db';
import { DiscoveredToken } from '../types/platforms';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory price cache
const priceCache = new Map<string, { price: number; timestamp: number }>();

export class TokensService {
  // ============================================================================
  // TOKEN CRUD
  // ============================================================================

  async getAllTokens(activeOnly: boolean = false): Promise<DiscoveredToken[]> {
    const whereClause = activeOnly ? 'WHERE is_active = true' : '';
    return query<DiscoveredToken>(`
      SELECT * FROM discovered_tokens
      ${whereClause}
      ORDER BY symbol ASC
    `);
  }

  async getTokenByAddress(address: string): Promise<DiscoveredToken | null> {
    return queryOne<DiscoveredToken>(
      `SELECT * FROM discovered_tokens WHERE address = $1`,
      [address.toLowerCase()]
    );
  }

  async getTokenBySymbol(symbol: string): Promise<DiscoveredToken | null> {
    return queryOne<DiscoveredToken>(
      `SELECT * FROM discovered_tokens WHERE UPPER(symbol) = UPPER($1)`,
      [symbol]
    );
  }

  // ============================================================================
  // TOKEN DISCOVERY
  // ============================================================================

  /**
   * Discover and upsert a token from transaction log data
   */
  async discoverToken(data: {
    address: string;
    name?: string;
    symbol?: string;
    decimals?: number;
    iconUrl?: string;
    tags?: string[];
  }): Promise<DiscoveredToken> {
    const address = data.address.toLowerCase();

    // Check if already exists
    const existing = await this.getTokenByAddress(address);
    if (existing) {
      // Update with new info if we have more data
      if (data.name || data.symbol || data.iconUrl) {
        await query(`
          UPDATE discovered_tokens SET
            name = COALESCE($2, name),
            symbol = COALESCE($3, symbol),
            icon_url = COALESCE($4, icon_url),
            tags = COALESCE($5, tags),
            updated_at = NOW()
          WHERE address = $1
        `, [address, data.name, data.symbol, data.iconUrl, data.tags]);
      }
      return (await this.getTokenByAddress(address))!;
    }

    // Detect if stablecoin
    const isStablecoin = this.detectStablecoin(data.symbol, data.name, data.tags);
    const isNativeWrapper = this.detectNativeWrapper(data.symbol, data.name, address);

    // Insert new token
    const result = await queryOne<DiscoveredToken>(`
      INSERT INTO discovered_tokens (
        address, name, symbol, decimals, icon_url, tags,
        is_stablecoin, is_native_wrapper
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      address,
      data.name || null,
      data.symbol || null,
      data.decimals || 18,
      data.iconUrl || null,
      data.tags || null,
      isStablecoin,
      isNativeWrapper,
    ]);

    return result!;
  }

  /**
   * Detect if token is a stablecoin based on symbol/name/tags
   */
  private detectStablecoin(symbol?: string, name?: string, tags?: string[]): boolean {
    const s = (symbol || '').toUpperCase();
    const n = (name || '').toUpperCase();

    // Check symbol patterns
    if (s.includes('USD') || s.includes('DAI') || s.includes('FRAX') || s.includes('LUSD')) {
      return true;
    }

    // Check name patterns
    if (n.includes('USD') || n.includes('DOLLAR') || n.includes('STABLECOIN')) {
      return true;
    }

    // Check tags
    if (tags?.some(t => t.toLowerCase().includes('stablecoin'))) {
      return true;
    }

    return false;
  }

  /**
   * Detect if token is a native wrapper (WETH)
   */
  private detectNativeWrapper(symbol?: string, name?: string, address?: string): boolean {
    const s = (symbol || '').toUpperCase();
    const n = (name || '').toUpperCase();
    const a = (address || '').toLowerCase();

    // Known WETH addresses
    const wethAddresses = [
      '0x4200000000000000000000000000000000000006', // Ink WETH
    ];

    if (wethAddresses.includes(a)) return true;
    if (s === 'WETH' || s === 'WINK') return true;
    if (n.includes('WRAPPED ETHER') || n.includes('WRAPPED ETH')) return true;

    return false;
  }

  // ============================================================================
  // PRICE FETCHING
  // ============================================================================

  /**
   * Get token price in USD
   */
  async getTokenPrice(address: string): Promise<number> {
    const addr = address.toLowerCase();

    // Check memory cache
    const cached = priceCache.get(addr);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    // Get token info
    const token = await this.getTokenByAddress(addr);
    if (!token) return 0;

    let price = 0;

    // Stablecoins = $1
    if (token.is_stablecoin) {
      price = 1;
    }
    // Native wrapper = ETH price
    else if (token.is_native_wrapper) {
      price = await this.getEthPrice();
    }
    // Try CoinGecko
    else if (token.coingecko_id) {
      price = await this.fetchCoinGeckoPrice(token.coingecko_id);
    }
    // Try DexScreener
    else {
      price = await this.fetchDexScreenerPrice(addr);
    }

    // Cache the price
    priceCache.set(addr, { price, timestamp: Date.now() });

    // Update DB cache
    if (price > 0) {
      await query(`
        UPDATE discovered_tokens SET
          last_price_usd = $2,
          price_source = $3,
          price_updated_at = NOW()
        WHERE address = $1
      `, [addr, price, token.coingecko_id ? 'coingecko' : 'dexscreener']);
    }

    return price;
  }

  /**
   * Get ETH price from CoinGecko
   */
  async getEthPrice(): Promise<number> {
    const cached = priceCache.get('eth');
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    try {
      const response = await fetch(
        `${COINGECKO_API}/simple/price?ids=ethereum&vs_currencies=usd`
      );
      if (!response.ok) return 0;

      const data = await response.json();
      const price = data.ethereum?.usd || 0;

      priceCache.set('eth', { price, timestamp: Date.now() });
      return price;
    } catch {
      return 0;
    }
  }

  /**
   * Fetch price from CoinGecko by ID
   */
  private async fetchCoinGeckoPrice(coingeckoId: string): Promise<number> {
    try {
      const response = await fetch(
        `${COINGECKO_API}/simple/price?ids=${coingeckoId}&vs_currencies=usd`
      );
      if (!response.ok) return 0;

      const data = await response.json();
      return data[coingeckoId]?.usd || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Fetch price from DexScreener
   */
  private async fetchDexScreenerPrice(tokenAddress: string): Promise<number> {
    try {
      const response = await fetch(`${DEXSCREENER_API}/tokens/${tokenAddress}`);
      if (!response.ok) return 0;

      const data = await response.json();

      // Find Ink chain pairs
      const inkPairs = data.pairs?.filter((p: { chainId: string }) => p.chainId === 'ink') || [];
      if (inkPairs.length === 0) return 0;

      // Get highest liquidity pair's price
      let bestPrice = 0;
      for (const pair of inkPairs) {
        const price = parseFloat(pair.priceUsd || '0');
        if (price > bestPrice) {
          bestPrice = price;
        }
      }

      return bestPrice;
    } catch {
      return 0;
    }
  }

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  /**
   * Get prices for multiple tokens
   */
  async getTokenPrices(addresses: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    for (const address of addresses) {
      const price = await this.getTokenPrice(address);
      prices.set(address.toLowerCase(), price);
    }

    return prices;
  }

  /**
   * Update all token prices (for background job)
   */
  async updateAllPrices(): Promise<void> {
    const tokens = await this.getAllTokens(true);

    for (const token of tokens) {
      try {
        await this.getTokenPrice(token.address);
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to update price for ${token.symbol}:`, error);
      }
    }
  }

  // ============================================================================
  // USD VALUE CALCULATION
  // ============================================================================

  /**
   * Calculate USD value for a token amount
   */
  async calculateUsdValue(
    tokenAddress: string,
    amount: bigint | string,
    decimals?: number
  ): Promise<number> {
    const addr = tokenAddress.toLowerCase();

    // Get token info
    let tokenDecimals = decimals;
    if (!tokenDecimals) {
      const token = await this.getTokenByAddress(addr);
      tokenDecimals = token?.decimals || 18;
    }

    // Parse amount
    const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;
    const amountDecimal = Number(amountBigInt) / Math.pow(10, tokenDecimals);

    // Get price
    const price = await this.getTokenPrice(addr);

    return amountDecimal * price;
  }
}

export const tokensService = new TokensService();
