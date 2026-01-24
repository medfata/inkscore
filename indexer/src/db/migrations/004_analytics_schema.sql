-- Analytics Schema Migration
-- Run this against your ink_analytics database

-- 1. Contracts Metadata (stores info about indexed contracts)
CREATE TABLE IF NOT EXISTS contracts_metadata (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  website_url VARCHAR(255),
  logo_url VARCHAR(255),
  category VARCHAR(50), -- 'bridge', 'dex', 'defi', 'social', 'launchpad'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Analytics Metrics (admin-defined metrics)
CREATE TABLE IF NOT EXISTS analytics_metrics (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  aggregation_type VARCHAR(20) NOT NULL, -- 'sum_eth_value', 'count', 'count_by_function'
  value_field VARCHAR(50),
  currency VARCHAR(10) DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  icon VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. Metric -> Contracts mapping
CREATE TABLE IF NOT EXISTS analytics_metric_contracts (
  id SERIAL PRIMARY KEY,
  metric_id INT REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  contract_address VARCHAR(42) NOT NULL,
  include_mode VARCHAR(10) DEFAULT 'include',
  UNIQUE(metric_id, contract_address)
);

-- 4. Metric -> Functions mapping
CREATE TABLE IF NOT EXISTS analytics_metric_functions (
  id SERIAL PRIMARY KEY,
  metric_id INT REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  function_name VARCHAR(100) NOT NULL,
  function_selector VARCHAR(10),
  include_mode VARCHAR(10) DEFAULT 'include',
  UNIQUE(metric_id, function_name)
);

-- 5. User Analytics Cache (pre-computed per-user per-metric)
CREATE TABLE IF NOT EXISTS user_analytics_cache (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  metric_id INT REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  
  total_count BIGINT DEFAULT 0,
  total_eth_value NUMERIC(30, 18) DEFAULT 0,
  total_usd_value NUMERIC(20, 2) DEFAULT 0,
  
  -- Sub-aggregates by contract and function
  sub_aggregates JSONB DEFAULT '{}',
  
  last_block_processed BIGINT DEFAULT 0,
  last_tx_hash VARCHAR(66),
  last_updated TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(wallet_address, metric_id)
);

-- 6. ETH Prices (hourly for USD conversion)
CREATE TABLE IF NOT EXISTS eth_prices (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL,
  price_usd NUMERIC(18, 2) NOT NULL,
  source VARCHAR(50) DEFAULT 'coingecko',
  UNIQUE(timestamp)
);

-- 7. Sync cursor per metric
CREATE TABLE IF NOT EXISTS analytics_sync_cursors (
  id SERIAL PRIMARY KEY,
  metric_id INT REFERENCES analytics_metrics(id) ON DELETE CASCADE UNIQUE,
  last_block_processed BIGINT DEFAULT 0,
  last_sync_at TIMESTAMP,
  is_syncing BOOLEAN DEFAULT false
);

-- Indexes for user_analytics_cache
CREATE INDEX IF NOT EXISTS idx_uac_wallet ON user_analytics_cache(wallet_address);
CREATE INDEX IF NOT EXISTS idx_uac_metric ON user_analytics_cache(metric_id);
CREATE INDEX IF NOT EXISTS idx_uac_wallet_metric ON user_analytics_cache(wallet_address, metric_id);

-- Indexes for wallet_interactions (if not exist)
CREATE INDEX IF NOT EXISTS idx_wi_wallet_contract ON wallet_interactions(wallet_address, contract_address);
CREATE INDEX IF NOT EXISTS idx_wi_block ON wallet_interactions(block_number);
CREATE INDEX IF NOT EXISTS idx_wi_function ON wallet_interactions(function_name);
CREATE INDEX IF NOT EXISTS idx_wi_contract_function ON wallet_interactions(contract_address, function_name);

-- Indexes for transaction_details (if not exist)
CREATE INDEX IF NOT EXISTS idx_td_wallet_contract ON transaction_details(wallet_address, contract_address);
CREATE INDEX IF NOT EXISTS idx_td_block ON transaction_details(block_number);
CREATE INDEX IF NOT EXISTS idx_td_contract_function ON transaction_details(contract_address, function_name);

-- Index for eth_prices
CREATE INDEX IF NOT EXISTS idx_eth_prices_timestamp ON eth_prices(timestamp DESC);

-- Seed contracts_metadata from existing data
INSERT INTO contracts_metadata (address, name, category)
SELECT DISTINCT 
  contract_address,
  CASE contract_address
    WHEN '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f' THEN 'DailyGM'
    WHEN '0x9b17690de96fcfa80a3acaefe11d936629cd7a77' THEN 'DyorRouterV2'
    WHEN '0x01d40099fcd87c018969b0e8d4ab1633fb34763c' THEN 'Velodrome UniversalRouter'
    WHEN '0x1d74317d760f2c72a94386f50e8d10f2c902b899' THEN 'InkyPump'
    WHEN '0x4cd00e387622c35bddb9b4c962c136462338bc31' THEN 'RelayDepository'
    WHEN '0xd7e72f3615aa65b92a4dbdc211e296a35512988b' THEN 'Unknown Contract 1'
    WHEN '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2' THEN 'Tydro WrappedTokenGateway'
    WHEN '0x7cfe8aa0d8e92ccbbdfb12b95aeb7a54ec40f0f5' THEN 'Unknown Contract 2'
    WHEN '0x2a37d63eadfe4b4682a3c28c1c2cd4f109cc2762' THEN 'GasZipV2'
    WHEN '0x551134e92e537ceaa217c2ef63210af3ce96a065' THEN 'InkySwap UniversalRouter'
    WHEN '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5' THEN 'Unknown Contract 3'
    WHEN '0xbd6a027b85fd5285b1623563bbef6fadbe396afb' THEN 'Unknown Contract 4'
    ELSE 'Unknown'
  END,
  CASE contract_address
    WHEN '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f' THEN 'social'
    WHEN '0x9b17690de96fcfa80a3acaefe11d936629cd7a77' THEN 'dex'
    WHEN '0x01d40099fcd87c018969b0e8d4ab1633fb34763c' THEN 'dex'
    WHEN '0x1d74317d760f2c72a94386f50e8d10f2c902b899' THEN 'launchpad'
    WHEN '0x4cd00e387622c35bddb9b4c962c136462338bc31' THEN 'bridge'
    WHEN '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2' THEN 'defi'
    WHEN '0x2a37d63eadfe4b4682a3c28c1c2cd4f109cc2762' THEN 'bridge'
    WHEN '0x551134e92e537ceaa217c2ef63210af3ce96a065' THEN 'dex'
    ELSE NULL
  END
FROM wallet_interactions
ON CONFLICT (address) DO NOTHING;

-- Update website URLs
UPDATE contracts_metadata SET website_url = 'https://gm.ink' WHERE address = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';
UPDATE contracts_metadata SET website_url = 'https://dyorswap.finance' WHERE address = '0x9b17690de96fcfa80a3acaefe11d936629cd7a77';
UPDATE contracts_metadata SET website_url = 'https://velodrome.finance' WHERE address = '0x01d40099fcd87c018969b0e8d4ab1633fb34763c';
UPDATE contracts_metadata SET website_url = 'https://inkypump.com' WHERE address = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
UPDATE contracts_metadata SET website_url = 'https://relay.link' WHERE address = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
UPDATE contracts_metadata SET website_url = 'https://app.tydro.com' WHERE address = '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2';
UPDATE contracts_metadata SET website_url = 'https://gas.zip' WHERE address = '0x2a37d63eadfe4b4682a3c28c1c2cd4f109cc2762';
UPDATE contracts_metadata SET website_url = 'https://inkyswap.com' WHERE address = '0x551134e92e537ceaa217c2ef63210af3ce96a065';
