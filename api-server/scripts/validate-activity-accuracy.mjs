// Independent activity-accuracy validator — InkScore vs live Ink chain.
//
// WHAT: samples 100 leaderboard wallets (stratified) + mandatory wallet,
// fetches what InkScore reports (black-box HTTP bundle), then re-derives
// on-chain activity counts with a FRESH, INDEPENDENT scanner and flags
// OVER-REPORTS (inkscore > chain = critical).
//
// WHY INDEPENDENT: production scanning lives in
// api-server/src/services/blockscout-service.ts (advanced-filters with
// server-side method filtering + Postgres bs_* caches + token-bucket
// throttle) via api-server/src/services/proxy-agent.ts. This script
// deliberately does NOT import any of that. Instead it:
//   1. pulls the wallet's FULL tx history via /addresses/{w}/transactions
//      (paginated, wallet-centric — no server-side method filter), plus
//      /addresses/{w}/counters for the authoritative tx total,
//   2. fetches each tx's definitive record via /transactions/{hash}
//      (method, raw_input selector, to, from, status),
//   3. classifies LOCALLY against a pinned contract/selector registry.
// Historical chain data never changes, so a full re-walk is ground truth.
// No DB cache is read or written here — every number below is live.
//
// PROXIES: reads api-server/scripts/proxyscrape-list.txt (100x
// user:pass@ip:port) with its OWN rotator (round-robin + per-proxy
// cooldown on 429/403/network failure + jittered retry). Set:
//   BLOCKSCOUT_PROXY=on
//   PROXY_URL_LIST_FILE=<path>/proxyscrape-list.txt
// in THIS script's env only — prod .env / lane cmds are untouched.
//
// COUNTS, NOT USD: USD volumes depend on price feeds/timing and cannot be
// compared exactly. All validated rows are integer action counts. Chain
// counts are MAXIMAL (failed txs included) so an OVER-REPORT verdict can
// never be a failed-vs-success artifact — it means InkScore truly claims
// more actions than exist on chain.
//
// Usage:
//   node scripts/validate-activity-accuracy.mjs [options]
//   Options:
//     --sample-size N   (default 100, includes mandatory wallet)
//     --wallets-file F  (explicit wallet list, one per line — skips sampling)
//     --resume          (skip wallets already present in OUT_CSV)
//     --out F           (default ./validation-results.csv next to this script)
//     --base URL        (inkscore api base, default http://127.0.0.1:4000)
//     --wallet-conc N   (default 4)
//     --tx-conc N       (default 12)
//     --dry-run         (sample + inkscore fetch only, no chain scan)
//
// Env: DATABASE_URL (leaderboard), API_BASE_URL_TEST or --base,
//      PROXY_URL_LIST_FILE or ./proxyscrape-list.txt
import 'dotenv/config';
import pg from 'pg';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ----------------------------- config --------------------------------------
const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes(`--${name}`);

const SAMPLE_SIZE = Math.max(2, parseInt(getArg('sample-size', '100'), 10) || 100);
const WALLETS_FILE = getArg('wallets-file', '');
const OUT_CSV = getArg('out', path.join(__dirname, 'validation-results.csv'));
const API_BASE = (getArg('base', process.env.API_BASE_URL_TEST || process.env.API_SERVER_URL || 'http://127.0.0.1:4000')).replace(/\/$/, '');
const WALLET_CONC = Math.max(1, Math.min(10, parseInt(getArg('wallet-conc', '4'), 10) || 4));
const TX_CONC = Math.max(1, Math.min(25, parseInt(getArg('tx-conc', '12'), 10) || 12));
const DRY_RUN = hasFlag('dry-run');
const RESUME = hasFlag('resume');

const MANDATORY_WALLET = '0x8655df35818f348ea4e371a613e73677d816f589';
const BLOCKSCOUT_BASE = 'https://explorer.inkonchain.com/api/v2';
const REQ_TIMEOUT_MS = 15_000;
const MAX_HISTORY_PAGES = 120; // 120 * 50 = 6000 txs per wallet ceiling
const MAX_TX_DETAILS = 6000;
const WALLET_BUDGET_MS = 4 * 60_000;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

// Pinned on-chain registry (lowercased). Selectors/methods mirror what the
// api-server services track, but matching happens HERE on full tx records.
const R = {
  gm: { contract: '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f' },
  swapContracts: [
    '0x551134e92e537ceaa217c2ef63210af3ce96a065',
    '0xd7e72f3615aa65b92a4dbdc211e296a35512988b',
    '0x9b17690de96fcfa80a3acaefe11d936629cd7a77',
    '0x01d40099fcd87c018969b0e8d4ab1633fb34763c',
  ],
  swapSelectors: new Set(['0x7ff36ab5','0x18cbafe5','0x38ed1739','0xfb3bdb41','0x4a25d94a','0x8803dbee','0xb6f9de95','0x791ac947','0x5c11d795','0x3593564c','0xaad348a2']),
  tydroContracts: ['0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2','0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba'],
  tydroSupply: new Set(['0x474cf53d','0x617ba037']),
  tydroBorrow: new Set(['0xe74f7b85','0xa415bcad']),
  nft2meFactory: '0x00000000001594c61dd8a6804da9ab58ed2483ce',
  nft2meMinter: '0x00000000009a1e02f00e280dcfa4c81c55724212',
  shelliesRaffles: ['0x47a27a42525fff2b7264b342f74216e37a831332','0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de'],
  shelliesPay: '0x57d287dc46cb0782c4bce1e4e964cc52083bb358',
  shelliesStaking: '0xb39a48d294e1530a271e712b7a19243679d320d0',
  shelliesStakingSelector: '0x1e332260',
  znsDeploy: '0x63c489d31a2c3de0638360931f47ff066282473f',
  znsSayGm: '0x3033d7ded400547d6442c55159da5c61f2721633',
  znsSayGmV2: '0xc3aa977fa6a937fde1c7cc61a3c0ef9b6baf43f9',
  znsRegister: '0xfb2cd41a8aec89efbb19575c6c48d872ce97a0a5',
  inkypump: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
  inkypumpCreate: '0xa07849e6',
  inkyswapRouter: '0xa8c1c38ff57428e5c3a34e0899be5cb385476507',
  inkypumpBuy: new Set(['0x7ff36ab5','0xfb3bdb41']),
  inkypumpSell: new Set(['0x18cbafe5','0x4a25d94a','0x791ac947']),
  nado: '0x05ec92d78ed421f3d3ada77ffde167106565974e',
  gonefishin: '0x476973c8124faf5db6a8fc35265da81e1d9b4e3e',
  gonefishinBuy: '0xe376f53a',
  sentryFactoryV4: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
  sentryFactoryLegacy: '0x733733e8eabb94832847abf0e0eed6031c3eb2e4',
  sentryLaunch: new Set(['0x229b79e5','0x0068927a','0x212a8af2','0x37f93c6a']),
  tsunamiRouter: '0x4415f2360bfd9b1bf55500cb28fa41df95cb2d2b',
  sentryRouterV4: '0x5275de614e06dba10546171c1e6d2a30a87844b7',
  sentrySwap: new Set(['0xac9650d8','0x5ae401dc','0x1f0464d1','0x10c29d98','0xc04b8d59','0x5d7ef810','0xcf8cc93f','0x472b43f3','0x42712a67']),
  sentryV4Swap: new Set(['0xc8529cbc','0xc61b004b']),
  quotronZapper: '0x215cead02e0b9e0e494dd179585c18a772048a43',
  getAssetsRouter: '0x1b4d919149912c9781b086c8242729ee317631c8',
  getAssetsZapper: '0x117a7bc2cbf0feb6e5ae5b457ddc1490a84db286',
  earnFactory: '0x86d82134d7ec5840ca0ed64131e9543b3dc1b51b',
  zapSelectors: new Set(['0xc75d2360','0xd0b4708f','0xb32c8a23']),
  getAssetsSelectors: new Set(['0x11abcf9e','0x6fd0b140']),
  fundSelector: '0x91c7d858',
  brokersDesk: '0xde773cf5e6973e29aff7e7125fb4df21bbde713e',
  brokersFloorRouter: '0xb3e8165984a91cf4001057ca646ee2e3a547cdf8',
  brokersFloorSelectors: new Set(['0x646c4451','0x64027ecd']),
  relayDeposit: '0x4cd00e387622c35bddb9b4c962c136462338bc31',
  oftAdapter: '0x1cb6de532588fca4a21b7209de7c456af8434a65',
  bungeeRequest: '0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc',
  bungeeGateway: '0x3a23f943181408eac424116af7b7790c94cb97a5',
};

// ----------------------------- logging -------------------------------------
const ts = () => new Date().toISOString();
const log = (...m) => console.log(`[${ts()}]`, ...m);
const warn = (...m) => console.warn(`[${ts()}] WARN`, ...m);

// ----------------------------- proxy pool (fresh impl) ---------------------
// Own rotator over the ProxyScrape datacenter list. Differs from
// proxy-agent.ts by design: per-proxy consecutive-failure cooldown (not
// session rebuild), sticky-per-wallet start offset (spreads wallets across
// IPs), jittered backoff, and full per-IP accounting for the summary.
class ProxyPool {
  constructor(urls) {
    this.entries = urls.map((url, i) => ({ url, idx: i, agent: null, fails: 0, cooledUntil: 0, ok: 0, r429: 0 }));
    this.pos = Math.floor(Math.random() * Math.max(1, this.entries.length));
    this.stats = { reqs: 0, ok: 0, r429: 0, r403: 0, netErr: 0, other: 0 };
  }
  agentFor(e) {
    if (!e.agent) e.agent = new ProxyAgent(e.url);
    return e.agent;
  }
  pick() {
    const n = this.entries.length;
    if (n === 0) return null;
    const now = Date.now();
    for (let k = 0; k < n; k++) {
      const e = this.entries[(this.pos + k) % n];
      if (now >= e.cooledUntil && e.fails < 5) {
        this.pos = (this.pos + k + 1) % n;
        return e;
      }
    }
    // all cooled — take the least-failed and reset one cooldown
    const best = [...this.entries].sort((a, b) => a.cooledUntil - b.cooledUntil || a.fails - b.fails)[0];
    best.cooledUntil = 0;
    if (best.fails >= 5) best.fails = 4;
    return best;
  }
  cool(e, ms) { e.cooledUntil = Date.now() + ms; }
  async fetchJson(url, { timeoutMs = REQ_TIMEOUT_MS } = {}) {
    const DIRECT = process.env.BLOCKSCOUT_PROXY === 'off' || this.entries.length === 0;
    let lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (DIRECT) {
        try {
          this.stats.reqs++;
          const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
          if (res.status === 429 || res.status === 403) {
            this.stats[res.status === 429 ? 'r429' : 'r403']++;
            await sleep(1500 * (attempt + 1) + Math.random() * 500);
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          this.stats.ok++;
          return await res.json();
        } catch (e) { lastErr = e; await sleep(400 + Math.random() * 400); continue; }
      }
      const e = this.pick();
      try {
        this.stats.reqs++;
        const res = await undiciFetch(url, {
          dispatcher: this.agentFor(e),
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 429 || res.status === 403) {
          e.r429++; e.fails++; this.stats[res.status === 429 ? 'r429' : 'r403']++;
          this.cool(e, 30_000 + Math.random() * 30_000);
          lastErr = new Error(`HTTP ${res.status} via proxy #${e.idx}`);
          continue;
        }
        if (!res.ok) { e.fails++; this.stats.other++; throw new Error(`HTTP ${res.status} via proxy #${e.idx}`); }
        e.fails = 0; e.ok++; this.stats.ok++;
        return await res.json();
      } catch (err) {
        e.fails++;
        this.cool(e, 10_000 + Math.random() * 10_000);
        this.stats.netErr++;
        lastErr = err;
        await sleep(200 + Math.random() * 300);
      }
    }
    throw lastErr || new Error('fetch failed');
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadProxyUrls() {
  const fromEnv = process.env.PROXY_URL_LIST_FILE || '';
  const candidates = [fromEnv, path.join(__dirname, 'proxyscrape-list.txt')].filter(Boolean);
  for (const f of candidates) {
    try {
      const raw = readFileSync(f, 'utf8');
      const urls = raw.split(/\r?\n|,/).map((l) => l.trim()).filter(Boolean)
        .map((l) => (l.startsWith('http') ? l : `http://${l}`));
      if (urls.length > 0) { log(`proxy list: ${urls.length} entries from ${f}`); return urls; }
    } catch { /* try next */ }
  }
  warn('no proxy list found — running DIRECT (set PROXY_URL_LIST_FILE)');
  return [];
}

// ----------------------------- leaderboard sample --------------------------
async function loadLeaderboard() {
  const { Client } = pg;
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    const r = await c.query('SELECT leaderboard_data FROM cached_leaderboard WHERE id = 1');
    const data = r.rows[0]?.leaderboard_data || [];
    return data.filter((e) => e?.wallet_address && ADDRESS_RE.test(e.wallet_address))
      .map((e) => ({ wallet: e.wallet_address.toLowerCase(), score: Number(e.score) || 0 }));
  } finally { await c.end().catch(() => {}); }
}
const tierOf = (score) => (score > 10000 ? 'high_gt10k' : score >= 5000 ? 'mid_5k_10k' : score >= 1000 ? 'midlow_1k_5k' : 'low_lt1k');
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

async function pickWallets() {
  if (WALLETS_FILE) {
    const raw = (await fs.readFile(WALLETS_FILE, 'utf8')).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => ADDRESS_RE.test(l));
    const set = new Set(raw); set.add(MANDATORY_WALLET);
    return [...set].map((wallet) => ({ wallet, score: NaN, tier: 'explicit' }));
  }
  const all = await loadLeaderboard();
  if (all.length === 0) throw new Error('leaderboard empty — is cached_leaderboard populated? run backfill-leaderboard first');
  const by = { high: shuffle(all.filter((e) => e.score > 10000)), mid: shuffle(all.filter((e) => e.score >= 5000 && e.score <= 10000)), low: shuffle(all.filter((e) => e.score < 1000)), rest: shuffle(all.filter((e) => e.score >= 1000 && e.score < 5000)) };
  log(`leaderboard buckets: high_gt10k=${by.high.length} mid_5k_10k=${by.mid.length} low_lt1k=${by.low.length} midlow_1k_5k=${by.rest.length} total=${all.length}`);
  const want = SAMPLE_SIZE - 1; // room for mandatory
  const qHigh = Math.min(by.high.length, Math.round(want * 0.3));
  const qMid = Math.min(by.mid.length, Math.round(want * 0.3));
  const qLow = Math.min(by.low.length, want - qHigh - qMid - Math.min(by.rest.length, Math.round(want * 0.15)));
  const qRest = Math.min(by.rest.length, want - qHigh - qMid - qLow);
  let picked = [...by.high.slice(0, qHigh), ...by.mid.slice(0, qMid), ...by.low.slice(0, qLow), ...by.rest.slice(0, qRest)];
  // top-up from anything remaining if a bucket ran short
  if (picked.length < want) {
    const have = new Set(picked.map((p) => p.wallet));
    for (const e of shuffle(all)) { if (picked.length >= want) break; if (!have.has(e.wallet)) { picked.push(e); have.add(e.wallet); } }
  }
  const have = new Set(picked.map((p) => p.wallet));
  if (!have.has(MANDATORY_WALLET)) {
    const mScore = all.find((e) => e.wallet === MANDATORY_WALLET)?.score ?? NaN;
    picked.push({ wallet: MANDATORY_WALLET, score: mScore });
  }
  return picked.map((p) => ({ ...p, tier: tierOf(p.score) }));
}

// ----------------------------- inkscore fetch (black box) ------------------
async function fetchBundle(wallet) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${API_BASE}/api/dashboard/bundle/${wallet}`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`bundle HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Extract the count InkScore reports per validated metric from a bundle.
// Returns Map<platformKey, {count, value}> plus meta {partial, fromSnapshot}.
function extractInkscore(bundle) {
  const m = bundle?.metrics || {};
  const out = new Map();
  const set = (k, count, value = count) => out.set(k, { count: Math.round(num(count)), value: num(value) });
  set('gm_count', m.gmCount?.total_count);
  set('swap_tx', m.swap?.txCount);
  set('tydro_deposit', m.tydro?.depositCount);
  set('tydro_borrow', m.tydro?.borrowCount);
  set('nft2me_collections', m.nft2me?.collectionsCreated);
  set('nft2me_mints', m.nft2me?.nftsMinted);
  set('shellies_raffles', m.shelliesJoinedRaffles?.total_count);
  set('shellies_pay', m.shelliesPayToPlay?.total_count);
  set('shellies_staking', m.shelliesStaking?.total_count);
  set('zns_total', m.zns?.total_count);
  set('inkypump_created', m.inkypumpCreatedTokens?.total_count);
  set('inkypump_buy_tx', m.inkypumpBuyVolume?.total_count);
  set('inkypump_sell_tx', m.inkypumpSellVolume?.total_count);
  set('nado_tx', m.nado?.totalTransactions);
  set('gonefishin_buys', m.gonefishin?.gamesBought);
  set('sentry_swaps', m.sentry?.swapCount);
  set('sentry_launches', m.sentry?.tokensLaunched);
  set('hypercall_swaps', m.hypercall?.swapCount);
  set('hypercall_positions', m.hypercall?.positionsWritten);
  set('inkbrokers_clockin', m.inkBrokers?.clock_in_count);
  set('inkbrokers_claim', m.inkBrokers?.claim_count);
  set('inkbrokers_swaps', m.inkBrokers?.swap_count);
  set('bridge_out_tx', m.bridge?.bridgedOutCount);
  set('wallet_txns', m.stats?.totalTxns);
  // null out metrics that never arrived (bundle sets them null on miss)
  for (const [k, v] of [...out]) if (v.count === 0 && isMetricNull(m, k)) out.set(k, { count: null, value: null });
  return { metrics: out, partial: bundle?.partial === true, fromSnapshot: bundle?.from_snapshot === true };
}
function isMetricNull(m, k) {
  const touch = {
    gm_count: m.gmCount, swap_tx: m.swap, tydro_deposit: m.tydro, tydro_borrow: m.tydro,
    nft2me_collections: m.nft2me, nft2me_mints: m.nft2me, shellies_raffles: m.shelliesJoinedRaffles,
    shellies_pay: m.shelliesPayToPlay, shellies_staking: m.shelliesStaking, zns_total: m.zns,
    inkypump_created: m.inkypumpCreatedTokens, inkypump_buy_tx: m.inkypumpBuyVolume, inkypump_sell_tx: m.inkypumpSellVolume,
    nado_tx: m.nado, gonefishin_buys: m.gonefishin, sentry_swaps: m.sentry, sentry_launches: m.sentry,
    hypercall_swaps: m.hypercall, hypercall_positions: m.hypercall, inkbrokers_clockin: m.inkBrokers,
    inkbrokers_claim: m.inkBrokers, inkbrokers_swaps: m.inkBrokers, bridge_out_tx: m.bridge, wallet_txns: m.stats,
  }[k];
  return touch == null;
}

// ----------------------------- independent chain scan ----------------------
// Wallet-centric full-history walk. No advanced-filters, no method params,
// no caches — pagination cursors only, classification below is purely local.
// Wallet-centric full-history walk. No advanced-filters, no method params,
// no caches — pagination cursors only, classification below is purely local.
//
// NOTE: /addresses/{w}/transactions items are FULL transaction objects
// (hash, method, raw_input selector, to, from, status, timestamp), so one
// paginated walk yields everything — no per-tx /transactions/{hash} fan-out
// (that would be 50x the requests for identical data).
async function listWalletHistory(pool, wallet) {
  const txs = [];
  let url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/transactions?items_count=50`;
  let pages = 0, complete = true;
  while (url && pages < MAX_HISTORY_PAGES) {
    pages++;
    const data = await pool.fetchJson(url);
    for (const it of data?.items || []) {
      const raw = typeof it?.raw_input === 'string' ? it.raw_input : typeof it?.input === 'string' ? it.input : '';
      txs.push({
        hash: String(it?.hash || '').toLowerCase(),
        to: String(it?.to?.hash || it?.to || '').toLowerCase() || null,
        from: String(it?.from?.hash || it?.from || '').toLowerCase() || null,
        selector: raw && raw.length >= 10 ? raw.slice(0, 10).toLowerCase() : null,
        method: typeof it?.method === 'string' ? it.method : null,
        status: typeof it?.status === 'string' ? it.status.toLowerCase() : null,
      });
    }
    const np = data?.next_page_params;
    if (!np) { url = null; break; }
    const qs = Object.entries(np).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');
    url = `${BLOCKSCOUT_BASE}/addresses/${wallet}/transactions?${qs}`;
  }
  if (url) complete = false; // hit page ceiling
  return { txs, complete, pages };
}

async function mapConc(items, conc, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(new Array(Math.min(conc, items.length)).fill(0).map(async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { __err: e }; } }
  }));
  return out;
}

const methodMatches = (txMethod, names) => {
  if (!txMethod) return false;
  const base = txMethod.split('(')[0].toLowerCase();
  return names.some((n) => base === n.toLowerCase());
};

// Local classifier — the heart of independence. Counts an OUT tx once per
// metric when (to == tracked contract) AND (selector in set OR method name
// matches). Failed txs are INCLUDED (maximal chain truth) so an
// OVER-REPORT can never be a status-filter artifact.
//
// Two numbers per metric:
//   exact — strict contract+selector/method match (mirrors what InkScore
//           claims to count; compared directly).
//   max   — ANY out tx to the metric's contracts (decoder-gap ceiling: if
//           InkScore <= max, a mismatch may be method-decoding drift rather
//           than phantom counts -> REVIEW, not FAIL).
// gm_possible — out txs to ANY contract whose decoded method mentions gm
//           (catches a DailyGM contract upgrade making the registry stale).
function classify(txs, wallet) {
  const exact = Object.fromEntries(['gm_count','swap_tx','tydro_deposit','tydro_borrow','nft2me_collections','nft2me_mints','shellies_raffles','shellies_pay','shellies_staking','zns_total','inkypump_created','inkypump_buy_tx','inkypump_sell_tx','nado_tx','gonefishin_buys','sentry_swaps','sentry_launches','hypercall_swaps','hypercall_positions','inkbrokers_clockin','inkbrokers_claim','inkbrokers_swaps','bridge_out_tx'].map((k) => [k, 0]));
  const max = Object.fromEntries(Object.keys(exact).map((k) => [k, 0]));
  let gmPossible = 0;
  const lc = (s) => (s || '').toLowerCase();
  const swapSet = new Set(R.swapContracts);
  const tydroSet = new Set(R.tydroContracts);
  const shelliesRaffleSet = new Set(R.shelliesRaffles);
  const sentryFactorySet = new Set([R.sentryFactoryV4, R.sentryFactoryLegacy]);
  const bridgeSet = new Set([R.relayDeposit, R.oftAdapter, R.bungeeRequest, R.bungeeGateway]);
  for (const t of txs) {
    if (!t || t.__err || lc(t.from) !== wallet) continue; // OUT only
    const to = lc(t.to), sel = lc(t.selector);
    if (!to) continue;
    if (t.method && /gm/i.test(t.method.split('(')[0])) gmPossible++;
    if (to === R.gm) { exact.gm_count++; max.gm_count++; }
    if (swapSet.has(to)) { max.swap_tx++; if (R.swapSelectors.has(sel)) exact.swap_tx++; }
    if (tydroSet.has(to)) {
      max.tydro_deposit++; max.tydro_borrow++;
      if (R.tydroSupply.has(sel)) exact.tydro_deposit++;
      if (R.tydroBorrow.has(sel)) exact.tydro_borrow++;
    }
    if (to === R.nft2meFactory) { max.nft2me_collections++; if (methodMatches(t.method, ['createCollectionN2M_000oEFvt'])) exact.nft2me_collections++; }
    if (to === R.nft2meMinter) { max.nft2me_mints++; if (sel === '0xb510391f' || methodMatches(t.method, ['mint'])) exact.nft2me_mints++; }
    if (shelliesRaffleSet.has(to)) { max.shellies_raffles++; if (sel === '0xa1dcf673' || methodMatches(t.method, ['JoinRaffle', 'joinRaffle'])) exact.shellies_raffles++; }
    if (to === R.shelliesPay) { max.shellies_pay++; if (sel === '0x3e5edbd3' || methodMatches(t.method, ['PayToPlay', 'payToPlay'])) exact.shellies_pay++; }
    if (to === R.shelliesStaking) { max.shellies_staking++; if (sel === R.shelliesStakingSelector || methodMatches(t.method, ['StakeBatch', 'stakeBatch'])) exact.shellies_staking++; }
    if (to === R.znsDeploy || to === R.znsSayGm || to === R.znsSayGmV2 || to === R.znsRegister) max.zns_total++;
    if (to === R.znsDeploy && (sel === '0x4c96a389' || methodMatches(t.method, ['Deploy', 'deploy']))) exact.zns_total++;
    if (to === R.znsSayGm && methodMatches(t.method, ['SayGM', 'sayGM'])) exact.zns_total++;
    if (to === R.znsSayGmV2 && (sel === '0x779a220b' || methodMatches(t.method, ['SayGM', 'sayGM', 'sayGMGN']))) exact.zns_total++;
    if (to === R.znsRegister && (sel === '0x3a99d4eb' || methodMatches(t.method, ['RegisterDomains', 'registerDomains']))) exact.zns_total++;
    if (to === R.inkypump) { max.inkypump_created++; if (sel === R.inkypumpCreate) exact.inkypump_created++; }
    if (to === R.inkyswapRouter) {
      max.inkypump_buy_tx++; max.inkypump_sell_tx++;
      if (R.inkypumpBuy.has(sel)) exact.inkypump_buy_tx++;
      if (R.inkypumpSell.has(sel)) exact.inkypump_sell_tx++;
    }
    if (to === R.nado) { exact.nado_tx++; max.nado_tx++; }
    if (to === R.gonefishin) { max.gonefishin_buys++; if (sel === R.gonefishinBuy) exact.gonefishin_buys++; }
    if (sentryFactorySet.has(to)) { max.sentry_launches++; if (R.sentryLaunch.has(sel)) exact.sentry_launches++; }
    if (to === R.tsunamiRouter || to === R.sentryRouterV4) {
      max.sentry_swaps++;
      if ((to === R.tsunamiRouter && R.sentrySwap.has(sel)) || (to === R.sentryRouterV4 && R.sentryV4Swap.has(sel))) exact.sentry_swaps++;
    }
    if (to === R.quotronZapper || to === R.getAssetsRouter || to === R.getAssetsZapper || to === R.earnFactory) max.hypercall_swaps++;
    if (to === R.quotronZapper && R.zapSelectors.has(sel)) exact.hypercall_swaps++;
    if (to === R.getAssetsRouter && R.getAssetsSelectors.has(sel)) exact.hypercall_swaps++;
    if (to === R.getAssetsZapper && R.zapSelectors.has(sel)) exact.hypercall_swaps++;
    if (to === R.earnFactory) { max.hypercall_positions++; if (sel === R.fundSelector) exact.hypercall_positions++; }
    if (to === R.brokersDesk) { max.inkbrokers_clockin++; max.inkbrokers_claim++; }
    if (to === R.brokersDesk && (sel === '0xfc03c14b' || methodMatches(t.method, ['ClockIn', 'clockIn']))) exact.inkbrokers_clockin++;
    if (to === R.brokersDesk && methodMatches(t.method, ['Claim', 'claim'])) exact.inkbrokers_claim++;
    if (to === R.brokersFloorRouter) { max.inkbrokers_swaps++; if (R.brokersFloorSelectors.has(sel)) exact.inkbrokers_swaps++; }
    if (bridgeSet.has(to)) { exact.bridge_out_tx++; max.bridge_out_tx++; }
  }
  return { exact, max, gmPossible };
}

async function scanWalletChain(pool, wallet) {
  const started = Date.now();
  const { txs, complete: histComplete, pages } = await listWalletHistory(pool, wallet);
  let countersTxns = null;
  try {
    const counters = await pool.fetchJson(`${BLOCKSCOUT_BASE}/addresses/${wallet}/counters`);
    countersTxns = parseInt(counters?.transactions_count || '0', 10) || 0;
  } catch (e) { warn(`${wallet.slice(0, 10)} counters failed: ${e.message}`); }
  const { exact, max, gmPossible } = classify(txs, wallet);
  const counts = exact;
  counts.wallet_txns = countersTxns ?? txs.length;
  const maxCounts = max;
  maxCounts.wallet_txns = countersTxns ?? txs.length;
  const complete = histComplete && Date.now() - started < WALLET_BUDGET_MS;
  return {
    counts, maxCounts, gmPossible, complete, pages, txsSeen: txs.length, detailErrors: 0,
    detail: `history_pages=${pages} txs=${txs.length} counters=${countersTxns}`,
  };
}

// ----------------------------- compare + CSV -------------------------------
const PLATFORMS = ['gm_count','swap_tx','tydro_deposit','tydro_borrow','nft2me_collections','nft2me_mints','shellies_raffles','shellies_pay','shellies_staking','zns_total','inkypump_created','inkypump_buy_tx','inkypump_sell_tx','nado_tx','gonefishin_buys','sentry_swaps','sentry_launches','hypercall_swaps','hypercall_positions','inkbrokers_clockin','inkbrokers_claim','inkbrokers_swaps','bridge_out_tx','wallet_txns'];

// Method-name-decoded metrics can drift when Blockscout's decoder changes;
// for those, an overage within the contract-any-method ceiling is REVIEW,
// and only beyond-ceiling is FAIL. Selector/raw_input metrics are exact.
const METHOD_BASED = new Set(['nft2me_collections','nft2me_mints','shellies_raffles','shellies_pay','shellies_staking','zns_total','inkbrokers_clockin','inkbrokers_claim']);

function verdictFor(ink, chain, chainMax, platform, chainComplete, gmPossible = 0) {
  if (ink == null) return { v: 'SKIP_inkscore_null', d: 'inkscore missing (partial bundle) — never a zero' };
  if (!chainComplete) return { v: 'SKIP_chain_incomplete', d: 'chain walk capped or errored — no FAIL on uncertainty' };
  if (platform === 'gm_count' && ink > chain && gmPossible >= ink) {
    return { v: 'REVIEW_gm_contract', d: `gm.ink=${ink} but 0 txs to pinned DailyGM; ${gmPossible} gm-named calls elsewhere — registry may be stale` };
  }
  if (ink > chain) {
    if (METHOD_BASED.has(platform) && ink <= chainMax) {
      return { v: 'REVIEW_method_gap', d: `inkscore=${ink} exact=${chain} but ${chainMax} txs to contract exist — decoder drift possible` };
    }
    return { v: 'OVER_REPORT_FAIL', d: `inkscore claims ${ink} but chain shows ${chain} (max ${chainMax})` };
  }
  if (ink === chain) return { v: 'PASS', d: 'exact match' };
  return { v: 'UNDER_REPORT', d: `chain ahead by ${chain - ink} (incomplete cache, warning only)` };
}

const csvEsc = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const HEADER = 'wallet,tier,inkscore_score,platform,inkscore_count,inkscore_value,chain_count,chain_value,delta_count,verdict,detail,chain_complete,inkscore_partial,bundle_from_snapshot';

async function readDoneWallets(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.trim().split('\n').slice(1);
    return new Set(lines.map((l) => l.split(',')[0].toLowerCase()));
  } catch { return new Set(); }
}

// ----------------------------- main ----------------------------------------
async function main() {
  log(`validator start: sample=${SAMPLE_SIZE} base=${API_BASE} walletConc=${WALLET_CONC} txConc=${TX_CONC}${DRY_RUN ? ' DRY-RUN' : ''}${RESUME ? ' RESUME' : ''}`);
  const proxyUrls = loadProxyUrls();
  const pool = new ProxyPool(proxyUrls);
  if (process.env.BLOCKSCOUT_PROXY === 'off' && proxyUrls.length > 0) warn('BLOCKSCOUT_PROXY=off — pool loaded but bypassed; set =on to use the 100 IPs');

  const wallets = await pickWallets();
  log(`sampled ${wallets.length} wallets (incl. mandatory ${MANDATORY_WALLET.slice(0, 10)}…)`);
  const done = RESUME ? await readDoneWallets(OUT_CSV) : new Set();
  if (RESUME) log(`resume: ${done.size} wallet-rows already in CSV (wallet-level skip on full coverage)`);
  if (!RESUME) await fs.writeFile(OUT_CSV, HEADER + '\n');

  const summary = { started_at: new Date().toISOString(), wallets: wallets.length, rows: 0, verdicts: {}, perPlatform: {}, proxy: null };
  const bump = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

  // wallet-level concurrency with shared proxy pool
  let wi = 0;
  const runOne = async () => {
    while (wi < wallets.length) {
      const w = wallets[wi++];
      try {
        // resume: skip wallet if all its platforms already recorded
        if (RESUME && PLATFORMS.every((p) => done.has(`${w.wallet}:${p}`))) { log(`${w.wallet.slice(0, 10)} skip (resume)`); continue; }
        log(`[${wi}/${wallets.length}] ${w.wallet} tier=${w.tier} score=${Number.isFinite(w.score) ? w.score : 'n/a'}`);
        let bundle;
        try { bundle = await fetchBundle(w.wallet); }
        catch (e) { warn(`${w.wallet.slice(0, 10)} bundle failed: ${e.message}`); continue; }
        const { metrics: ink, partial, fromSnapshot } = extractInkscore(bundle);
        let chain = { counts: {}, maxCounts: {}, gmPossible: 0, complete: false, detail: 'dry-run' };
        if (!DRY_RUN) {
          try { chain = await scanWalletChain(pool, w.wallet); }
          catch (e) { warn(`${w.wallet.slice(0, 10)} chain scan failed: ${e.message}`); chain = { counts: {}, maxCounts: {}, gmPossible: 0, complete: false, detail: `scan error: ${e.message}` }; }
        }
        const lines = [];
        for (const p of PLATFORMS) {
          if (RESUME && done.has(`${w.wallet}:${p}`)) continue;
          const iv = ink.get(p);
          const inkCount = iv?.count ?? null;
          const chainCount = DRY_RUN ? null : (chain.counts[p] ?? 0);
          const chainMax = DRY_RUN ? null : (chain.maxCounts[p] ?? chainCount ?? 0);
          let v, d;
          if (DRY_RUN) { v = inkCount == null ? 'SKIP_inkscore_null' : 'DRY_RUN'; d = 'no chain scan'; }
          else ({ v, d } = verdictFor(inkCount, chainCount, chainMax, p, chain.complete, chain.gmPossible || 0));
          if (p === 'wallet_txns' && !DRY_RUN && inkCount != null && chain.counts.wallet_txns != null && inkCount > chain.counts.wallet_txns && chain.complete) {
            v = 'OVER_REPORT_FAIL'; d = `counter claims ${inkCount} but explorer counters show ${chain.counts.wallet_txns}`;
          }
          if (!DRY_RUN && METHOD_BASED.has(p)) d += ` [exact=${chainCount} max=${chainMax}]`;
          const delta = inkCount == null || chainCount == null ? '' : inkCount - chainCount;
          lines.push([w.wallet, w.tier, Number.isFinite(w.score) ? w.score : '', p, inkCount ?? '', inkCount ?? '', chainCount ?? '', chainCount ?? '', delta, v, `${d}${DRY_RUN ? '' : ` | ${chain.detail}`}`, DRY_RUN ? '' : chain.complete, partial, fromSnapshot].map(csvEsc).join(','));
          bump(summary.verdicts, v);
          const pk = (summary.perPlatform[p] = summary.perPlatform[p] || {});
          bump(pk, v);
          summary.rows++;
        }
        if (lines.length) await fs.appendFile(OUT_CSV, lines.join('\n') + '\n');
      } catch (e) { warn(`wallet ${w.wallet.slice(0, 10)} crashed: ${e.message}`); }
    }
  };
  await Promise.all(new Array(Math.min(WALLET_CONC, wallets.length)).fill(0).map(runOne));

  summary.finished_at = new Date().toISOString();
  summary.proxy = pool.stats;
  summary.csv = OUT_CSV;
  await fs.writeFile(OUT_CSV.replace(/\.csv$/i, '.summary.json'), JSON.stringify(summary, null, 2));

  // console accuracy report — the over-report line is the headline
  log('---- ACCURACY (chain-complete rows only; SKIP rows excluded) ----');
  for (const p of PLATFORMS) {
    const pk = summary.perPlatform[p] || {};
    const denom = (pk.PASS || 0) + (pk.OVER_REPORT_FAIL || 0) + (pk.UNDER_REPORT || 0);
    if (!denom) continue;
    const exact = (((pk.PASS || 0) / denom) * 100).toFixed(1);
    log(`${p}: exact=${exact}% pass=${pk.PASS || 0} OVER-REPORT=${pk.OVER_REPORT_FAIL || 0} under=${pk.UNDER_REPORT || 0}`);
  }
  const tot = summary.verdicts;
  log(`TOTAL rows=${summary.rows} ${JSON.stringify(tot)}`);
  log(`CSV: ${OUT_CSV}`);
  const fails = tot.OVER_REPORT_FAIL || 0;
  if (fails > 0) { log(`RESULT: ${fails} OVER-REPORT rows — investigate before trusting those platforms`); process.exitCode = 2; }
  else log('RESULT: zero over-reports on complete rows');
}

main().catch((e) => { console.error('fatal:', e); process.exit(1); });
