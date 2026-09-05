// Parity baseline capture: freezes the JSON output of every metric endpoint
// for a wallet, so the Sprint-1 extractions (swap/tydro/nft2me/volume/
// analytics -> services) can be proven behavior-identical.
//
// Usage:
//   node scripts/capture-baseline.mjs --out baselines/pre-sprint1 --wallet 0x...
// (server must be running on :4000; endpoints are hit with ?refresh=true to
// force a live recompute, bypassing the 1h cache)
//
// IMPORTANT: run this BEFORE any extraction change, and again after each one,
// then diff with compare-baseline.mjs.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = getArg('out', 'baselines/pre-sprint1');
const WALLET = (getArg('wallet', '0x8655df35818f348ea4e371a613e73677d816f589')).toLowerCase();
const BASE = getArg('base', 'http://127.0.0.1:4000');

// Every metric endpoint the dashboard + score consume.
const ENDPOINTS = [
  { name: 'stats', path: `/api/wallet/${WALLET}/stats` },
  { name: 'bridge', path: `/api/wallet/${WALLET}/bridge` },
  { name: 'swap', path: `/api/wallet/${WALLET}/swap` },
  { name: 'volume', path: `/api/wallet/${WALLET}/volume` },
  { name: 'tydro', path: `/api/wallet/${WALLET}/tydro` },
  { name: 'nft2me', path: `/api/wallet/${WALLET}/nft2me` },
  { name: 'score', path: `/api/wallet/${WALLET}/score` },
  { name: 'nado', path: `/api/nado/${WALLET}` },
  { name: 'copink', path: `/api/copink/${WALLET}` },
  { name: 'cards', path: `/api/dashboard/cards/${WALLET}` },
  { name: 'gm_count', path: `/api/analytics/${WALLET}/gm_count` },
  { name: 'inkypump_created_tokens', path: `/api/analytics/${WALLET}/inkypump_created_tokens` },
  { name: 'inkypump_buy_volume', path: `/api/analytics/${WALLET}/inkypump_buy_volume` },
  { name: 'inkypump_sell_volume', path: `/api/analytics/${WALLET}/inkypump_sell_volume` },
  { name: 'shellies_joined_raffles', path: `/api/analytics/${WALLET}/shellies_joined_raffles` },
  { name: 'shellies_pay_to_play', path: `/api/analytics/${WALLET}/shellies_pay_to_play` },
  { name: 'shellies_staking', path: `/api/analytics/${WALLET}/shellies_staking` },
  { name: 'zns', path: `/api/analytics/${WALLET}/zns` },
  { name: 'templars_nft_balance', path: `/api/analytics/${WALLET}/templars_nft_balance` },
  { name: 'mint_count', path: `/api/analytics/${WALLET}/mint_count` },
  { name: 'opensea_buy_count', path: `/api/analytics/${WALLET}/opensea_buy_count` },
  { name: 'opensea_sale_count', path: `/api/analytics/${WALLET}/opensea_sale_count` },
  { name: 'cowswap_swaps', path: `/api/analytics/${WALLET}/cowswap_swaps` },
  { name: 'sweep', path: `/api/analytics/${WALLET}/sweep` },
];

const dir = join(OUT, WALLET);
mkdirSync(dir, { recursive: true });

// Record the ETH spot price context for this capture: USD values across the
// API are priced at fetch time, so cross-run diffs must be normalized by the
// price ratio (the price source intermittently writes a 3500.00 fallback —
// exclude those rows when picking the reference price).
let ethPrice = null;
try {
  const { Client } = await import('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT price_usd FROM eth_prices WHERE price_usd IS DISTINCT FROM 3500 ORDER BY timestamp DESC LIMIT 1"
  );
  ethPrice = r.rows[0] ? Number(r.rows[0].price_usd) : null;
  await c.end();
} catch (e) {
  console.log(`  (no price context: ${e.message})`);
}
writeFileSync(join(dir, '_meta.json'), JSON.stringify({ wallet: WALLET, ethPrice, captured_at: new Date().toISOString() }, null, 2));
console.log(`  price context: ETH $${ethPrice ?? 'unknown'}`);

let ok = 0, failed = 0;
for (const ep of ENDPOINTS) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${ep.path}?refresh=true`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    JSON.parse(text); // must be valid JSON
    writeFileSync(join(dir, `${ep.name}.json`), text);
    ok++;
    console.log(`  ✓ ${ep.name.padEnd(24)} ${res.status}  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${(text.length / 1024).toFixed(1)}KB`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${ep.name.padEnd(24)} FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(err?.message || err).slice(0, 120)}`);
  }
}

console.log(`\nBaseline "${OUT}" for ${WALLET}: ${ok} captured, ${failed} failed.`);
if (failed > 0) console.log('WARNING: fix the failures and re-run — a baseline with holes weakens the parity guarantee.');
console.log(`Next: after each extraction change, re-run with --out baselines/after-<change> and diff via compare-baseline.mjs.`);
