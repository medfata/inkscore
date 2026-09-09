// =============================================================================
// Worker / 24h-cycle validator
//
// Validates:
//  1. CatchupWorker cadence coverage — every leaderboard wallet has a complete
//     metrics snapshot refreshed within its cadence (top-200: 6h, rest: 24h).
//  2. The refresh queue is draining (bs_refresh_queue not backing up).
//  3. Worker liveness — snapshots written recently.
//
// Run: npx tsx scripts/validate-workers.ts
// =============================================================================
import 'dotenv/config';
import { readFileSync } from 'fs';

async function main() {
  const { query, pool } = await import('../src/db');

  // 0. Config sanity (what the server process was started with is in .env).
  let env = '';
  try { env = readFileSync('.env', 'utf8'); } catch { /* ignore */ }
  const catchupOn = /CATCHUP_WORKER\s*=\s*on/i.test(env);
  console.log(`CATCHUP_WORKER (api-server/.env): ${catchupOn ? 'on' : 'OFF — catchup cycles will not run!'}`);

  // 1. Leaderboard roster.
  const board = await query<{ wallet: string; score: string }>(
    `SELECT entry->>'wallet_address' AS wallet, entry->>'score' AS score
       FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
      WHERE id = 1`
  );
  const wallets = board.map(r => r.wallet.toLowerCase()).filter(w => w.startsWith('0x'));
  const top200 = new Set(
    [...board].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 200).map(r => r.wallet.toLowerCase())
  );
  console.log(`leaderboard wallets: ${wallets.length} (top-200 fast cadence: 6h, rest: 24h)\n`);

  // 2. Snapshot coverage per wallet (complete snapshots only).
  const snaps = await query<{ wallet: string; captured_at: string; age_hours: string }>(
    `SELECT s.wallet, s.captured_at::text AS captured_at,
            EXTRACT(EPOCH FROM (NOW() - s.captured_at)) / 3600 AS age_hours
       FROM wallet_metrics_snapshots s
      WHERE s.partial = false
        AND s.captured_at = (
          SELECT MAX(captured_at) FROM wallet_metrics_snapshots m
           WHERE m.wallet = s.wallet AND m.partial = false
        )`
  );
  const ageByWallet = new Map(snaps.map(r => [r.wallet.toLowerCase(), parseFloat(r.age_hours)]));

  const buckets = { fresh6h: 0, fresh24h: 0, stale: 0, missing: 0 };
  const staleList: Array<{ wallet: string; age: number; due: string }> = [];
  for (const w of wallets) {
    const age = ageByWallet.get(w);
    const dueH = top200.has(w) ? 6 : 24;
    if (age === undefined) { buckets.missing++; staleList.push({ wallet: w, age: -1, due: `${dueH}h` }); }
    else if (age <= dueH) { age <= 6 ? buckets.fresh6h++ : buckets.fresh24h++; }
    else { buckets.stale++; staleList.push({ wallet: w, age, due: `${dueH}h` }); }
  }
  const covered = wallets.length - buckets.missing;
  console.log('── Snapshot coverage vs cadence ──');
  console.log(`  within cadence (≤6h or ≤24h): ${buckets.fresh6h + buckets.fresh24h}/${wallets.length}`);
  console.log(`  fresh ≤6h:  ${buckets.fresh6h}`);
  console.log(`  fresh ≤24h: ${buckets.fresh24h}`);
  console.log(`  STALE (> cadence): ${buckets.stale}`);
  console.log(`  NO complete snapshot: ${buckets.missing}`);
  for (const s of staleList.slice(0, 15)) {
    console.log(`    stale: ${s.wallet} age=${s.age === -1 ? 'never' : `${s.age.toFixed(1)}h`} (due ${s.due})`);
  }
  if (staleList.length > 15) console.log(`    … and ${staleList.length - 15} more`);

  // 3. Worker liveness: snapshot writes in recent windows.
  const liveness = await query<{ window: string; n: string }>(
    `SELECT '1h' AS window, COUNT(*)::text AS n FROM wallet_metrics_snapshots WHERE captured_at > NOW() - INTERVAL '1 hour'
     UNION ALL SELECT '6h', COUNT(*)::text FROM wallet_metrics_snapshots WHERE captured_at > NOW() - INTERVAL '6 hours'
     UNION ALL SELECT '24h', COUNT(*)::text FROM wallet_metrics_snapshots WHERE captured_at > NOW() - INTERVAL '24 hours'`
  );
  console.log('\n── Worker liveness (snapshot writes) ──');
  for (const r of liveness) console.log(`  last ${r.window}: ${r.n} snapshots written`);

  // 4. Refresh queue health.
  try {
    const q = await query<{ protocol: string; pending: string; oldest_min: string | null; retried: string }>(
      `SELECT protocol, COUNT(*)::text AS pending,
              ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(next_run))) / 60)::text AS oldest_min,
              COUNT(*) FILTER (WHERE attempts > 0)::text AS retried
         FROM bs_refresh_queue
        WHERE next_run <= NOW()
        GROUP BY protocol
        ORDER BY COUNT(*) DESC`
    );
    console.log('\n── bs_refresh_queue (due jobs pending) ──');
    if (q.length === 0) console.log('  empty — queue fully drained ✓');
    for (const r of q) console.log(`  ${r.protocol}: ${r.pending} pending (oldest overdue ${r.oldest_min ?? '?'} min, ${r.retried} retried)`);
    const backlog = q.reduce((a, r) => a + parseInt(r.pending, 10), 0);
    console.log(`  total due backlog: ${backlog} ${backlog > 200 ? '⚠ queue backing up' : '✓'}`);
  } catch (e) {
    console.log(`  (queue table unreadable: ${(e as Error).message})`);
  }

  // 5. CatchupWorker staleness logic spot-check: wallets the catchup should
  //    consider stale right now = age > cadence. Cross-checked above. Also
  //    verify the latest tx probe path exists (getLatestTxTimestamp).
  const { getLatestTxTimestamp } = await import('../src/services/blockscout-service');
  console.log(`\ngetLatestTxTimestamp (catchup probe) importable: ${typeof getLatestTxTimestamp === 'function' ? '✓' : '✗'}`);

  await pool.end();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
