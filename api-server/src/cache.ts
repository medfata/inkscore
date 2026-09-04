interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const DEFAULT_TTL = 30 * 1000; // 30 seconds — global default for non-wallet keys
const MAX_ENTRIES = 2000; // LRU cap: unbounded growth would OOM the 4GB VPS

// Per-wallet metrics TTL. One dashboard load / scan walks dozens of upstream
// pages per wallet; every repeat load inside the window is served from cache
// so a single wallet costs one real upstream scan per TTL period, however
// often it's viewed or scored. Configure with WALLET_CACHE_TTL_MIN
// (default 60 = 1 hour; e.g. set 15 for a 15-minute window).
const WALLET_TTL_MIN = parseInt(process.env.WALLET_CACHE_TTL_MIN || '60', 10);
export const WALLET_CACHE_TTL_MS = Math.max(DEFAULT_TTL, WALLET_TTL_MIN * 60 * 1000);

// Matches any cache key embedding an EVM address (wallet-scoped responses).
const WALLET_KEY_RE = /0x[0-9a-f]{40}/i;

// Explicit-refresh bypass window: when a user clicks Refresh (?refresh=true),
// wallet entries older than the default window are treated as stale so the
// request recomputes live — without touching the entries themselves (other
// concurrent viewers keep getting the cached data). Auto-expires so a stale
// flag can never leak across unrelated requests.
let bypassUntil = 0;
export function bypassWalletCache(ms = 5000): void {
  bypassUntil = Math.max(bypassUntil, Date.now() + ms);
}

class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.timestamp;
    const fresh = age <= entry.ttlMs;
    // ?refresh=true: wallet entries older than the default window are ignored
    // for this short window, but NOT deleted — concurrent non-refresh viewers
    // keep their cached data.
    const bypassed = WALLET_KEY_RE.test(key) && now < bypassUntil && age > DEFAULT_TTL;

    if (fresh && !bypassed) {
      // LRU touch: re-insert to mark as recently used
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.data as T;
    }

    if (!fresh) {
      this.cache.delete(key);
    }
    return null;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    // Per-wallet responses get the long wallet TTL automatically: every
    // dashboard load / score poll touches dozens of these keys, and each one
    // costs real upstream scans. One scan per wallet per window, then cached.
    // Keys embedding a 0x…40-hex wallet address are wallet-scoped.
    let effectiveTtl = ttlMs ?? (WALLET_KEY_RE.test(key) ? WALLET_CACHE_TTL_MS : DEFAULT_TTL);
    // Never long-cache incomplete data: partial walks (capped pages, truncated
    // bridge fills) must recompute so USD converges to complete over loads.
    // Applies to any entry cached longer than the default window.
    if (effectiveTtl > DEFAULT_TTL && data && typeof data === 'object' && (data as { partial?: boolean }).partial === true) {
      effectiveTtl = DEFAULT_TTL;
    }
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict least-recently-used entries while over capacity
    while (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    this.cache.set(key, { data, timestamp: Date.now(), ttlMs: effectiveTtl });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

export const responseCache = new ResponseCache();

// Run cleanup every minute
setInterval(() => responseCache.cleanup(), 60 * 1000);

// ---- shared long-cache + in-flight dedup ---------------------------------
// responseCache default TTL is 30s, so every dashboard poll recomputes slow
// routes from scratch — and the frontend's direct fetch + the score's self-fetch
// fire simultaneously, doubling Blockscout/external-API load (the duplicate
// "discovery completed" lines). These helpers fix both:
// - getLongCache/setLongCache: minute-scale cache for slow-moving data
//   (append-only histories, third-party volumes). Never store partial/
//   truncated results here — they must recompute so USD converges.
// - withInflight: concurrent requests for the same key share one computation
//   instead of stampeding the upstream.
const longCache = new Map<string, { data: unknown; timestamp: number }>();
const LONG_CACHE_MAX = 1000;

export function getLongCache<T>(key: string, ttlMs: number): T | null {
  const entry = longCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) {
    longCache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setLongCache<T>(key: string, data: T): void {
  if (longCache.size >= LONG_CACHE_MAX) {
    const oldest = longCache.keys().next();
    if (!oldest.done) longCache.delete(oldest.value);
  }
  longCache.set(key, { data, timestamp: Date.now() });
}

const inflight = new Map<string, Promise<unknown>>();

export function getInflight<T>(key: string): Promise<T> | null {
  return (inflight.get(key) as Promise<T>) ?? null;
}

export async function withInflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
