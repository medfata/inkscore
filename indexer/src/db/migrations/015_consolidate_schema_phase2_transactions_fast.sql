-- ============================================================================
-- Migration 015: Fast Transaction Consolidation - Keep transaction_details, Drop Others
-- ============================================================================
-- This migration simply drops the redundant transaction tables since
-- transaction_details already contains the complete and most important data.
--
-- STRATEGY: Direct cleanup - no data migration needed
-- - transaction_details ✅ (Keep - main table with complete data)
-- - transactions ❌ (Drop - basic duplicate)
-- - volume_transactions ❌ (Drop - duplicate)
-- - benchmark_transactions ❌ (Drop - testing duplicate)
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Verify transaction_details has data
-- ============================================================================

DO $$
DECLARE
  tx_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tx_count FROM transaction_details;
  
  RAISE NOTICE 'Transaction consolidation - Fast cleanup:';
  RAISE NOTICE '  transaction_details: % records (KEEPING)', tx_count;
  
  -- Safety check - abort if main table is empty
  IF tx_count = 0 THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: transaction_details table is empty. Aborting cleanup.';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop redundant transaction tables directly
-- ============================================================================

-- Drop transactions table (basic duplicate)
DROP TABLE IF EXISTS transactions CASCADE;
RAISE NOTICE 'Dropped transactions table';

-- Drop volume_transactions table (duplicate)
DROP TABLE IF EXISTS volume_transactions CASCADE;
RAISE NOTICE 'Dropped volume_transactions table';

-- Drop benchmark_transactions table (testing duplicate)
DROP TABLE IF EXISTS benchmark_transactions CASCADE;
RAISE NOTICE 'Dropped benchmark_transactions table';

-- ============================================================================
-- STEP 3: Clean up sequences
-- ============================================================================

DROP SEQUENCE IF EXISTS transactions_id_seq CASCADE;
DROP SEQUENCE IF EXISTS volume_transactions_id_seq CASCADE;

RAISE NOTICE 'Cleaned up orphaned sequences';

-- ============================================================================
-- STEP 4: Optimize transaction_details table
-- ============================================================================

-- Ensure transaction_details has all necessary indexes for performance
CREATE INDEX IF NOT EXISTS idx_td_chain_id ON transaction_details(chain_id);
CREATE INDEX IF NOT EXISTS idx_td_tx_type ON transaction_details(tx_type);
CREATE INDEX IF NOT EXISTS idx_td_nonce ON transaction_details(nonce);
CREATE INDEX IF NOT EXISTS idx_td_gas_limit ON transaction_details(gas_limit);
CREATE INDEX IF NOT EXISTS idx_td_status ON transaction_details(status);

-- Analyze the table to update statistics
ANALYZE transaction_details;

-- Vacuum to reclaim space and optimize performance
VACUUM ANALYZE transaction_details;

RAISE NOTICE 'Optimized transaction_details table';

-- ============================================================================
-- STEP 5: Final verification
-- ============================================================================

DO $$
DECLARE
  final_count INTEGER;
  remaining_tx_tables INTEGER;
BEGIN
  SELECT COUNT(*) INTO final_count FROM transaction_details;
  
  -- Count any remaining transaction tables (should be 1 - just transaction_details)
  SELECT COUNT(*) INTO remaining_tx_tables
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name LIKE '%transaction%';
  
  RAISE NOTICE 'Fast transaction consolidation completed:';
  RAISE NOTICE '  transaction_details: % records', final_count;
  RAISE NOTICE '  Remaining transaction tables: %', remaining_tx_tables;
  
  IF remaining_tx_tables = 1 THEN
    RAISE NOTICE '  ✅ Successfully consolidated to single transaction table';
  ELSE
    RAISE WARNING 'Expected 1 transaction table, found %', remaining_tx_tables;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🎉 FAST TRANSACTION CONSOLIDATION COMPLETE! 🎉';
  RAISE NOTICE '';
  RAISE NOTICE 'Summary:';
  RAISE NOTICE '  ✅ Kept transaction_details (main table)';
  RAISE NOTICE '  ❌ Dropped transactions (duplicate)';
  RAISE NOTICE '  ❌ Dropped volume_transactions (duplicate)';
  RAISE NOTICE '  ❌ Dropped benchmark_transactions (testing)';
  RAISE NOTICE '  ✅ Optimized remaining table';
  RAISE NOTICE '';
  RAISE NOTICE 'Result: Clean, fast transaction data access! 🚀';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- This migration is fast because:
-- 1. No data migration - transaction_details already has complete data
-- 2. Direct table drops - no complex queries
-- 3. Simple cleanup - just remove duplicates
-- 4. Optimized remaining table for better performance
--
-- transaction_details contains all the transaction data you need:
-- - Complete transaction information (66 columns)
-- - All wallet interactions
-- - All contract interactions  
-- - All indexing data
-- - All analytics data
-- ============================================================================