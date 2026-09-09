// Sprint 2 gate: prove the dashboard bundle is faithful.
//
// Claim 1 (composition): every bundle.metrics entry equals the EXACT JSON
// the corresponding individual endpoint serves.
//   node scripts/check-bundle-parity.mjs bundle out/bundle.json   (capture bundle)
//   node scripts/check-bundle-parity.mjs verify  out/bundle.json  (fetch all endpoints, per-metric compare)
//
// Claim 2 (snapshot): a bundle served from wallet_dashboard_snapshots after
// a server restart equals the live bundle (ignoring timestamps).
//   node scripts/check-bundle-parity.mjs diff out/live.json out/from-snapshot.json
//
// Timestamps (captured_at, last_updated fields, score.last_updated) are
// ignored in `diff` — they reflect WHEN a computation ran, not its result.

const WALLET = process.argv[4] || '0x8655df35818f348ea4e371a613e73677d816f589';
const BASE = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
const mode = process.argv[2];

// Dashboard metric id -> individual endpoint path (the exact 27 the
// dashboard route.ts fans out to; 'analytics' = the /api/analytics/:wallet
// aggregate; 'score' = the score endpoint).
const ENDPOINTS = {
  stats: `/api/wallet/${WALLET}/stats`,
  bridge: `/api/wallet/${WALLET}/bridge`,
  swap: `/api/wallet/${WALLET}/swap`,
  volume: `/api/wallet/${WALLET}/volume`,
  score: `/api/wallet/${WALLET}/score`,
  analytics: `/api/analytics/${WALLET}`,
  cards: `/api/dashboard/cards/${WALLET}`,
  nado: `/api/nado/${WALLET}`,
  otomate: `/api/otomate/${WALLET}`,
  cryptoclash: `/api/cryptoclash/${WALLET}`,
  nft2me: `/api/wallet/${WALLET}/nft2me`,
  tydro: `/api/wallet/${WALLET}/tydro`,
  gmCount: `/api/analytics/${WALLET}/gm_count`,
  inkypumpCreatedTokens: `/api/analytics/${WALLET}/inkypump_created_tokens`,
  inkypumpBuyVolume: `/api/analytics/${WALLET}/inkypump_buy_volume`,
  inkypumpSellVolume: `/api/analytics/${WALLET}/inkypump_sell_volume`,
  zns: `/api/analytics/${WALLET}/zns`,
  shelliesJoinedRaffles: `/api/analytics/${WALLET}/shellies_joined_raffles`,
  shelliesPayToPlay: `/api/analytics/${WALLET}/shellies_pay_to_play`,
  shelliesStaking: `/api/analytics/${WALLET}/shellies_staking`,
  openseaBuyCount: `/api/analytics/${WALLET}/opensea_buy_count`,
  mintCount: `/api/analytics/${WALLET}/mint_count`,
  openseaSaleCount: `/api/analytics/${WALLET}/opensea_sale_count`,
  templarsNftBalance: `/api/analytics/${WALLET}/templars_nft_balance`,
  sweep: `/api/analytics/${WALLET}/sweep`,
  zenithNft: `/api/analytics/${WALLET}/zenith_nft_balance`,
  zenithStaking: `/api/analytics/${WALLET}/zenith_staking`,
};

// Endpoints whose cold computes legitimately exceed a plain fetch: use the
// dashboard's own budgets so verify() doesn't manufacture failures.
const LONG = { bridge: 42000, volume: 42000, swap: 30000, tydro: 30000, nft2me: 30000, score: 35000, analytics: 35000 };

// Canonical stringify: sorted object keys, timestamps stripped. Required
// for any comparison that crosses a jsonb round-trip (Postgres re-sorts
// object keys — byte comparison is invalid there).
const canonical = (v) => JSON.stringify(v, (k, val) => {
  if (k === 'last_updated' || k === 'captured_at') return undefined;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return val;
});

async function fetchJson(url, timeoutMs) {
  const res = await fetch(`${BASE}${url}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

if (mode === 'bundle') {
  const out = process.argv[3];
  const bundle = await fetchJson(`/api/dashboard/bundle/${WALLET}`, 60000);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(bundle, null, 2));
  console.log(`[bundle] captured_at=${bundle.captured_at} partial=${bundle.partial} from_snapshot=${bundle.from_snapshot} metrics=${Object.keys(bundle.metrics).length} -> ${out}`);
} else if (mode === 'verify') {
  const { readFileSync } = await import('node:fs');
  const bundle = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  let fails = 0;
  const entries = Object.entries(ENDPOINTS);
  for (const [id, path] of entries) {
    try {
      const ep = await fetchJson(path, LONG[id] || 20000);
      const bm = bundle.metrics[id];
      // canonical(): key-sorted, timestamps stripped — data fields must be
      // exactly equal (jsonb round-trips re-sort keys, byte compare fails).
      if (canonical(ep) === canonical(bm)) {
        console.log(`  ✓ ${id}`);
      } else {
        fails++;
        console.log(`  ✗ ${id} DIFFERS (endpoint vs bundle)`);
        const a = JSON.stringify(ep || null).slice(0, 300);
        const b = JSON.stringify(bm ?? null).slice(0, 300);
        console.log(`      endpoint: ${a}`);
        console.log(`      bundle:   ${b}`);
      }
    } catch (err) {
      fails++;
      console.log(`  ✗ ${id} endpoint fetch failed: ${err.message}`);
    }
  }
  if (fails === 0) {
    console.log('BUNDLE PARITY OK ✅ — every bundle entry equals its endpoint payload');
  } else {
    console.log(`BUNDLE PARITY: ${fails} differences ❌ — do not ship`);
    process.exit(1);
  }
} else if (mode === 'diff') {
  const { readFileSync } = await import('node:fs');
  const a = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  const b = JSON.parse(readFileSync(process.argv[4], 'utf8'));
  const diffs = Object.keys(a.metrics).filter((k) => canonical(a.metrics[k]) !== canonical(b.metrics[k]));
  if (diffs.length === 0) {
    console.log('SNAPSHOT BUNDLE PARITY OK ✅ — snapshot-served bundle identical to live bundle (canonical, timestamps ignored)');
  } else {
    console.log(`SNAPSHOT BUNDLE PARITY: ${diffs.length} metrics differ ❌`);
    for (const k of diffs) {
      console.log(`  ✗ metric ${k}`);
      const sa = canonical(a.metrics[k]).slice(0, 240);
      const sb = canonical(b.metrics[k]).slice(0, 240);
      if (sa !== sb) {
        console.log(`      live:     ${sa}`);
        console.log(`      snapshot: ${sb}`);
      }
    }
    process.exit(1);
  }
} else {
  console.error('usage: check-bundle-parity.mjs bundle|verify|diff ...');
  process.exit(1);
}
