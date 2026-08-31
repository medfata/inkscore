/**
 * Staking points — shared, isomorphic accrual math.
 *
 * Points accrue linearly over a Zenith stake's lock period and complete
 * exactly when the lock releases (contract-enforced: unstake reverts before
 * unlock, so a settled unstake always earns the full award):
 *
 *   1 Day = 5 pts · 1 Week = 15 pts · 1 Month = 50 pts (per NFT)
 *
 * Points are only PERSISTED at unstake time (verified server-side against
 * the contract's Staked/Unstaked event logs — see
 * lib/services/staking-points-service.ts). Everything else — the live
 * accumulating counter on the NFT card and the header total — is derived
 * on the client with the exact same formula exported here, keeping the UI
 * and the settle math on a single source of truth.
 */

import { STAKING_DURATIONS } from './staking-contract';

export type LockPeriodIndex = 0 | 1 | 2;

/** Points awarded per NFT, keyed by the contract's LockPeriod enum value. */
export const STAKING_POINTS_AWARDS: Record<LockPeriodIndex, number> = {
  0: 5,
  1: 15,
  2: 50,
};

/**
 * Tolerance (seconds) when matching an on-chain lock duration
 * (unlockAt - stakedAt) back to a known plan. Mirrors the 60s tolerance
 * used by the staking page's durationLabelFor().
 */
export const DURATION_MATCH_TOLERANCE_SEC = 60;

/** Award for a raw LockPeriod enum value — null when the period is unknown. */
export function awardForPeriod(period: number): number | null {
  if (period !== 0 && period !== 1 && period !== 2) return null;
  return STAKING_POINTS_AWARDS[period];
}

/**
 * Award for an on-chain position derived from its exact lock duration.
 * Returns null when the duration doesn't match any known plan (the
 * accumulator simply isn't rendered rather than guessing an award).
 */
export function awardForLock(stakedAtSec: number, unlockAtSec: number): number | null {
  const duration = unlockAtSec - stakedAtSec;
  if (!(duration > 0)) return null;
  const match = STAKING_DURATIONS.find(
    (d) => Math.abs(d.seconds - duration) < DURATION_MATCH_TOLERANCE_SEC
  );
  return match ? STAKING_POINTS_AWARDS[match.index] : null;
}

/**
 * Fraction (0..1) of the lock period that has elapsed at `nowSec`.
 * Clamps at both ends: 0 before staking, 1 from unlockAt onward — points
 * cap at the plan's award once the lock completes, even if the NFT stays
 * staked longer.
 */
export function accruedFraction(
  stakedAtSec: number,
  unlockAtSec: number,
  nowSec: number
): number {
  if (!(unlockAtSec > stakedAtSec)) return 0;
  const clampedNow = Math.min(Math.max(nowSec, stakedAtSec), unlockAtSec);
  return (clampedNow - stakedAtSec) / (unlockAtSec - stakedAtSec);
}

/** Points accrued at `nowSec` for a position with the given award. */
export function accruedPoints(
  stakedAtSec: number,
  unlockAtSec: number,
  nowSec: number,
  award: number
): number {
  return award * accruedFraction(stakedAtSec, unlockAtSec, nowSec);
}

/** Round to 2 decimals (the DB column precision for points_settled). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
