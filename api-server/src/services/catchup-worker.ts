// Catch-up worker — warms snapshots for wallets whose users haven't visited.
//
// A user visit ALREADY refreshes a stale wallet live (the dashboard bundle
// path detects staleness and gathers before serving). This worker covers
// everyone else so no dashboard load ever starts from cold data:
//
//   once per cadence per wallet, ONE cheap probe (latest Blockscout tx
//   timestamp, page size 1). If the wallet shows activity newer than its
//   stored snapshot, a 'bundle' refresh job is enqueued on the shared
//   bs_refresh_queue. RefreshWorker drains that queue with cursor-resume
//   (scans only the delta since the last walk) and persists the snapshot —
//   so the next visit is instant instead of a cold gather.
//
// Two cadences:
//   top-N (CATCHUP_TOP_N, default 200) wallets every CATCHUP_TOP_INTERVAL_HOURS (default 6)
//   full board every CATCHUP_INTERVAL_HOURS (default 24)
//
// Env: CATCHUP_WORKER=on enables (default off — dev machines must never
// enqueue against the shared queue). Scheduler ticks every CATCHUP_TICK_MIN
// (default 15) and runs a tier only when its cadence has elapsed. Sweep state
// is in-memory: a restart simply re-probes (probes are cheap by design).
//
// Queue etiquette: catch-up jobs enqueue at priority 0 — strictly BELOW the
// user-triggered jobs (priority 1), so interactive refreshes always win.

import { query } from '../db';
import { getLatestTxTimestamp } from './blockscout-service';
import { JUNK_WALLETS } from './refresh-worker';

const ENABLED = process.env.CATCHUP_WORKER === 'on';
const TICK_MS = parseInt(process.env.CATCHUP_TICK_MIN || '15', 10) * 60_000;
const TOP_N = Math.max(0, parseInt(process.env.CATCHUP_TOP_N || '200', 10));
const TOP_CADENCE_MS = parseInt(process.env.CATCHUP_TOP_INTERVAL_HOURS || '6', 10) * 3_600_000;
const FULL_CADENCE_MS = parseInt(process.env.CATCHUP_INTERVAL_HOURS || '24', 10) * 3_600_000;
const PROBE_CONCURRENCY = Math.max(1, Math.min(16, parseInt(process.env.CATCHUP_PROBE_CONCURRENCY || '6', 10)));

let started = false;
let sweeping = false;
let lastTopSweep = 0;
let lastFullSweep = 0;

async function getBoardWallets(limit?: number): Promise<string[]> {
  const rows = await query<{ wallet: string }>(
    `SELECT lower(entry->>'wallet_address') AS wallet
       FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
      WHERE id = 1
      ORDER BY (entry->>'score')::numeric DESC
      ${limit ? 'LIMIT $1' : ''}`,
    (limit ? [limit] : []) as never[]
  );
  return rows
    .map((r) => (r.wallet || '').toLowerCase())
    .filter((w) => /^0x[0-9a-f]{40}$/.test(w) && !JUNK_WALLETS.has(w));
}

async function sweep(topOnly: boolean): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  const t0 = Date.now();
  try {
    const wallets = await getBoardWallets(topOnly ? TOP_N : undefined);
    const cadenceMs = topOnly ? TOP_CADENCE_MS : FULL_CADENCE_MS;
    const tier = topOnly ? `top-${TOP_N}` : 'full-board';

    const snapRows = await query<{ wallet: string; captured_at: Date }>(
      `SELECT wallet, captured_at FROM wallet_metrics_snapshots WHERE wallet = ANY($1)`,
      [wallets] as never[]
    );
    const captured = new Map<string, number>();
    for (const r of snapRows) captured.set(r.wallet.toLowerCase(), new Date(r.captured_at).getTime());

    const now = Date.now();
    const stale = wallets.filter((w) => {
      const c = captured.get(w);
      return c === undefined || now - c > cadenceMs;
    });
    if (stale.length === 0) {
      console.log(`[Catchup] ${tier} sweep: all ${wallets.length} wallets fresh (cadence ${Math.round(cadenceMs / 3_600_000)}h) — skipping`);
      return;
    }
    console.log(`[Catchup] ${tier} sweep: probing ${stale.length}/${wallets.length} stale wallets (cadence ${Math.round(cadenceMs / 3_600_000)}h)`);

    // One probe per stale wallet, bounded concurrency; the shared Blockscout
    // throttle (bsFetch) applies on top of this.
    let idx = 0;
    let enqueued = 0;
    let quiet = 0;
    let probeFailed = 0;
    const worker = async (): Promise<void> => {
      while (idx < stale.length) {
        const w = stale[idx++];
        const ts = await getLatestTxTimestamp(w);
        if (!ts) {
          probeFailed++;
          continue;
        }
        const capturedMs = captured.get(w) ?? 0;
        // ms-based comparison: Blockscout and Postgres serialize ISO stamps
        // with different sub-second precision — never string-compare them.
        if (Date.parse(ts) > capturedMs) {
          await query(
            `INSERT INTO bs_refresh_queue (wallet_address, protocol, to_address, methods, method_names, direction, priority, next_run, attempts)
             VALUES ($1, 'bundle', '', '', '', 'out', 0, now(), 0)
             ON CONFLICT (wallet_address, protocol) DO NOTHING`,
            [w] as never[]
          );
          enqueued++;
        } else {
          quiet++;
        }
      }
    };
    await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));

    console.log(
      `[Catchup] ${tier} sweep done in ${Math.round((Date.now() - t0) / 1000)}s — probed ${stale.length}, active→enqueued ${enqueued}, quiet ${quiet}, probe-failed ${probeFailed}`
    );
  } catch (err: unknown) {
    console.warn('[Catchup] sweep failed:', (err as Error)?.message || err);
  } finally {
    sweeping = false;
  }
}

export function startCatchupWorker(): void {
  if (started) return;
  started = true;
  if (!ENABLED) {
    console.log('[Catchup] disabled (set CATCHUP_WORKER=on to enable)');
    return;
  }
  console.log(
    `[Catchup] started — top-${TOP_N} every ${Math.round(TOP_CADENCE_MS / 3_600_000)}h, full board every ${Math.round(FULL_CADENCE_MS / 3_600_000)}h, tick ${Math.round(TICK_MS / 60_000)}min, probe conc ${PROBE_CONCURRENCY}`
  );
  // First top sweep shortly after boot (staggered so it never competes with
  // startup traffic); full-board sweep takes its own first pass right after.
  setTimeout(() => {
    lastTopSweep = Date.now();
    void sweep(true);
  }, 90_000);
  setTimeout(() => {
    lastFullSweep = Date.now();
    void sweep(false);
  }, 5 * 60_000);
  setInterval(() => {
    const now = Date.now();
    if (TOP_N > 0 && now - lastTopSweep >= TOP_CADENCE_MS) {
      lastTopSweep = now;
      void sweep(true);
    } else if (now - lastFullSweep >= FULL_CADENCE_MS) {
      lastFullSweep = now;
      void sweep(false);
    }
  }, TICK_MS).unref();
}
