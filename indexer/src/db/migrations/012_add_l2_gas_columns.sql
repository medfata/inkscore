-- Migration: Add missing columns to transaction_details for complete RPC data capture
-- Run with: psql $DATABASE_URL -f indexer/src/db/migrations/012_add_l2_gas_columns.sql

-- Add missing transaction fields
ALTER TABLE transaction_details 
ADD COLUMN IF NOT EXISTS to_address VARCHAR(42),
ADD COLUMN IF NOT EXISTS block_hash VARCHAR(66),
ADD COLUMN IF NOT EXISTS transaction_index INTEGER,
ADD COLUMN IF NOT EXISTS gas_limit VARCHAR(78),
ADD COLUMN IF NOT EXISTS effective_gas_price VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS max_priority_fee_per_gas VARCHAR(78),
ADD COLUMN IF NOT EXISTS tx_fee_wei VARCHAR(78),
ADD COLUMN IF NOT EXISTS burned_fees VARCHAR(78),
ADD COLUMN IF NOT EXISTS nonce INTEGER,
ADD COLUMN IF NOT EXISTS tx_type INTEGER DEFAULT 0;

-- Add L2 gas fields (Optimism/Ink chain)
ALTER TABLE transaction_details 
ADD COLUMN IF NOT EXISTS l1_gas_price VARCHAR(78),
ADD COLUMN IF NOT EXISTS l1_gas_used VARCHAR(78),
ADD COLUMN IF NOT EXISTS l1_fee VARCHAR(78),
ADD COLUMN IF NOT EXISTS l1_base_fee_scalar VARCHAR(78),
ADD COLUMN IF NOT EXISTS l1_blob_base_fee VARCHAR(78),
ADD COLUMN IF NOT EXISTS l1_blob_base_fee_scalar VARCHAR(78);
