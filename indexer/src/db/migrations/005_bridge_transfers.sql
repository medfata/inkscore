-- Bridge Transfers Schema Migration
-- Tracks incoming bridge transfers from bridge platform hot wallets to users on Ink chain

-- Bridge transfers table
CREATE TABLE IF NOT EXISTS bridge_transfers (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  from_address VARCHAR(42) NOT NULL, -- Bridge hot wallet address
  to_address VARCHAR(42) NOT NULL,   -- User wallet address (recipient)
  platform VARCHAR(50) NOT NULL,      -- Bridge platform name (Owlto, Orbiter, etc.)
  sub_platform VARCHAR(50),           -- Sub-platform (e.g., 'Ink Official' vs 'Relay')
  method_selector VARCHAR(10),        -- Function selector from tx input
  eth_value NUMERIC(30, 18) NOT NULL, -- Amount in ETH
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMP NOT NULL,
  chain_id INT DEFAULT 57073,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tx_hash, to_address)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_bt_to_address ON bridge_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_bt_from_address ON bridge_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_bt_platform ON bridge_transfers(platform);
CREATE INDEX IF NOT EXISTS idx_bt_block ON bridge_transfers(block_number);
CREATE INDEX IF NOT EXISTS idx_bt_to_platform ON bridge_transfers(to_address, platform);

-- Bridge sync cursor (tracks indexing progress per hot wallet)
CREATE TABLE IF NOT EXISTS bridge_sync_cursors (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  platform VARCHAR(50) NOT NULL,
  last_block_processed BIGINT DEFAULT 0,
  last_sync_at TIMESTAMP,
  is_syncing BOOLEAN DEFAULT false
);

-- User bridge volume cache (pre-computed totals per user)
CREATE TABLE IF NOT EXISTS user_bridge_volume (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  total_eth_value NUMERIC(30, 18) DEFAULT 0,
  total_usd_value NUMERIC(20, 2) DEFAULT 0,
  tx_count INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(wallet_address, platform)
);

CREATE INDEX IF NOT EXISTS idx_ubv_wallet ON user_bridge_volume(wallet_address);
CREATE INDEX IF NOT EXISTS idx_ubv_platform ON user_bridge_volume(platform);
