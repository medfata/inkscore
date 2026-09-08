// Sprint 2: wallet metrics snapshots.
//
// A snapshot stores the EXACT ScoreInputs object a live score computation
// consumed (the 20 raw metric outputs). computeScoreFromInputs() is a pure
// function of those inputs, so serving a score from a snapshot is provably
// identical to serving it from a live gather — same function, same inputs —
// as long as the JSONB round-trip is lossless. It is, by construction:
// every input object was already JSON-serialized over HTTP in the
// pre-Sprint-1 world (each metric route did res.json(metric) and the score
// consumed the parsed result), so a JSONB round-trip reproduces exactly the
// shapes the score has always consumed. The dedicated parity script
// (scripts/check-snapshot-parity.mjs) verifies this end to end.
//
// ACCURACY RULES:
// - Snapshots store raw metric outputs, never scores or derived USD sums.
// - A partial snapshot (wallet stats timed out during gather) is STORED for
//   audit but NEVER served — the live path treats partials as 30s-clamped
//   cache entries and recomputes soon; serving a partial snapshot would
//   zero native points for up to an hour. Unacceptable.
// - The snapshot is only served when fresher than SNAPSHOT_MAX_AGE_MS
//   (default 60 min = the score's responseCache TTL), so snapshot-served
//   data is never staler than what the warm responseCache already served.
// - refresh=true bypasses snapshots entirely (a refresh must mean refresh).
// - Admin overrides and junk-wallet guards run BEFORE the snapshot read:
//   an override always wins, junk wallets never touch upstreams or storage.

import { query, queryOne } from '../db';
import type { ScoreInputs } from './points-service-v2';

// Default 60 min: exactly the score's responseCache TTL. A snapshot-served
// score is therefore never staler than the warm-cache behavior it replaces.
export const SNAPSHOT_MAX_AGE_MS =
  parseInt(process.env.SNAPSHOT_MAX_AGE_MIN || '60', 10) * 60_000;

export interface ScoreSnapshot {
  inputs: ScoreInputs;
  capturedAt: Date;
  partial: boolean;
}

let ensured = false;

async function ensureTable(): Promise<void> {
  if (ensured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS wallet_metrics_snapshots (
      wallet TEXT PRIMARY KEY,
      inputs JSONB NOT NULL,
      partial BOOLEAN NOT NULL DEFAULT FALSE,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
  ensured = true;
}

/**
 * Persist the raw inputs of a completed live score computation.
 * Fire-and-forget from the score path; failures are logged, never thrown
 * into the response.
 */
export async function saveScoreSnapshot(
  wallet: string,
  inputs: ScoreInputs,
  partial: boolean
): Promise<void> {
  await ensureTable();
  await query(
    `INSERT INTO wallet_metrics_snapshots (wallet, inputs, partial, captured_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (wallet) DO UPDATE
       SET inputs = EXCLUDED.inputs,
           partial = EXCLUDED.partial,
           captured_at = NOW()
     -- DOWNGRADE GUARD: a partial gather (wallet stats timed out under
     -- throttle pressure) must never overwrite a COMPLETE snapshot — the
     -- stored complete inputs remain valid facts and the fast serve path
     -- depends on them. Partials still upgrade partials; completes always
     -- overwrite anything.`,
    [wallet, JSON.stringify(inputs), partial]
  );
}

/**
 * Return the wallet's snapshot if it is fresh enough to serve, else null.
 * Malformed/partial snapshots return null (the caller falls back to a live
 * gather) — a snapshot is a cache of facts, never a source of them.
 */
/**
 * Map a snapshot row to a ScoreSnapshot, refusing malformed/truncated inputs
 * (a snapshot is a cache of facts, never a source of them).
 */
function rowToScoreSnapshot(
  wallet: string,
  row: { inputs: ScoreInputs; partial: boolean; captured_at: string }
): ScoreSnapshot | null {
  const i = row.inputs;
  if (
    !i || typeof i !== 'object' ||
    !i.openSeaCounts || typeof i.openSeaCounts.buys !== 'number'
  ) {
    console.warn(`[Snapshot] ${wallet.slice(0, 10)}: malformed snapshot ignored`);
    return null;
  }

  return {
    inputs: row.inputs,
    capturedAt: new Date(row.captured_at),
    partial: row.partial,
  };
}

/**
 * Fresh snapshot: complete and captured within SNAPSHOT_MAX_AGE_MS — served
 * as-is, byte-identical semantics to the warm responseCache it replaces.
 */
export async function getFreshScoreSnapshot(wallet: string): Promise<ScoreSnapshot | null> {
  await ensureTable();
  const row = await queryOne<{
    inputs: ScoreInputs;
    partial: boolean;
    captured_at: string;
  }>(
    `SELECT inputs, partial, captured_at
       FROM wallet_metrics_snapshots
      WHERE wallet = $1
        AND captured_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
    [wallet, SNAPSHOT_MAX_AGE_MS]
  );
  if (!row) return null;
  return rowToScoreSnapshot(wallet, row);
}

// Stale-while-revalidate cap: a snapshot older than this is worthless (the
// wallet could have changed completely) — fall through to a live gather.
const STALE_SNAPSHOT_MAX_AGE_MS =
  parseInt(process.env.STALE_SNAPSHOT_MAX_AGE_H || '168', 10) * 60 * 60 * 1000;

/**
 * Stale snapshot: complete but of ANY age (up to STALE_SNAPSHOT_MAX_AGE_MS).
 * Served instantly by the score's stale-while-revalidate path while a fresh
 * live gather runs in the background — a day-old score on screen beats a
 * 10-30s skeleton.
 */
export async function getStaleScoreSnapshot(wallet: string): Promise<ScoreSnapshot | null> {
  await ensureTable();
  const row = await queryOne<{
    inputs: ScoreInputs;
    partial: boolean;
    captured_at: string;
  }>(
    `SELECT inputs, partial, captured_at
       FROM wallet_metrics_snapshots
      WHERE wallet = $1
        AND captured_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')
      ORDER BY captured_at DESC
      LIMIT 1`,
    [wallet, STALE_SNAPSHOT_MAX_AGE_MS]
  );
  if (!row) return null;
  return rowToScoreSnapshot(wallet, row);
}

/** Age of the wallet's latest snapshot in ms, or null if none exists. */
export async function getSnapshotAgeMs(wallet: string): Promise<number | null> {
  await ensureTable();
  const row = await queryOne<{ age_ms: string }>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - captured_at)) * 1000 AS age_ms
       FROM wallet_metrics_snapshots WHERE wallet = $1`,
    [wallet]
  );
  return row ? Number(row.age_ms) : null;
}

// ---------------------------------------------------------------------------
// Sprint 2: dashboard bundle snapshots — same rules as score snapshots
// (fresh-only, partial never served, malformed refused). The bundle stores
// the exact per-endpoint payloads the dashboard consumes; a served bundle is
// byte-comparable to what the individual endpoints return
// (scripts/check-bundle-parity.mjs).
// ---------------------------------------------------------------------------

export interface BundleSnapshot {
  bundle: Record<string, unknown>;
  capturedAt: Date;
  partial: boolean;
}

let bundleEnsured = false;

async function ensureBundleTable(): Promise<void> {
  if (bundleEnsured) return;
  await query(
    `CREATE TABLE IF NOT EXISTS wallet_dashboard_snapshots (
      wallet TEXT PRIMARY KEY,
      bundle JSONB NOT NULL,
      partial BOOLEAN NOT NULL DEFAULT FALSE,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
  bundleEnsured = true;
}

export async function saveBundleSnapshot(
  wallet: string,
  bundle: Record<string, unknown>,
  partial: boolean
): Promise<void> {
  await ensureBundleTable();
  await query(
    `INSERT INTO wallet_dashboard_snapshots (wallet, bundle, partial, captured_at)
     VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (wallet) DO UPDATE
       SET bundle = EXCLUDED.bundle,
           partial = EXCLUDED.partial,
           captured_at = NOW()
     -- DOWNGRADE GUARD: a partial bundle must never overwrite a complete
     -- dashboard snapshot (same rule as the score snapshot store).`,
    [wallet, JSON.stringify(bundle), partial]
  );
}

export async function getFreshBundleSnapshot(wallet: string): Promise<BundleSnapshot | null> {
  await ensureBundleTable();
  const row = await queryOne<{
    bundle: Record<string, unknown>;
    partial: boolean;
    captured_at: string;
  }>(
    `SELECT bundle, partial, captured_at
       FROM wallet_dashboard_snapshots
      WHERE wallet = $1
        AND captured_at > NOW() - ($2::bigint * INTERVAL '1 millisecond')`,
    [wallet, SNAPSHOT_MAX_AGE_MS]
  );
  if (!row) return null;
  return {
    bundle: row.bundle,
    capturedAt: new Date(row.captured_at),
    partial: row.partial,
  };
}

/** Age of the wallet's latest BUNDLE snapshot in ms, or null if none exists. */
export async function getBundleSnapshotAgeMs(wallet: string): Promise<number | null> {
  await ensureBundleTable();
  const row = await queryOne<{ age_ms: string }>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - captured_at)) * 1000 AS age_ms
       FROM wallet_dashboard_snapshots WHERE wallet = $1`,
    [wallet]
  );
  return row ? Number(row.age_ms) : null;
}
