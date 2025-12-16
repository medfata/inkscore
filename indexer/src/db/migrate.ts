import { pool } from './index.js';

const migrations = `
-- Indexer cursor tracking
CREATE TABLE IF NOT EXISTS indexer_cursors (
  contract_address VARCHAR(42) PRIMARY KEY,
  chain_id INT NOT NULL,
  last_indexed_block BIGINT NOT NULL,
  deploy_block BIGINT NOT NULL,
  is_backfill_complete BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
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
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tx_hash, wallet_address, contract_address)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_wallet_contract 
ON wallet_interactions(wallet_address, contract_address);

CREATE INDEX IF NOT EXISTS idx_wallet_contract_fn 
ON wallet_interactions(wallet_address, contract_address, function_selector);

CREATE INDEX IF NOT EXISTS idx_contract_block 
ON wallet_interactions(contract_address, block_number);
`;

async function migrate() {
  console.log('Running migrations...');
  await pool.query(migrations);
  console.log('Migrations complete!');
  await pool.end();
}

migrate().catch(console.error);
