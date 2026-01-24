-- Migration: Add trigram indexes for fast ILIKE searches on JSONB columns
-- This dramatically speeds up queries like: WHERE operations::text ILIKE '%wallet%'

-- Step 1: Enable pg_trgm extension (required for trigram indexes)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 2: Create trigram GIN indexes on JSONB columns cast to text
-- These indexes make ILIKE queries use index scans instead of sequential scans

-- Index for operations JSONB (used by Relay bridge IN queries)
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_operations_trgm 
ON transaction_enrichment USING gin((operations::text) gin_trgm_ops) 
WHERE operations IS NOT NULL;

-- Index for logs JSONB (used by Native Bridge IN queries)
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_logs_trgm 
ON transaction_enrichment USING gin((logs::text) gin_trgm_ops) 
WHERE logs IS NOT NULL;

COMMENT ON INDEX idx_tx_enrichment_operations_trgm IS 'Trigram index for fast ILIKE on operations JSONB';
COMMENT ON INDEX idx_tx_enrichment_logs_trgm IS 'Trigram index for fast ILIKE on logs JSONB';

-- Note: These indexes can be large (roughly 2-3x the size of the text data)
-- but they make ILIKE queries 10-100x faster
