import { NextRequest, NextResponse } from 'next/server';
import { EXPLORER_API_BASE, ZENITH_NFT_ADDRESS } from '@/lib/staking-contract';

/**
 * Held-Zenith discovery via the Blockscout instances endpoint:
 * /tokens/{collection}/instances?holder_address_hash={wallet}
 *
 * One request per wallet for typical holdings (paginated for whales),
 * no per-IP RPC budget to blow through — the public Ink RPC rate-limits
 * the shared serverless egress IPs, which is what killed the batched
 * ownerOf scan approach.
 *
 * Results are cached per wallet module-level (single-flighted, stale-serve
 * on failure) and on the CDN (s-maxage + stale-while-revalidate).
 * `?refresh=1` bypasses the cache TTL so stake/unstake flows can force a
 * post-tx read.
 */

const REQUEST_TIMEOUT = 10_000;
// 45s sits above the client's 30s poll cadence, so every other poll is a
// cache hit (~2 explorer requests/min per active wallet instead of 4).
// Tx flows bypass this via ?refresh=1, so staleness only affects viewers.
const CACHE_TTL_MS = 45_000;
const MAX_PAGES = 20;
const MAX_CACHED_WALLETS = 5_000;

interface CacheEntry {
  ids: string[];
  at: number;
}

const walletCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function pageUrl(query: string): string {
  return `${EXPLORER_API_BASE}/tokens/${ZENITH_NFT_ADDRESS}/instances?${query}`;
}

async function fetchHeldFromExplorer(wallet: string): Promise<string[]> {
  const ids: string[] = [];
  let url = pageUrl(`holder_address_hash=${wallet}`);
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!res.ok) throw new Error(`Explorer responded ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ id?: unknown }>;
      next_page_params?: Record<string, unknown> | null;
    };
    if (!data || !Array.isArray(data.items)) {
      throw new Error('Explorer returned unexpected payload');
    }
    for (const item of data.items) {
      if (item && typeof item.id === 'string' && /^\d+$/.test(item.id)) ids.push(item.id);
    }
    const next = data.next_page_params;
    if (!next || typeof next !== 'object') break;
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) qs.set(key, String(value));
    url = pageUrl(qs.toString());
  }
  ids.sort((a, b) => Number(a) - Number(b));
  return ids;
}

function evictIfNeeded(): void {
  if (walletCache.size <= MAX_CACHED_WALLETS) return;
  let evicted = 0;
  for (const key of walletCache.keys()) {
    walletCache.delete(key);
    if (++evicted >= MAX_CACHED_WALLETS / 2) break;
  }
}

/** Cached per-wallet lookup — single-flighted, stale-serve on failure. */
async function getHeldIds(wallet: string, forced: boolean): Promise<CacheEntry> {
  const now = Date.now();
  const cached = walletCache.get(wallet) ?? null;
  // Forced requests bypass the TTL — the caller just confirmed a tx and
  // needs the post-tx owner set, which a cache written before the tx lacks.
  if (!forced && cached && now - cached.at < CACHE_TTL_MS) return cached;

  const existing = inflight.get(wallet);
  if (existing) {
    if (cached && !forced) return cached;
    return existing;
  }

  const pending = fetchHeldFromExplorer(wallet)
    .then((ids) => {
      const entry: CacheEntry = { ids, at: Date.now() };
      walletCache.set(wallet, entry);
      evictIfNeeded();
      return entry;
    })
    .finally(() => {
      inflight.delete(wallet);
    });
  inflight.set(wallet, pending);

  if (cached && !forced) {
    void pending.catch(() => {}); // background refresh; stale data already served
    return cached;
  }
  try {
    return await pending;
  } catch (err) {
    if (cached) return cached; // last-known-good beats an error
    throw err;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const walletParam = request.nextUrl.searchParams.get('wallet') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletParam)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
  }
  const wallet = walletParam.toLowerCase();
  const forced = request.nextUrl.searchParams.get('refresh') === '1';

  let entry: CacheEntry;
  try {
    entry = await getHeldIds(wallet, forced);
  } catch (err) {
    console.error('[held-nfts] explorer lookup failed:', (err as Error).message);
    return NextResponse.json({ error: 'Held-NFT lookup failed' }, { status: 502 });
  }

  const res = NextResponse.json({ ids: entry.ids, scannedAt: entry.at });
  // Long SWR window: if origin or the explorer hiccups, the edge keeps
  // serving the last-good response instead of surfacing an error.
  res.headers.set('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=300');
  return res;
}
