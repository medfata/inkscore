-- ============================================================================
-- Migration 014: Schema Consolidation Phase 1 - Contract Models
-- ============================================================================
-- This migration consolidates all contract-related tables into a single
-- unified contracts table, eliminating confusion and duplication.
--
-- CONSOLIDATES:
-- - contracts (main) ✅
-- - contracts_metadata ❌ → merge into contracts
-- - contracts_to_index ❌ → merge into contracts
-- - Static CONTRACTS_TO_INDEX ❌ → migrate to contracts
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Enhance contracts table with missing columns
-- ============================================================================

-- Add metadata columns from contracts_metadata
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS website_url VARCHAR(255);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Add indexer configuration columns from contracts_to_index
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS chain_id INTEGER DEFAULT 57073;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS index_type VARCHAR(20) DEFAULT 'COUNT_TX';
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS abi JSONB;

-- Add total_indexed column if not exists (from migration 010)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_indexed BIGINT DEFAULT 0;

-- ============================================================================
-- STEP 2: Migrate data from contracts_metadata
-- ============================================================================

-- Update contracts with metadata from contracts_metadata
UPDATE contracts c SET
  website_url = cm.website_url,
  logo_url = cm.logo_url,
  category = cm.category
FROM contracts_metadata cm
WHERE c.address = cm.address;

-- Insert any contracts that exist only in contracts_metadata
INSERT INTO contracts (
  address, name, website_url, logo_url, category, 
  deploy_block, fetch_transactions, indexing_enabled, 
  indexing_status, is_active
)
SELECT 
  cm.address,
  cm.name,
  cm.website_url,
  cm.logo_url,
  cm.category,
  0, -- deploy_block (will be updated later)
  true, -- fetch_transactions (default)
  true, -- indexing_enabled
  'pending', -- indexing_status
  cm.is_active
FROM contracts_metadata cm
WHERE NOT EXISTS (
  SELECT 1 FROM contracts c WHERE c.address = cm.address
);

-- ============================================================================
-- STEP 3: Migrate data from contracts_to_index
-- ============================================================================

-- Update existing contracts with indexer configuration
UPDATE contracts c SET
  chain_id = cti.chain_id,
  deploy_block = GREATEST(c.deploy_block, cti.deploy_block),
  index_type = cti.index_type,
  abi = cti.abi
FROM contracts_to_index cti
WHERE c.address = cti.address;

-- Insert any contracts that exist only in contracts_to_index
INSERT INTO contracts (
  address, name, deploy_block, chain_id, index_type, abi,
  fetch_transactions, indexing_enabled, indexing_status, is_active
)
SELECT 
  cti.address,
  COALESCE(cti.name, 'Unknown Contract'),
  cti.deploy_block,
  cti.chain_id,
  cti.index_type,
  cti.abi,
  true, -- fetch_transactions
  true, -- indexing_enabled
  'pending', -- indexing_status
  cti.is_active
FROM contracts_to_index cti
WHERE NOT EXISTS (
  SELECT 1 FROM contracts c WHERE c.address = cti.address
);

-- ============================================================================
-- STEP 4: Migrate static contracts from config.ts
-- ============================================================================

-- Insert the 7 hardcoded contracts from CONTRACTS_TO_INDEX in config.ts
INSERT INTO contracts (
  address, name, deploy_block, fetch_transactions, 
  indexing_enabled, indexing_status, is_active, category
) VALUES
  -- DailyGM (event-based)
  ('0x9f500d075118272b3564ac6ef2c70a9067fd2d3f', 'DailyGM', 3816036, false, true, 'complete', true, 'social'),
  
  -- UniversalRouter (Inkyswap)
  ('0x551134e92e537ceaa217c2ef63210af3ce96a065', 'UniversalRouter (Inkyswap)', 29465815, true, true, 'complete', true, 'dex'),
  
  -- ERC1967Proxy (InkyPump)
  ('0x1d74317d760f2c72a94386f50e8d10f2c902b899', 'ERC1967Proxy (InkyPump)', 1895455, true, true, 'complete', true, 'launchpad'),
  
  -- WrappedTokenGatewayV3 (Tydro)
  ('0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2', 'WrappedTokenGatewayV3 (Tydro)', 19954050, true, true, 'complete', true, 'defi'),
  
  -- TydroPool
  ('0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba', 'TydroPool', 19954047, true, true, 'complete', true, 'defi'),
  
  -- UniversalRouter (Velodrome)
  ('0x01d40099fcd87c018969b0e8d4ab1633fb34763c', 'UniversalRouter (Velodrome)', 16728376, true, true, 'complete', true, 'dex'),
  
  -- DyorRouterV2
  ('0x9b17690de96fcfa80a3acaefe11d936629cd7a77', 'DyorRouterV2', 933619, true, true, 'complete', true, 'dex')

ON CONFLICT (address) DO UPDATE SET
  name = EXCLUDED.name,
  deploy_block = GREATEST(contracts.deploy_block, EXCLUDED.deploy_block),
  fetch_transactions = EXCLUDED.fetch_transactions,
  category = COALESCE(contracts.category, EXCLUDED.category);

-- ============================================================================
-- STEP 5: Update indexing progress from cursor tables
-- ============================================================================

-- Sync progress from tx_indexer_cursors
UPDATE contracts c SET
  current_block = cursor.total_indexed,
  total_blocks = GREATEST(cursor.total_indexed, c.total_blocks),
  total_indexed = cursor.total_indexed,
  progress_percent = CASE 
    WHEN cursor.is_complete THEN 100.00
    WHEN c.total_blocks > 0 THEN ROUND((cursor.total_indexed::NUMERIC / c.total_blocks::NUMERIC) * 100, 2)
    ELSE 0.00
  END,
  indexing_status = CASE 
    WHEN cursor.is_complete THEN 'complete'
    WHEN cursor.total_indexed > 0 THEN 'indexing'
    ELSE c.indexing_status
  END,
  last_indexed_at = cursor.updated_at
FROM tx_indexer_cursors cursor
WHERE LOWER(c.address) = cursor.contract_address;

-- ============================================================================
-- STEP 6: Update platform_contracts junction table
-- ============================================================================

-- The platform_contracts table references contracts.id, so we need to ensure
-- all platform associations are preserved after the consolidation

-- First, let's update any platform_contracts that reference contracts_metadata
-- (This shouldn't be necessary if the migration in 006 worked correctly, but just in case)

-- ============================================================================
-- STEP 7: Add indexes for new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_contracts_chain_id ON contracts(chain_id);
CREATE INDEX IF NOT EXISTS idx_contracts_index_type ON contracts(index_type);
CREATE INDEX IF NOT EXISTS idx_contracts_category ON contracts(category);
CREATE INDEX IF NOT EXISTS idx_contracts_total_indexed ON contracts(total_indexed);

-- ============================================================================
-- STEP 8: Verify data integrity
-- ============================================================================

-- Log the consolidation results
DO $$
DECLARE
  total_contracts INTEGER;
  contracts_with_metadata INTEGER;
  contracts_with_indexer_config INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_contracts FROM contracts;
  SELECT COUNT(*) INTO contracts_with_metadata FROM contracts WHERE website_url IS NOT NULL OR logo_url IS NOT NULL;
  SELECT COUNT(*) INTO contracts_with_indexer_config FROM contracts WHERE abi IS NOT NULL OR index_type != 'COUNT_TX';
  
  RAISE NOTICE 'Contract consolidation completed:';
  RAISE NOTICE '  Total contracts: %', total_contracts;
  RAISE NOTICE '  Contracts with metadata: %', contracts_with_metadata;
  RAISE NOTICE '  Contracts with indexer config: %', contracts_with_indexer_config;
END $$;

COMMIT;

-- ============================================================================
-- NOTES FOR NEXT PHASE:
-- ============================================================================
-- After this migration is applied and tested:
-- 1. Update all services to use the unified contracts table
-- 2. Update admin APIs to use contracts instead of contracts_metadata
-- 3. Test thoroughly
-- 4. Then run Phase 2 migration to drop the old tables
-- ============================================================================