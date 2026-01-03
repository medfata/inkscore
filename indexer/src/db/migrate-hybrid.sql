-- Migration for Hybrid Indexing Strategy
-- Adds new columns and tables for backfill tracking

-- Add new columns to contracts table for hybrid indexing
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_type VARCHAR(20) DEFAULT 'count' CHECK (contract_type IN ('count', 'volume'));
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS creation_date TIMESTAMP;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS backfill_status VARCHAR(20) DEFAULT 'pending' CHECK (backfill_status IN ('pending', 'in_progress', 'completed', 'failed'));
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS backfill_progress DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_transactions BIGINT DEFAULT 0;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS indexed_transactions BIGINT DEFAULT 0;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS enrichment_status VARCHAR(20) DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'in_progress', 'completed', 'failed'));
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS enrichment_progress DECIMAL(5,2) DEFAULT 0.00;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS last_backfill_date TIMESTAMP;

-- Create backfill batches tracking table
CREATE TABLE IF NOT EXISTS backfill_batches (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL,
  from_date TIMESTAMP NOT NULL,
  to_date TIMESTAMP,
  transaction_count INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  export_id VARCHAR(100),
  csv_file_path TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE(contract_id, batch_number)
);

-- Create job queue table for background processing
CREATE TABLE IF NOT EXISTS job_queue (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL, -- 'backfill', 'enrich', 'realtime_sync'
  contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 5, -- 1 = highest, 10 = lowest
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload JSONB,
  error_message TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  next_retry_at TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_contracts_backfill_status ON contracts(backfill_status);
CREATE INDEX IF NOT EXISTS idx_contracts_contract_type ON contracts(contract_type);
CREATE INDEX IF NOT EXISTS idx_backfill_batches_contract_status ON backfill_batches(contract_id, status);
CREATE INDEX IF NOT EXISTS idx_job_queue_status_priority ON job_queue(status, priority);
CREATE INDEX IF NOT EXISTS idx_job_queue_next_retry ON job_queue(next_retry_at) WHERE status = 'failed';

-- Add transaction_details indexes for enrichment queries
CREATE INDEX IF NOT EXISTS idx_transaction_details_contract_enrichment ON transaction_details(contract_address, total_usd_value) WHERE total_usd_value IS NULL;
CREATE INDEX IF NOT EXISTS idx_transaction_details_block_timestamp ON transaction_details(block_timestamp);

-- Add updated_at column to transaction_details for UPSERT operations
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS to_address VARCHAR(42);

-- Add volume enrichment columns for volume contracts
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS total_usd_value DECIMAL(20,8);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS eth_price_at_tx DECIMAL(10,2);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS token_amounts JSONB;
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMP;
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS value_in_eth DECIMAL(20,18);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS value_out_eth DECIMAL(20,18);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS txn_fee_eth DECIMAL(20,18);
ALTER TABLE transaction_details ADD COLUMN IF NOT EXISTS txn_fee_usd DECIMAL(20,8);

-- Update existing contracts to have default values
UPDATE contracts SET 
  contract_type = 'count',
  backfill_status = 'completed',
  backfill_progress = 100.00
WHERE backfill_status IS NULL;

COMMENT ON TABLE backfill_batches IS 'Tracks CSV export batches for historical data backfill';
COMMENT ON TABLE job_queue IS 'Background job queue for indexing operations';
COMMENT ON COLUMN contracts.contract_type IS 'Type of contract: count (simple counting) or volume (requires enrichment)';
COMMENT ON COLUMN contracts.creation_date IS 'When the contract was deployed (for backfill start date)';
COMMENT ON COLUMN contracts.backfill_status IS 'Status of historical data backfill process';
COMMENT ON COLUMN contracts.enrichment_status IS 'Status of volume data enrichment process';