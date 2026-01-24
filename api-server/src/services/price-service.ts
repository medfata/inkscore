import { query, queryOne } from '../db';
import { EthPrice } from '../types/analytics';

const COINGECKO_API = 'https://api.coingecko.com/api/v3';

export class PriceService {
  // Get current ETH price
  async getCurrentPrice(): Promise<number> {
    // First try to get from cache (last hour)
    const cached = await queryOne<EthPrice>(`
      SELECT * FROM eth_prices 
      WHERE timestamp > NOW() - INTERVAL '1 hour'
      ORDER BY timestamp DESC 
      LIMIT 1
    `);

    if (cached) {
      return parseFloat(cached.price_usd);
    }

    // Fetch from CoinGecko
    const price = await this.fetchCurrentPrice();
    
    // Cache it
    await this.savePrice(price);
    
    return price;
  }

  // Get price at specific timestamp (hourly granularity)
  async getPriceAt(timestamp: Date): Promise<number> {
    // Round to hour
    const hourTimestamp = new Date(timestamp);
    hourTimestamp.setMinutes(0, 0, 0);

    const cached = await queryOne<EthPrice>(`
      SELECT * FROM eth_prices 
      WHERE timestamp = $1
    `, [hourTimestamp]);

    if (cached) {
      return parseFloat(cached.price_usd);
    }

    // If not found, return current price as fallback
    return this.getCurrentPrice();
  }

  // Fetch current price from CoinGecko
  private async fetchCurrentPrice(): Promise<number> {
    try {
      const response = await fetch(
        `${COINGECKO_API}/simple/price?ids=ethereum&vs_currencies=usd`
      );
      
      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json() as { ethereum: { usd: number } };
      return data.ethereum.usd;
    } catch (error) {
      console.error('Failed to fetch ETH price:', error);
      // Return a fallback price
      return 3500;
    }
  }


  // Save price to database
  private async savePrice(price: number): Promise<void> {
    const now = new Date();
    now.setMinutes(0, 0, 0); // Round to hour

    await query(`
      INSERT INTO eth_prices (timestamp, price_usd, source)
      VALUES ($1, $2, 'coingecko')
      ON CONFLICT (timestamp) DO UPDATE SET price_usd = $2
    `, [now, price]);
  }

  // Sync historical prices (for backfill)
  async syncHistoricalPrices(days: number = 90): Promise<void> {
    try {
      const response = await fetch(
        `${COINGECKO_API}/coins/ethereum/market_chart?vs_currency=usd&days=${days}&interval=hourly`
      );

      if (!response.ok) {
        throw new Error(`CoinGecko API error: ${response.status}`);
      }

      const data = await response.json() as { prices: [number, number][] };
      const prices: [number, number][] = data.prices;

      // Batch insert
      for (const [timestamp, price] of prices) {
        const date = new Date(timestamp);
        date.setMinutes(0, 0, 0);

        await query(`
          INSERT INTO eth_prices (timestamp, price_usd, source)
          VALUES ($1, $2, 'coingecko')
          ON CONFLICT (timestamp) DO NOTHING
        `, [date, price]);
      }

      console.log(`Synced ${prices.length} historical prices`);
    } catch (error) {
      console.error('Failed to sync historical prices:', error);
    }
  }

  // Convert ETH to USD
  async ethToUsd(ethAmount: string | number, timestamp?: Date): Promise<number> {
    const eth = typeof ethAmount === 'string' ? parseFloat(ethAmount) : ethAmount;
    const price = timestamp ? await this.getPriceAt(timestamp) : await this.getCurrentPrice();
    return eth * price;
  }
}

export const priceService = new PriceService();
