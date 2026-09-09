// Sprint 2 gate: the Next dashboard endpoint (flipped to the bundle fast
// path) must return the SAME data the individual Express endpoints serve.
//
//   node scripts/check-dashboard-flip.mjs verify <wallet> <port>
//
// Fetches /api/:w/dashboard from the Next server, then fetches each
// individual Express endpoint directly, and compares per-field (canonical,
// timestamps ignored). Also reports which source flag the dashboard used.
const BASE_NEXT = process.argv[4] ? `http://127.0.0.1:${process.argv[4]}` : 'http://127.0.0.1:3100';
const BASE_API = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
const WALLET = process.argv[3] || '0x8655df35818f348ea4e371a613e73677d816f589';

const FIELDS = {
  stats: `${BASE_API}/api/wallet/${WALLET}/stats`,
  bridge: `${BASE_API}/api/wallet/${WALLET}/bridge`,
  swap: `${BASE_API}/api/wallet/${WALLET}/swap`,
  volume: `${BASE_API}/api/wallet/${WALLET}/volume`,
  score: `${BASE_API}/api/wallet/${WALLET}/score`,
  analytics: `${BASE_API}/api/analytics/${WALLET}`,
  cards: `${BASE_API}/api/dashboard/cards/${WALLET}`,
  nado: `${BASE_API}/api/nado/${WALLET}`,
  otomate: `${BASE_API}/api/otomate/${WALLET}`,
  cryptoclash: `${BASE_API}/api/cryptoclash/${WALLET}`,
  nft2me: `${BASE_API}/api/wallet/${WALLET}/nft2me`,
  tydro: `${BASE_API}/api/wallet/${WALLET}/tydro`,
  gmCount: `${BASE_API}/api/analytics/${WALLET}/gm_count`,
  inkypumpCreatedTokens: `${BASE_API}/api/analytics/${WALLET}/inkypump_created_tokens`,
  inkypumpBuyVolume: `${BASE_API}/api/analytics/${WALLET}/inkypump_buy_volume`,
  inkypumpSellVolume: `${BASE_API}/api/analytics/${WALLET}/inkypump_sell_volume`,
  zns: `${BASE_API}/api/analytics/${WALLET}/zns`,
  shelliesJoinedRaffles: `${BASE_API}/api/analytics/${WALLET}/shellies_joined_raffles`,
  shelliesPayToPlay: `${BASE_API}/api/analytics/${WALLET}/shellies_pay_to_play`,
  shelliesStaking: `${BASE_API}/api/analytics/${WALLET}/shellies_staking`,
  openseaBuyCount: `${BASE_API}/api/analytics/${WALLET}/opensea_buy_count`,
  mintCount: `${BASE_API}/api/analytics/${WALLET}/mint_count`,
  openseaSaleCount: `${BASE_API}/api/analytics/${WALLET}/opensea_sale_count`,
  templarsNftBalance: `${BASE_API}/api/analytics/${WALLET}/templars_nft_balance`,
  sweep: `${BASE_API}/api/analytics/${WALLET}/sweep`,
  zenithNft: `${BASE_API}/api/analytics/${WALLET}/zenith_nft_balance`,
  zenithStaking: `${BASE_API}/api/analytics/${WALLET}/zenith_staking`,
};

const canonical = (v) => JSON.stringify(v, (k, val) => {
  if (k === 'last_updated' || k === 'captured_at') return undefined;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return val;
});

const dashUrl = `${BASE_NEXT}/api/${WALLET}/dashboard${process.env.FLIP_REFRESH === 'true' ? '?refresh=true' : ''}`;
const dashRes = await fetch(dashUrl);
if (!dashRes.ok) {
  console.error(`dashboard HTTP ${dashRes.status}`);
  process.exit(1);
}
const dash = await dashRes.json();
console.log(`dashboard: from_snapshot=${dash.from_snapshot} captured_at=${dash.captured_at} errors=${JSON.stringify(dash.errors || [])}`);

let fails = 0;
for (const [field, url] of Object.entries(FIELDS)) {
  const dv = dash[field] ?? null;
  let ev = null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    ev = r.ok ? await r.json() : null;
  } catch { ev = null; }
  if (canonical(dv) === canonical(ev)) {
    console.log(`  ✓ ${field}${dv === null ? ' (null==null)' : ''}`);
  } else {
    fails++;
    console.log(`  ✗ ${field} DIFFERS`);
    console.log(`      dashboard: ${canonical(dv).slice(0, 200)}`);
    console.log(`      endpoint:  ${canonical(ev).slice(0, 200)}`);
  }
}
if (fails === 0) {
  console.log('DASHBOARD FLIP PARITY OK ✅ — flipped dashboard data is identical to the individual endpoints');
} else {
  console.log(`DASHBOARD FLIP PARITY: ${fails} differences ❌`);
  process.exit(1);
}
