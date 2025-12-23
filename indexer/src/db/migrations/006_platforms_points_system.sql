-- ============================================================================
-- Migration 006: Platforms & Points System
-- ============================================================================
-- This migration introduces:
-- 1. Platforms (third-party dApps like Velodrome, Tydro, etc.)
-- 2. Dynamic contract management (replaces static config.ts)
-- 3. Token discovery from transaction logs
-- 4. Points system with admin-defined rules
-- 5. Ranking system based on total points
--
-- IMPORTANT: All existing indexed data is preserved!
-- ============================================================================

-- ============================================================================
-- PART 1: PLATFORMS & CONTRACTS
-- ============================================================================

-- Platforms table (third-party dApps)
CREATE TABLE IF NOT EXISTS platforms (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,           -- 'velodrome', 'tydro', 'inkyswap'
  name VARCHAR(100) NOT NULL,                 -- 'Velodrome Finance'
  description TEXT,
  logo_url VARCHAR(500),
  website_url VARCHAR(255),
  platform_type VARCHAR(30) NOT NULL,         -- 'dex', 'defi', 'bridge', 'social', 'launchpad', 'nft'
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Contracts table (replaces static CONTRACTS_TO_INDEX in config.ts)
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  deploy_block BIGINT NOT NULL DEFAULT 0,
  fetch_transactions BOOLEAN DEFAULT true,   -- true = use Routerscan API, false = use RPC events
  
  -- Indexing status (visible in admin dashboard)
  indexing_enabled BOOLEAN DEFAULT true,
  indexing_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'indexing', 'complete', 'paused', 'error'
  current_block BIGINT DEFAULT 0,
  total_blocks BIGINT DEFAULT 0,
  progress_percent NUMERIC(5, 2) DEFAULT 0,
  last_indexed_at TIMESTAMP,
  error_message TEXT,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Platform-Contract junction table (M:N - contracts can belong to multiple platforms)
CREATE TABLE IF NOT EXISTS platform_contracts (
  id SERIAL PRIMARY KEY,
  platform_id INT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  contract_id INT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(platform_id, contract_id)
);

-- Indexes for platforms & contracts
CREATE INDEX IF NOT EXISTS idx_platforms_type ON platforms(platform_type);
CREATE INDEX IF NOT EXISTS idx_platforms_active ON platforms(is_active);
CREATE INDEX IF NOT EXISTS idx_contracts_address ON contracts(address);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(indexing_status);
CREATE INDEX IF NOT EXISTS idx_platform_contracts_platform ON platform_contracts(platform_id);
CREATE INDEX IF NOT EXISTS idx_platform_contracts_contract ON platform_contracts(contract_id);

-- ============================================================================
-- PART 2: TOKEN DISCOVERY
-- ============================================================================

-- Auto-discovered tokens from transaction logs
CREATE TABLE IF NOT EXISTS discovered_tokens (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) UNIQUE NOT NULL,
  
  -- Token info (from Routerscan logs or RPC)
  name VARCHAR(100),
  symbol VARCHAR(20),
  decimals INT DEFAULT 18,
  icon_url VARCHAR(500),
  tags TEXT[],                                -- ['staking', 'wrapped_token', 'bridged_token']
  
  -- Price info
  is_stablecoin BOOLEAN DEFAULT false,
  is_native_wrapper BOOLEAN DEFAULT false,    -- true for WETH
  coingecko_id VARCHAR(50),
  dexscreener_pair_address VARCHAR(42),
  last_price_usd NUMERIC(20, 8),
  price_source VARCHAR(20),                   -- 'coingecko', 'dexscreener', 'hardcoded'
  price_updated_at TIMESTAMP,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  discovered_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovered_tokens_symbol ON discovered_tokens(symbol);
CREATE INDEX IF NOT EXISTS idx_discovered_tokens_stablecoin ON discovered_tokens(is_stablecoin);

-- ============================================================================
-- PART 3: ENHANCED TRANSACTION DATA
-- ============================================================================

-- Add USD value columns to existing transaction_details (non-breaking)
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS total_usd_value NUMERIC(20, 2);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS eth_price_at_tx NUMERIC(20, 2);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS primary_token_address VARCHAR(42);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS primary_token_amount NUMERIC(38, 18);

-- Token transfers extracted from transaction logs
CREATE TABLE IF NOT EXISTS transaction_token_transfers (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL,
  log_index INT NOT NULL,
  
  -- Token info
  token_address VARCHAR(42) NOT NULL,
  token_name VARCHAR(100),
  token_symbol VARCHAR(20),
  token_decimals INT DEFAULT 18,
  token_icon VARCHAR(500),
  
  -- Transfer details
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount_raw VARCHAR(78) NOT NULL,            -- Raw amount as string (can be very large)
  amount_decimal NUMERIC(38, 18),             -- Parsed with decimals
  
  -- USD value (calculated at index time)
  usd_value NUMERIC(20, 2),
  price_used NUMERIC(20, 8),
  
  -- Event info
  event_type VARCHAR(50),                     -- 'Transfer', 'Exchange', 'Swap', 'Deposit', 'Withdrawal'
  
  -- Metadata
  block_number BIGINT,
  block_timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_ttt_tx_hash ON transaction_token_transfers(tx_hash);
CREATE INDEX IF NOT EXISTS idx_ttt_from ON transaction_token_transfers(from_address);
CREATE INDEX IF NOT EXISTS idx_ttt_to ON transaction_token_transfers(to_address);
CREATE INDEX IF NOT EXISTS idx_ttt_token ON transaction_token_transfers(token_address);
CREATE INDEX IF NOT EXISTS idx_ttt_block ON transaction_token_transfers(block_number);

-- ============================================================================
-- PART 4: NATIVE METRICS
-- ============================================================================

-- Native metrics (built-in, always available, fetched from Routerscan API)
CREATE TABLE IF NOT EXISTS native_metrics (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,            -- 'wallet_age', 'nft_collections', 'erc20_tokens', 'total_tx'
  name VARCHAR(100) NOT NULL,
  description TEXT,
  value_type VARCHAR(20) NOT NULL,            -- 'count', 'days', 'usd'
  icon VARCHAR(50),
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed native metrics
INSERT INTO native_metrics (key, name, description, value_type, icon, display_order) VALUES
  ('wallet_age', 'Wallet Age', 'Days since first transaction on Ink chain', 'days', 'calendar', 1),
  ('total_tx', 'Total Transactions', 'Total number of transactions on Ink chain', 'count', 'activity', 2),
  ('nft_collections', 'NFT Holdings', 'Number of NFTs held', 'count', 'image', 3),
  ('erc20_tokens', 'Token Holdings', 'Total USD value of ERC-20 tokens held', 'usd', 'coins', 4)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- PART 5: POINTS SYSTEM
-- ============================================================================

-- Points rules (admin-defined scoring rules)
CREATE TABLE IF NOT EXISTS points_rules (
  id SERIAL PRIMARY KEY,
  
  -- What this rule applies to
  metric_type VARCHAR(20) NOT NULL,           -- 'platform' or 'native'
  platform_id INT REFERENCES platforms(id) ON DELETE CASCADE,  -- For platform metrics
  native_metric_id INT REFERENCES native_metrics(id) ON DELETE CASCADE,  -- For native metrics
  
  -- Rule configuration
  name VARCHAR(100) NOT NULL,
  description TEXT,
  calculation_mode VARCHAR(20) NOT NULL,      -- 'range' or 'multiplier'
  ranges JSONB NOT NULL DEFAULT '[]',         -- [{min: 1, max: 10, points: 100}, ...]
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure either platform_id or native_metric_id is set
  CONSTRAINT check_metric_reference CHECK (
    (metric_type = 'platform' AND platform_id IS NOT NULL AND native_metric_id IS NULL) OR
    (metric_type = 'native' AND native_metric_id IS NOT NULL AND platform_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_points_rules_platform ON points_rules(platform_id);
CREATE INDEX IF NOT EXISTS idx_points_rules_native ON points_rules(native_metric_id);
CREATE INDEX IF NOT EXISTS idx_points_rules_active ON points_rules(is_active);

-- ============================================================================
-- PART 6: RANKING SYSTEM
-- ============================================================================

-- Ranks (admin-defined tiers based on total points)
CREATE TABLE IF NOT EXISTS ranks (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,                  -- 'Ink Legend', 'Power User', etc.
  min_points INT NOT NULL,
  max_points INT,                             -- NULL = unlimited (top tier)
  logo_url VARCHAR(500),
  color VARCHAR(20),                          -- '#FFD700' for gold, etc.
  description TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed default ranks
INSERT INTO ranks (name, min_points, max_points, color, display_order) VALUES
  ('New User', 0, 99, '#6B7280', 1),
  ('Active User', 100, 499, '#10B981', 2),
  ('Power User', 500, 1999, '#3B82F6', 3),
  ('OG Member', 2000, 4999, '#8B5CF6', 4),
  ('Ink Legend', 5000, NULL, '#F59E0B', 5)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PART 7: WALLET POINTS CACHE
-- ============================================================================

-- Pre-computed wallet scores (updated by indexer job)
CREATE TABLE IF NOT EXISTS wallet_points_cache (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) UNIQUE NOT NULL,
  
  -- Total score
  total_points INT DEFAULT 0,
  rank_id INT REFERENCES ranks(id),
  
  -- Breakdown by category (for dashboard display)
  breakdown JSONB DEFAULT '{}',
  /*
  Example breakdown:
  {
    "native": {
      "wallet_age": { "value": 45, "points": 200 },
      "nft_collections": { "value": 12, "points": 300 },
      "erc20_tokens": { "value": 1500.50, "points": 300 },
      "total_tx": { "value": 250, "points": 150 }
    },
    "platforms": {
      "velodrome": { "tx_count": 25, "usd_volume": 5000, "points": 400 },
      "tydro": { "tx_count": 10, "usd_volume": 2000, "points": 200 }
    }
  }
  */
  
  -- Metadata
  last_calculated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wpc_wallet ON wallet_points_cache(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wpc_points ON wallet_points_cache(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_wpc_rank ON wallet_points_cache(rank_id);

-- ============================================================================
-- PART 8: MIGRATE EXISTING DATA
-- ============================================================================

-- Migrate contracts_metadata to platforms + contracts
-- Step 1: Create platforms from categories
INSERT INTO platforms (slug, name, platform_type, is_active)
SELECT DISTINCT 
  LOWER(REPLACE(category, ' ', '_')),
  INITCAP(category),
  CASE category
    WHEN 'dex' THEN 'dex'
    WHEN 'defi' THEN 'defi'
    WHEN 'bridge' THEN 'bridge'
    WHEN 'social' THEN 'social'
    WHEN 'launchpad' THEN 'launchpad'
    ELSE 'other'
  END,
  true
FROM contracts_metadata
WHERE category IS NOT NULL
ON CONFLICT (slug) DO NOTHING;

-- Step 2: Create contracts from contracts_metadata
INSERT INTO contracts (address, name, deploy_block, fetch_transactions, indexing_status, is_active)
SELECT 
  cm.address,
  cm.name,
  COALESCE(
    (SELECT MIN(range_start) FROM indexer_ranges WHERE contract_address = cm.address),
    (SELECT deploy_block FROM indexer_cursors WHERE contract_address = cm.address),
    0
  ),
  true,
  CASE 
    WHEN EXISTS (SELECT 1 FROM indexer_ranges WHERE contract_address = cm.address AND is_complete = true)
    THEN 'complete'
    WHEN EXISTS (SELECT 1 FROM indexer_ranges WHERE contract_address = cm.address)
    THEN 'indexing'
    ELSE 'pending'
  END,
  cm.is_active
FROM contracts_metadata cm
ON CONFLICT (address) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = EXCLUDED.is_active;

-- Step 3: Link contracts to platforms
INSERT INTO platform_contracts (platform_id, contract_id)
SELECT p.id, c.id
FROM contracts_metadata cm
JOIN platforms p ON LOWER(REPLACE(cm.category, ' ', '_')) = p.slug
JOIN contracts c ON cm.address = c.address
WHERE cm.category IS NOT NULL
ON CONFLICT (platform_id, contract_id) DO NOTHING;

-- Step 4: Update contract indexing progress from existing cursors
UPDATE contracts c SET
  current_block = COALESCE(
    (SELECT MAX(current_block) FROM indexer_ranges WHERE contract_address = c.address),
    (SELECT last_indexed_block FROM indexer_cursors WHERE contract_address = c.address),
    0
  ),
  total_blocks = COALESCE(
    (SELECT MAX(range_end) FROM indexer_ranges WHERE contract_address = c.address),
    0
  ),
  progress_percent = CASE 
    WHEN (SELECT MAX(range_end) FROM indexer_ranges WHERE contract_address = c.address) > 0
    THEN ROUND(
      (SELECT MAX(current_block)::NUMERIC FROM indexer_ranges WHERE contract_address = c.address) / 
      (SELECT MAX(range_end)::NUMERIC FROM indexer_ranges WHERE contract_address = c.address) * 100, 2
    )
    ELSE 0
  END;

-- ============================================================================
-- PART 9: SEED KNOWN TOKENS
-- ============================================================================

INSERT INTO discovered_tokens (address, name, symbol, decimals, is_stablecoin, is_native_wrapper, coingecko_id, icon_url) VALUES
  -- Native/Wrapped
  ('0x4200000000000000000000000000000000000006', 'Wrapped Ether', 'WETH', 18, false, true, 'ethereum', 'https://cms-cdn.avascan.com/cms2/Wrapped Ether.b659cc6de243.png'),
  -- Stablecoins
  ('0x0200c29006150606b650577bbe7b6248f58470c1', 'Tether USD', 'USDT0', 6, true, false, 'tether', NULL),
  ('0x2d270e6886d130d724215a266106e6832161eaed', 'USD Coin', 'USDC0', 6, true, false, 'usd-coin', NULL),
  ('0xeb466342c4d449bc9f53a865d5cb90586f405215', 'Axelar USDC', 'axlUSDC', 6, true, false, 'usd-coin', NULL),
  ('0xe343167631d89b6ffc58b88d6b7fb0228795491d', 'Global Dollar', 'USDGLO', 18, true, false, NULL, NULL),
  -- Staking
  ('0x11476323d8dfcbafac942588e2f38823d2dd308e', 'Ink Staked ETH', 'iETH', 18, false, false, NULL, 'https://cms-cdn.avascan.com/cms2/iETH.f4df945b363c.svg')
ON CONFLICT (address) DO UPDATE SET
  name = EXCLUDED.name,
  symbol = EXCLUDED.symbol,
  decimals = EXCLUDED.decimals,
  is_stablecoin = EXCLUDED.is_stablecoin,
  is_native_wrapper = EXCLUDED.is_native_wrapper,
  coingecko_id = EXCLUDED.coingecko_id;

-- ============================================================================
-- DONE
-- ============================================================================
