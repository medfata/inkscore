-- ============================================================
-- Staking points (off-chain) — persist-on-unstake model
--
-- One row per settled stake cycle: an NFT staked and later unstaked,
-- verified server-side against the staking contract's Staked/Unstaked
-- event logs before insertion. Points accrue in the UI from chain
-- timestamps but are only WRITTEN here at unstake time.
--
--   1 Day = 5 pts · 1 Week = 15 pts · 1 Month = 50 pts (per NFT)
--
-- Banked total for a wallet = SUM(points_settled) WHERE wallet_address = ?
-- ============================================================

CREATE TABLE IF NOT EXISTS staking_points (
  id             BIGSERIAL     PRIMARY KEY,
  wallet_address CHAR(42)      NOT NULL,          -- lowercased depositor
  token_id       INTEGER       NOT NULL,          -- 1..888
  lock_period    SMALLINT      NOT NULL,          -- 0=1D 1=1W 2=1M
  staked_at      TIMESTAMPTZ   NOT NULL,          -- from Staked event (stake tx receipt)
  unlock_at      TIMESTAMPTZ   NOT NULL,          -- from Staked event (stake tx receipt)
  unstaked_at    TIMESTAMPTZ,                     -- set when settled (NULL = open anchor)
  points_award   NUMERIC(12,2) NOT NULL,          -- plan award snapshot (5/15/50)
  points_settled NUMERIC(12,2) NOT NULL DEFAULT 0,-- credited at unstake (full; prorated only for admin emergency unstake)
  tx_hash        CHAR(66),                        -- stake tx (audit)
  settled_at     TIMESTAMPTZ,                     -- when the row was settled
  -- Idempotency: a (token, stake) cycle can only ever be anchored once.
  -- Replayed anchor requests no-op on conflict.
  UNIQUE (token_id, staked_at)
);

CREATE INDEX IF NOT EXISTS idx_staking_points_wallet ON staking_points (wallet_address);
