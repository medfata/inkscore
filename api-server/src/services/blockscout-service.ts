// Blockscout Service — Ink chain data via the official explorer API.
//
// Replaces the dead Routescan dependency (Routescan delisted Ink Mainnet:
// every api/cdn/canary URL for chain 57073 now returns 400). All endpoints
// below were verified live against https://explorer.inkonchain.com/api/v2.
//
// Design (keeps us under the ~180 req/min public budget):
// - Token-bucket throttle (~150 req/min) + concurrency cap + 429 backoff.
// - Postgres caches: TTL caches for mutable aggregates, PERMANENT cache for
//   immutable per-tx data (chain facts never change: fetch once, ever).
// - Incremental refresh: protocol counts store last_seen and re-query with
//   `age_from`, so steady-state refresh costs only new activity.
// - Hard caps per request (pages / tx hashes) + partial flags; a background
//   worker completes truncated fills. Scoring must only use complete values.

import { query, queryOne } from '../db';
import { withInflight } from '../cache';
import { proxiedFetch, isProxyEnabled, logProxyStatus } from './proxy-agent';

const BLOCKSCOUT_BASE = 'https://explorer.inkonchain.com/api/v2';
const INK_CHAIN_ID = 57073;

// ---- throttle -------------------------------------------------------------
// Env-tunable for ops: with the 15-IP residential pool the upstream per-IP
// budget no longer accumulates, so BLOCKSCOUT_RATE_LIMIT can be raised above
// the direct-egress-safe 150 if cold walks feel slow (watch the usage logger).
const RATE_LIMIT_PER_MIN = parseInt(process.env.BLOCKSCOUT_RATE_LIMIT || '150', 10);
// Read by the refresh worker: it yields to user traffic at 80% of whatever
// the throttle is configured for, so raising the limit scales the backoff
// threshold automatically.
export function getBlockscoutRateLimit(): number {
  return RATE_LIMIT_PER_MIN;
}
const MAX_CONCURRENT = parseInt(process.env.BLOCKSCOUT_MAX_CONCURRENT || '10', 10);
const REQUEST_TIMEOUT_MS = 10_000;

let tokensAvailable = RATE_LIMIT_PER_MIN;
let lastRefill = Date.now();
let inFlight = 0;
// Global 429 cooldown: while any request is backing off, pause ALL new
// admissions so the upstream can actually recover. Without this, the bucket
// keeps admitting fresh requests at full rate during other requests'
// backoff windows and the 429s never stop.
let cooldownUntil = 0;
const waitQueue: Array<() => void> = [];

function refillTokens(): void {
  const now = Date.now();
  const elapsedMin = (now - lastRefill) / 60_000;
  if (elapsedMin > 0) {
    tokensAvailable = Math.min(RATE_LIMIT_PER_MIN, tokensAvailable + elapsedMin * RATE_LIMIT_PER_MIN);
    lastRefill = now;
  }
}

async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    if (now < cooldownUntil) {
      await new Promise<void>((resolve) => setTimeout(resolve, cooldownUntil - now + 50));
      continue;
    }
    refillTokens();
    if (tokensAvailable >= 1 && inFlight < MAX_CONCURRENT) {
      tokensAvailable -= 1;
      inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      waitQueue.push(resolve);
      setTimeout(resolve, 100);
    });
  }
}

function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  const waiter = waitQueue.shift();
  if (waiter) waiter();
}

// ---- usage accounting -------------------------------------------------------
// Approximates proxy bandwidth: decompressed JSON bytes per successful
// response. Actual wire usage is lower (Blockscout gzips — tx pages measured
// ~8-12x compression), so treat these numbers as the conservative ceiling.
// The 60s log line lets you read exactly what one real wallet scan costs:
// run a scan, note the KB in that minute's line.
let totalBytes = 0;
let totalReqs = 0;
let windowBytes = 0;
let windowReqs = 0;
// Rolling 60s request timestamps — read by the refresh worker to yield to
// user traffic: when the throttle is saturated by interactive loads, the
// worker skips its cycle instead of competing for the same budget.
const recentReqTimes: number[] = [];
export function getRecentBlockscoutUsagePerMin(): number {
  const cutoff = Date.now() - 60_000;
  while (recentReqTimes.length && recentReqTimes[0] < cutoff) recentReqTimes.shift();
  return recentReqTimes.length;
}
function accountUsage(data: unknown): void {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(data));
    totalBytes += bytes;
    totalReqs += 1;
    windowBytes += bytes;
    windowReqs += 1;
    const now = Date.now();
    recentReqTimes.push(now);
    if (recentReqTimes.length > 2000) {
      const cutoff = now - 60_000;
      while (recentReqTimes.length && recentReqTimes[0] < cutoff) recentReqTimes.shift();
    }
  } catch {
    // ignore — accounting must never break a scan
  }
}
setInterval(() => {
  if (windowReqs === 0) return;
  const kb = windowBytes / 1024;
  console.log(
    `[Blockscout usage] last 60s: ${windowReqs} reqs, ${(kb / 1024).toFixed(2)} MB decompressed (~${(kb / 10 / 1024).toFixed(2)} MB wire) — lifetime: ${totalReqs} reqs, ${(totalBytes / 1024 / 1024).toFixed(1)} MB`
  );
  windowBytes = 0;
  windowReqs = 0;
}, 60_000).unref();

async function bsFetch(path: string, retries = 3): Promise<any> {
  // Loop instead of recursing: a recursive retry would run inside this
  // frame's try, so `finally { releaseSlot() }` fires once for the retry AND
  // once for the original attempt. Every 429 thus under-counted inFlight and
  // the MAX_CONCURRENT cap silently stopped working, which is what turned
  // cold walks into 429 storms.
  for (let attempt = 0; ; attempt++) {
    await acquireSlot();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let res: Awaited<ReturnType<typeof proxiedFetch>>;
      try {
        // Egress through the residential proxy pool: Blockscout's rate limit
        // is per-IP, so round-robining sticky sessions keeps the budget from
        // accumulating on one address. The local throttle/cooldown below
        // stays as the second line of defense.
        res = await proxiedFetch(`${BLOCKSCOUT_BASE}${path}`, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        // Network-level failures (proxy TLS garbage, dead tunnels, resets)
        // are retried on a FRESH proxy session — a single flaky session used
        // to abort the whole walk and blank the card. Request TIMEOUTS are
        // NOT retried: they mean the upstream is struggling, and retrying
        // would hammer it (same reasoning as the 429 cooldown).
        if (err?.name === 'AbortError' || attempt >= 2) throw err;
        console.warn(`[Blockscout] network error for ${path.slice(0, 60)} — retrying on fresh proxy session (${attempt + 1}/2): ${err?.cause?.code || err?.message || err}`);
        continue; // finally releases the slot exactly once; proxiedFetch already rotated the bad session
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.status === 429 && attempt < retries) {
        const retryAfter = parseInt(res.headers.get('retry-after') || '', 10);
        // Exponential backoff with Retry-After floor: 5s, 10s, 20s.
        const waitMs = Number.isFinite(retryAfter)
          ? Math.max(retryAfter * 1000, 5000 * Math.pow(2, attempt))
          : 5000 * Math.pow(2, attempt);
        cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
        console.warn(`[Blockscout] 429 for ${path.slice(0, 60)}, waiting ${waitMs}ms (${retries - attempt} retries left)`);
        continue; // finally releases the slot exactly once
      }
      if (!res.ok) {
        throw new Error(`Blockscout HTTP ${res.status} for ${path}`);
      }
      const data = await res.json();
      accountUsage(data);
      return data;
    } finally {
      releaseSlot();
    }
  }
}

export function isBlockscoutEnabled(): boolean {
  return process.env.BLOCKSCOUT_SOURCE !== 'off';
}

// Blockscout requires ISO 8601 for age_from/age_to. Postgres TIMESTAMPTZ
// comes back as a JS Date whose toString() is NOT ISO ("Thu Sep 03 ..."),
// which Blockscout rejects with HTTP 422 — always normalize here.
export function toAgeParam(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  try {
    const iso = v instanceof Date ? v.toISOString() : new Date(v).toISOString();
    return iso;
  } catch {
    return null;
  }
}

function assertEnabled(): void {
  if (!isBlockscoutEnabled()) {
    throw new Error('Blockscout source disabled via BLOCKSCOUT_SOURCE=off');
  }
}

// ---- types ----------------------------------------------------------------
export interface BsTokenHolding {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  rawBalance: string;
  exchangeRate: number; // current USD price, 0 when unlisted
  iconUrl: string;
  tokenType: string;
}

export interface BsNftHolding {
  address: string;
  name: string;
  count: number;
}

export interface BsTransferLeg {
  tokenAddress: string;
  symbol: string;
  decimals: number;
  amount: number; // human-readable
  exchangeRate: number;
  fromAddress: string;
  toAddress: string;
}

export interface BsTxMeta {
  method: string | null;
  selector: string | null; // 4-byte input selector, canonical across ABIs
  to: string | null;
  value: string;
  timestamp: string | null;
  ok: boolean | null;
}

export interface ProtocolCount {
  count: number;
  complete: boolean;
}

// ---- schema (self-creating, like opensea_wallet_counts) --------------------
let tablesReady: Promise<void> | null = null;

function ensureTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS bs_wallet_stats (
        wallet_address TEXT PRIMARY KEY,
        txns INTEGER NOT NULL DEFAULT 0,
        first_seen TIMESTAMPTZ,
        eth_wei TEXT NOT NULL DEFAULT '0',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_holdings (
        wallet_address TEXT PRIMARY KEY,
        tokens JSONB NOT NULL DEFAULT '[]',
        nfts JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_protocol_counts (
        wallet_address TEXT NOT NULL,
        protocol TEXT NOT NULL,
        methods_hash TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL DEFAULT 0,
        last_seen TIMESTAMPTZ,
        complete BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (wallet_address, protocol)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_tx_legs (
        tx_hash TEXT PRIMARY KEY,
        transfers JSONB NOT NULL,
        method TEXT,
        selector TEXT,
        tx_to TEXT,
        tx_value TEXT NOT NULL DEFAULT '0',
        tx_timestamp TIMESTAMPTZ,
        tx_ok BOOLEAN,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      // Additive migrations for tables created by older builds.
      await query(`ALTER TABLE bs_tx_legs ADD COLUMN IF NOT EXISTS selector TEXT`);
      await query(`CREATE TABLE IF NOT EXISTS bs_native_volume (
        wallet_address TEXT PRIMARY KEY,
        out_wei TEXT NOT NULL DEFAULT '0',
        out_count INTEGER NOT NULL DEFAULT 0,
        last_seen TIMESTAMPTZ,
        complete BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_tx_logs (
        tx_hash TEXT PRIMARY KEY,
        logs JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_bridge_inflows (
        wallet_address TEXT PRIMARY KEY,
        inflows JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      // Sprint 3: cursored tx-hash discovery — the accumulated hash set IS
      // the cursor (historical matches never change; each pass only adds).
      await query(`CREATE TABLE IF NOT EXISTS bs_tx_discovery (
        wallet_address TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        covered_oldest TIMESTAMPTZ,
        covered_newest TIMESTAMPTZ,
        complete BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (wallet_address, query_hash)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_protocol_tx_hashes (
        wallet_address TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (wallet_address, query_hash, tx_hash)
      )`);
      await query(`CREATE TABLE IF NOT EXISTS bs_refresh_queue (
        wallet_address TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT '',
        to_address TEXT NOT NULL DEFAULT '',
        methods TEXT NOT NULL DEFAULT '',
        method_names TEXT NOT NULL DEFAULT '',
        direction TEXT NOT NULL DEFAULT 'out',
        priority INTEGER NOT NULL DEFAULT 0,
        next_run TIMESTAMPTZ NOT NULL DEFAULT now(),
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (wallet_address, protocol)
      )`);
    })().catch((err) => {
      tablesReady = null;
      throw err;
    });
  }
  return tablesReady;
}

async function dbGet<T>(sql: string, params: unknown[]): Promise<T | null> {
  try {
    await ensureTables();
    return await queryOne<T>(sql, params as never[]);
  } catch (err: any) {
    console.warn('[Blockscout] DB cache read failed:', err.message || err);
    return null;
  }
}

async function dbWrite(sql: string, params: unknown[]): Promise<void> {
  try {
    await ensureTables();
    await query(sql, params as never[]);
  } catch (err: any) {
    console.warn('[Blockscout] DB cache write failed:', err.message || err);
  }
}

// ---- wallet stats ----------------------------------------------------------
const STATS_TTL_MS = 15 * 60 * 1000;

export async function getWalletStats(walletAddress: string): Promise<{
  txns: number;
  firstSeen: string | null;
  ethWei: string;
}> {
  assertEnabled();
  const wallet = walletAddress.toLowerCase();
  const cached = await dbGet<{ txns: number; first_seen: string | null; eth_wei: string; updated_at: string }>(
    'SELECT txns, first_seen, eth_wei, updated_at FROM bs_wallet_stats WHERE wallet_address = $1',
    [wallet]
  );
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < STATS_TTL_MS) {
    return { txns: cached.txns, firstSeen: cached.first_seen, ethWei: cached.eth_wei };
  }

  const [counters, oldest, address] = await Promise.all([
    bsFetch(`/addresses/${wallet}/counters`),
    bsFetch(`/addresses/${wallet}/transactions?sort=block_number&order=asc&items_count=1`),
    bsFetch(`/addresses/${wallet}`),
  ]);

  const txns = parseInt(counters?.transactions_count || '0', 10) || 0;
  const firstSeen: string | null = oldest?.items?.[0]?.timestamp || null;
  const ethWei: string = address?.coin_balance || '0';

  await dbWrite(
    `INSERT INTO bs_wallet_stats (wallet_address, txns, first_seen, eth_wei, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (wallet_address) DO UPDATE SET txns = $2, first_seen = $3, eth_wei = $4, updated_at = now()`,
    [wallet, txns, firstSeen, ethWei]
  );
  return { txns, firstSeen, ethWei };
}

// ---- holdings --------------------------------------------------------------
const HOLDINGS_TTL_MS = 15 * 60 * 1000;
const HOLDINGS_PAGE_LIMIT = 50;

async function fetchAllPages(path: string, maxPages: number): Promise<{ items: any[]; complete: boolean }> {
  const items: any[] = [];
  let url: string | null = path;
  let pages = 0;
  while (url && pages < maxPages) {
    pages++;
    const data = await bsFetch(url);
    if (Array.isArray(data?.items)) items.push(...data.items);
    const np = data?.next_page_params;
    if (!np) break;
    const qs = Object.entries(np)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
      .join('&');
    // next_page_params are cursors for the same endpoint (strip to base path)
    const basePath = path.split('?')[0];
    const baseQs = path.includes('?') ? path.split('?')[1] + '&' : '';
    url = `${basePath}?${baseQs}${qs}`;
  }
  return { items, complete: pages < maxPages };
}

async function refreshHoldings(wallet: string): Promise<{ tokens: BsTokenHolding[]; nfts: BsNftHolding[] }> {
  assertEnabled();
  const [tokenRes, nftRes] = await Promise.all([
    fetchAllPages(`/addresses/${wallet}/tokens?type=ERC-20`, 5),
    fetchAllPages(`/addresses/${wallet}/nft/collections`, 5),
  ]);
  const tokens: BsTokenHolding[] = [];
  for (const item of tokenRes.items) {
    const token = item?.token || {};
    if (!token?.address_hash) continue;
    tokens.push({
      address: String(token.address_hash).toLowerCase(),
      symbol: token.symbol || '',
      name: token.name || '',
      decimals: Number(token.decimals ?? 18),
      rawBalance: String(item.value ?? '0'),
      exchangeRate: parseFloat(token.exchange_rate || '0') || 0,
      iconUrl: token.icon_url || '',
      tokenType: token.type || '',
    });
  }
  const nfts: BsNftHolding[] = [];
  for (const item of nftRes.items) {
    const token = item?.token || {};
    if (!token?.address_hash) continue;
    nfts.push({
      address: String(token.address_hash).toLowerCase(),
      name: token.name || '',
      count: parseInt(item.amount || '0', 10) || 0,
    });
  }
  await dbWrite(
    `INSERT INTO bs_holdings (wallet_address, tokens, nfts, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (wallet_address) DO UPDATE SET tokens = $2, nfts = $3, updated_at = now()`,
    [wallet, JSON.stringify(tokens), JSON.stringify(nfts)]
  );
  return { tokens, nfts };
}

export async function getTokenHoldingsRaw(walletAddress: string): Promise<BsTokenHolding[]> {
  const wallet = walletAddress.toLowerCase();
  const cached = await dbGet<{ tokens: BsTokenHolding[]; updated_at: string }>(
    'SELECT tokens, updated_at FROM bs_holdings WHERE wallet_address = $1',
    [wallet]
  );
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < HOLDINGS_TTL_MS) {
    return cached.tokens;
  }
  const { tokens } = await refreshHoldings(wallet);
  return tokens;
}

export async function getNftHoldingsRaw(walletAddress: string): Promise<BsNftHolding[]> {
  const wallet = walletAddress.toLowerCase();
  const cached = await dbGet<{ nfts: BsNftHolding[]; updated_at: string }>(
    'SELECT nfts, updated_at FROM bs_holdings WHERE wallet_address = $1',
    [wallet]
  );
  if (cached && Date.now() - new Date(cached.updated_at).getTime() < HOLDINGS_TTL_MS) {
    return cached.nfts;
  }
  const { nfts } = await refreshHoldings(wallet);
  return nfts;
}

// ---- protocol counts (incremental via age_from) -----------------------------
const COUNTS_TTL_MS = 60 * 60 * 1000;
// Page caps are safety valves per request; walks marked incomplete converge
// over successive loads (background refresh + permanent per-tx caches).
const MAX_COUNT_PAGES = 100;

function hashQuery(methods: string[] | null, methodNames: string[], direction = 'out'): string {
  const parts: string[] = [`dir:${direction}`];
  if (methods && methods.length > 0) {
    parts.push('sel:' + [...methods].map((m) => m.toLowerCase()).sort().join(','));
  }
  if (methodNames.length > 0) {
    parts.push('names:' + [...methodNames].map((m) => m.toLowerCase()).sort().join(','));
  }
  return parts.join('|');
}

function normalizeMethodNames(names: string[] | null | undefined): string[] {
  if (!names || names.length === 0) return [];
  return names.map((n) => n.toLowerCase());
}

// A tx matches when it is not failed AND (selector matches OR name
// matches). Either filter list may be empty (= no constraint from it).
// Unknown metadata fails open (kept) so a decode gap never zeroes a metric.
function matchTx(
  meta: BsTxMeta | undefined,
  methods: string[] | null,
  methodNames: string[]
): boolean {
  if (meta && meta.ok === false) return false;
  if (!meta) return true;
  const selMatch =
    !methods || methods.length === 0
      ? false
      : methods.some((m) => m.toLowerCase() === (meta.selector || '').toLowerCase());
  const name = (meta.method || '').toLowerCase();
  const nameMatch =
    methodNames.length === 0
      ? false
      : methodNames.some((n) => name === n || name.startsWith(n + '('));
  if (methods && methods.length > 0 && methodNames.length > 0) return selMatch || nameMatch;
  if (methods && methods.length > 0) return selMatch;
  if (methodNames.length > 0) return nameMatch;
  return true;
}

// Cap for per-tx metadata resolution in name-filtered queries. These target
// low-frequency actions (mints, raffles, DCA runs, ZNS, staking) so small
// result sets are the norm; the cap is a safety valve with partial+queue.
const META_RESOLVE_CAP = 1000;

async function filterByMethodNames(
  hashes: string[],
  methods: string[] | null,
  names: string[]
): Promise<{ matched: string[]; complete: boolean }> {
  if (names.length === 0) return { matched: hashes, complete: true };
  const slice = hashes.slice(0, META_RESOLVE_CAP);
  const metas = await getTxMetas(slice);
  return {
    matched: slice.filter((h) => matchTx(metas.get(h), methods, names)),
    complete: hashes.length <= META_RESOLVE_CAP,
  };
}

// Walk advanced-filters pages collecting distinct contract_interaction tx
// hashes. Returns hashes + whether the walk finished (false = page cap hit).
// `since` (age_from) scans only NEWER activity; `until` (age_to, verified
// supported — full ISO required) resumes a build pass strictly BELOW its
// floor, so repeated passes extend coverage downward without re-walking the
// same newest pages.
async function walkProtocolTxHashes(
  fromAddr: string,
  toAddr: string,
  methods: string[] | null,
  since: string | null,
  maxPages: number,
  until: string | null = null
): Promise<{ hashes: string[]; complete: boolean; newestSeen: string | null; oldestSeen: string | null }> {
  const from = fromAddr.toLowerCase();
  const to = toAddr.toLowerCase();
  let base =
    `/advanced-filters?from_address_hashes_to_include=${from}` +
    `&to_address_hashes_to_include=${to}&address_relation=and`;
  if (methods && methods.length > 0) {
    base += `&methods=${methods.map((m) => m.toLowerCase()).join(',')}`;
  }
  // Normalize: PG TIMESTAMPTZ reads back as Date; Blockscout needs ISO 8601
  // (raw Date.toString() yields HTTP 422). Date-only strings are silently
  // IGNORED by age_to (verified live) — full ISO is mandatory.
  const sinceIso = toAgeParam(since);
  const untilIso = toAgeParam(until);
  const sinceQs = sinceIso ? `age_from=${encodeURIComponent(sinceIso)}` : '';
  const untilQs = untilIso ? `age_to=${encodeURIComponent(untilIso)}` : '';
  const joinQs = (extra: string): string => {
    const parts = [sinceQs, untilQs, extra].filter((p) => p.length > 0);
    return parts.length > 0 ? `${base}&${parts.join('&')}` : base;
  };
  let url: string | null = joinQs('');
  const seen = new Set<string>();
  let newestSeen: string | null = sinceIso;
  let oldestSeen: string | null = untilIso;
  let pages = 0;
  while (url && pages < maxPages) {
    pages++;
    const data = await bsFetch(url);
    for (const item of data?.items || []) {
      if (item?.type === 'contract_interaction' && item?.hash) {
        seen.add(String(item.hash).toLowerCase());
      }
      if (item?.timestamp && (!newestSeen || item.timestamp > newestSeen)) {
        newestSeen = item.timestamp;
      }
      if (item?.timestamp && (!oldestSeen || item.timestamp < oldestSeen)) {
        oldestSeen = item.timestamp;
      }
    }
    const np = data?.next_page_params;
    if (!np) break;
    const qs = Object.entries(np)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
      .join('&');
    url = joinQs(qs);
  }
  return { hashes: [...seen], complete: pages < maxPages, newestSeen, oldestSeen };
}

export type TxDirection = 'out' | 'in' | 'either';

export async function getProtocolCount(
  walletAddress: string,
  protocol: string,
  toAddress: string,
  methods: string[] | null,
  methodNames: string[] | null = null,
  direction: TxDirection = 'out'
): Promise<ProtocolCount> {
  assertEnabled();
  const wallet = walletAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  const names = normalizeMethodNames(methodNames);
  const methodsHash = hashQuery(methods, names, direction);
  const cached = await dbGet<{ count: number; last_seen: string | null; complete: boolean; updated_at: string }>(
    'SELECT count, last_seen, complete, updated_at FROM bs_protocol_counts WHERE wallet_address = $1 AND protocol = $2',
    [wallet, protocol]
  );

  const fresh = cached && Date.now() - new Date(cached.updated_at).getTime() < COUNTS_TTL_MS;
  if (fresh && cached!.complete) {
    return { count: cached!.count, complete: true };
  }

  // Dedup concurrent identical walks: the dashboard's ~27-request burst and
  // the score's self-fetches fire the same (wallet, protocol) count at the
  // same moment — without this, both run the full walk and double the
  // Blockscout load.
  return withInflight(`proto-count:${wallet}:${protocol}:${methodsHash}`, async () => {
    // Re-check: a concurrent run may have completed while we waited on the
    // in-flight slot.
    const cachedNow = await dbGet<{ count: number; last_seen: string | null; complete: boolean; updated_at: string }>(
      'SELECT count, last_seen, complete, updated_at FROM bs_protocol_counts WHERE wallet_address = $1 AND protocol = $2',
      [wallet, protocol]
    );
    const freshNow = cachedNow && Date.now() - new Date(cachedNow.updated_at).getTime() < COUNTS_TTL_MS;
    if (freshNow && cachedNow!.complete) {
      return { count: cachedNow!.count, complete: true };
    }
    const row = cachedNow ?? cached;

    // Incremental refresh: only activity since last_seen (cheap + exact).
    // direction=either unions both directions (needed for fill/claim flows
    // that may not originate from the wallet).
    const since = row?.last_seen || null;
    const dirs: Array<[string, string]> =
      direction === 'either'
        ? [[wallet, to], [to, wallet]]
        : direction === 'in'
          ? [[to, wallet]]
          : [[wallet, to]];
    const results = await Promise.all(
      dirs.map(([f, t]) => walkProtocolTxHashes(f, t, methods, since, MAX_COUNT_PAGES))
    );
    const hashes = [...new Set(results.flatMap((r) => r.hashes))];
    const walkComplete = results.every((r) => r.complete);
    const newestSeen = results.reduce<string | null>(
      (acc, r) => (!acc || (r.newestSeen && r.newestSeen > acc) ? r.newestSeen || acc : acc),
      since
    );

    let matched = hashes;
    let namesComplete = true;
    if (names.length > 0 && hashes.length > 0) {
      const filtered = await filterByMethodNames(hashes, methods, names);
      matched = filtered.matched;
      namesComplete = filtered.complete;
    }
    const count = (row?.count || 0) + matched.length;
    const complete = walkComplete && namesComplete;

    await dbWrite(
      `INSERT INTO bs_protocol_counts (wallet_address, protocol, methods_hash, count, last_seen, complete, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (wallet_address, protocol)
       DO UPDATE SET count = $4, last_seen = COALESCE($5, bs_protocol_counts.last_seen),
         complete = $6, methods_hash = $3, updated_at = now()`,
      [wallet, protocol, methodsHash, count, newestSeen, complete]
    );
    if (!complete) {
      await queueRefresh(wallet, 10, { protocol, toAddress: to, methods: methods || [], methodNames: names, direction });
    }
    return { count, complete };
  });
}

// Return distinct tx hashes for a protocol query (for USD legs).
//
// SPRINT 3 — CURSORIZED DISCOVERY (historical data never changes, so it is
// scanned exactly once):
// - The accumulated hash set lives in bs_protocol_tx_hashes, keyed by the
//   exact query (wallet + to-address + methods + direction). The set IS the
//   cursor: walks stop at the first hash we already know.
// - covered_oldest (bs_tx_discovery) is the walk floor: when a pass hits its
//   page cap, the next pass resumes BELOW that point with age_to (verified
//   supported by advanced-filters, full-ISO required) instead of re-walking
//   the same newest pages.
// - complete=true means every historical match is in the set; refreshes then
//   only scan age_from=covered_newest (same incremental model as counts).
// - ACCURACY: the returned hash list is ALWAYS the full accumulated set, so
//   every USD sum derived from it is complete — a truncated pass only
//   affects WHEN the remaining history gets discovered (background passes),
//   never WHAT is summed.
export async function getProtocolTxHashes(
  walletAddress: string,
  toAddress: string,
  methods: string[] | null,
  methodNames: string[] | null = null,
  maxPages = 10,
  direction: TxDirection = 'out'
): Promise<{ hashes: string[]; complete: boolean }> {
  assertEnabled();
  const wallet = walletAddress.toLowerCase();
  const to = toAddress.toLowerCase();
  const names = normalizeMethodNames(methodNames);
  const queryHash = `${to}:${hashQuery(methods, names, direction)}`;

  const DISCOVERY_TTL_MS = 10 * 60 * 1000;
  const cached = await dbGet<{ covered_oldest: string | null; covered_newest: string | null; complete: boolean; updated_at: string }>(
    'SELECT covered_oldest, covered_newest, complete, updated_at FROM bs_tx_discovery WHERE wallet_address = $1 AND query_hash = $2',
    [wallet, queryHash]
  );
  if (cached && cached.complete && Date.now() - new Date(cached.updated_at).getTime() < DISCOVERY_TTL_MS) {
    const rows = await query<{ tx_hash: string }>(
      'SELECT tx_hash FROM bs_protocol_tx_hashes WHERE wallet_address = $1 AND query_hash = $2',
      [wallet, queryHash]
    );
    return { hashes: rows.map((r) => r.tx_hash), complete: true };
  }

  return withInflight(`tx-disc:${wallet}:${queryHash}`, async () => {
    // Re-read state inside the in-flight slot (a concurrent pass may have
    // advanced the cursor while we waited).
    const cur = (await dbGet<{ covered_oldest: string | null; covered_newest: string | null; complete: boolean }>(
      'SELECT covered_oldest, covered_newest, complete FROM bs_tx_discovery WHERE wallet_address = $1 AND query_hash = $2',
      [wallet, queryHash]
    )) ?? { covered_oldest: null, covered_newest: null, complete: false };
    const knownRows = await query<{ tx_hash: string }>(
      'SELECT tx_hash FROM bs_protocol_tx_hashes WHERE wallet_address = $1 AND query_hash = $2',
      [wallet, queryHash]
    );
    const known = new Set(knownRows.map((r) => r.tx_hash));

    // Refresh pass (history fully covered): only scan for NEWER activity.
    // Build pass (page cap hit earlier): resume strictly below the floor.
    const refreshPass = cur.complete && cur.covered_newest != null;
    const dirs: Array<[string, string]> =
      direction === 'either' ? [[wallet, to], [to, wallet]] : direction === 'in' ? [[to, wallet]] : [[wallet, to]];
    const results = await Promise.all(
      dirs.map(([f, t]) =>
        walkProtocolTxHashes(
          f,
          t,
          methods,
          refreshPass ? cur.covered_newest : null,
          maxPages,
          refreshPass ? null : cur.covered_oldest
        )
      )
    );
    const found = [...new Set(results.flatMap((r) => r.hashes))].map((h) => h.toLowerCase());
    const newHashes = found.filter((h) => !known.has(h));
    if (newHashes.length > 0) {
      // Batch insert the newly discovered hashes.
      const chunk = 200;
      for (let i = 0; i < newHashes.length; i += chunk) {
        const slice = newHashes.slice(i, i + chunk);
        const values = slice.map((_, idx) => `($1, $2, $${idx + 3})`).join(', ');
        await dbWrite(
          `INSERT INTO bs_protocol_tx_hashes (wallet_address, query_hash, tx_hash)
           VALUES ${values}
           ON CONFLICT (wallet_address, query_hash, tx_hash) DO NOTHING`,
          [wallet, queryHash, ...slice]
        );
      }
    }
    for (const h of newHashes) known.add(h);

    // Cursor update: newest/oldest seen across this pass, clamped so a pass
    // can never move a boundary the wrong way (multi-direction queries walk
    // independently; the floor is the MIN across dirs — a shallower dir is
    // simply re-walked with dedupe, which is correct, just less optimal).
    let newestSeen: string | null = cur.covered_newest;
    let oldestSeen: string | null = cur.covered_oldest;
    for (const r of results) {
      if (r.newestSeen && (!newestSeen || r.newestSeen > newestSeen)) newestSeen = r.newestSeen;
      if (r.oldestSeen && (!oldestSeen || r.oldestSeen < oldestSeen)) oldestSeen = r.oldestSeen;
    }
    // (A build pass that finishes its pages without hitting the cap HAS
    // walked all remaining history — complete. A capped pass leaves
    // complete=false and the floor advances for the next pass.)
    const complete = results.every((r) => r.complete);

    await dbWrite(
      `INSERT INTO bs_tx_discovery (wallet_address, query_hash, covered_oldest, covered_newest, complete, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (wallet_address, query_hash)
       DO UPDATE SET covered_oldest = $3, covered_newest = $4, complete = $5, updated_at = now()`,
      [wallet, queryHash, oldestSeen, newestSeen, complete]
    );
    if (!complete) {
      // Incomplete passes converge via the heavy-metric service jobs the
      // bundle/score paths enqueue (swap/tydro/nado/... re-run this
      // discovery with the cursor resuming below its floor). No self-enqueue
      // here: a bare 'txdisc' queue row would not carry the full query
      // context (direction/methodNames) and the drain cannot re-run it
      // faithfully.
    }
    // Preserve the old behavior exactly: method-name filtering applies to
    // the RETURNED set (tx metas are permanently cached, so re-filtering the
    // accumulated set costs DB reads only — no Blockscout requests).
    if (names.length === 0) {
      return { hashes: [...known], complete };
    }
    const filtered = await filterByMethodNames([...known], methods, names);
    return { hashes: filtered.matched, complete: complete && filtered.complete };
  });
}

// ---- per-tx data (permanent cache: chain facts never change) ---------------
export interface BsTxData {
  legs: BsTransferLeg[];
  meta: BsTxMeta;
}

export async function getTxData(txHashes: string[]): Promise<Map<string, BsTxData>> {
  const result = new Map<string, BsTxData>();
  if (txHashes.length === 0) return result;
  const normalized = [...new Set(txHashes.map((h) => h.toLowerCase()))];

  await ensureTables();
  const missing: string[] = [];
  // Chunk the IN query to stay well within PG parameter limits.
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    try {
      const rows = await query<{
        tx_hash: string;
        transfers: BsTransferLeg[];
        method: string | null;
        selector: string | null;
        tx_to: string | null;
        tx_value: string;
        tx_timestamp: string | null;
        tx_ok: boolean | null;
      }>(
        'SELECT tx_hash, transfers, method, selector, tx_to, tx_value, tx_timestamp, tx_ok FROM bs_tx_legs WHERE tx_hash = ANY($1)',
        [chunk] as never[]
      );
      for (const row of rows) {
        result.set(row.tx_hash.toLowerCase(), {
          legs: row.transfers || [],
          meta: {
            method: row.method,
            selector: row.selector,
            to: row.tx_to,
            value: row.tx_value || '0',
            timestamp: row.tx_timestamp,
            ok: row.tx_ok,
          },
        });
      }
    } catch (err: any) {
      console.warn('[Blockscout] tx cache read failed:', err.message || err);
      break;
    }
  }
  for (const h of normalized) {
    if (!result.has(h)) missing.push(h);
  }

  // Fetch missing with bounded concurrency. IMPORTANT: only cache
  // successful fetches — caching a failed (empty) result would poison the
  // permanent cache with zero legs forever.
  const CONC = 10;
  for (let i = 0; i < missing.length; i += CONC) {
    const batch = missing.slice(i, i + CONC);
    const fetched = await Promise.all(
      batch.map(async (h) => {
        try {
          const tx = await bsFetch(`/transactions/${h}`);
          const legs: BsTransferLeg[] = [];
          for (const tr of tx?.token_transfers || []) {
            const tk = tr?.token || {};
            if (!tk?.address_hash || tr?.total?.value === undefined) continue;
            const decimals = Number(tr.total.decimals ?? tk.decimals ?? 18);
            const amount = Number(BigInt(String(tr.total.value))) / Math.pow(10, decimals);
            legs.push({
              tokenAddress: String(tk.address_hash).toLowerCase(),
              symbol: tk.symbol || '',
              decimals,
              amount,
              exchangeRate: parseFloat(tk.exchange_rate || '0') || 0,
              fromAddress: String(tr.from?.hash || tr.from || '').toLowerCase(),
              toAddress: String(tr.to?.hash || tr.to || '').toLowerCase(),
            });
          }
          const meta: BsTxMeta = {
            method: tx?.method || null,
            selector: typeof tx?.raw_input === 'string' && tx.raw_input.length >= 10
              ? tx.raw_input.slice(0, 10).toLowerCase()
              : null,
            to: tx?.to ? String(tx.to.hash || tx.to).toLowerCase() : null,
            value: String(tx?.value ?? '0'),
            timestamp: tx?.timestamp || null,
            ok: tx?.status === undefined || tx?.status === null ? null : tx.status === 'ok',
          };
          await dbWrite(
            `INSERT INTO bs_tx_legs (tx_hash, transfers, method, selector, tx_to, tx_value, tx_timestamp, tx_ok)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
            [h, JSON.stringify(legs), meta.method, meta.selector, meta.to, meta.value, meta.timestamp, meta.ok]
          );
          return [h, { legs, meta }] as [string, BsTxData];
        } catch (err: any) {
          // Do NOT cache failures — return empty for this request only so a
          // retry on the next load can succeed.
          console.warn(`[Blockscout] tx fetch failed for ${h.slice(0, 12)} (not cached):`, err.message || err);
          const empty: BsTxData = {
            legs: [],
            meta: { method: null, selector: null, to: null, value: '0', timestamp: null, ok: null },
          };
          return [h, empty] as [string, BsTxData];
        }
      })
    );
    for (const [h, data] of fetched) result.set(h, data);
  }
  return result;
}

export async function getTxLegs(txHashes: string[]): Promise<Map<string, BsTransferLeg[]>> {
  const data = await getTxData(txHashes);
  const legs = new Map<string, BsTransferLeg[]>();
  for (const [h, d] of data) legs.set(h, d.legs);
  return legs;
}

// Split hashes into already-cached vs not-yet-fetched (single cheap query).
// Callers price ALL cached + a capped slice of uncached so USD converges to
// complete over successive loads instead of re-pricing the same window.
export async function partitionTxHashes(txHashes: string[]): Promise<{ cached: string[]; uncached: string[] }> {
  const normalized = [...new Set(txHashes.map((h) => h.toLowerCase()))];
  const cachedSet = new Set<string>();
  await ensureTables();
  for (let i = 0; i < normalized.length; i += 500) {
    const chunk = normalized.slice(i, i + 500);
    try {
      const rows = await query<{ tx_hash: string }>('SELECT tx_hash FROM bs_tx_legs WHERE tx_hash = ANY($1)', [
        chunk,
      ] as never[]);
      for (const row of rows) cachedSet.add(row.tx_hash.toLowerCase());
    } catch {
      break;
    }
  }
  return {
    cached: normalized.filter((h) => cachedSet.has(h)),
    uncached: normalized.filter((h) => !cachedSet.has(h)),
  };
}

export async function getTxMetas(txHashes: string[]): Promise<Map<string, BsTxMeta>> {
  const data = await getTxData(txHashes);
  const metas = new Map<string, BsTxMeta>();
  for (const [h, d] of data) metas.set(h, d.meta);
  return metas;
}

export interface BsLogEntry {
  address: string;
  topics: string[];
  data: string;
}

// Fetch raw logs for a set of txs (permanent cache: logs never change).
// Used ONLY for event-topic parsing flows (OFT/SocketBridge/Withdraw) —
// transfer-amount flows use legs instead (1 call, not 2).
export async function getTxLogs(txHashes: string[]): Promise<Map<string, BsLogEntry[]>> {
  assertEnabled();
  const result = new Map<string, BsLogEntry[]>();
  const normalized = [...new Set(txHashes.map((h) => h.toLowerCase()))];
  if (normalized.length === 0) return result;

  await ensureTables();
  const missing: string[] = [];
  for (let i = 0; i < normalized.length; i += 200) {
    const chunk = normalized.slice(i, i + 200);
    try {
      const rows = await query<{ tx_hash: string; logs: BsLogEntry[] }>(
        'SELECT tx_hash, logs FROM bs_tx_logs WHERE tx_hash = ANY($1)',
        [chunk] as never[]
      );
      for (const row of rows) result.set(row.tx_hash.toLowerCase(), row.logs || []);
    } catch (err: any) {
      console.warn('[Blockscout] logs cache read failed:', err.message || err);
      break;
    }
  }
  for (const h of normalized) {
    if (!result.has(h)) missing.push(h);
  }
  if (missing.length === 0) return result;

  const CONC = 10;
  for (let i = 0; i < missing.length; i += CONC) {
    const batch = missing.slice(i, i + CONC);
    const fetched = await Promise.all(
      batch.map(async (h) => {
        try {
          const data = await bsFetch(`/transactions/${h}/logs`);
          const logs: BsLogEntry[] = [];
          for (const log of data?.items || []) {
            logs.push({
              address: String(log.address?.hash || log.address || '').toLowerCase(),
              topics: Array.isArray(log.topics) ? log.topics.map((t: unknown) => String(t)) : [],
              data: String(log.data || ''),
            });
          }
          await dbWrite('INSERT INTO bs_tx_logs (tx_hash, logs) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
            h,
            JSON.stringify(logs),
          ]);
          return [h, logs] as [string, BsLogEntry[]];
        } catch (err: any) {
          // Do NOT cache failures.
          console.warn(`[Blockscout] logs fetch failed for ${h.slice(0, 12)} (not cached):`, err.message || err);
          return [h, []] as [string, BsLogEntry[]];
        }
      })
    );
    for (const [h, logs] of fetched) result.set(h, logs);
  }
  return result;
}

// ---- bridge inflows (wallet-centric discovery) ------------------------------
// Solver/relayer-originated fills NEVER appear in from/to-constrained
// contract queries (top-level from=solver, wallet only internal/in topics).
// So IN-flows are discovered from the wallet side: its inbound token
// transfers + native receives, keeping those whose parent tx touches a
// bridge contract. Amounts come from legs, native value, or internal
// transactions (all permanently cached).
export interface BridgeInflow {
  txHash: string;
  bucket: 'relay' | 'usdt0' | 'bungee';
  tokenAddress: string; // '' for native
  amount: number; // human-readable (token units or ETH)
  exchangeRate: number; // USD price from explorer, 0 when unlisted
  isNative: boolean;
  selector: string | null;
  timestamp: string | null;
}

const BRIDGE_INFLOW_TRANSFER_PAGES = 60;
const BRIDGE_INFLOWS_TTL_MS = 60 * 60 * 1000;

export async function getBridgeInflows(
  walletAddress: string,
  bridgeContracts: { relayWallet: string; oftAdapter: string; lzExecutor: string; bungeeFulfill: string }
): Promise<{ inflows: BridgeInflow[]; complete: boolean }> {
  assertEnabled();
  const wallet = walletAddress.toLowerCase();
  const bridges = new Set(
    [bridgeContracts.relayWallet, bridgeContracts.oftAdapter, bridgeContracts.lzExecutor, bridgeContracts.bungeeFulfill].map(
      (a) => a.toLowerCase()
    )
  );
  const inflows: BridgeInflow[] = [];
  const seenTx = new Set<string>();
  let complete = true;

  // Inflow discovery costs up to 90 history pages + per-candidate tx fetches
  // and dominates cold bridge loads (~10-20s, starving every other metric
  // through the shared Blockscout throttle). Inflows are append-only, so the
  // derived list is cached 1h like the other discovery caches. Only complete
  // walks are cached — truncated walks recompute (and report partial).
  const cachedInflows = await dbGet<{ inflows: BridgeInflow[]; updated_at: string }>(
    'SELECT inflows, updated_at FROM bs_bridge_inflows WHERE wallet_address = $1',
    [wallet]
  );
  if (
    cachedInflows &&
    Date.now() - new Date(cachedInflows.updated_at).getTime() < BRIDGE_INFLOWS_TTL_MS
  ) {
    return { inflows: cachedInflows.inflows, complete: true };
  }

  // The 3 history walks are independent (different endpoints/cursors) — run
  // them IN PARALLEL. Serially they cost 3x page latency and were the
  // dominant bridge cold-load stall behind the score's fetch timeout.
  const walkInboundTokenTransfers = async (): Promise<{ txs: string[]; pagesHitCap: boolean; pages: number }> => {
    let turl: string | null = `/addresses/${wallet}/token-transfers`;
    let tpages = 0;
    const txs: string[] = [];
    while (turl && tpages < BRIDGE_INFLOW_TRANSFER_PAGES) {
      tpages++;
      const data = await bsFetch(turl);
      for (const tr of data?.items || []) {
        const to = tr.to && (tr.to.hash || tr.to);
        if (String(to || '').toLowerCase() !== wallet) continue;
        if (tr.transaction_hash) txs.push(String(tr.transaction_hash).toLowerCase());
      }
      const np = data?.next_page_params;
      if (!np) break;
      const qs = Object.entries(np)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
        .join('&');
      turl = `/addresses/${wallet}/token-transfers?${qs}`;
    }
    return { txs, pagesHitCap: tpages >= BRIDGE_INFLOW_TRANSFER_PAGES, pages: tpages };
  };

  // 2. Internal ETH movements TO the wallet (solver fills pay native via
  // internal calls: invisible in token_transfers AND in from/to queries).
  // Kept when the sender OR the parent tx touches a bridge contract.
  const walkInternalEth = async (): Promise<{ native: Map<string, { amount: number; froms: Set<string> }>; pagesHitCap: boolean; pages: number }> => {
    const native = new Map<string, { amount: number; froms: Set<string> }>();
    let iurl: string | null = `/addresses/${wallet}/internal-transactions`;
    let ipages = 0;
    while (iurl && ipages < BRIDGE_INFLOW_TRANSFER_PAGES) {
      ipages++;
      const data = await bsFetch(iurl);
      for (const item of data?.items || []) {
        const to = item.to && (item.to.hash || item.to);
        if (String(to || '').toLowerCase() !== wallet) continue;
        if (item?.transaction_hash) {
          const h = String(item.transaction_hash).toLowerCase();
          let v = 0;
          try {
            v = Number(BigInt(String(item.value ?? '0'))) / 1e18;
          } catch {
            // ignore malformed values
          }
          if (v > 0) {
            const entry = native.get(h) || { amount: 0, froms: new Set<string>() };
            entry.amount += v;
            const from = item.from && (item.from.hash || item.from);
            if (from) entry.froms.add(String(from).toLowerCase());
            native.set(h, entry);
          }
        }
      }
      const np = data?.next_page_params;
      if (!np) break;
      const qs = Object.entries(np)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
        .join('&');
      iurl = `/addresses/${wallet}/internal-transactions?${qs}`;
    }
    return { native, pagesHitCap: ipages >= BRIDGE_INFLOW_TRANSFER_PAGES, pages: ipages };
  };

  // 2b. Top-level native transfers TO the wallet (plain value sends like
  // relay fills: from=relayWallet, to=wallet, method=null). These appear in
  // NEITHER token_transfers (not tokens) NOR internal-transactions
  // (not internal) — only the address tx list shows them.
  const walkTopLevelNative = async (): Promise<{ native: Map<string, { amount: number; froms: Set<string> }>; pagesHitCap: boolean; pages: number }> => {
    const native = new Map<string, { amount: number; froms: Set<string> }>();
    let furl: string | null = `/addresses/${wallet}/transactions?filter=to`;
    let fpages = 0;
    while (furl && fpages < BRIDGE_INFLOW_TRANSFER_PAGES) {
      fpages++;
      const data = await bsFetch(furl);
      for (const item of data?.items || []) {
        if (!item?.hash || !item?.value || item.value === '0') continue;
        const h = String(item.hash).toLowerCase();
        try {
          const v = Number(BigInt(String(item.value))) / 1e18;
          if (v > 0) {
            const entry = native.get(h) || { amount: 0, froms: new Set<string>() };
            entry.amount += v;
            const from = item.from && (item.from.hash || item.from);
            if (from) entry.froms.add(String(from).toLowerCase());
            native.set(h, entry);
          }
        } catch {
          // ignore malformed values
        }
      }
      const np = data?.next_page_params;
      if (!np) break;
      const qs = Object.entries(np)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
        .join('&');
      furl = `/addresses/${wallet}/transactions?filter=to&${qs}`;
    }
    return { native, pagesHitCap: fpages >= BRIDGE_INFLOW_TRANSFER_PAGES, pages: fpages };
  };

  const walksStart = Date.now();
  const [tokenWalk, internalWalk, topLevelWalk] = await Promise.all([
    walkInboundTokenTransfers(),
    walkInternalEth(),
    walkTopLevelNative(),
  ]);
  if (tokenWalk.pagesHitCap || internalWalk.pagesHitCap || topLevelWalk.pagesHitCap) complete = false;

  // Merge: token-transfer candidates + native amounts (Set-merged, O(n)).
  const candidateSet = new Set<string>(tokenWalk.txs);
  const nativeInTx = new Map<string, { amount: number; froms: Set<string> }>();
  const mergeNative = (m: Map<string, { amount: number; froms: Set<string> }>): void => {
    for (const [h, e] of m) {
      const existing = nativeInTx.get(h);
      if (existing) {
        existing.amount += e.amount;
        for (const f of e.froms) existing.froms.add(f);
      } else {
        nativeInTx.set(h, { amount: e.amount, froms: new Set(e.froms) });
      }
      candidateSet.add(h);
    }
  };
  mergeNative(internalWalk.native);
  mergeNative(topLevelWalk.native);
  const candidateTx = [...candidateSet];
  console.log(`[BridgeInflows ${wallet.slice(0, 10)}] walks: token=${tokenWalk.pages}p internal=${internalWalk.pages}p totolist=${topLevelWalk.pages}p in ${Date.now() - walksStart}ms, candidates=${candidateTx.length}`);

  // 3. Keep txs touching bridge contracts; extract inbound amounts.
  // Amount sources per tx, in order: token legs TO the wallet, then native
  // value for direct pays, then internal ETH movements (solver fills pay
  // native via internal calls with no token leg).
  const uniqueTx = [...new Set(candidateTx)];
  const txDataStart = Date.now();
  const txData = await getTxData(uniqueTx);
  console.log(`[BridgeInflows ${wallet.slice(0, 10)}] txData: ${uniqueTx.length} txs in ${Date.now() - txDataStart}ms`);
  for (const h of uniqueTx) {
    const data = txData.get(h);
    if (!data) continue;
    const metaTo = (data.meta.to || '').toLowerCase();
    if (seenTx.has(h)) continue;
    const touchesBridge =
      bridges.has(metaTo) || data.legs.some((l) => bridges.has(l.fromAddress) || bridges.has(l.toAddress));
    if (!touchesBridge) continue;

    // 3a. Token legs TO the wallet (fills, mints, distributions).
    let emitted = false;
    for (const leg of data.legs) {
      if (leg.toAddress !== wallet) continue;
      const legFromBridge = bridges.has(leg.fromAddress);
      const isUsdt0Flow =
        metaTo === bridgeContracts.oftAdapter.toLowerCase() ||
        metaTo === bridgeContracts.lzExecutor.toLowerCase() ||
        legFromBridge;
      inflows.push({
        txHash: h,
        bucket: isUsdt0Flow ? 'usdt0' : metaTo === bridgeContracts.bungeeFulfill.toLowerCase() ? 'bungee' : 'relay',
        tokenAddress: leg.tokenAddress,
        amount: leg.amount,
        exchangeRate: leg.exchangeRate,
        isNative: false,
        selector: data.meta.selector,
        timestamp: data.meta.timestamp,
      });
      emitted = true;
      break;
    }
    if (emitted) {
      seenTx.add(h);
      continue;
    }

    // 3b. Native: direct pays (tx to == wallet).
    if (metaTo === wallet && data.meta.value && data.meta.value !== '0') {
      inflows.push({
        txHash: h,
        bucket: metaTo === bridgeContracts.relayWallet.toLowerCase() ? 'relay' : 'bungee',
        tokenAddress: '',
        amount: Number(BigInt(data.meta.value)) / 1e18,
        exchangeRate: 0,
        isNative: true,
        selector: data.meta.selector,
        timestamp: data.meta.timestamp,
      });
      seenTx.add(h);
    }
  }

  // 3c. Native-only fills from the internal-transactions walk (no token leg,
  // no direct value): solver fills paying ETH via internal calls. Amounts
  // were pre-summed per tx above.
  for (const [h, entry] of nativeInTx) {
    if (seenTx.has(h)) continue;
    const data = txData.get(h);
    if (!data) continue;
    const metaTo = (data.meta.to || '').toLowerCase();
    const hit =
      [...entry.froms].some((f) => bridges.has(f)) ||
      bridges.has(metaTo) ||
      data.legs.some((l) => bridges.has(l.fromAddress) || bridges.has(l.toAddress));
    if (!hit || entry.amount <= 0) continue;
    inflows.push({
      txHash: h,
      bucket: metaTo === bridgeContracts.bungeeFulfill.toLowerCase() ? 'bungee' : 'relay',
      tokenAddress: '',
      amount: entry.amount,
      exchangeRate: 0,
      isNative: true,
      selector: data.meta.selector,
      timestamp: data.meta.timestamp,
    });
    seenTx.add(h);
  }
  if (complete) {
    await dbWrite(
      `INSERT INTO bs_bridge_inflows (wallet_address, inflows, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (wallet_address)
       DO UPDATE SET inflows = $2, updated_at = now()`,
      [wallet, JSON.stringify(inflows)]
    );
  } else {
    await queueRefresh(wallet, 5);
  }
  return { inflows, complete };
}

// ---- native outflow (circulated volume): incremental via age_from ---------
const NATIVE_VOLUME_TTL_MS = 60 * 60 * 1000;
const MAX_NATIVE_PAGES = 100;

export async function getNativeOutflow(walletAddress: string): Promise<{
  outWei: string;
  count: number;
  complete: boolean;
}> {
  assertEnabled();
  const wallet = walletAddress.toLowerCase();
  const cached = await dbGet<{ out_wei: string; out_count: number; last_seen: string | null; complete: boolean; updated_at: string }>(
    'SELECT out_wei, out_count, last_seen, complete, updated_at FROM bs_native_volume WHERE wallet_address = $1',
    [wallet]
  );
  const fresh = cached && Date.now() - new Date(cached.updated_at).getTime() < NATIVE_VOLUME_TTL_MS;
  // Serve fresh rows even when a previous walk hit the page cap: the plain
  // transactions endpoint has no age_from cursor, so every refresh is a full
  // capped walk that returns identical totals — recomputing it on every
  // dashboard load (up to 30 Blockscout pages) buys nothing. The partial
  // flag stays honest so callers know totals are capped.
  if (fresh) {
    return { outWei: cached!.out_wei, count: cached!.out_count, complete: cached!.complete };
  }

  // NOTE: the plain address-transactions endpoint does NOT support age_from
  // (it would be silently ignored, causing double counts). So every refresh
  // is a full walk (capped) that OVERWRITES — no accumulation, no doubles.
  const base = `/addresses/${wallet}/transactions?filter=from`;
  let url: string | null = base;
  let outWei = 0n;
  let count = 0;
  let newestSeen: string | null = null;
  let pages = 0;
  while (url && pages < MAX_NATIVE_PAGES) {
    pages++;
    const data = await bsFetch(url);
    for (const item of data?.items || []) {
      if (item?.status === 'ok' && item?.value) {
        try {
          outWei += BigInt(String(item.value));
          count += 1;
        } catch {
          // ignore malformed values
        }
      }
      if (item?.timestamp && (!newestSeen || item.timestamp > newestSeen)) {
        newestSeen = item.timestamp;
      }
    }
    const np = data?.next_page_params;
    if (!np) break;
    const qs = Object.entries(np)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === null || v === undefined ? '' : String(v))}`)
      .join('&');
    url = `${base}&${qs}`;
  }
  const complete = pages < MAX_NATIVE_PAGES;
  await dbWrite(
    `INSERT INTO bs_native_volume (wallet_address, out_wei, out_count, last_seen, complete, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (wallet_address)
     DO UPDATE SET out_wei = $2, out_count = $3, last_seen = COALESCE($4, bs_native_volume.last_seen),
       complete = $5, updated_at = now()`,
    [wallet, outWei.toString(), count, newestSeen, complete]
  );
  if (!complete) {
    await queueRefresh(wallet, 10);
  }
  return { outWei: outWei.toString(), count, complete };
}

// ---- refresh queue ----------------------------------------------------------
// Jobs carry the full protocol query so the background worker can complete
// truncated fills without any request context.
export interface RefreshJob {
  protocol: string;
  toAddress: string;
  methods: string[];
  methodNames?: string[];
  direction?: TxDirection;
}

export async function queueRefresh(walletAddress: string, priority = 0, job?: RefreshJob): Promise<void> {
  const protocol = job?.protocol || '';
  const toAddress = (job?.toAddress || '').toLowerCase();
  const methods = (job?.methods || []).map((m) => m.toLowerCase()).sort().join(',');
  const methodNames = (job?.methodNames || []).map((m) => m.toLowerCase()).sort().join(',');
  const direction = job?.direction || 'out';
  await dbWrite(
    `INSERT INTO bs_refresh_queue (wallet_address, protocol, to_address, methods, method_names, direction, priority, next_run, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 0)
     ON CONFLICT (wallet_address, protocol)
     DO UPDATE SET priority = GREATEST(bs_refresh_queue.priority, $7),
       to_address = $3, methods = $4, method_names = $5, direction = $6,
       next_run = LEAST(bs_refresh_queue.next_run, now())`,
    [walletAddress.toLowerCase(), protocol, toAddress, methods, methodNames, direction, priority]
  );
}
