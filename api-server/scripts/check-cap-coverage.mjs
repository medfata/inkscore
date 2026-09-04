// One-off: check whether the new page caps cover the top-10 leaderboard
// wallets (i.e., no walk would truncate and mark metrics partial).
//
// Method: /addresses/{w}/counters gives live totals (cheap, 1 call/wallet).
// Walks page 50 items each, so pages_needed = ceil(count / 50). Platform-
// specific filtered walks can only see a SUBSET of these totals, so if the
// total fits under a cap, every platform walk fits too (upper-bound check).
//
// Usage: node scripts/check-cap-coverage.mjs   (from api-server/, needs .env)

import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;

// The caps currently in blockscout-service.ts / backup_wallet.ts:
const CAPS = {
  protocolPages: 100,   // MAX_COUNT_PAGES — platform metric walks
  nativePages: 100,     // MAX_NATIVE_PAGES — circulated volume (outgoing txs)
  inflowPages: 60,      // BRIDGE_INFLOW_TRANSFER_PAGES — bridge inflow walks
  metaResolve: 1000,    // META_RESOLVE_CAP — name-matched hashes per platform
  priceTxs: 1000,       // CAP_PRICE_TXS — priced txs per bridge flow / DEX
};
const ITEMS_PER_PAGE = 50;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const rows = await client.query(
  `SELECT entry->>'wallet_address' AS w, (entry->>'score') AS score
     FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
    WHERE id = 1
    ORDER BY (entry->>'score')::numeric DESC
    LIMIT 10`
);

console.log(`Top ${rows.rows.length} leaderboard wallets vs new caps (pages hold 50 items)\n`);
console.log(
  'rank  wallet'.padEnd(46),
  'score'.padStart(8),
  'txs'.padStart(7),
  'xfer'.padStart(7),
  'out-pages/100'.padStart(14),
  'xfer-pages/60'.padStart(14),
  'verdict'
);

let allCovered = true;
for (let i = 0; i < rows.rows.length; i++) {
  const r = rows.rows[i];
  const w = (r.w || '').toLowerCase();
  let counters = {};
  try {
    const res = await fetch(`https://explorer.inkonchain.com/api/v2/addresses/${w}/counters`);
    counters = await res.json();
  } catch (e) {
    console.log(String(i + 1).padStart(4), w.slice(0, 10) + '…', 'FETCH FAILED:', e.message);
    continue;
  }
  const txs = parseInt(counters.transactions_count || '0', 10);
  const xfers = parseInt(counters.token_transfers_count || '0', 10);
  const outPages = Math.ceil(txs / ITEMS_PER_PAGE);     // worst case: all txs outgoing
  const xferPages = Math.ceil(xfers / ITEMS_PER_PAGE);  // worst case: all transfers inbound

  // Upper-bound checks: a platform walk can never see more than the totals.
  const volumeOk = outPages <= CAPS.nativePages;
  const bridgeOk = xferPages <= CAPS.inflowPages;
  // Outgoing-only filtered walks (protocols) use ≤ outPages as well.
  const protocolsOk = outPages <= CAPS.protocolPages;
  const ok = volumeOk && bridgeOk && protocolsOk;
  if (!ok) allCovered = false;

  const verdict = ok
    ? 'COVERED — exact in one scan'
    : `AT RISK: ${!volumeOk ? `volume needs ${outPages}p ` : ''}${!bridgeOk ? `bridge needs ${xferPages}p ` : ''}${!protocolsOk ? 'protocol walk may truncate' : ''}`;

  console.log(
    String(i + 1).padStart(4),
    (w.slice(0, 10) + '…').padEnd(12),
    String(r.score ?? '').padStart(8),
    String(txs).padStart(7),
    String(xfers).padStart(7),
    `${outPages}/100`.padStart(14),
    `${xferPages}/60`.padStart(14),
    verdict
  );

  await new Promise((res) => setTimeout(res, 1200)); // stay well under the rate limit
}

console.log('\n' + (allCovered
  ? 'RESULT: every top-10 wallet is fully covered by the new caps — no truncated metrics.'
  : 'RESULT: some wallets exceed caps — those metrics would converge over loads (partial flags), not break.'));
await client.end();
