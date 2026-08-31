-- ============================================================
-- Staking points v2 — anchor-at-stake / settle-at-unstake.
--
-- An OPEN row (unstaked_at IS NULL) is the verified position anchor,
-- created from the stake tx receipt. Settling writes unstaked_at +
-- points_settled. Banked total = SUM(points_settled) for closed rows.
--
-- (v1 assumed unstake-time event-log verification; the deployed staking
-- contract never emits Unstaked, so settlement is receipt/state based now.)
-- ============================================================

ALTER TABLE staking_points ALTER COLUMN unstaked_at DROP NOT NULL;
ALTER TABLE staking_points ALTER COLUMN settled_at DROP NOT NULL;
ALTER TABLE staking_points ALTER COLUMN settled_at DROP DEFAULT;
