// Sprint 3: leaderboard backfill.
//
// For every leaderboard wallet, walk EVERY platform metric to completion
// with NO request-timeout pressure (the interactive budgets are what made
// cold first loads partial). Historical data never changes, and the
// discovery cursors + permanent per-tx caches mean each pass only fetches
// what's missing — so this script is idempotent and resumable: rerun it any
// time, it costs only the delta.
//
//   node scripts/backfill-leaderboard.mjs [topN] [concurrency]
//   defaults: topN=50, concurrency=2
//
// After each wallet completes, its score+bundle snapshots are persisted so
// dashboard loads for it are instant.
//
// ACCURACY: this script computes through the SAME services the API uses —
// no separate logic, no shortcuts. What it changes is only TIME BUDGETS
// (none) and pacing (polite concurrency).
import 'dotenv/config';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'path';

// Import the real services (ts-node-free: run with node --experimental-strip-types? No —
// compile-free approach: use the API server itself. See note at bottom.)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

const BASE = process.env.API_BASE_URL_TEST || 'http://127.0.0.1:4000';
// "all" = every wallet in cached_leaderboard (no LIMIT).
const topNArg = process.argv[2] || '50';
const topN = topNArg === 'all' ? 100000 : parseInt(topNArg, 10);
const concurrency = Math.max(1, Math.min(5, parseInt(process.argv[3] || '3', 10)));
// Full discovery of heavy wallets takes several passes; each pass is capped
// by the discovery maxPages, and cursors resume below the previous floor.
const PASSES_PER_WALLET = parseInt(process.argv[4] || '6', 10);
const PASS_COOLDOWN_MS = parseInt(process.env.BACKFILL_PASS_COOLDOWN_MS || '1500', 10);
// Wallets ranked <= TIER_BOUNDARY get the full multi-pass treatment; the
// long tail (thousands of light wallets) gets a light pass each.
const TIER_BOUNDARY = parseInt(process.argv[5] || '200', 10);
// Optional rank-range partition so multiple machines/processes can split the
// leaderboard without overlapping work (cursor state lives in the SHARED
// Postgres, so ranges are the only coordination needed):
//   argv[6] = startRank (1-based, default 1)
//   argv[7] = endRank (inclusive, default = last wallet)
const startRank = Math.max(1, parseInt(process.argv[6] || '1', 10));
const endRankRaw = parseInt(process.argv[7] || '0', 10);

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

// One pass = the bundle's live gather with refresh=true (bypasses caches,
// walks every metric; cursors + permanent caches make each pass cheaper).
// NOTE: runs against the RUNNING api-server so all in-flight dedup, caches
// and queue machinery are shared with production code paths.
async function pass(wallet) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/dashboard/bundle/${wallet}?refresh=true`, {
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const b = await res.json();
  const missing = Object.entries(b.metrics || {}).filter(([, v]) => v == null).map(([k]) => k);
  return { ms: Date.now() - t0, partial: !!b.partial, missing };
}

async function backfillWallet(wallet, rank) {
  // Tiering: the top TIER wallets get full multi-pass treatment (heavy
  // histories, users actually look at them); the long tail is low-activity —
  // a single pass usually completes it, and cursors make any rerun cheap.
  const passes = rank <= TIER_BOUNDARY ? PASSES_PER_WALLET : Math.min(2, PASSES_PER_WALLET);
  const attempts = [];
  for (let p = 1; p <= passes; p++) {
    try {
      const r = await pass(wallet);
      attempts.push(r);
      console.log(`  [#${rank} pass ${p}] ${fmt(r.ms)} partial=${r.partial}${r.missing.length ? ' missing: ' + r.missing.join(',') : ''}`);
      if (!r.partial) {
        // Warm pass (serves from the just-written caches + persists snapshot
        // server-side is automatic on the refresh path).
        // Timeout is MANDATORY: an unbounded fetch here hung the whole
        // backfill for 24h when one request stalled (observed 2026-09-05).
        const wt0 = Date.now();
        const warm = await fetch(`${BASE}/api/dashboard/bundle/${wallet}`, {
          signal: AbortSignal.timeout(120000),
        }).catch(() => null);
        if (warm && warm.ok) {
          const wb = await warm.json();
          console.log(`  [#${rank} warm ] ${fmt(Date.now() - wt0)} partial=${wb.partial} from_snapshot=${wb.from_snapshot}`);
        }
        return { rank, wallet, ok: true, passes: p };
      }
    } catch (e) {
      attempts.push({ error: String(e.message || e) });
      console.log(`  [#${rank} pass ${p}] ERROR ${String(e.message || e).slice(0, 120)}`);
    }
    // Give the throttle a breath between passes on the same wallet.
    await new Promise((s) => setTimeout(s, PASS_COOLDOWN_MS));
  }
  return { rank, wallet, ok: false, passes: PASSES_PER_WALLET, lastMissing: attempts[attempts.length - 1]?.missing || [] };
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    topNArg === 'all'
      ? `SELECT DISTINCT entry->>'wallet_address' AS wallet, (entry->>'score')::numeric AS score
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC`
      : `SELECT entry->>'wallet_address' AS wallet
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT $1`,
    topNArg === 'all' ? [] : [topN]
  );
  await c.end();
  const wallets = r.rows.map((x) => (x.wallet || '').toLowerCase()).filter((w) => /^0x[0-9a-f]{40}$/.test(w));
  const endRank = endRankRaw > 0 ? Math.min(endRankRaw, wallets.length) : wallets.length;
  if (startRank > 1 || endRank < wallets.length) {
    console.log(`range partition: ranks ${startRank}..${endRank} of ${wallets.length} (this lane)\n`);
  }
  console.log(`backfill: ${wallets.length} wallets, concurrency=${concurrency}, passes=${PASSES_PER_WALLET}\n`);

  const t0 = Date.now();
  let idx = startRank - 1;
  let done = 0;
  const results = [];
  const worker = async () => {
    while (idx < endRank) {
      const i = idx++;
      const res = await backfillWallet(wallets[i], i + 1);
      results.push(res);
      done++;
      console.log(`[${done}/${endRank - startRank + 1}] rank ${i + 1}: ${res.ok ? 'COMPLETE' : 'incomplete after passes'}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const complete = results.filter((x) => x.ok).length;
  console.log(`\n=== BACKFILL DONE in ${fmt(Date.now() - t0)} ===`);
  console.log(`complete: ${complete}/${wallets.length}`);
  const incomplete = results.filter((x) => !x.ok);
  if (incomplete.length) {
    console.log('still incomplete (rerun the script — cursors resume below the floor):');
    incomplete.forEach((x) => console.log(`  rank ${x.rank} ${x.wallet}`));
  }
})();
