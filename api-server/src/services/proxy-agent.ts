// Proxy egress for rate-limited upstreams (Blockscout).
//
// FOUR modes (pick via env BLOCKSCOUT_PROXY):
// 1. "on"    — all Blockscout traffic egresses through the proxy pool.
// 2. "hybrid"— DIRECT-FIRST. Direct egress until it gets 429/403'd or fails,
//              then the pool takes over for a cooldown window; direct is
//              re-probed after the window and re-armed on success. Pool
//              failures fall straight back to direct (a dead pool must never
//              take the API down). This is the production default.
// 3. "off"   — direct always, pool never built.
// (Pool sources, in priority order:)
//    a. PROXY_URL_LIST_FILE / PROXY_URL_LIST — fixed list (one URL per line),
//       round-robined per request; 429/403/network failure moves the next
//       request to the next IP. ProxyScrape-style datacenter mode.
//    b. PROXY_URL_TEMPLATE — provider-agnostic sticky-session template with
//       {sid} (Iproyal/Decodo/DataImpulse). Rebuilt with a fresh session id
//       on failure/429.
//    c. Legacy DATAIMPULSE_* creds (default when nothing else is set).
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

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

// --- Mode 1: fixed proxy list ---
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

const LIST_URLS = loadProxyList();
const LIST_MODE = LIST_URLS.length > 0;

interface PoolEntry {
  agent: ProxyAgent;
  fails: number;
  url?: string; // list mode: the fixed proxy URL this entry serves
}

const AGENT_POOL: PoolEntry[] = !PROXY_ENABLED
  ? []
  : LIST_MODE
    ? LIST_URLS.map((u) => ({ agent: new ProxyAgent(u), fails: 0, url: u }))
    : Array.from({ length: PROXY_POOL_SIZE }, () => ({ agent: new ProxyAgent(proxyUrl(newSessionId())), fails: 0 }));
let agentIdx = 0;
function rotateEntry(entry: PoolEntry): void {
  // Fixed-list entries cannot be rebuilt (same URL) — rotation is a no-op;
  // the per-request round-robin already moves the next request to the next IP.
  if (LIST_MODE) return;
  entry.agent = new ProxyAgent(proxyUrl(newSessionId()));
  entry.fails = 0;
}

// Undici request init is structurally compatible with the global RequestInit
// for everything bsFetch passes (signal + headers).
export async function proxiedFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }> {
  const poolAvailable = PROXY_ENABLED && AGENT_POOL.length > 0;
  const poolOnCooldown = HYBRID && Date.now() < poolBlockedUntil;

  // Direct egress paths: BLOCKSCOUT_PROXY=off, no pool built, or hybrid with
  // the pool benched after failures.
  if (!poolAvailable || poolOnCooldown) {
    const res = await fetch(url, init as RequestInit);
    return res as unknown as Awaited<ReturnType<typeof proxiedFetch>>;
  }

  const entry = AGENT_POOL[agentIdx++ % AGENT_POOL.length];

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
    const res = await undiciFetch(url, { ...init, dispatcher: entry.agent } as never);
    entry.fails = 0;
    // A per-IP rate limit just bit this residential session — swap it for a
    // fresh IP so the retry (and every later request) lands elsewhere.
    if (res.status === 429 || res.status === 403 || res.status === 495) {
      rotateEntry(entry);
    }
    return {
      ok: res.ok,
      status: res.status,
      headers: { get: (name: string) => res.headers.get(name) },
      json: () => res.json(),
    };
  } catch (err: unknown) {
    // A failing residential session (TLS garbage, self-signed certs, resets,
    // dead tunnels) is replaced IMMEDIATELY — otherwise it keeps failing
    // every round-robin turn and poisons ~1 in every N requests. Rotating is
    // cheap; keeping a bad session is not.
    rotateEntry(entry);
    // HYBRID: if the whole pool looks dead, fall back to DIRECT immediately —
    // a dead pool must never take the API down.
    if (HYBRID) {
      entry.fails += 1;
      if (countPoolFailures() >= Math.min(5, AGENT_POOL.length)) {
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

function isPoolUsable(): boolean {
  return true; // placeholder — real gate is poolBlockedUntil checked by caller
}

function countPoolFailures(): number {
  return AGENT_POOL.filter((e) => e.fails > 0).length;
}

export function isProxyEnabled(): boolean {
  return PROXY_ENABLED && AGENT_POOL.length > 0;
}

export function isHybridMode(): boolean {
  return HYBRID && AGENT_POOL.length > 0;
}

// Startup preflight (fire-and-forget): 3 probes through 3 different sessions.
// Catches a dead/garbage pool at boot instead of as mystery fetch failures on
// the first dashboard load.
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
      console.warn('[Proxy] preflight: ALL probes failed — pool may be dead. Check DataImpulse or set BLOCKSCOUT_PROXY=off.');
    } else if (distinct < 2) {
      console.warn(`[Proxy] preflight: egress IPs [${ips.join(', ')}] — rotation looks stuck (1 distinct IP).`);
    } else {
      console.log(`[Proxy] preflight OK: egress IPs [${ips.join(', ')}] (${distinct} distinct)`);
    }
  })();
}

export function logProxyStatus(): void {
  if (PROXY_ENABLED && AGENT_POOL.length > 0) {
    if (HYBRID) {
      console.log(`[Proxy] HYBRID mode: direct-first egress, pool of ${AGENT_POOL.length} IPs as 429/failure fallback (direct cooldown ${Math.round(DIRECT_COOLDOWN_MS / 1000)}s)`);
      void preflight();
    } else {
      console.log(`[Proxy] DataImpulse pool ready: ${AGENT_POOL.length} sticky residential sessions via ${CREDS.host}:${CREDS.port}`);
      void preflight();
    }
  } else if (PROXY_ENABLED && HYBRID) {
    // hybrid with no pool (missing/garbage list file) degrades to pure direct
    console.log('[Proxy] HYBRID mode but no proxy list found — running direct-only');
  } else {
    console.log('[Proxy] Disabled — Blockscout traffic egresses directly (BLOCKSCOUT_PROXY=off)');
  }
}
