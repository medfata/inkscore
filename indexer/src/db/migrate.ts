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

-- Wallet interactions (main analytics table)
CREATE TABLE IF NOT EXISTS wallet_interactions (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL,
  contract_address VARCHAR(42) NOT NULL,
  function_selector VARCHAR(10) NOT NULL,
  function_name VARCHAR(100),
  tx_hash VARCHAR(66) NOT NULL,
  block_number BIGINT NOT NULL,
  block_timestamp TIMESTAMP NOT NULL,
  chain_id INT NOT NULL,
  status SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tx_hash, wallet_address, contract_address)
);

-- Add status column if missing (migration for existing tables)
ALTER TABLE wallet_interactions ADD COLUMN IF NOT EXISTS status SMALLINT DEFAULT 1;

-- Update existing index to include status for better query performance
-- This index covers: (wallet, contract, status), (wallet, contract), and (wallet) queries
DROP INDEX IF EXISTS idx_wallet_contract;
CREATE INDEX idx_wallet_contract ON wallet_interactions(wallet_address, contract_address, status);

-- Index for queries that filter by contract + status (platform stats, unique wallets)
CREATE INDEX IF NOT EXISTS idx_contract_status 
ON wallet_interactions(contract_address, status);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_wallet_contract 
ON wallet_interactions(wallet_address, contract_address);

CREATE INDEX IF NOT EXISTS idx_wallet_contract_fn 
ON wallet_interactions(wallet_address, contract_address, function_selector);

CREATE INDEX IF NOT EXISTS idx_contract_block 
ON wallet_interactions(contract_address, block_number);

-- Transaction details for contracts without events (routers, proxies)
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

CREATE INDEX IF NOT EXISTS idx_txdetails_wallet 
ON transaction_details(wallet_address);

CREATE INDEX IF NOT EXISTS idx_txdetails_contract 
ON transaction_details(contract_address);

CREATE INDEX IF NOT EXISTS idx_txdetails_wallet_contract 
ON transaction_details(wallet_address, contract_address);

-- Update indexes to include status for better query performance
DROP INDEX IF EXISTS idx_txdetails_wallet_contract;
CREATE INDEX idx_txdetails_wallet_contract 
ON transaction_details(wallet_address, contract_address, status);

CREATE INDEX IF NOT EXISTS idx_txdetails_contract_status 
ON transaction_details(contract_address, status);
`;

async function migrate() {
  console.log('Running migrations...');
  await pool.query(migrations);
  console.log('Migrations complete!');
  await pool.end();
}

migrate().catch(console.error);
