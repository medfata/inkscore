// Residential-proxy egress for rate-limited upstreams (Blockscout).
//
// Modeled on robi-mint-bulk.mjs: a pool of sticky DataImpulse residential
// sessions, round-robined per request. Rate limits that are enforced per IP
// (the ~180 req/min Blockscout budget) then never accumulate on one address.
// Sessions rotate automatically after repeated failures or 429/403 replies.
//
// Creds come from env (DATAIMPULSE_PROXY_USER/PASS/HOST/PORT); the fallbacks
// match robi-mint-bulk.mjs so the pool works out of the box in this project.
// Set BLOCKSCOUT_PROXY=off to bypass the pool and egress directly.
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { randomBytes } from 'node:crypto';

const PROXY_ENABLED = process.env.BLOCKSCOUT_PROXY !== 'off';
const PROXY_POOL_SIZE = parseInt(process.env.PROXY_POOL_SIZE || '15', 10);
const PROXY_SESSION_TTL_MIN = 10;

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
const proxyUrl = (sid: string) =>
  `http://${CREDS.user}__sessid.${sid};sessttl.${PROXY_SESSION_TTL_MIN}:${encodeURIComponent(CREDS.pass)}@${CREDS.host}:${CREDS.port}`;

interface PoolEntry {
  agent: ProxyAgent;
  fails: number;
}

const AGENT_POOL: PoolEntry[] = PROXY_ENABLED
  ? Array.from({ length: PROXY_POOL_SIZE }, () => ({ agent: new ProxyAgent(proxyUrl(newSessionId())), fails: 0 }))
  : [];
let agentIdx = 0;
function rotateEntry(entry: PoolEntry): void {
  entry.agent = new ProxyAgent(proxyUrl(newSessionId()));
  entry.fails = 0;
}

// Undici request init is structurally compatible with the global RequestInit
// for everything bsFetch passes (signal + headers).
export async function proxiedFetch(
  url: string,
  init: { signal?: AbortSignal; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }> {
  if (!PROXY_ENABLED || AGENT_POOL.length === 0) {
    // Direct egress (BLOCKSCOUT_PROXY=off or pool unavailable).
    const res = await fetch(url, init as RequestInit);
    return res as unknown as Awaited<ReturnType<typeof proxiedFetch>>;
  }
  const entry = AGENT_POOL[agentIdx++ % AGENT_POOL.length];
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
    throw err;
  }
}

export function isProxyEnabled(): boolean {
  return PROXY_ENABLED && AGENT_POOL.length > 0;
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
    console.log(`[Proxy] DataImpulse pool ready: ${AGENT_POOL.length} sticky residential sessions via ${CREDS.host}:${CREDS.port}`);
    void preflight();
  } else {
    console.log('[Proxy] Disabled — Blockscout traffic egresses directly (BLOCKSCOUT_PROXY=off)');
  }
}
