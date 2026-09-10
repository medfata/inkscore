// Background refresh worker — completes truncated fills and refreshes stale
// Blockscout caches without blocking interactive traffic.
//
// Runs inside the api-server process (no new service to deploy on the 4GB
// VPS): a 60s interval loop draining `bs_refresh_queue` at low concurrency.
// Disable with REFRESH_WORKER=off.

import { query } from '../db';
import {
  TxDirection,
  getProtocolCount,
  getTokenHoldingsRaw,
  getWalletStats,
} from './blockscout-service';
import { getTotalVolumeData } from './volume-service';
import { pointsServiceV2 } from './points-service-v2';
import { gatherDashboardBundle } from './dashboard-bundle-service';
import { getBridgeVolume } from './bridge-service';
import { getSwapVolume } from './swap-service';
import { getTydroData } from './tydro-service';
import { getNft2meData } from './nft2me-service';
import { getNadoMetrics } from './nado-service';
import {
  getSnapshotAgeMs,
  getBundleSnapshotAgeMs,
  saveScoreSnapshot,
  saveBundleSnapshot,
  SNAPSHOT_MAX_AGE_MS,
} from './metrics-snapshot-service';
import { getRecentBlockscoutUsagePerMin, getBlockscoutRateLimit, auditPinnedRegistryDrift, runAsBackground } from './blockscout-service';

// Score-snapshot refresh: only bother when a snapshot is older than this,
// comfortably under SNAPSHOT_MAX_AGE_MS (60 min) — no point re-gathering
// inputs the serve path would still use, and never letting a top wallet's
// snapshot cross the staleness threshold in the first place. Env-tunable but
// clamped below the serve window (55 min) so warmth always stays servable.
const SNAPSHOT_REFRESH_MIN_AGE_MS =
  Math.min(55, Math.max(10, parseInt(process.env.SNAPSHOT_REFRESH_MIN_AGE_MIN || '45', 10))) * 60_000;
// How many top wallets each snapshot sweep keeps warm (env for whale sets).
const SNAPSHOT_SWEEP_WALLETS = Math.max(1, parseInt(process.env.SNAPSHOT_SWEEP_WALLETS || '50', 10));

// USER-PRIORITY BACKOFF: the Blockscout throttle (BLOCKSCOUT_RATE_LIMIT
// req/min through the residential proxy) is shared between interactive
// dashboard loads and this worker. When interactive traffic has the throttle
// near-saturated (80% of the configured limit), the worker SKIPS its cycle —
// a user's cold load must never compete with background warmth (observed: a
// worker drain during a heavy wallet's first load starved every metric past
// its timeout).
const THROTTLE_YIELD_PER_MIN = Math.floor(getBlockscoutRateLimit() * 0.8);
function throttleSaturated(): boolean {
  return getRecentBlockscoutUsagePerMin() >= THROTTLE_YIELD_PER_MIN;
}

// Background-class wrapper: every worker task runs inside the Blockscout 'bg'
// reservation, so interactive dashboard loads always keep their share of the
// throttle even when the queue is draining hard.
const runBg = (fn: () => Promise<void>) => () => {
  void runAsBackground(fn).catch((err: any) =>
    console.warn('[RefreshWorker] background task failed:', err?.message || err)
  );
};

const WORKER_INTERVAL_MS = 60_000;
// Env-tunable for faster backlog drain on capable boxes (the throttle-yield
// guard stays in place, so higher values cannot starve interactive loads).
const WORKER_BATCH = Math.max(1, parseInt(process.env.REFRESH_WORKER_BATCH || '20', 10));
const WORKER_CONCURRENCY = Math.max(1, parseInt(process.env.REFRESH_WORKER_CONCURRENCY || '2', 10));
// Bundle refill jobs (accuracy completion loop): past this attempt count the
// job parks to a 6h cadence instead of the standard 60min backoff, so a
// genuinely unreachable source can never retry-storm.
const BUNDLE_PARK_ATTEMPTS = parseInt(process.env.BUNDLE_PARK_ATTEMPTS || '8', 10);
// Incomplete-cursor sweep: finds wallets whose discovery/count/volume walks
// are still truncated and enqueues bundle refills — guarantees convergence
// even when nobody ever revisits the wallet.
const INCOMPLETE_SWEEP_INTERVAL_MS = 10 * 60_000;
const INCOMPLETE_SWEEP_LIMIT = Math.max(0, parseInt(process.env.INCOMPLETE_SWEEP_LIMIT || '40', 10));
let incompleteSweepWarned = false;
// Registry drift audit cadence (see auditPinnedRegistryDrift): cheap, bounded,
// catches tracked actions that move to a new selector before counts drop.
const REGISTRY_AUDIT_INTERVAL_MS = 6 * 60 * 60_000;

// System/junk wallets that must never be walked: the burn address has 55M
// txs — every Blockscout query for it times out and poisons the shared
// request budget for real users.
export const JUNK_WALLETS = new Set([
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0001',
]);

let started = false;
// Re-entrancy guards for the warm sweeps: with larger SNAPSHOT_SWEEP_WALLETS a
// sequential sweep can outlive its 15-min interval, and two overlapping sweeps
// would double the upstream load for no benefit.
let scoreSweepRunning = false;
let bundleSweepRunning = false;
const active = new Set<string>();

interface QueueRow {
  wallet_address: string;
  protocol: string;
  to_address: string;
  methods: string;
  method_names: string;
  direction: string;
  attempts: number;
}

async function drainOnce(): Promise<void> {
  // Yield to interactive traffic first: never steal throttle budget from a
  // live dashboard load (the queue jobs keep their backoff and re-run later).
  if (throttleSaturated()) {
    console.log('[RefreshWorker] throttle saturated by user traffic — deferring drain');
    return;
  }
  let rows: QueueRow[] = [];
  try {
    rows = await query<QueueRow>(
      `SELECT wallet_address, protocol, to_address, methods, method_names, direction, attempts
       FROM bs_refresh_queue
       WHERE next_run <= now()
       ORDER BY priority DESC, next_run ASC
       LIMIT $1`,
      [WORKER_BATCH] as never[]
    );
  } catch (err: any) {
    // Tables may not exist yet on first boot; ensureTables runs on demand.
    console.warn('[RefreshWorker] queue read failed:', err.message || err);
    return;
  }
  if (rows.length === 0) return;

  console.log(`[RefreshWorker] draining ${rows.length} jobs`);
  for (let i = 0; i < rows.length; i += WORKER_CONCURRENCY) {
    const batch = rows.slice(i, i + WORKER_CONCURRENCY);
    await Promise.all(batch.map((row) => runJob(row)));
  }
}

async function runJob(row: QueueRow): Promise<void> {
  // Yield to interactive traffic between jobs too (a long bridge walk
  // occupies a slot for minutes — check before starting each one).
  if (throttleSaturated()) {
    // Leave the job in the queue with its backoff; it re-runs next cycle.
    return;
  }
  const key = `${row.wallet_address}:${row.protocol}`;
  if (active.has(key)) return;
  active.add(key);
  try {
    // Heavy-metric completion jobs: enqueue when a dashboard load times out
    // on bridge/volume/swap/tydro/nado — the walk runs here WITHOUT the
    // request-path timeout pressure (bridge discovery for an active wallet
    // can take minutes), its service caches fill, and the NEXT user load
    // hits warm data.
    // Full-bundle refresh (catch-up worker / warm sweeps): the exact work a
    // user visit would do, off the request path — every metric re-gathers
    // with cursor-resume (delta only) and the complete bundle persists to the
    // snapshot store, so the next visit serves instantly.
    if (row.protocol === 'bundle') {
      if (row.attempts >= BUNDLE_PARK_ATTEMPTS) {
        // Still partial after N passes (usually a dead upstream): park to a
        // 6h cadence instead of tight retries. A later visit/sweep can still
        // complete it earlier; the row is deleted on success.
        await query(
          `UPDATE bs_refresh_queue SET next_run = now() + interval '6 hours'
            WHERE wallet_address = $1 AND protocol = 'bundle'`,
          [row.wallet_address] as never[]
        );
        console.warn(`[RefreshWorker] parked bundle refill for ${row.wallet_address.slice(0, 10)} (attempts=${row.attempts})`);
        return;
      }
      const bundle = await gatherDashboardBundle(row.wallet_address, { fresh: true });
      if (bundle.partial) throw new Error('bundle refresh ended partial — will retry with backoff');
      return;
    }
    if (row.protocol === 'bridge') {
      await getBridgeVolume(row.wallet_address);
    } else if (row.protocol === 'volume') {
      await getTotalVolumeData(row.wallet_address);
    } else if (row.protocol === 'swap') {
      await getSwapVolume(row.wallet_address);
    } else if (row.protocol === 'tydro') {
      await getTydroData(row.wallet_address);
    } else if (row.protocol === 'nado') {
      await getNadoMetrics(row.wallet_address);
    } else if (row.protocol) {
      const methods = row.methods ? row.methods.split(',').filter(Boolean) : [];
      const methodNames = row.method_names ? row.method_names.split(',').filter(Boolean) : [];
      const direction = (row.direction === 'in' || row.direction === 'either' ? row.direction : 'out') as TxDirection;
      await getProtocolCount(row.wallet_address, row.protocol, row.to_address, methods.length > 0 ? methods : null, methodNames, direction);
    } else {
      // Wallet-level refresh: stats + holdings.
      await getWalletStats(row.wallet_address);
      await getTokenHoldingsRaw(row.wallet_address);
    }
    await query('DELETE FROM bs_refresh_queue WHERE wallet_address = $1 AND protocol = $2', [
      row.wallet_address,
      row.protocol,
    ] as never[]);
  } catch (err: any) {
    console.warn(`[RefreshWorker] job failed for ${row.wallet_address.slice(0, 10)} (${row.protocol || 'wallet'}):`, err.message || err);
    const backoffMin = Math.min(60, 5 * (row.attempts + 1));
    await query(
      'UPDATE bs_refresh_queue SET attempts = attempts + 1, next_run = now() + ($1 || \' minutes\')::interval WHERE wallet_address = $2 AND protocol = $3',
      [String(backoffMin), row.wallet_address, row.protocol] as never[]
    ).catch(() => undefined);
  } finally {
    active.delete(key);
  }
}

export function startRefreshWorker(): void {
  if (started) return;
  started = true;
  if (process.env.REFRESH_WORKER === 'off') {
    console.log('[RefreshWorker] disabled via REFRESH_WORKER=off');
    return;
  }
  console.log('[RefreshWorker] started (60s interval, low concurrency)');
  // Warm-on-idle: keep the top active wallets' domain caches fresh so their
  // next dashboard load is instant even after a server restart. Their stats/
  // holdings services are TTL-cached in Postgres, so re-queues that find
  // fresh data cost a DB read, not a Blockscout walk.
  // - Junk wallets (burn address etc.) are skipped — a 55M-tx wallet makes
  //   every walk time out and poisons the shared Blockscout budget.
  // - ON CONFLICT DO NOTHING: never clobber a failing job's backoff
  //   (queueRefresh's upsert resets next_run, which would retry-storm a
  //   wallet whose upstream is down).
  const warmActiveWallets = async (): Promise<void> => {
    if (throttleSaturated()) return;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT ${SNAPSHOT_SWEEP_WALLETS}`
      );
      let enqueued = 0;
      for (const r of rows) {
        const w = (r.wallet_address || '').toLowerCase();
        if (!w || JUNK_WALLETS.has(w)) continue;
        await query(
          `INSERT INTO bs_refresh_queue (wallet_address, protocol, to_address, methods, method_names, direction, priority, next_run, attempts)
           VALUES ($1, '', '', '', '', 'out', 1, now(), 0)
           ON CONFLICT (wallet_address, protocol) DO NOTHING`,
          [w] as never[]
        );
        enqueued++;
      }
      if (enqueued > 0) console.log(`[RefreshWorker] warm sweep: enqueued ${enqueued} active wallets`);
    } catch (err: any) {
      console.warn('[RefreshWorker] warm sweep failed:', err.message || err);
    }
  };
  setTimeout(runBg(warmActiveWallets), 60_000);
  setInterval(runBg(warmActiveWallets), 15 * 60_000);

  // Completeness backstop: wallets whose cursor rows are still truncated get a
  // bundle refill without any user visit. Bounded per sweep and throttle-aware;
  // harmless before the cursor tables exist (warned once, then skipped).
  const sweepIncompleteCursors = async (): Promise<void> => {
    if (throttleSaturated()) return;
    if (INCOMPLETE_SWEEP_LIMIT === 0) return;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT DISTINCT wallet_address FROM (
           SELECT wallet_address FROM bs_tx_discovery WHERE complete = false
           UNION SELECT wallet_address FROM bs_protocol_counts WHERE complete = false
           UNION SELECT wallet_address FROM bs_bridge_inflows WHERE complete = false
           UNION SELECT wallet_address FROM bs_native_volume WHERE done = false
           UNION SELECT wallet_address FROM bs_token_inflow_cursors WHERE complete = false
         ) incomplete
         LIMIT $1`,
        [INCOMPLETE_SWEEP_LIMIT] as never[]
      );
      let enqueued = 0;
      for (const r of rows) {
        const w = (r.wallet_address || '').toLowerCase();
        if (!w || JUNK_WALLETS.has(w)) continue;
        await query(
          `INSERT INTO bs_refresh_queue (wallet_address, protocol, to_address, methods, method_names, direction, priority, next_run, attempts)
           VALUES ($1, 'bundle', '', '', '', 'out', 0, now(), 0)
           ON CONFLICT (wallet_address, protocol) DO NOTHING`,
          [w] as never[]
        );
        enqueued++;
      }
      if (enqueued > 0) console.log(`[RefreshWorker] incomplete sweep: enqueued ${enqueued} bundle refills`);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (/\bdoes not exist\b/i.test(msg)) {
        if (!incompleteSweepWarned) {
          incompleteSweepWarned = true;
          console.warn('[RefreshWorker] incomplete sweep idle (cursor tables not created yet)');
        }
      } else {
        console.warn('[RefreshWorker] incomplete sweep failed:', msg);
      }
    }
  };
  setTimeout(runBg(sweepIncompleteCursors), 180_000);
  setInterval(runBg(sweepIncompleteCursors), INCOMPLETE_SWEEP_INTERVAL_MS);

  // Drift audit: verifies pinned selectors still cover the tracked actions.
  const runRegistryAudit = async (): Promise<void> => {
    if (throttleSaturated()) return;
    try {
      await auditPinnedRegistryDrift();
    } catch (err: any) {
      console.warn('[RefreshWorker] registry audit failed:', err?.message || err);
    }
  };
  setTimeout(runBg(runRegistryAudit), 5 * 60_000);
  setInterval(runBg(runRegistryAudit), REGISTRY_AUDIT_INTERVAL_MS);

  // Backlog hygiene: overdue wallet-level warm-sweep rows are superseded by
  // the next warm sweep (the same wallets re-enqueue every 15 min), so stale
  // copies only consume background budget. Delete them hourly; bundle and
  // count jobs are NEVER touched (they carry real completion work).
  const queueHygiene = async (): Promise<void> => {
    try {
      const removed = await query<{ wallet_address: string }>(
        `DELETE FROM bs_refresh_queue
          WHERE protocol = ''
            AND next_run < now() - interval '30 minutes'
          RETURNING wallet_address`
      );
      if (removed.length > 0) {
        console.log(`[RefreshWorker] queue hygiene: removed ${removed.length} superseded warm-sweep jobs`);
      }
    } catch (err: any) {
      console.warn('[RefreshWorker] queue hygiene failed:', err?.message || err);
    }
  };
  setTimeout(runBg(queueHygiene), 4 * 60_000);
  setInterval(runBg(queueHygiene), 60 * 60_000);

  // Sprint 2: keep the top leaderboard wallets' score snapshots fresh so a
  // cold restart serves their score instantly from wallet_metrics_snapshots
  // (proven identical to a live computation by check-snapshot-parity.mjs).
  // - Strictly SEQUENTIAL: a gather is capped by the same per-service
  //   budgets the score uses, but it still walks shared upstreams — never
  //   compete with itself or flood the Blockscout budget.
  // - Skipped when the existing snapshot is younger than 45 min (traffic
  //   already refreshed it — every live score computation persists its
  //   inputs on the way out).
  // - Junk wallets excluded (the gather would time out everything anyway).
  // - REFRESH_WORKER=off or SCORE_SNAPSHOT_WORKER=off disables it.
  const refreshScoreSnapshots = async (): Promise<void> => {
    if (process.env.SCORE_SNAPSHOT_WORKER === 'off') return;
    if (scoreSweepRunning || throttleSaturated()) return;
    scoreSweepRunning = true;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT ${SNAPSHOT_SWEEP_WALLETS}`
      );
      let refreshed = 0;
      for (const r of rows) {
        const w = (r.wallet_address || '').toLowerCase();
        if (!w || JUNK_WALLETS.has(w)) continue;
        if (throttleSaturated()) break; // users first — resume next sweep
        const age = await getSnapshotAgeMs(w).catch(() => null);
        if (age !== null && age < SNAPSHOT_REFRESH_MIN_AGE_MS) continue;
        try {
          const inputs = await pointsServiceV2.gatherScoreInputs(w);
          await saveScoreSnapshot(w, inputs, inputs.walletStats === null);
          refreshed++;
        } catch (err: any) {
          console.warn(`[RefreshWorker] snapshot gather failed for ${w.slice(0, 10)}:`, err.message || err);
        }
      }
      if (refreshed > 0) console.log(`[RefreshWorker] score snapshots refreshed: ${refreshed}`);
    } catch (err: any) {
      console.warn('[RefreshWorker] score snapshot sweep failed:', err.message || err);
    } finally {
      scoreSweepRunning = false;
    }
  };

  // Sprint 2: same warm treatment for DASHBOARD BUNDLE snapshots — the
  // leaderboard's dashboards load instantly from wallet_dashboard_snapshots
  // even after a restart or cache expiry. Same discipline as the score
  // sweep: strictly sequential, 45-min age gate (traffic-written bundles
  // make most sweeps a no-op), junk wallets excluded. Incomplete bundles
  // are saved with partial=true (never served) and simply retried next sweep.
  const refreshBundleSnapshots = async (): Promise<void> => {
    if (process.env.SCORE_SNAPSHOT_WORKER === 'off') return;
    if (bundleSweepRunning || throttleSaturated()) return;
    bundleSweepRunning = true;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT ${SNAPSHOT_SWEEP_WALLETS}`
      );
      let refreshed = 0;
      for (const r of rows) {
        const w = (r.wallet_address || '').toLowerCase();
        if (!w || JUNK_WALLETS.has(w)) continue;
        if (throttleSaturated()) break; // users first — resume next sweep
        const age = await getBundleSnapshotAgeMs(w).catch(() => null);
        if (age !== null && age < SNAPSHOT_REFRESH_MIN_AGE_MS) continue;
        try {
          const bundle = await gatherDashboardBundle(w);
          await saveBundleSnapshot(w, bundle as unknown as Record<string, unknown>, bundle.partial);
          refreshed++;
        } catch (err: any) {
          console.warn(`[RefreshWorker] bundle gather failed for ${w.slice(0, 10)}:`, err.message || err);
        }
      }
      if (refreshed > 0) console.log(`[RefreshWorker] bundle snapshots refreshed: ${refreshed}`);
    } catch (err: any) {
      console.warn('[RefreshWorker] bundle snapshot sweep failed:', err.message || err);
    } finally {
      bundleSweepRunning = false;
    }
  };
  setTimeout(runBg(refreshBundleSnapshots), 120_000);
  setInterval(runBg(refreshBundleSnapshots), 15 * 60_000);
  setTimeout(runBg(refreshScoreSnapshots), 90_000);
  setInterval(runBg(refreshScoreSnapshots), 15 * 60_000);

  setInterval(runBg(drainOnce), WORKER_INTERVAL_MS);
}
