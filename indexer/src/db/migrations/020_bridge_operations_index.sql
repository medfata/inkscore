-- Migration: Indexes for bridge and analytics queries
-- Your existing indexes use LOWER(), so queries must also use LOWER()

-- Existing indexes (already created):
-- idx_tx_enrichment_contract_lower: btree (lower(contract_address::text))
-- idx_tx_enrichment_contract_wallet: btree (lower(contract_address::text), lower(wallet_address::text))
-- idx_tx_enrichment_operations_gin: gin (operations) WHERE operations IS NOT NULL

-- GIN index on logs JSONB for faster ILIKE searches
-- Note: GIN indexes help with @>, @?, but ILIKE still needs text scan
-- However, the contract_address filter will narrow down rows first
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_logs_gin 
ON transaction_enrichment USING gin(logs)
WHERE logs IS NOT NULL;

-- For ILIKE searches on JSONB::text, we can use pg_trgm extension
-- This requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Then create trigram indexes:
-- CREATE INDEX idx_tx_enrichment_operations_trgm ON transaction_enrichment USING gin(operations::text gin_trgm_ops) WHERE operations IS NOT NULL;
-- CREATE INDEX idx_tx_enrichment_logs_trgm ON transaction_enrichment USING gin(logs::text gin_trgm_ops) WHERE logs IS NOT NULL;

COMMENT ON INDEX idx_tx_enrichment_logs_gin IS 'GIN index for JSONB logs containment queries';
