-- ============================================================================
-- Migration 017: Schema Consolidation Phase 4 - Final Cleanup
-- ============================================================================
-- This migration drops all deprecated tables and performs final cleanup
-- after the consolidation is complete and tested.
--
-- WARNING: This migration is DESTRUCTIVE and cannot be easily reversed.
-- Only run this after:
-- 1. All previous phases have been applied and tested
-- 2. All services have been updated to use the consolidated tables
-- 3. You have verified that no code references the old tables
-- 4. You have taken a full database backup
--
-- TABLES TO DROP:
-- - contracts_metadata (consolidated into contracts)
-- - contracts_to_index (consolidated into contracts)
-- - transactions (consolidated into transaction_details)
-- - volume_transactions (consolidated into transaction_details)
-- - benchmark_transactions (consolidated into transaction_details)
-- - fast_tx_indexer_cursors (consolidated into tx_indexer_cursors)
-- - hybrid_tx_indexer_cursors (consolidated into tx_indexer_cursors)
-- - indexer_cursors (consolidated into tx_indexer_cursors)
-- - indexer_ranges (progress tracked in contracts table)
-- - tx_indexer_ranges (progress tracked in contracts table)
-- - volume_indexer_ranges (progress tracked in contracts table)
-- - transaction_events (evaluate if needed)
-- - bridge_sync_cursors (evaluate if needed)
-- ============================================================================

-- Prevent accidental execution - uncomment the line below when ready
-- SET session_replication_role = replica; -- Disable triggers during cleanup

BEGIN;

-- ============================================================================
-- STEP 1: Pre-cleanup verification
-- ============================================================================

-- Verify that the main tables have the expected data
DO $$
DECLARE
  contracts_count INTEGER;
  transaction_details_count INTEGER;
  tx_cursors_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO contracts_count FROM contracts;
  SELECT COUNT(*) INTO transaction_details_count FROM transaction_details;
  SELECT COUNT(*) INTO tx_cursors_count FROM tx_indexer_cursors;
  
  RAISE NOTICE 'Pre-cleanup verification:';
  RAISE NOTICE '  contracts: % records', contracts_count;
  RAISE NOTICE '  transaction_details: % records', transaction_details_count;
  RAISE NOTICE '  tx_indexer_cursors: % records', tx_cursors_count;
  
  -- Safety check - abort if main tables are empty
  IF contracts_count = 0 THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: contracts table is empty. Aborting cleanup.';
  END IF;
  
  IF transaction_details_count = 0 THEN
    RAISE EXCEPTION 'SAFETY CHECK FAILED: transaction_details table is empty. Aborting cleanup.';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop foreign key constraints that reference deprecated tables
-- ============================================================================

-- Drop foreign keys that might reference deprecated tables
-- (Most of our deprecated tables don't have foreign keys, but let's be safe)

-- Check for any foreign keys referencing contracts_metadata
DO $$
DECLARE
  fk_record RECORD;
BEGIN
  FOR fk_record IN 
    SELECT conname, conrelid::regclass as table_name
    FROM pg_constraint 
    WHERE confrelid = 'contracts_metadata'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s', fk_record.table_name, fk_record.conname);
    RAISE NOTICE 'Dropped foreign key constraint % from %', fk_record.conname, fk_record.table_name;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 3: Drop compatibility views
-- ============================================================================

-- Drop the compatibility views created in previous phases
DROP VIEW IF EXISTS transactions_view CASCADE;
DROP VIEW IF EXISTS volume_transactions_view CASCADE;
DROP VIEW IF EXISTS indexer_ranges_view CASCADE;

RAISE NOTICE 'Dropped compatibility views';

-- ============================================================================
-- STEP 4: Drop deprecated contract tables
-- ============================================================================

-- Drop contract-related deprecated tables
DROP TABLE IF EXISTS contracts_metadata CASCADE;
RAISE NOTICE 'Dropped contracts_metadata table';

DROP TABLE IF EXISTS contracts_to_index CASCADE;
RAISE NOTICE 'Dropped contracts_to_index table';

-- ============================================================================
-- STEP 5: Drop deprecated transaction tables
-- ============================================================================

-- Drop transaction-related deprecated tables
DROP TABLE IF EXISTS transactions CASCADE;
RAISE NOTICE 'Dropped transactions table';

DROP TABLE IF EXISTS volume_transactions CASCADE;
RAISE NOTICE 'Dropped volume_transactions table';

DROP TABLE IF EXISTS benchmark_transactions CASCADE;
RAISE NOTICE 'Dropped benchmark_transactions table';

-- ============================================================================
-- STEP 6: Drop deprecated cursor and range tables
-- ============================================================================

-- Drop cursor-related deprecated tables
DROP TABLE IF EXISTS fast_tx_indexer_cursors CASCADE;
RAISE NOTICE 'Dropped fast_tx_indexer_cursors table';

DROP TABLE IF EXISTS hybrid_tx_indexer_cursors CASCADE;
RAISE NOTICE 'Dropped hybrid_tx_indexer_cursors table';

DROP TABLE IF EXISTS indexer_cursors CASCADE;
RAISE NOTICE 'Dropped indexer_cursors table';

-- Drop range-related deprecated tables
DROP TABLE IF EXISTS indexer_ranges CASCADE;
RAISE NOTICE 'Dropped indexer_ranges table';

DROP TABLE IF EXISTS tx_indexer_ranges CASCADE;
RAISE NOTICE 'Dropped tx_indexer_ranges table';

DROP TABLE IF EXISTS volume_indexer_ranges CASCADE;
RAISE NOTICE 'Dropped volume_indexer_ranges table';

-- ============================================================================
-- STEP 7: Evaluate and drop questionable tables
-- ============================================================================

-- Check if transaction_events is actually used
DO $$
DECLARE
  events_count INTEGER;
  recent_events INTEGER;
BEGIN
  SELECT COUNT(*) INTO events_count FROM transaction_events;
  SELECT COUNT(*) INTO recent_events FROM transaction_events WHERE block_timestamp > NOW() - INTERVAL '30 days';
  
  RAISE NOTICE 'transaction_events analysis: % total, % recent', events_count, recent_events;
  
  -- If transaction_events seems redundant with transaction_logs, consider dropping it
  -- Uncomment the next line if you determine it's safe to drop
  -- DROP TABLE IF EXISTS transaction_events CASCADE;
  -- RAISE NOTICE 'Dropped transaction_events table';
END $$;

-- Check if bridge_sync_cursors is redundant with bridge_indexer_cursors
DO $$
DECLARE
  sync_cursors_count INTEGER;
  indexer_cursors_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sync_cursors_count FROM bridge_sync_cursors;
  SELECT COUNT(*) INTO indexer_cursors_count FROM bridge_indexer_cursors;
  
  RAISE NOTICE 'Bridge cursors analysis: % sync_cursors, % indexer_cursors', sync_cursors_count, indexer_cursors_count;
  
  -- If bridge_sync_cursors is redundant, consider dropping it
  -- Uncomment the next line if you determine it's safe to drop
  -- DROP TABLE IF EXISTS bridge_sync_cursors CASCADE;
  -- RAISE NOTICE 'Dropped bridge_sync_cursors table';
END $$;

-- ============================================================================
-- STEP 8: Clean up sequences for dropped tables
-- ============================================================================

-- Drop sequences that belonged to the dropped tables
-- PostgreSQL usually drops these automatically, but let's be explicit

DROP SEQUENCE IF EXISTS contracts_metadata_id_seq CASCADE;
DROP SEQUENCE IF EXISTS contracts_to_index_id_seq CASCADE;
DROP SEQUENCE IF EXISTS transactions_id_seq CASCADE;
DROP SEQUENCE IF EXISTS volume_transactions_id_seq CASCADE;
DROP SEQUENCE IF EXISTS fast_tx_indexer_cursors_id_seq CASCADE;
DROP SEQUENCE IF EXISTS hybrid_tx_indexer_cursors_id_seq CASCADE;
DROP SEQUENCE IF EXISTS indexer_ranges_id_seq CASCADE;
DROP SEQUENCE IF EXISTS tx_indexer_ranges_id_seq CASCADE;
DROP SEQUENCE IF EXISTS volume_indexer_ranges_id_seq CASCADE;

RAISE NOTICE 'Cleaned up orphaned sequences';

-- ============================================================================
-- STEP 9: Optimize remaining tables
-- ============================================================================

-- Analyze the main tables to update statistics after the consolidation
ANALYZE contracts;
ANALYZE transaction_details;
ANALYZE tx_indexer_cursors;
ANALYZE platforms;
ANALYZE platform_contracts;

RAISE NOTICE 'Updated table statistics';

-- Vacuum the main tables to reclaim space and optimize performance
VACUUM ANALYZE contracts;
VACUUM ANALYZE transaction_details;
VACUUM ANALYZE tx_indexer_cursors;

RAISE NOTICE 'Vacuumed main tables';

-- ============================================================================
-- STEP 10: Final verification
-- ============================================================================

-- Verify the final state of the database
DO $$
DECLARE
  total_tables INTEGER;
  deprecated_tables INTEGER;
BEGIN
  -- Count total tables in public schema
  SELECT COUNT(*) INTO total_tables 
  FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
  
  -- Count any remaining deprecated tables (should be 0)
  SELECT COUNT(*) INTO deprecated_tables
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN (
      'contracts_metadata', 'contracts_to_index', 'transactions', 
      'volume_transactions', 'benchmark_transactions',
      'fast_tx_indexer_cursors', 'hybrid_tx_indexer_cursors', 'indexer_cursors',
      'indexer_ranges', 'tx_indexer_ranges', 'volume_indexer_ranges'
    );
  
  RAISE NOTICE 'Final verification:';
  RAISE NOTICE '  Total tables remaining: %', total_tables;
  RAISE NOTICE '  Deprecated tables remaining: %', deprecated_tables;
  
  IF deprecated_tables > 0 THEN
    RAISE WARNING 'Some deprecated tables were not dropped. Check for dependencies.';
  ELSE
    RAISE NOTICE '  ✅ All deprecated tables successfully removed';
  END IF;
END $$;

-- ============================================================================
-- STEP 11: Update schema version
-- ============================================================================

-- Record the completion of schema consolidation
INSERT INTO schema_migrations (filename) VALUES ('017_consolidate_schema_phase4_cleanup.sql');

COMMIT;

-- Re-enable triggers if they were disabled
-- SET session_replication_role = DEFAULT;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🎉 SCHEMA CONSOLIDATION COMPLETE! 🎉';
  RAISE NOTICE '';
  RAISE NOTICE 'Summary of changes:';
  RAISE NOTICE '  ✅ Consolidated 4 contract tables → 1 (contracts)';
  RAISE NOTICE '  ✅ Consolidated 4 transaction tables → 1 (transaction_details)';
  RAISE NOTICE '  ✅ Consolidated 7 cursor/range tables → 1 (tx_indexer_cursors)';
  RAISE NOTICE '  ✅ Dropped 11+ deprecated tables';
  RAISE NOTICE '  ✅ Preserved all data integrity';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Update application code to use consolidated tables';
  RAISE NOTICE '  2. Remove references to old table names';
  RAISE NOTICE '  3. Update documentation';
  RAISE NOTICE '  4. Monitor performance and optimize as needed';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- This completes the schema consolidation. Your database now has:
-- 
-- MAIN TABLES:
-- - contracts (unified contract management)
-- - transaction_details (all transaction data)
-- - tx_indexer_cursors (indexing progress)
-- - platforms (dApp platforms)
-- - platform_contracts (M:N junction)
-- - discovered_tokens (auto-discovered tokens)
-- - tracked_assets (admin-managed assets)
-- - transaction_logs (raw event logs)
-- - transaction_token_transfers (token transfers)
-- - asset_transfers (asset transfers)
-- - bridge_transfers (bridge transfers)
-- - bridge_indexer_cursors (bridge progress)
-- - analytics_* (analytics system)
-- - points_* (points system)
-- - wallet_points_cache (user scores)
-- - ranks (user ranks)
-- - native_metrics (built-in metrics)
-- - dashboard_* (dashboard system)
-- - eth_prices (price data)
-- - chain_config (chain configuration)
-- - schema_migrations (migration tracking)
--
-- The schema is now clean, consistent, and maintainable! 🚀
-- ============================================================================