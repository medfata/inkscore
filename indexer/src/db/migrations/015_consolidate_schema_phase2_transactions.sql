-- ============================================================================
-- Migration 015: Schema Consolidation Phase 2 - Transaction Models
-- ============================================================================
-- This migration consolidates transaction-related tables, keeping only
-- transaction_details as the main transaction table.
--
-- ANALYSIS:
-- - transaction_details ✅ (Main - 66 columns, complete data)
-- - transactions ❌ (Basic - 11 columns, redundant)
-- - volume_transactions ❌ (27 columns, duplicate of transaction_details)
-- - benchmark_transactions ❌ (18 columns, testing/benchmark data)
--
-- STRATEGY:
-- 1. Migrate any unique data from other tables to transaction_details
-- 2. Verify data integrity
-- 3. Mark old tables for deletion in Phase 4
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Analyze data overlap
-- ============================================================================

-- Create temporary analysis table to understand data overlap
CREATE TEMP TABLE tx_analysis AS
SELECT 
  'transaction_details' as source_table,
  COUNT(*) as tx_count,
  MIN(block_number) as min_block,
  MAX(block_number) as max_block,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT contract_address) as unique_contracts
FROM transaction_details
UNION ALL
SELECT 
  'transactions' as source_table,
  COUNT(*) as tx_count,
  MIN(block_number) as min_block,
  MAX(block_number) as max_block,
  COUNT(DISTINCT from_address) as unique_wallets,
  COUNT(DISTINCT contract_address) as unique_contracts
FROM transactions
UNION ALL
SELECT 
  'volume_transactions' as source_table,
  COUNT(*) as tx_count,
  MIN(block_number) as min_block,
  MAX(block_number) as max_block,
  COUNT(DISTINCT from_address) as unique_wallets,
  COUNT(DISTINCT contract_address) as unique_contracts
FROM volume_transactions
UNION ALL
SELECT 
  'benchmark_transactions' as source_table,
  COUNT(*) as tx_count,
  MIN(block_number) as min_block,
  MAX(block_number) as max_block,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT contract_address) as unique_contracts
FROM benchmark_transactions;

-- Log the analysis
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE 'Transaction table analysis:';
  FOR rec IN SELECT * FROM tx_analysis ORDER BY source_table LOOP
    RAISE NOTICE '  %: % txs, blocks %-%, % wallets, % contracts', 
      rec.source_table, rec.tx_count, rec.min_block, rec.max_block, 
      rec.unique_wallets, rec.unique_contracts;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Migrate unique data from transactions table
-- ============================================================================

-- Check for transactions that exist in 'transactions' but not in 'transaction_details'
INSERT INTO transaction_details (
  tx_hash, wallet_address, contract_address, to_address, 
  block_number, block_timestamp, status, chain_id, created_at
)
SELECT 
  t.tx_hash,
  t.from_address as wallet_address,
  t.contract_address,
  t.to_address,
  t.block_number,
  t.block_timestamp,
  t.status,
  t.chain_id,
  t.created_at
FROM transactions t
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_details td 
  WHERE td.tx_hash = t.tx_hash
)
ON CONFLICT (tx_hash) DO NOTHING;

-- ============================================================================
-- STEP 3: Migrate unique data from volume_transactions table
-- ============================================================================

-- Check for transactions that exist in 'volume_transactions' but not in 'transaction_details'
-- Note: volume_transactions has more complete data than transaction_details in some cases
INSERT INTO transaction_details (
  tx_hash, wallet_address, contract_address, to_address, eth_value,
  block_number, block_hash, block_timestamp, transaction_index,
  gas_limit, gas_used, gas_price, effective_gas_price, 
  max_fee_per_gas, max_priority_fee_per_gas, tx_fee_wei,
  nonce, tx_type, status, chain_id, input_data, 
  created_contract_address, access_list, created_at
)
SELECT 
  vt.tx_hash,
  vt.from_address as wallet_address,
  vt.contract_address,
  vt.to_address,
  vt.eth_value,
  vt.block_number,
  vt.block_hash,
  vt.block_timestamp,
  vt.transaction_index,
  vt.gas_limit,
  vt.gas_used,
  vt.gas_price,
  vt.effective_gas_price,
  vt.max_fee_per_gas,
  vt.max_priority_fee_per_gas,
  vt.tx_fee_wei,
  vt.nonce,
  vt.tx_type,
  vt.status,
  vt.chain_id,
  vt.input_data,
  vt.created_contract_address,
  vt.access_list,
  vt.created_at
FROM volume_transactions vt
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_details td 
  WHERE td.tx_hash = vt.tx_hash
)
ON CONFLICT (tx_hash) DO NOTHING;

-- Update existing transaction_details with more complete data from volume_transactions
-- where volume_transactions has data that transaction_details is missing
UPDATE transaction_details td SET
  block_hash = COALESCE(td.block_hash, vt.block_hash),
  transaction_index = COALESCE(td.transaction_index, vt.transaction_index),
  gas_limit = COALESCE(td.gas_limit, vt.gas_limit),
  max_fee_per_gas = COALESCE(td.max_fee_per_gas, vt.max_fee_per_gas),
  max_priority_fee_per_gas = COALESCE(td.max_priority_fee_per_gas, vt.max_priority_fee_per_gas),
  nonce = COALESCE(td.nonce, vt.nonce),
  tx_type = COALESCE(td.tx_type, vt.tx_type),
  input_data = COALESCE(td.input_data, vt.input_data),
  created_contract_address = COALESCE(td.created_contract_address, vt.created_contract_address),
  access_list = COALESCE(td.access_list, vt.access_list)
FROM volume_transactions vt
WHERE td.tx_hash = vt.tx_hash
  AND (
    td.block_hash IS NULL OR td.transaction_index IS NULL OR 
    td.gas_limit IS NULL OR td.input_data IS NULL
  );

-- ============================================================================
-- STEP 4: Migrate unique data from benchmark_transactions table
-- ============================================================================

-- benchmark_transactions is used for testing/benchmarking
-- We'll preserve this data by migrating it to transaction_details
INSERT INTO transaction_details (
  tx_hash, wallet_address, contract_address, to_address, eth_value,
  block_number, block_hash, block_timestamp, transaction_index,
  gas_used, gas_price, effective_gas_price, tx_fee_wei,
  status, chain_id, created_at
)
SELECT 
  bt.tx_hash,
  bt.wallet_address,
  bt.contract_address,
  bt.to_address,
  bt.eth_value,
  bt.block_number,
  bt.block_hash,
  bt.block_timestamp,
  bt.transaction_index,
  bt.gas_used,
  bt.gas_price,
  bt.effective_gas_price,
  bt.tx_fee_wei,
  bt.status,
  bt.chain_id,
  bt.created_at
FROM benchmark_transactions bt
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_details td 
  WHERE td.tx_hash = bt.tx_hash
)
ON CONFLICT (tx_hash) DO NOTHING;

-- ============================================================================
-- STEP 5: Add missing indexes to transaction_details
-- ============================================================================

-- Ensure transaction_details has all necessary indexes for performance
CREATE INDEX IF NOT EXISTS idx_td_chain_id ON transaction_details(chain_id);
CREATE INDEX IF NOT EXISTS idx_td_tx_type ON transaction_details(tx_type);
CREATE INDEX IF NOT EXISTS idx_td_nonce ON transaction_details(nonce);
CREATE INDEX IF NOT EXISTS idx_td_gas_limit ON transaction_details(gas_limit);

-- ============================================================================
-- STEP 6: Create views for backward compatibility (temporary)
-- ============================================================================

-- Create a view that mimics the old 'transactions' table structure
-- This allows existing code to continue working during the transition
CREATE OR REPLACE VIEW transactions_view AS
SELECT 
  ROW_NUMBER() OVER (ORDER BY block_number, tx_hash) as id,
  chain_id,
  tx_hash,
  block_number,
  block_timestamp,
  contract_address,
  wallet_address as from_address,
  to_address,
  SUBSTRING(input_data, 1, 10) as method_id,
  status,
  created_at
FROM transaction_details;

-- Create a view that mimics the old 'volume_transactions' table structure
CREATE OR REPLACE VIEW volume_transactions_view AS
SELECT 
  ROW_NUMBER() OVER (ORDER BY block_number, tx_hash) as id,
  chain_id,
  tx_hash,
  block_number,
  block_hash,
  block_timestamp,
  transaction_index,
  wallet_address as from_address,
  to_address,
  contract_address,
  created_contract_address as created_contract,
  eth_value,
  gas_limit,
  gas_used,
  gas_price,
  effective_gas_price,
  max_fee_per_gas,
  max_priority_fee_per_gas,
  nonce,
  tx_type,
  status,
  input_data,
  SUBSTRING(input_data, 1, 10) as method_id,
  created_at,
  tx_fee_wei,
  created_contract_address,
  access_list
FROM transaction_details;

-- ============================================================================
-- STEP 7: Verify data integrity
-- ============================================================================

-- Final analysis after migration
CREATE TEMP TABLE tx_analysis_final AS
SELECT 
  'transaction_details_final' as source_table,
  COUNT(*) as tx_count,
  MIN(block_number) as min_block,
  MAX(block_number) as max_block,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT contract_address) as unique_contracts
FROM transaction_details;

-- Log the final results
DO $$
DECLARE
  rec RECORD;
  initial_count INTEGER;
  final_count INTEGER;
BEGIN
  SELECT tx_count INTO initial_count FROM tx_analysis WHERE source_table = 'transaction_details';
  SELECT tx_count INTO final_count FROM tx_analysis_final;
  
  RAISE NOTICE 'Transaction consolidation completed:';
  RAISE NOTICE '  Initial transaction_details count: %', initial_count;
  RAISE NOTICE '  Final transaction_details count: %', final_count;
  RAISE NOTICE '  Net transactions added: %', (final_count - initial_count);
  
  FOR rec IN SELECT * FROM tx_analysis_final LOOP
    RAISE NOTICE '  Final stats: % txs, blocks %-%, % wallets, % contracts', 
      rec.tx_count, rec.min_block, rec.max_block, 
      rec.unique_wallets, rec.unique_contracts;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 8: Mark old tables for deletion
-- ============================================================================

-- Add comments to mark these tables for deletion in Phase 4
COMMENT ON TABLE transactions IS 'DEPRECATED: Consolidated into transaction_details. Will be dropped in Phase 4.';
COMMENT ON TABLE volume_transactions IS 'DEPRECATED: Consolidated into transaction_details. Will be dropped in Phase 4.';
COMMENT ON TABLE benchmark_transactions IS 'DEPRECATED: Consolidated into transaction_details. Will be dropped in Phase 4.';

COMMIT;

-- ============================================================================
-- NOTES FOR NEXT PHASE:
-- ============================================================================
-- After this migration is applied and tested:
-- 1. Update all services to use transaction_details instead of other tx tables
-- 2. Update any queries that reference transactions, volume_transactions, benchmark_transactions
-- 3. Test thoroughly with the compatibility views
-- 4. Then run Phase 3 migration to consolidate indexer cursors
-- ============================================================================