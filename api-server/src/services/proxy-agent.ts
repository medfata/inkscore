// Proxy egress for rate-limited upstreams (Blockscout).
//
// Modes (pick via env BLOCKSCOUT_PROXY):
// 1. "on"    — all Blockscout traffic egresses through the proxy pool.
// 2. "hybrid"— DIRECT-FIRST. Direct egress until it gets 429/403'd or fails,
//              then the pool takes over for a cooldown window; direct is
//              re-probed after the window and re-armed on success. Pool
//              failures fall straight back to direct (a dead pool must never
//              take the API down). This is the production default.
// 3. "off"   — direct always, pool never built.
//
// Pool sources, in priority order:
//    a. Proxy API keys (DB table proxy_api_keys, managed from the admin UI):
//       the pool is the UNION of every active key's ProxyScrape list,
//       deduped by host:port. Keys auto-deprecate on quota exhaustion or
//       subscription expiry (scheduled poll + failure-triggered re-check).
//    b. PROXY_URL_LIST_FILE / PROXY_URL_LIST — legacy fixed list, used ONLY
//       when the key store is empty (pre-key era / fresh DB).
//    c. PROXY_URL_TEMPLATE / legacy DATAIMPULSE_* creds — used ONLY when the
//       key store is empty AND no list is configured.
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  decryptSecret,
  ensureTables as ensureProxyTables,
  getActivePoolIps,
  listKeysWithSecrets,
  proxyIdentity,
  recordIpAutoDisabled,
  recordIpAutoRecovered,
  setKeyDeprecated,
  setKeyError,
  syncPoolIps,
  updateKeyQuota,
} from './proxy-keys-store';
import {
  fetchProxyList,
  fetchQuota,
} from './proxyscrape-client';

const PROXY_ENABLED = process.env.BLOCKSCOUT_PROXY !== 'off';
// HYBRID: direct-first, pool only as rate-limit/failure fallback.
const HYBRID = process.env.BLOCKSCOUT_PROXY === 'hybrid';
// How long direct egress stays benched after a 429/403 before being re-probed.
const DIRECT_COOLDOWN_MS = parseInt(process.env.PROXY_DIRECT_COOLDOWN_MS || '60000', 10);
// How long the pool stays benched after repeated pool failures (dead pool must
// never take the API down — direct takes over again immediately).
const POOL_COOLDOWN_MS = parseInt(process.env.PROXY_POOL_COOLDOWN_MS || '60000', 10);
let directBlockedUntil = 0;
let poolBlockedUntil = 0;
const PROXY_POOL_SIZE = parseInt(process.env.PROXY_POOL_SIZE || '15', 10);
const PROXY_SESSION_TTL_MIN = 10;
// Consecutive network failures before ONE ip is auto-disabled (429s don't
// count — throttled means alive).
const AUTO_DISABLE_FAILS = parseInt(process.env.PROXY_AUTO_DISABLE_FAILS || '5', 10);
// Scheduled quota/expiry poll per active key.
const QUOTA_POLL_MIN = parseInt(process.env.PROXY_QUOTA_POLL_MIN || '10', 10);
// Full list re-sync per active key (catches provider-side offline/rotation).
const LIST_SYNC_MIN = parseInt(process.env.PROXY_LIST_SYNC_MIN || '60', 10);

// PROVIDER-AGNOSTIC PROXY: set PROXY_URL_TEMPLATE with a {sid} placeholder
// and the pool substitutes a fresh random session id per agent entry.
// Examples:
//   Iproyal:   http://customer-USER-sessid-{sid}:PASS@geo.iproyal.com:12321
//   Decodo:    http://user-sessid-{sid}:PASS@gate.decodo.com:7000
//   DataImpulse (legacy default): http://USER__sessid.{sid};sessttl.10:PASS@gw.dataimpulse.com:823
// The session id keeps an IP sticky for the provider's session window
// (typically 10-30 min); rotation on failure/429 is per request.
const PROXY_URL_TEMPLATE = process.env.PROXY_URL_TEMPLATE || '';

function loadProxyCreds() {
  return {
    user: process.env.DATAIMPULSE_PROXY_USER || '0feae1403d8287fcb122',
    pass: process.env.DATAIMPULSE_PROXY_PASS || '3667e8adad3c4907',
    host: process.env.DATAIMPULSE_PROXY_HOST || 'gw.dataimpulse.com',
    port: process.env.DATAIMPULSE_PROXY_PORT || '823',
  };
}

const CREDS = loadProxyCreds();
const newSessionId = () => randomBytes(8).toString('hex');
const proxyUrl = (sid: string) => {
  if (PROXY_URL_TEMPLATE) {
    return PROXY_URL_TEMPLATE.replace(/\{sid\}/g, sid);
  }
  // Legacy DataImpulse format
  return `http://${CREDS.user}__sessid.${sid};sessttl.${PROXY_SESSION_TTL_MIN}:${encodeURIComponent(CREDS.pass)}@${CREDS.host}:${CREDS.port}`;
};

// --- legacy fixed proxy list (fallback when the key store is empty) ---
const PROXY_URL_LIST_FILE = process.env.PROXY_URL_LIST_FILE || '';
const PROXY_URL_LIST_INLINE = process.env.PROXY_URL_LIST || '';

function loadProxyList(): string[] {
  const raw = PROXY_URL_LIST_FILE
    ? (() => { try { return readFileSync(PROXY_URL_LIST_FILE, 'utf8'); } catch { return ''; } })()
    : PROXY_URL_LIST_INLINE;
  return raw
    .split(/\r?\n|,/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith('http') ? l : `http://${l}`));
}

interface PoolEntry {
  agent: ProxyAgent;
  fails: number;
  subaccountId: string; // '' = legacy (file/template) entry
  proxyKey: string; // host:port identity ('' = template entry)
  url: string; // full proxy URL — NEVER log or expose; mask first
  disabled: boolean;
  // in-memory counters, flushed to DB periodically (DB-backed entries only)
  requests: number;
  okCount: number;
  rateLimited: number;
  netErrors: number;
  lastError: string;
  dirty: boolean;
}

let AGENT_POOL: PoolEntry[] = [];
let poolSource = 'uninitialized';
let agentIdx = 0;

/** user:pass@host → user:•••@host (safe for logs/API). */
export function maskProxyUrl(url: string): string {
  return url.replace(/(:\/\/[^/:@]+:)[^@]+(@)/, '$1•••$2');
}

function makeEntry(url: string, subaccountId: string, proxyKey: string): PoolEntry {
  return {
    agent: new ProxyAgent(url),
    fails: 0,
    subaccountId,
    proxyKey,
    url,
    disabled: false,
    requests: 0,
    okCount: 0,
    rateLimited: 0,
    netErrors: 0,
    lastError: '',
    dirty: false,
  };
}

function rotateEntry(entry: PoolEntry): void {
  // Managed (DB/file list) entries have fixed URLs — rotation is a no-op;
  // the per-request round-robin already moves the next request on.
  // Template entries get a fresh session (fresh IP).
  if (entry.subaccountId !== '' || entry.proxyKey !== '') return;
  entry.agent = new ProxyAgent(proxyUrl(newSessionId()));
  entry.fails = 0;
}

/** Build the legacy (pre-key) pool exactly like the old boot behavior. */
function buildLegacyPool(): PoolEntry[] {
  if (!PROXY_ENABLED) return [];
  const listUrls = loadProxyList();
  if (listUrls.length > 0) {
    poolSource = `file list (${listUrls.length} IPs)`;
    return listUrls.map((u) => makeEntry(u, '', proxyIdentity(u)));
  }
  poolSource = `residential template (${PROXY_POOL_SIZE} sessions)`;
  return Array.from({ length: PROXY_POOL_SIZE }, () => makeEntry(proxyUrl(newSessionId()), '', ''));
}

/**
 * (Re)build the pool. DB keys win; legacy file/template only when the store
 * holds zero keys. Hot-swappable at runtime — in-flight requests keep their
 * old entry refs, new requests use the new array.
 */
export async function rebuildPool(reason: string): Promise<{ size: number; source: string }> {
  if (!PROXY_ENABLED) {
    AGENT_POOL = [];
    poolSource = 'disabled (BLOCKSCOUT_PROXY=off)';
    return { size: 0, source: poolSource };
  }
  try {
    await ensureProxyTables();
    const keys = await listKeysWithSecrets();
    if (keys.length === 0) {
      AGENT_POOL = buildLegacyPool();
      console.log(`[Proxy] rebuild (${reason}): key store empty — ${poolSource}`);
      return { size: AGENT_POOL.length, source: poolSource };
    }
    const rows = await getActivePoolIps();
    const seen = new Set<string>();
    const next: PoolEntry[] = [];
    for (const r of rows) {
      const ident = proxyIdentity(r.proxy_url);
      if (!ident || seen.has(ident)) continue; // union-dedupe across keys
      seen.add(ident);
      next.push(makeEntry(r.proxy_url, r.subaccount_id, r.proxy_key));
    }
    const activeKeys = keys.filter((k) => k.status === 'active').length;
    AGENT_POOL = next;
    poolSource = `${next.length} IPs across ${activeKeys} active key(s)`;
    console.log(`[Proxy] rebuild (${reason}): ${poolSource}`);
    return { size: next.length, source: poolSource };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Proxy] rebuild (${reason}) failed (${msg}) — keeping previous pool of ${AGENT_POOL.length}`);
    return { size: AGENT_POOL.length, source: poolSource };
  }
}

/** Boot-time init: build the pool, then start quota/list schedulers. */
let schedulersStarted = false;

export async function initProxyPool(): Promise<void> {
  await rebuildPool('boot');
  if (!schedulersStarted && PROXY_ENABLED) {
    schedulersStarted = true;
    setInterval(() => {
      void pollAllKeyQuotas('scheduled');
    }, QUOTA_POLL_MIN * 60_000).unref();
    setInterval(() => {
      void syncAllKeyLists('scheduled');
    }, LIST_SYNC_MIN * 60_000).unref();
    setInterval(() => {
      void flushStats();
    }, 60_000).unref();
  }
}

function countPoolFailures(): number {
  return AGENT_POOL.filter((e) => e.fails > 0).length;
}

// ---- per-key failure tracking → failure-triggered quota re-check ----------

interface KeyWindow {
  ok: number;
  fail: number;
  lastRecheck: number;
}
const keyWindows = new Map<string, KeyWindow>();

function noteKeyResult(subaccountId: string, ok: boolean): void {
  if (!subaccountId) return;
  let w = keyWindows.get(subaccountId);
  if (!w) {
    w = { ok: 0, fail: 0, lastRecheck: 0 };
    keyWindows.set(subaccountId, w);
  }
  if (ok) w.ok++;
  else w.fail++;
  // A whole key failing while the pool otherwise works smells like quota
  // death / expiry, not dead IPs — verify against ProxyScrape directly.
  if (w.fail >= 10 && w.fail / Math.max(1, w.fail + w.ok) >= 0.8) {
    const othersHealthy = [...keyWindows.entries()].some(
      ([sub, o]) => sub !== subaccountId && o.ok > o.fail
    );
    const poolHasOthers = AGENT_POOL.some((e) => e.subaccountId !== subaccountId && !e.disabled);
    if ((othersHealthy || poolHasOthers) && Date.now() - w.lastRecheck > 5 * 60_000) {
      w.lastRecheck = Date.now();
      w.ok = 0;
      w.fail = 0;
      void recheckKeyQuota(subaccountId, 'failure-triggered');
    }
  }
  // Bound window growth.
  if (w.ok + w.fail > 1000) {
    w.ok = Math.floor(w.ok / 2);
    w.fail = Math.floor(w.fail / 2);
  }
}

/**
 * Verify ONE key against ProxyScrape: deprecate on definitive death signals
 * (401 expired / bandwidth exhausted / past expiry), otherwise just refresh
 * the cached quota. Transient API errors never deprecate.
 */
export async function recheckKeyQuota(subaccountId: string, reason: string): Promise<void> {
  try {
    await ensureProxyTables();
    const keys = await listKeysWithSecrets();
    const key = keys.find((k) => k.subaccount_id === subaccountId && k.status === 'active');
    if (!key) return;
    let apiKey: string;
    try {
      apiKey = decryptSecret(key.api_key_enc);
    } catch {
      return;
    }
    const quota = await fetchQuota(apiKey, key.subaccount_id, key.account_type);
    await updateKeyQuota(key.id, quota, quota.proxyAmount);
    const exhausted = quota.bandwidthLimit > 0 && quota.bandwidthUsed >= quota.bandwidthLimit;
    const expired = quota.expiresAtMs !== null && Date.now() > quota.expiresAtMs;
    if (exhausted || expired) {
      const why = exhausted
        ? `bandwidth exhausted (${quota.bandwidthUsed}/${quota.bandwidthLimit} bytes)`
        : 'subscription period ended';
      console.warn(`[Proxy] key "${key.label || key.subaccount_id}" deprecated (${reason}): ${why}`);
      await setKeyDeprecated(key.id, why);
      await rebuildPool(`key deprecated (${reason})`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err as { code?: string })?.code === 'SUBSCRIPTION_EXPIRED') {
      try {
        const keys = await listKeysWithSecrets();
        const key = keys.find((k) => k.subaccount_id === subaccountId && k.status === 'active');
        if (key) {
          console.warn(`[Proxy] key "${key.label || key.subaccount_id}" deprecated (${reason}): subscription expired (401)`);
          await setKeyDeprecated(key.id, 'subscription expired (ProxyScrape 401)');
          await rebuildPool(`key deprecated (${reason})`);
        }
      } catch {
        // never break traffic on bookkeeping failures
      }
    } else {
      console.warn(`[Proxy] quota re-check (${reason}) for ${subaccountId} failed transiently: ${msg}`);
    }
  }
}

async function pollAllKeyQuotas(reason: string): Promise<void> {
  try {
    await ensureProxyTables();
    const keys = await listKeysWithSecrets();
    for (const key of keys.filter((k) => k.status === 'active')) {
      try {
        await recheckKeyQuota(key.subaccount_id, reason);
      } catch {
        // per-key isolation: one bad key must not skip the rest
      }
    }
  } catch (err: unknown) {
    console.warn(`[Proxy] quota poll (${reason}) failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Re-download every active key's list; provider-offline IPs drop out, usable
 *  ones (re)join, flapping auto-disabled IPs get a second chance. */
async function syncAllKeyLists(reason: string): Promise<void> {
  let changed = false;
  try {
    await ensureProxyTables();
    const keys = await listKeysWithSecrets();
    for (const key of keys.filter((k) => k.status === 'active')) {
      try {
        let apiKey: string;
        try {
          apiKey = decryptSecret(key.api_key_enc);
        } catch {
          continue;
        }
        const urls = await fetchProxyList(apiKey, key.subaccount_id, key.account_type);
        await syncPoolIps(key.subaccount_id, urls);
        // Second chance: provider says online again + old failure is stale.
        const { getAllPoolIps } = await import('./proxy-keys-store');
        const rows = await getAllPoolIps();
        for (const r of rows.filter(
          (x) => x.subaccount_id === key.subaccount_id && x.online && x.auto_disabled && !x.admin_disabled
        )) {
          await recordIpAutoRecovered(r.subaccount_id, r.proxy_key);
        }
        const quota = await fetchQuota(apiKey, key.subaccount_id, key.account_type).catch(() => null);
        if (quota) await updateKeyQuota(key.id, quota, urls.length);
        else await updateKeyQuota(key.id, { proxyAmount: urls.length, bandwidthLimit: 0, bandwidthUsed: 0, expiresAtMs: null }, urls.length);
        changed = true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as { code?: string })?.code === 'SUBSCRIPTION_EXPIRED') {
          await recheckKeyQuota(key.subaccount_id, `list-sync (${reason})`);
        } else {
          await setKeyError(key.id, msg).catch(() => undefined);
        }
      }
    }
    if (changed) await rebuildPool(`list sync (${reason})`);
  } catch (err: unknown) {
    console.warn(`[Proxy] list sync (${reason}) failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Flush in-memory per-IP counters to the DB (best-effort, never throws). */
async function flushStats(): Promise<void> {
  try {
    const { addIpStats } = await import('./proxy-keys-store');
    for (const e of AGENT_POOL) {
      if (!e.dirty || !e.subaccountId || !e.proxyKey) {
        e.dirty = false;
        e.requests = 0;
        e.okCount = 0;
        e.rateLimited = 0;
        e.netErrors = 0;
        continue;
      }
      const deltas = { requests: e.requests, ok: e.okCount, rateLimited: e.rateLimited, netErrors: e.netErrors };
      e.requests = 0;
      e.okCount = 0;
      e.rateLimited = 0;
      e.netErrors = 0;
      e.dirty = false;
      await addIpStats(e.subaccountId, e.proxyKey, deltas, e.fails, e.lastError || null).catch(() => undefined);
    }
  } catch {
    // stats must never break traffic
  }
}

// Undici request init is structurally compatible with the global RequestInit
// for everything bsFetch passes (signal + headers).
export async function proxiedFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }> {
  const healthy = AGENT_POOL.filter((e) => !e.disabled);
  const poolAvailable = PROXY_ENABLED && healthy.length > 0;
  const poolOnCooldown = HYBRID && Date.now() < poolBlockedUntil;

  // Direct egress paths: BLOCKSCOUT_PROXY=off, no pool built, or hybrid with
  // the pool benched after failures.
  if (!poolAvailable || poolOnCooldown) {
    const res = await fetch(url, init as RequestInit);
    return res as unknown as Awaited<ReturnType<typeof proxiedFetch>>;
  }

  const entry = healthy[agentIdx++ % healthy.length];

  // HYBRID: try DIRECT first (free, unlimited-ish budget for the box's own IP).
  if (HYBRID && Date.now() >= directBlockedUntil) {
    try {
      const res = await fetch(url, init as RequestInit);
      if (res.status === 429 || res.status === 403) {
        // Direct IP is rate-limited — bench it and let the retry (and every
        // request until the cooldown expires) ride the pool instead.
        directBlockedUntil = Date.now() + DIRECT_COOLDOWN_MS;
        console.warn(`[Proxy] hybrid: direct egress ${res.status} — pool takes over for ${Math.round(DIRECT_COOLDOWN_MS / 1000)}s`);
      }
      return res as unknown as Awaited<ReturnType<typeof proxiedFetch>>;
    } catch (err: unknown) {
      // Direct network failure — bench direct briefly, surface to bsFetch so
      // its retry rides the pool.
      directBlockedUntil = Date.now() + Math.min(DIRECT_COOLDOWN_MS, 15_000);
      throw err;
    }
  }

  try {
    entry.requests++;
    entry.dirty = true;
    const res = await undiciFetch(url, { ...init, dispatcher: entry.agent } as never);
    entry.fails = 0;
    entry.okCount++;
    noteKeyResult(entry.subaccountId, true);
    // A per-IP rate limit just bit this session — swap it for a fresh IP so
    // the retry (and every later request) lands elsewhere. (No-op for fixed
    // list entries; the round-robin already moves on.)
    if (res.status === 429 || res.status === 403 || res.status === 495) {
      entry.rateLimited++;
      rotateEntry(entry);
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: { get: (name: string) => res.headers.get(name) },
      json: () => res.json(),
    };
  } catch (err: unknown) {
    entry.netErrors++;
    entry.fails++;
    entry.lastError = (err as { cause?: { code?: string } })?.cause?.code || (err instanceof Error ? err.message : String(err));
    entry.dirty = true;
    noteKeyResult(entry.subaccountId, false);
    rotateEntry(entry);
    // Consecutive network failures = dead IP: disable it (persisted) so it
    // stops poisoning every round-robin turn. 429/403s never count here.
    if (entry.proxyKey && entry.fails >= AUTO_DISABLE_FAILS && !entry.disabled) {
      entry.disabled = true;
      const reason = `auto-disabled after ${entry.fails} consecutive network failures (${entry.lastError})`;
      console.warn(`[Proxy] ${maskProxyUrl(entry.url)} ${reason}`);
      void recordIpAutoDisabled(entry.subaccountId, entry.proxyKey, reason).catch(() => undefined);
    }
    // HYBRID: if the whole pool looks dead, fall back to DIRECT immediately —
    // a dead pool must never take the API down.
    if (HYBRID) {
      if (countPoolFailures() >= Math.min(5, healthy.length)) {
        poolBlockedUntil = Date.now() + POOL_COOLDOWN_MS;
        console.warn(`[Proxy] hybrid: pool failures piling up — back to direct for ${Math.round(POOL_COOLDOWN_MS / 1000)}s`);
      }
      try {
        const res = await fetch(url, init as RequestInit);
        return res as unknown as Awaited<ReturnType<typeof proxiedFetch>>;
      } catch {
        throw err; // surface the original pool error
      }
    }
    throw err;
  }
}

export function isProxyEnabled(): boolean {
  return PROXY_ENABLED && AGENT_POOL.some((e) => !e.disabled);
}

export function isHybridMode(): boolean {
  return HYBRID && AGENT_POOL.some((e) => !e.disabled);
}

// Startup preflight (fire-and-forget): 3 probes through the pool. In HYBRID
// the probes intentionally go direct first (same as all traffic), so an
// all-box-IP result is EXPECTED there, not stuck rotation — only "on" mode
// proves pool rotation.
function preflight(): Promise<void> {
  return (async () => {
    const ips: string[] = [];
    for (let i = 0; i < 3; i++) {
      try {
        const res = await proxiedFetch('https://api.ipify.org?format=json');
        const j: any = await res.json();
        ips.push(j?.ip || '?');
      } catch (err: any) {
        console.warn(`[Proxy] preflight probe failed: ${err?.cause?.code || err?.message || err}`);
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const distinct = new Set(ips).size;
    if (ips.length === 0) {
      console.warn('[Proxy] preflight: ALL probes failed — pool may be dead. Check keys or set BLOCKSCOUT_PROXY=off.');
    } else if (distinct < 2 && !HYBRID) {
      console.warn(`[Proxy] preflight: egress IPs [${ips.join(', ')}] — rotation looks stuck (1 distinct IP).`);
    } else {
      console.log(`[Proxy] preflight OK: egress IPs [${ips.join(', ')}] (${distinct} distinct${HYBRID ? ', hybrid-direct expected' : ''})`);
    }
  })();
}

export function logProxyStatus(): void {
  const healthyCount = AGENT_POOL.filter((e) => !e.disabled).length;
  if (PROXY_ENABLED && AGENT_POOL.length > 0) {
    if (HYBRID) {
      console.log(`[Proxy] HYBRID mode: direct-first egress, pool of ${healthyCount}/${AGENT_POOL.length} healthy IPs as 429/failure fallback (direct cooldown ${Math.round(DIRECT_COOLDOWN_MS / 1000)}s) — ${poolSource}`);
      void preflight();
    } else {
      console.log(`[Proxy] Pool ready: ${healthyCount}/${AGENT_POOL.length} healthy sessions — ${poolSource}`);
      void preflight();
    }
  } else if (PROXY_ENABLED && HYBRID) {
    console.log('[Proxy] HYBRID mode but pool is empty — running direct-only');
  } else {
    console.log('[Proxy] Disabled — Blockscout traffic egresses directly (BLOCKSCOUT_PROXY=off)');
  }
}

/** Admin status snapshot: pool + per-entry health (URLs masked). */
export function getProxyPoolStatus(): {
  mode: string;
  source: string;
  total: number;
  healthy: number;
  entries: Array<{
    subaccountId: string;
    proxyKey: string;
    urlMasked: string;
    disabled: boolean;
    fails: number;
    requests: number;
    okCount: number;
    rateLimited: number;
    netErrors: number;
    lastError: string;
  }>;
} {
  return {
    mode: !PROXY_ENABLED ? 'off' : HYBRID ? 'hybrid' : 'on',
    source: poolSource,
    total: AGENT_POOL.length,
    healthy: AGENT_POOL.filter((e) => !e.disabled).length,
    entries: AGENT_POOL.map((e) => ({
      subaccountId: e.subaccountId,
      proxyKey: e.proxyKey,
      urlMasked: e.subaccountId || e.proxyKey ? maskProxyUrl(e.url) : '(residential session)',
      disabled: e.disabled,
      fails: e.fails,
      requests: e.requests,
      okCount: e.okCount,
      rateLimited: e.rateLimited,
      netErrors: e.netErrors,
      lastError: e.lastError,
    })),
  };
}
