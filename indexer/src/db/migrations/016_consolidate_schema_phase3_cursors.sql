-- ============================================================================
-- Migration 016: Schema Consolidation Phase 3 - Indexer Cursor Models
-- ============================================================================
-- This migration consolidates indexer cursor and range tables, keeping only
-- tx_indexer_cursors as the main cursor tracking table.
--
-- ANALYSIS:
-- - tx_indexer_cursors ✅ (Main - used by services and admin UI)
-- - fast_tx_indexer_cursors ❌ (Experimental)
-- - hybrid_tx_indexer_cursors ❌ (Experimental)
-- - indexer_cursors ❌ (Legacy RPC-based)
-- - indexer_ranges ❌ (Range-based indexing)
-- - tx_indexer_ranges ❌ (Range duplicate)
-- - volume_indexer_ranges ❌ (Volume range duplicate)
--
-- STRATEGY:
-- 1. Migrate any unique progress data to tx_indexer_cursors
-- 2. Update contracts table with final progress state
-- 3. Mark old tables for deletion in Phase 4
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Analyze cursor data overlap
-- ============================================================================

-- Create temporary analysis table to understand cursor data
CREATE TEMP TABLE cursor_analysis AS
SELECT 
  'tx_indexer_cursors' as source_table,
  COUNT(*) as cursor_count,
  COUNT(*) FILTER (WHERE is_complete = true) as complete_count,
  SUM(total_indexed) as total_transactions
FROM tx_indexer_cursors
UNION ALL
SELECT 
  'fast_tx_indexer_cursors' as source_table,
  COUNT(*) as cursor_count,
  COUNT(*) FILTER (WHERE is_complete = true) as complete_count,
  SUM(total_indexed) as total_transactions
FROM fast_tx_indexer_cursors
UNION ALL
SELECT 
  'hybrid_tx_indexer_cursors' as source_table,
  COUNT(*) as cursor_count,
  COUNT(*) FILTER (WHERE is_complete = true) as complete_count,
  SUM(total_indexed) as total_transactions
FROM hybrid_tx_indexer_cursors
UNION ALL
SELECT 
  'indexer_cursors' as source_table,
  COUNT(*) as cursor_count,
  COUNT(*) FILTER (WHERE is_backfill_complete = true) as complete_count,
  0 as total_transactions -- This table doesn't track total_indexed
FROM indexer_cursors;

-- Log the analysis
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE 'Cursor table analysis:';
  FOR rec IN SELECT * FROM cursor_analysis ORDER BY source_table LOOP
    RAISE NOTICE '  %: % cursors, % complete, % total transactions', 
      rec.source_table, rec.cursor_count, rec.complete_count, rec.total_transactions;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 2: Migrate data from fast_tx_indexer_cursors
-- ============================================================================

-- Merge fast_tx_indexer_cursors data into tx_indexer_cursors
-- Only migrate if tx_indexer_cursors doesn't have better data
INSERT INTO tx_indexer_cursors (
  contract_address, last_next_token, total_indexed, is_complete, updated_at
)
SELECT 
  ftc.contract_address,
  ftc.last_next_token,
  ftc.total_indexed,
  ftc.is_complete,
  ftc.updated_at
FROM fast_tx_indexer_cursors ftc
WHERE NOT EXISTS (
  SELECT 1 FROM tx_indexer_cursors tc 
  WHERE tc.contract_address = ftc.contract_address
)
ON CONFLICT (contract_address) DO NOTHING;

-- Update existing cursors with better data from fast_tx_indexer_cursors
UPDATE tx_indexer_cursors tc SET
  total_indexed = GREATEST(tc.total_indexed, ftc.total_indexed),
  is_complete = tc.is_complete OR ftc.is_complete,
  updated_at = GREATEST(tc.updated_at, ftc.updated_at)
FROM fast_tx_indexer_cursors ftc
WHERE tc.contract_address = ftc.contract_address
  AND ftc.total_indexed > tc.total_indexed;

-- ============================================================================
-- STEP 3: Migrate data from hybrid_tx_indexer_cursors
-- ============================================================================

-- Merge hybrid_tx_indexer_cursors data into tx_indexer_cursors
INSERT INTO tx_indexer_cursors (
  contract_address, total_indexed, is_complete, updated_at, last_indexed_block
)
SELECT 
  htc.contract_address,
  htc.total_indexed,
  htc.is_complete,
  htc.updated_at,
  htc.last_block_indexed
FROM hybrid_tx_indexer_cursors htc
WHERE NOT EXISTS (
  SELECT 1 FROM tx_indexer_cursors tc 
  WHERE tc.contract_address = htc.contract_address
)
ON CONFLICT (contract_address) DO NOTHING;

-- Update existing cursors with better data from hybrid_tx_indexer_cursors
UPDATE tx_indexer_cursors tc SET
  total_indexed = GREATEST(tc.total_indexed, htc.total_indexed),
  is_complete = tc.is_complete OR htc.is_complete,
  updated_at = GREATEST(tc.updated_at, htc.updated_at),
  last_indexed_block = GREATEST(COALESCE(tc.last_indexed_block, 0), htc.last_block_indexed)
FROM hybrid_tx_indexer_cursors htc
WHERE tc.contract_address = htc.contract_address
  AND htc.total_indexed > tc.total_indexed;

-- ============================================================================
-- STEP 4: Migrate data from indexer_cursors (RPC-based)
-- ============================================================================

-- indexer_cursors is for RPC-based indexing (events), different from transaction indexing
-- We'll preserve this data by creating cursors for contracts that don't have them
INSERT INTO tx_indexer_cursors (
  contract_address, total_indexed, is_complete, updated_at, last_indexed_block
)
SELECT 
  ic.contract_address,
  0, -- RPC indexing doesn't track transaction count
  ic.is_backfill_complete,
  ic.updated_at,
  ic.last_indexed_block
FROM indexer_cursors ic
WHERE NOT EXISTS (
  SELECT 1 FROM tx_indexer_cursors tc 
  WHERE tc.contract_address = ic.contract_address
)
ON CONFLICT (contract_address) DO NOTHING;

-- ============================================================================
-- STEP 5: Consolidate range data into progress tracking
-- ============================================================================

-- Analyze indexer_ranges to update progress in contracts table
UPDATE contracts c SET
  current_block = COALESCE(range_stats.max_current_block, c.current_block),
  total_blocks = COALESCE(range_stats.max_range_end, c.total_blocks),
  progress_percent = CASE 
    WHEN range_stats.max_range_end > 0 THEN 
      ROUND((range_stats.max_current_block::NUMERIC / range_stats.max_range_end::NUMERIC) * 100, 2)
    ELSE c.progress_percent
  END,
  indexing_status = CASE 
    WHEN range_stats.all_complete THEN 'complete'
    WHEN range_stats.max_current_block > 0 THEN 'indexing'
    ELSE c.indexing_status
  END
FROM (
  SELECT 
    contract_address,
    MAX(current_block) as max_current_block,
    MAX(range_end) as max_range_end,
    BOOL_AND(is_complete) as all_complete,
    COUNT(*) as total_ranges,
    COUNT(*) FILTER (WHERE is_complete) as complete_ranges
  FROM indexer_ranges
  GROUP BY contract_address
) range_stats
WHERE LOWER(c.address) = range_stats.contract_address;

-- Do the same for tx_indexer_ranges
UPDATE contracts c SET
  current_block = COALESCE(range_stats.max_current_block, c.current_block),
  total_blocks = COALESCE(range_stats.max_range_end, c.total_blocks),
  progress_percent = CASE 
    WHEN range_stats.max_range_end > 0 THEN 
      ROUND((range_stats.max_current_block::NUMERIC / range_stats.max_range_end::NUMERIC) * 100, 2)
    ELSE c.progress_percent
  END
FROM (
  SELECT 
    contract_address,
    MAX(current_block) as max_current_block,
    MAX(range_end) as max_range_end,
    BOOL_AND(is_complete) as all_complete
  FROM tx_indexer_ranges
  GROUP BY contract_address
) range_stats
WHERE LOWER(c.address) = range_stats.contract_address;

-- Do the same for volume_indexer_ranges
UPDATE contracts c SET
  current_block = COALESCE(range_stats.max_current_block, c.current_block),
  total_blocks = COALESCE(range_stats.max_range_end, c.total_blocks),
  progress_percent = CASE 
    WHEN range_stats.max_range_end > 0 THEN 
      ROUND((range_stats.max_current_block::NUMERIC / range_stats.max_range_end::NUMERIC) * 100, 2)
    ELSE c.progress_percent
  END
FROM (
  SELECT 
    contract_address,
    MAX(current_block) as max_current_block,
    MAX(range_end) as max_range_end,
    BOOL_AND(is_complete) as all_complete
  FROM volume_indexer_ranges
  GROUP BY contract_address
) range_stats
WHERE LOWER(c.address) = range_stats.contract_address;

-- ============================================================================
-- STEP 6: Final sync between tx_indexer_cursors and contracts
-- ============================================================================

-- Ensure contracts table has the most up-to-date information
UPDATE contracts c SET
  total_indexed = GREATEST(COALESCE(c.total_indexed, 0), tc.total_indexed),
  current_block = GREATEST(COALESCE(c.current_block, 0), COALESCE(tc.last_indexed_block, 0)),
  indexing_status = CASE 
    WHEN tc.is_complete THEN 'complete'
    WHEN tc.total_indexed > 0 THEN 'indexing'
    ELSE c.indexing_status
  END,
  progress_percent = CASE 
    WHEN tc.is_complete THEN 100.00
    WHEN c.total_blocks > 0 AND tc.total_indexed > 0 THEN 
      ROUND((tc.total_indexed::NUMERIC / c.total_blocks::NUMERIC) * 100, 2)
    ELSE c.progress_percent
  END,
  last_indexed_at = GREATEST(COALESCE(c.last_indexed_at, tc.updated_at), tc.updated_at)
FROM tx_indexer_cursors tc
WHERE LOWER(c.address) = tc.contract_address;

-- ============================================================================
-- STEP 7: Create compatibility views for range tables
-- ============================================================================

-- Create a view that provides range information from the contracts table
-- This helps with backward compatibility during transition
CREATE OR REPLACE VIEW indexer_ranges_view AS
SELECT 
  ROW_NUMBER() OVER (ORDER BY c.id) as id,
  c.address as contract_address,
  c.chain_id,
  0 as range_start,
  c.total_blocks as range_end,
  c.current_block,
  (c.indexing_status = 'complete') as is_complete,
  c.created_at,
  c.updated_at,
  NULL::integer as worker_id
FROM contracts c
WHERE c.indexing_enabled = true;

-- ============================================================================
-- STEP 8: Verify data integrity
-- ============================================================================

-- Final analysis after migration
CREATE TEMP TABLE cursor_analysis_final AS
SELECT 
  'tx_indexer_cursors_final' as source_table,
  COUNT(*) as cursor_count,
  COUNT(*) FILTER (WHERE is_complete = true) as complete_count,
  SUM(total_indexed) as total_transactions
FROM tx_indexer_cursors;

-- Log the final results
DO $$
DECLARE
  rec RECORD;
  initial_count INTEGER;
  final_count INTEGER;
  contracts_with_cursors INTEGER;
BEGIN
  SELECT cursor_count INTO initial_count FROM cursor_analysis WHERE source_table = 'tx_indexer_cursors';
  SELECT cursor_count INTO final_count FROM cursor_analysis_final;
  
  SELECT COUNT(*) INTO contracts_with_cursors 
  FROM contracts c 
  WHERE EXISTS (SELECT 1 FROM tx_indexer_cursors tc WHERE tc.contract_address = LOWER(c.address));
  
  RAISE NOTICE 'Cursor consolidation completed:';
  RAISE NOTICE '  Initial tx_indexer_cursors count: %', initial_count;
  RAISE NOTICE '  Final tx_indexer_cursors count: %', final_count;
  RAISE NOTICE '  Contracts with cursors: %', contracts_with_cursors;
  
  FOR rec IN SELECT * FROM cursor_analysis_final LOOP
    RAISE NOTICE '  Final stats: % cursors, % complete, % total transactions', 
      rec.cursor_count, rec.complete_count, rec.total_transactions;
  END LOOP;
END $$;

-- ============================================================================
-- STEP 9: Mark old tables for deletion
-- ============================================================================

-- Add comments to mark these tables for deletion in Phase 4
COMMENT ON TABLE fast_tx_indexer_cursors IS 'DEPRECATED: Consolidated into tx_indexer_cursors. Will be dropped in Phase 4.';
COMMENT ON TABLE hybrid_tx_indexer_cursors IS 'DEPRECATED: Consolidated into tx_indexer_cursors. Will be dropped in Phase 4.';
COMMENT ON TABLE indexer_cursors IS 'DEPRECATED: Consolidated into tx_indexer_cursors. Will be dropped in Phase 4.';
COMMENT ON TABLE indexer_ranges IS 'DEPRECATED: Progress tracked in contracts table. Will be dropped in Phase 4.';
COMMENT ON TABLE tx_indexer_ranges IS 'DEPRECATED: Progress tracked in contracts table. Will be dropped in Phase 4.';
COMMENT ON TABLE volume_indexer_ranges IS 'DEPRECATED: Progress tracked in contracts table. Will be dropped in Phase 4.';

COMMIT;

-- ============================================================================
-- NOTES FOR NEXT PHASE:
-- ============================================================================
-- After this migration is applied and tested:
-- 1. Update indexer services to use only tx_indexer_cursors
-- 2. Update admin APIs to get progress from contracts table
-- 3. Test thoroughly with the compatibility views
-- 4. Then run Phase 4 migration to drop all deprecated tables
-- ============================================================================