-- Migration for Volume Enrichment Service
-- Single table for enriched transaction data with USD volume calculations

-- ============================================
-- 1. TRANSACTION ENRICHMENT TABLE
-- ============================================
-- Stores all enrichment data for a transaction in one row
-- Links to transaction_details via tx_hash

CREATE TABLE IF NOT EXISTS transaction_enrichment (
  id SERIAL PRIMARY KEY,
  tx_hash VARCHAR(66) NOT NULL UNIQUE,
  contract_address VARCHAR(42) NOT NULL,  -- For fast filtering by contract
  
  -- ========== ETH VALUES ==========
  eth_value_wei VARCHAR(78),              -- Raw ETH sent with tx (from API value field)
  eth_value_decimal NUMERIC(38,18),       -- ETH as decimal (wei / 10^18)
  eth_price_usd NUMERIC(20,8),            -- ETH price at tx timestamp
  eth_usd_value NUMERIC(20,8),            -- eth_value_decimal × eth_price_usd
  
  -- ========== TOKEN TRANSFERS IN (received by wallet) ==========
  tokens_in_count INTEGER DEFAULT 0,
  tokens_in_raw JSONB,                    -- Array of {token, amount, usd_value}
  tokens_in_usd_total NUMERIC(20,8),      -- Sum of all tokens received in USD
  
  -- ========== TOKEN TRANSFERS OUT (sent by wallet) ==========
  tokens_out_count INTEGER DEFAULT 0,
  tokens_out_raw JSONB,                   -- Array of {token, amount, usd_value}
  tokens_out_usd_total NUMERIC(20,8),     -- Sum of all tokens sent in USD
  
  -- ========== INTERNAL ETH TRANSFERS ==========
  internal_eth_in NUMERIC(38,18),         -- ETH received via internal txs
  internal_eth_in_usd NUMERIC(20,8),
  internal_eth_out NUMERIC(38,18),        -- ETH sent via internal txs  
  internal_eth_out_usd NUMERIC(20,8),
  internal_tx_count INTEGER DEFAULT 0,
  
  -- ========== TOTAL USD VOLUMES ==========
  usd_volume_in NUMERIC(20,8),            -- Total USD sent: eth_usd + tokens_out_usd + internal_eth_out_usd
  usd_volume_out NUMERIC(20,8),           -- Total USD received: tokens_in_usd + internal_eth_in_usd
  total_usd_volume NUMERIC(20,8),         -- Max of (volume_in, volume_out) or sum depending on use case
  
  -- ========== GAS DATA ==========
  gas_used BIGINT,
  gas_price VARCHAR(50),
  gas_limit BIGINT,
  burned_fees VARCHAR(50),
  
  -- ========== L1 FEES (L2 chains) ==========
  l1_gas_price VARCHAR(50),
  l1_gas_used BIGINT,
  l1_fee VARCHAR(50),
  l1_base_fee_scalar INTEGER,
  l1_blob_base_fee VARCHAR(50),
  l1_blob_base_fee_scalar INTEGER,
  
  -- ========== METADATA ==========
  wallet_address VARCHAR(42),             -- The tx initiator (for IN/OUT calculation)
  contract_verified BOOLEAN,
  method_full TEXT,                       -- Full method signature
  
  -- ========== TRACKING ==========
  enriched_at TIMESTAMP DEFAULT NOW(),
  enrichment_source VARCHAR(50) DEFAULT 'routerscan',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- 2. TOKENS TABLE - Registry for price lookups
-- ============================================
CREATE TABLE IF NOT EXISTS tokens (
  id SERIAL PRIMARY KEY,
  address VARCHAR(42) NOT NULL UNIQUE,
  symbol VARCHAR(20),
  name VARCHAR(100),
  decimals INTEGER DEFAULT 18,
  is_stablecoin BOOLEAN DEFAULT FALSE,
  coingecko_id VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Common tokens on Ink Chain (57073)
INSERT INTO tokens (address, symbol, name, decimals, is_stablecoin) VALUES
  ('0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, FALSE),
  ('0x0200C29006150606B650577BBE7B6248F58470c1', 'USDT0', 'USD₮0', 6, TRUE),
  ('0x1217BfE6c773EEC6cc4A38b5Dc45B92292B6E189', 'oUSDT', 'OpenUSDT', 6, TRUE)
ON CONFLICT (address) DO NOTHING;

-- ============================================
-- 3. HISTORICAL PRICES TABLE - Cache
-- ============================================
CREATE TABLE IF NOT EXISTS historical_prices (
  id SERIAL PRIMARY KEY,
  token_address VARCHAR(42) NOT NULL,
  price_usd NUMERIC(20,8) NOT NULL,
  price_date DATE NOT NULL,
  source VARCHAR(50) DEFAULT 'coingecko',
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(token_address, price_date)
);

-- ============================================
-- 4. ENRICHMENT BATCHES TABLE - Progress tracking
-- ============================================
CREATE TABLE IF NOT EXISTS enrichment_batches (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER NOT NULL REFERENCES contracts(id),
  batch_number INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  processed_count INTEGER DEFAULT 0,
  total_count INTEGER NOT NULL,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(contract_id, batch_number)
);

-- ============================================
-- 5. ADD COLUMNS TO CONTRACTS TABLE
-- ============================================
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS enrichment_progress DECIMAL(5,2) DEFAULT 0;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS enrichment_error TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_enriched_at TIMESTAMP;

-- ============================================
-- 6. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_tx_hash ON transaction_enrichment(tx_hash);
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_contract ON transaction_enrichment(contract_address);
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_wallet ON transaction_enrichment(wallet_address);
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_volume_in ON transaction_enrichment(contract_address, usd_volume_in) WHERE usd_volume_in > 0;
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_volume_out ON transaction_enrichment(contract_address, usd_volume_out) WHERE usd_volume_out > 0;
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_total_volume ON transaction_enrichment(contract_address, total_usd_volume) WHERE total_usd_volume > 0;

CREATE INDEX IF NOT EXISTS idx_historical_prices_lookup ON historical_prices(token_address, price_date);
CREATE INDEX IF NOT EXISTS idx_enrichment_batches_status ON enrichment_batches(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_contracts_enrichment ON contracts(enrichment_status) WHERE contract_type = 'volume';

-- ============================================
-- 7. COMMENTS
-- ============================================
COMMENT ON TABLE transaction_enrichment IS 'Enriched transaction data with USD volume calculations';
COMMENT ON COLUMN transaction_enrichment.usd_volume_in IS 'Total USD value sent BY wallet (ETH + tokens out)';
COMMENT ON COLUMN transaction_enrichment.usd_volume_out IS 'Total USD value received BY wallet (tokens in + internal ETH)';
COMMENT ON COLUMN transaction_enrichment.tokens_in_raw IS 'JSONB array: [{address, symbol, amount, decimals, usd_value}]';
COMMENT ON COLUMN transaction_enrichment.tokens_out_raw IS 'JSONB array: [{address, symbol, amount, decimals, usd_value}]';
