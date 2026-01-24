-- Migration: Add missing columns to transaction_details and volume_transactions for USD volume calculation
-- These columns are needed for complete transaction data capture

-- Add missing columns to transaction_details table
ALTER TABLE transaction_details 
ADD COLUMN IF NOT EXISTS to_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66),
ADD COLUMN IF NOT EXISTS transaction_index INTEGER,
ADD COLUMN IF NOT EXISTS gas_limit VARCHAR(78),
ADD COLUMN IF NOT EXISTS effective_gas_price VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_priority_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS tx_fee_wei VARCHAR(78),
ADD COLUMN IF NOT EXISTS nonce INTEGER,
ADD COLUMN IF NOT EXISTS tx_type INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_contract_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS access_list JSONB;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_txd_to_address ON transaction_details(to_address);
CREATE INDEX IF NOT EXISTS idx_txd_block_hash ON transaction_details(block_hash);
CREATE INDEX IF NOT EXISTS idx_txd_created_contract ON transaction_details(created_contract_address);

-- Add missing columns to volume_transactions table
ALTER TABLE volume_transactions
ADD COLUMN IF NOT EXISTS to_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66),
ADD COLUMN IF NOT EXISTS transaction_index INTEGER,
ADD COLUMN IF NOT EXISTS gas_limit VARCHAR(78),
ADD COLUMN IF NOT EXISTS gas_used VARCHAR(78),
ADD COLUMN IF NOT EXISTS gas_price VARCHAR(78),
ADD COLUMN IF NOT EXISTS effective_gas_price VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_priority_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS tx_fee_wei VARCHAR(78),
ADD COLUMN IF NOT EXISTS nonce INTEGER,
ADD COLUMN IF NOT EXISTS tx_type INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS input_data TEXT,
ADD COLUMN IF NOT EXISTS method_id VARCHAR(10),
ADD COLUMN IF NOT EXISTS created_contract_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS access_list JSONB;

-- Add indexes for volume_transactions
CREATE INDEX IF NOT EXISTS idx_vol_to_address ON volume_transactions(to_address);
CREATE INDEX IF NOT EXISTS idx_vol_method_id ON volume_transactions(method_id);
CREATE INDEX IF NOT EXISTS idx_vol_timestamp ON volume_transactions(block_timestamp);

-- Create transaction_logs table to store all logs for each transaction
CREATE TABLE IF NOT EXISTS transaction_logs (
    id SERIAL PRIMARY KEY,
    tx_hash VARCHAR(66) NOT NULL,
    log_index INTEGER NOT NULL,
    address VARCHAR(42) NOT NULL,
    topic0 VARCHAR(66),
    topic1 VARCHAR(66),
    topic2 VARCHAR(66),
    topic3 VARCHAR(66),
    data TEXT,
    removed BOOLEAN DEFAULT FALSE,
    block_number INTEGER NOT NULL,
    chain_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tx_hash, log_index, chain_id)
);

-- Indexes for transaction_logs
CREATE INDEX IF NOT EXISTS idx_txlogs_tx ON transaction_logs(tx_hash);
CREATE INDEX IF NOT EXISTS idx_txlogs_address ON transaction_logs(address);
CREATE INDEX IF NOT EXISTS idx_txlogs_topic0 ON transaction_logs(topic0);
CREATE INDEX IF NOT EXISTS idx_txlogs_block ON transaction_logs(block_number);

-- Add comment explaining the schema
COMMENT ON TABLE transaction_logs IS 'Stores all event logs from transactions for complete asset tracking and USD volume calculation';
COMMENT ON COLUMN volume_transactions.tx_fee_wei IS 'Transaction fee in wei (gas_used * effective_gas_price)';
COMMENT ON COLUMN volume_transactions.method_id IS 'First 4 bytes of input_data (function selector)';
