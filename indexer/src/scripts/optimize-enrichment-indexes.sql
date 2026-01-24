-- Optimization Indexes for Gap Enrichment Queries
-- Run this to improve performance of the gap enrichment script

-- ============================================
-- 1. COMPOSITE INDEXES FOR MISSING TRANSACTION QUERIES
-- ============================================

-- Optimize the LEFT JOIN query for finding missing transactions
-- This covers: td.contract_address = $1 AND te.tx_hash IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_details_contract_timestamp 
ON transaction_details(contract_address, block_timestamp ASC, tx_hash);

-- Optimize the enrichment lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_enrichment_tx_hash_contract 
ON transaction_enrichment(tx_hash, contract_address);

-- ============================================
-- 2. COVERING INDEXES FOR BETTER PERFORMANCE
-- ============================================

-- Covering index for transaction_details to avoid table lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transaction_details_gap_covering 
ON transaction_details(contract_address, block_timestamp ASC) 
INCLUDE (tx_hash, wallet_address);

-- ============================================
-- 3. PARTIAL INDEXES FOR ACTIVE CONTRACTS
-- ============================================

-- Only index active volume contracts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_active_volume 
ON contracts(address, name) 
WHERE contract_type = 'volume' AND is_active = true;

-- ============================================
-- 4. ANALYZE TABLES FOR BETTER QUERY PLANS
-- ============================================

-- Update table statistics for better query planning
ANALYZE transac