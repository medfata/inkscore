import { describe, expect, it } from 'vitest';
import {
  DURATION_MATCH_TOLERANCE_SEC,
  accruedFraction,
  accruedPoints,
  awardForLock,
  awardForPeriod,
  round2,
} from '../staking-points';

const DAY = 86_400;
const WEEK = 604_800;
const MONTH = 2_592_000;

describe('awardForPeriod', () => {
  it('maps the contract LockPeriod enum to plan awards', () => {
    expect(awardForPeriod(0)).toBe(5);
    expect(awardForPeriod(1)).toBe(15);
    expect(awardForPeriod(2)).toBe(50);
  });

  it('returns null for unknown periods instead of guessing', () => {
    expect(awardForPeriod(3)).toBeNull();
    expect(awardForPeriod(-1)).toBeNull();
    expect(awardForPeriod(255)).toBeNull();
  });
});

describe('awardForLock', () => {
  it('derives the award from the on-chain lock duration', () => {
    expect(awardForLock(1000, 1000 + DAY)).toBe(5);
    expect(awardForLock(1000, 1000 + WEEK)).toBe(15);
    expect(awardForLock(1000, 1000 + MONTH)).toBe(50);
  });

  it('tolerates small clock drift around known durations', () => {
    expect(awardForLock(1000, 1000 + DAY + 30)).toBe(5);
    expect(awardForLock(1000, 1000 + DAY - DURATION_MATCH_TOLERANCE_SEC + 1)).toBe(5);
  });

  it('returns null for durations that match no plan', () => {
    expect(awardForLock(1000, 1000 + 100_000)).toBeNull();
  });

  it('returns null for invalid windows', () => {
    expect(awardForLock(2000, 1000)).toBeNull();
    expect(awardForLock(1000, 1000)).toBeNull();
  });
});

describe('accruedFraction', () => {
  it('is linear over the lock window', () => {
    expect(accruedFraction(0, DAY, DAY / 4)).toBeCloseTo(0.25);
    expect(accruedFraction(0, DAY, DAY / 2)).toBeCloseTo(0.5);
    expect(accruedFraction(0, DAY, (DAY * 3) / 4)).toBeCloseTo(0.75);
  });

  it('clamps at 0 before the stake starts', () => {
    expect(accruedFraction(1000, 1000 + DAY, 500)).toBe(0);
  });

  it('caps at 1 from unlockAt onward (plan-end cap)', () => {
    expect(accruedFraction(0, DAY, DAY)).toBe(1);
    expect(accruedFraction(0, DAY, DAY * 30)).toBe(1);
  });

  it('returns 0 for degenerate windows', () => {
    expect(accruedFraction(1000, 1000, 1000)).toBe(0);
    expect(accruedFraction(2000, 1000, 1500)).toBe(0);
  });
});

describe('accruedPoints', () => {
  it('accrues proportionally per plan', () => {
    expect(accruedPoints(0, DAY, DAY / 2, 5)).toBeCloseTo(2.5);
    expect(accruedPoints(0, WEEK, WEEK / 3, 15)).toBeCloseTo(5);
    expect(accruedPoints(0, MONTH, MONTH / 10, 50)).toBeCloseTo(5);
  });

  it('completes exactly at unlock and stays there', () => {
    expect(accruedPoints(0, DAY, DAY, 5)).toBe(5);
    expect(accruedPoints(0, MONTH, MONTH * 2, 50)).toBe(50);
  });

  it('is 0 before the stake starts', () => {
    expect(accruedPoints(1000, 1000 + DAY, 999, 5)).toBe(0);
  });
});

describe('round2', () => {
  it('rounds to the DB column precision', () => {
    expect(round2(5 / 3)).toBe(1.67);
    expect(round2(2.5)).toBe(2.5);
    expect(round2(0.005)).toBe(0.01);
  });
});
