-- Persistent cache for OpenSea buy/sale/mint counts per wallet (Ink chain).
-- Written by api-server/src/services/opensea-service.ts, which also creates
-- this table automatically on first use (CREATE TABLE IF NOT EXISTS).
-- Rows older than 24h are served stale and refreshed in the background.

CREATE TABLE IF NOT EXISTS opensea_wallet_counts (
  wallet_address TEXT PRIMARY KEY,
  buys INTEGER NOT NULL DEFAULT 0,
  sales INTEGER NOT NULL DEFAULT 0,
  mints INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
