-- Add index to speed up OpenSea sales queries
-- This creates a GIN index on the logs JSONB field for the OpenSea contract

-- Drop the text trigram index if it exists (it's slower)
DROP INDEX IF EXISTS idx_tx_enrichment_opensea_logs_text_trgm;

-- Create a partial GIN index on logs for OpenSea contract only
-- This will speed up the jsonb_array_elements and JSONB operations
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_opensea_logs_gin
ON transaction_enrichment USING gin(logs jsonb_path_ops)
WHERE contract_address = lower('0x0000000000000068F116a894984e2DB1123eB395')
  AND logs IS NOT NULL;

-- Also create a regular btree index on contract_address for faster filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_contract_lower
ON transaction_enrichment (lower(contract_address))
WHERE logs IS NOT NULL;

COMMENT ON INDEX idx_tx_enrichment_opensea_logs_gin IS 'Speeds up OpenSea sales queries by indexing logs JSONB for OpenSea contract (14s query time)';
COMMENT ON INDEX idx_tx_enrichment_contract_lower IS 'Speeds up contract filtering with lower() function';





