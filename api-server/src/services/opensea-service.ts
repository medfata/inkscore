// OpenSea Service — official v2 REST API
// Fetches NFT activity (buys, sales, mints) for wallets on the Ink chain via
// https://api.opensea.io/api/v2/events/accounts/{address} with an API key.
//
// Caching layers:
//   1. In-memory (1h TTL) — fastest path for repeated requests
//   2. Postgres `opensea_wallet_counts` (24h TTL) — survives restarts; stale rows
//      are served immediately while a background refresh updates them
//
// Kill switch: DISABLE_OPENSEA=true returns zeros without any API/DB calls.

import { query, queryOne } from '../db';

const OPENSEA_V2_EVENTS_URL = 'https://api.opensea.io/api/v2/events/accounts';

interface V2AssetEvent {
  event_type: string; // 'sale' | 'transfer' | ...
  transfer_type?: string; // 'mint' on mint transfers
  transaction?: string;
  buyer?: string;
  seller?: string;
  from_address?: string;
  to_address?: string;
  quantity?: number;
  chain?: string;
  protocol_address?: string;
}

interface V2EventsResponse {
  asset_events: V2AssetEvent[];
  next: string | null;
}

interface ActivityCounts {
  buys: number;
  sales: number;
  mints: number;
  buyTransactions: string[];
  saleTransactions: string[];
  mintTransactions: string[];
}

interface CountsRow {
  wallet_address: string;
  buys: number;
  sales: number;
  mints: number;
  updated_at: string;
}

const ZERO_COUNTS: ActivityCounts = {
  buys: 0, sales: 0, mints: 0,
  buyTransactions: [], saleTransactions: [], mintTransactions: [],
};

export class OpenSeaService {
  // In-memory cache: wallet -> { counts, timestamp }
  private countsCache: Map<string, { counts: ActivityCounts; timestamp: number }> = new Map();
  private readonly MEMORY_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly DB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — counts change slowly

  // Dedup lock: wallet -> in-flight promise (prevents parallel duplicate fetches)
  private inflight: Map<string, Promise<ActivityCounts>> = new Map();

  // Lazy one-time table creation
  private tableReady: Promise<void> | null = null;

  private get apiKey(): string {
    return process.env.OPENSEA_API_KEY || '';
  }

  private get disabled(): boolean {
    return process.env.DISABLE_OPENSEA === 'true';
  }

  private ensureTable(): Promise<void> {
    if (!this.tableReady) {
      this.tableReady = query(`
        CREATE TABLE IF NOT EXISTS opensea_wallet_counts (
          wallet_address TEXT PRIMARY KEY,
          buys INTEGER NOT NULL DEFAULT 0,
          sales INTEGER NOT NULL DEFAULT 0,
          mints INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `).then(() => undefined).catch((err) => {
        this.tableReady = null; // allow retry on next call
        throw err;
      });
    }
    return this.tableReady;
  }

  /**
   * Fetch all sale + mint events for a wallet on Ink from the official v2 API.
   * Cursor pagination; retries 429/5xx (the v2 API throws intermittent 500s on
   * deep pages — single retry usually recovers); hard overall time budget.
   */
  async fetchV2Events(walletAddress: string): Promise<V2AssetEvent[]> {
    const walletLabel = walletAddress.slice(0, 10);
    const events: V2AssetEvent[] = [];
    let next: string | null = null;
    let page = 0;
    let retries = 0;
    const MAX_PAGES = 30; // 30 * 50 = 1500 events max
    const MAX_RETRIES = 4;
    const PER_PAGE_TIMEOUT_MS = 10000;
    const OVERALL_TIMEOUT_MS = 20000; // must stay under the 30s score fetch timeout
    const start = Date.now();

    if (!this.apiKey) {
      console.warn('[OpenSea] OPENSEA_API_KEY not set, skipping fetch');
      return events;
    }

    do {
      page++;
      if (page > MAX_PAGES) {
        console.warn(`[OpenSea] ${walletLabel} hit max pages (${MAX_PAGES}), returning ${events.length} partial events`);
        break;
      }
      if (Date.now() - start > OVERALL_TIMEOUT_MS) {
        console.warn(`[OpenSea] ${walletLabel} overall timeout (${OVERALL_TIMEOUT_MS}ms) after ${page - 1} pages, returning ${events.length} partial events`);
        break;
      }

      const params = new URLSearchParams({ chain: 'ink', limit: '50' });
      params.append('event_type', 'sale');
      params.append('event_type', 'mint');
      if (next) params.set('next', next);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
        const pageStart = Date.now();

        const res = await fetch(`${OPENSEA_V2_EVENTS_URL}/${walletAddress.toLowerCase()}?${params}`, {
          headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // 429 = rate limited, 5xx = intermittent v2 API errors; both retryable
        if (res.status === 429 || res.status >= 500) {
          retries++;
          if (retries > MAX_RETRIES) {
            console.warn(`[OpenSea] ${walletLabel} giving up after ${MAX_RETRIES} retries (HTTP ${res.status}), returning ${events.length} partial events`);
            break;
          }
          const retryAfter = res.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 2000;
          console.warn(`[OpenSea] ${walletLabel} page ${page} HTTP ${res.status}, waiting ${waitTime}ms (retry ${retries}/${MAX_RETRIES})`);
          await new Promise((r) => setTimeout(r, waitTime));
          page--;
          continue;
        }

        if (!res.ok) {
          console.error(`[OpenSea] ${walletLabel} page ${page} API error: ${res.status} ${res.statusText}`);
          break;
        }

        const data = await res.json() as V2EventsResponse;
        const items = data.asset_events || [];
        events.push(...items);
        next = data.next || null;
        console.log(`[OpenSea] ${walletLabel} page ${page}: ${items.length} events in ${Date.now() - pageStart}ms (total: ${events.length})`);
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.error(`[OpenSea] ${walletLabel} page ${page} timed out after ${PER_PAGE_TIMEOUT_MS}ms`);
        } else {
          console.error(`[OpenSea] ${walletLabel} page ${page} error:`, error.message || error);
        }
        break;
      }
    } while (next);

    console.log(`[OpenSea] ${walletLabel} done: ${events.length} events in ${((Date.now() - start) / 1000).toFixed(2)}s`);
    return events;
  }

  /**
   * Calculate buy, sale, and mint counts from v2 events
   *
   * Logic:
   * - Buy: sale event where buyer matches wallet (count individual events)
   * - Sale: sale event where seller matches wallet (count individual events)
   * - Mint: transfer event with transfer_type=mint to wallet (count unique transactions)
   */
  calculateActivityCounts(events: V2AssetEvent[], walletAddress: string): ActivityCounts {
    const normalizedWallet = walletAddress.toLowerCase();

    const buys: string[] = [];
    const sales: string[] = [];
    const mintTxs = new Set<string>();

    for (const event of events) {
      if (event.event_type === 'sale') {
        if (event.buyer?.toLowerCase() === normalizedWallet) {
          buys.push(event.transaction || '');
        } else if (event.seller?.toLowerCase() === normalizedWallet) {
          sales.push(event.transaction || '');
        }
      } else if (event.event_type === 'mint' || (event.event_type === 'transfer' && event.transfer_type === 'mint')) {
        if (event.to_address?.toLowerCase() === normalizedWallet && event.transaction) {
          mintTxs.add(event.transaction);
        }
      }
    }

    return {
      buys: buys.length,
      sales: sales.length,
      mints: mintTxs.size,
      buyTransactions: buys,
      saleTransactions: sales,
      mintTransactions: Array.from(mintTxs),
    };
  }

  private async readDbCounts(wallet: string): Promise<{ counts: ActivityCounts; ageMs: number } | null> {
    await this.ensureTable();
    const row = await queryOne<CountsRow>(
      'SELECT * FROM opensea_wallet_counts WHERE wallet_address = $1',
      [wallet]
    );
    if (!row) return null;
    return {
      counts: {
        buys: row.buys, sales: row.sales, mints: row.mints,
        buyTransactions: [], saleTransactions: [], mintTransactions: [],
      },
      ageMs: Date.now() - new Date(row.updated_at).getTime(),
    };
  }

  private async writeDbCounts(wallet: string, counts: ActivityCounts): Promise<void> {
    await this.ensureTable();
    await query(
      `INSERT INTO opensea_wallet_counts (wallet_address, buys, sales, mints, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (wallet_address)
       DO UPDATE SET buys = $2, sales = $3, mints = $4, updated_at = now()`,
      [wallet, counts.buys, counts.sales, counts.mints]
    );
  }

  /**
   * Fetch from the v2 API and persist to both caches. Deduped per wallet.
   */
  private refresh(wallet: string): Promise<ActivityCounts> {
    const existing = this.inflight.get(wallet);
    if (existing) {
      console.log(`[OpenSea] Dedup: joining in-flight request for ${wallet.slice(0, 10)}...`);
      return existing;
    }

    const fetchPromise = (async (): Promise<ActivityCounts> => {
      try {
        const events = await this.fetchV2Events(wallet);
        const counts = this.calculateActivityCounts(events, wallet);
        this.countsCache.set(wallet, { counts, timestamp: Date.now() });
        await this.writeDbCounts(wallet, counts).catch((err) =>
          console.warn(`[OpenSea] DB cache write failed for ${wallet.slice(0, 10)}:`, err.message || err)
        );
        return counts;
      } finally {
        this.inflight.delete(wallet);
      }
    })();

    this.inflight.set(wallet, fetchPromise);
    return fetchPromise;
  }

  /**
   * Get buy/sale/mint counts for a wallet.
   * Memory cache -> Postgres cache (stale rows served immediately + refreshed in
   * background) -> inline v2 API fetch. Never throws; falls back to zeros.
   */
  async getAllCounts(walletAddress: string): Promise<ActivityCounts> {
    // Kill switch: skip OpenSea entirely so the score never blocks on it
    if (this.disabled) {
      console.warn('[OpenSea] disabled via DISABLE_OPENSEA, returning zeros');
      return ZERO_COUNTS;
    }

    const key = walletAddress.toLowerCase();

    // 1. Memory cache
    const cached = this.countsCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.MEMORY_TTL_MS) {
      console.log(`[OpenSea] Memory cache hit for ${key.slice(0, 10)}...`);
      return cached.counts;
    }

    // 2. Postgres cache
    try {
      const db = await this.readDbCounts(key);
      if (db) {
        if (db.ageMs < this.DB_TTL_MS) {
          console.log(`[OpenSea] DB cache hit for ${key.slice(0, 10)} (age ${(db.ageMs / 60000).toFixed(0)}m)`);
          this.countsCache.set(key, { counts: db.counts, timestamp: Date.now() });
          return db.counts;
        }
        // Stale: serve immediately, refresh in background
        console.log(`[OpenSea] DB cache stale for ${key.slice(0, 10)}, refreshing in background`);
        this.refresh(key).catch((err) =>
          console.warn(`[OpenSea] background refresh failed for ${key.slice(0, 10)}:`, err.message || err)
        );
        return db.counts;
      }
    } catch (err: any) {
      console.warn(`[OpenSea] DB cache read failed for ${key.slice(0, 10)}:`, err.message || err);
    }

    // 3. No cache anywhere: fetch inline (bounded by fetchV2Events' 20s budget)
    try {
      return await this.refresh(key);
    } catch (err: any) {
      console.error(`[OpenSea] fetch failed for ${key.slice(0, 10)}:`, err.message || err);
      return ZERO_COUNTS;
    }
  }
}

export const openSeaService = new OpenSeaService();
