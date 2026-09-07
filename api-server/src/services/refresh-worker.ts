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
import { getRecentBlockscoutUsagePerMin, getBlockscoutRateLimit } from './blockscout-service';

// Score-snapshot refresh: only bother when a snapshot is older than 45 min,
// comfortably under SNAPSHOT_MAX_AGE_MS (60 min) — no point re-gathering
// inputs the serve path would still use, and never letting a top wallet's
// snapshot cross the staleness threshold in the first place.
const SNAPSHOT_REFRESH_MIN_AGE_MS = 45 * 60_000;

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

const WORKER_INTERVAL_MS = 60_000;
const WORKER_BATCH = 20;
const WORKER_CONCURRENCY = 2;

// System/junk wallets that must never be walked: the burn address has 55M
// txs — every Blockscout query for it times out and poisons the shared
// request budget for real users.
export const JUNK_WALLETS = new Set([
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0001',
]);

let started = false;
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
          LIMIT 50`
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
  setTimeout(warmActiveWallets, 60_000);
  setInterval(warmActiveWallets, 15 * 60_000);

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
    if (throttleSaturated()) return;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT 50`
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
    if (throttleSaturated()) return;
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT 50`
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
    }
  };
  setTimeout(refreshBundleSnapshots, 120_000);
  setInterval(refreshBundleSnapshots, 15 * 60_000);
  setTimeout(refreshScoreSnapshots, 90_000);
  setInterval(refreshScoreSnapshots, 15 * 60_000);

  setInterval(() => {
    drainOnce().catch((err) => console.error('[RefreshWorker] drain failed:', err.message || err));
  }, WORKER_INTERVAL_MS);
}
