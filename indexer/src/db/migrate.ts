import 'dotenv/config';
import { pool } from './index.js';

const migrations = `
-- Indexer cursor tracking (legacy, kept for compatibility)
CREATE TABLE IF NOT EXISTS indexer_cursors (
  contract_address VARCHAR(42) PRIMARY KEY,
  chain_id INT NOT NULL,
  last_indexed_block BIGINT NOT NULL,
  deploy_block BIGINT NOT NULL,
  is_backfill_complete BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Parallel range tracking for fast backfill
CREATE TABLE IF NOT EXISTS indexer_ranges (
  id SERIAL PRIMARY KEY,
  contract_address VARCHAR(42) NOT NULL,
  chain_id INT NOT NULL,
  range_start BIGINT NOT NULL,
  range_end BIGINT NOT NULL,
  current_block BIGINT NOT NULL,
  is_complete BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(contract_address, range_start, range_end)
);

-- Transaction details - single source of truth for all transaction data
CREATE TABLE IF NOT EXISTS transaction_details (
  tx_hash VARCHAR(66) PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  contract_address VARCHAR(42) NOT NULL,
  function_selector VARCHAR(10),
  function_name VARCHAR(100),
  input_data TEXT,
  eth_value VARCHAR(78) NOT NULL DEFAULT '0',
  gas_used BIGINT,
  gas_price VARCHAR(78),
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMP NOT NULL,
  status SMALLINT DEFAULT 1,
  chain_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Optimized indexes for transaction_details (supports both count and volume queries)
CREATE INDEX IF NOT EXISTS idx_td_wallet_contract_status 
ON transaction_details(wallet_address, contract_address, status);

CREATE INDEX IF NOT EXISTS idx_td_contract_status 
ON transaction_details(contract_address, status);

CREATE INDEX IF NOT EXISTS idx_td_wallet_contract_function 
ON transaction_details(wallet_address, contract_address, function_selector);

CREATE INDEX IF NOT EXISTS idx_td_contract_block 
ON transaction_details(contract_address, block_number);

CREATE INDEX IF NOT EXISTS idx_td_function_name 
ON transaction_details(function_name) WHERE function_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_td_contract_function_name 
ON transaction_details(contract_address, function_name) WHERE function_name IS NOT NULL;
`;

async function migrate() {
  console.log('Running migrations...');
  await pool.query(migrations);
  console.log('Migrations complete!');
  await pool.end();
}

migrate().catch(console.error);
