-- Migration: Optimize transaction_enrichment queries based on actual usage patterns
-- Analysis of all queries in the codebase shows these main patterns:

-- QUERY PATTERN ANALYSIS:
-- 1. contract_address only: COUNT queries, enrichment status checks
-- 2. wallet_address only: User analytics, volume calculations  
-- 3. contract_address + wallet_address: Bridge queries, Tydro lending, user-specific contract interactions
-- 4. wallet_address + contract_address IN (...): Multi-contract user queries (Tydro, analytics)
-- 5. logs JSONB searches: Bridge event parsing, complex log analysis
-- 6. LOWER() function usage: Case-insensitive address matching (Tydro, some analytics)

-- EXISTING INDEXES (from migrate-enrichment.sql):
-- - idx_tx_enrichment_tx_hash (tx_hash) - PRIMARY KEY equivalent
-- - idx_tx_enrichment_contract (contract_address) - Single contract queries
-- - idx_tx_enrichment_wallet (wallet_address) - Single wallet queries  
-- - idx_tx_enrichment_volume_* (contract_address, volume_fields) - Volume-specific queries
-- - idx_tx_enrichment_contract_wallet (contract_address, wallet_address) - From migration 019

-- PERFORMANCE ISSUES IDENTIFIED:
-- 1. Bridge and swap queries use exact matching without LOWER() functions
-- 2. Enrichment service stores addresses in exact case (not lowercase)
-- 3. JSONB log searches are slow without GIN index (Bridge API: ILIKE queries) - CRITICAL

-- OPTIMIZED INDEXES:

-- 1. The existing idx_tx_enrichment_contract_wallet uses LOWER() but our queries use exact matching
-- Create a regular composite index for exact case matching
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_contract_wallet_exact 
ON transaction_enrichment(contract_address, wallet_address) 
WHERE logs IS NOT NULL;

-- 2. Add GIN indexes for fast JSONB operations on logs and operations (critical for performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_logs_gin 
ON transaction_enrichment USING gin(logs) 
WHERE logs IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_operations_gin 
ON transaction_enrichment USING gin(operations) 
WHERE operations IS NOT NULL;

-- Add comments for documentation
COMMENT ON INDEX idx_tx_enrichment_contract_wallet_exact IS 'Composite index for exact-match contract+wallet queries (Bridge API, Swap API)';
COMMENT ON INDEX idx_tx_enrichment_logs_gin IS 'GIN index for fast JSONB searches in logs (Bridge API, event parsing)';
COMMENT ON INDEX idx_tx_enrichment_operations_gin IS 'GIN index for fast JSONB searches in operations (future transaction analysis features)';

-- Update table statistics to help query planner
ANALYZE transaction_enrichment;