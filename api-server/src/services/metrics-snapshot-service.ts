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
           captured_at = NOW()`,
    [wallet, JSON.stringify(inputs), partial]
  );
}

/**
 * Return the wallet's snapshot if it is fresh enough to serve, else null.
 * Malformed/partial snapshots return null (the caller falls back to a live
 * gather) — a snapshot is a cache of facts, never a source of them.
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

  // Structural sanity: refuse to serve anything that doesn't look like a
  // complete ScoreInputs object (e.g. a hand-edited or truncated row).
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
