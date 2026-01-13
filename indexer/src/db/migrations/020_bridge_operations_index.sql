-- Migration: Add index for efficient bridge volume queries on operations JSONB
-- This index optimizes queries that search for wallet addresses in the operations array

-- Create an index on contract_address for filtering by Relay wallet
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_contract_lower 
ON transaction_enrichment(LOWER(contract_address::text));

-- Create a GIN index on the operations JSONB column for fast searches
-- This helps with EXISTS queries on jsonb_array_elements
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_operations_gin 
ON transaction_enrichment USING gin(operations)
WHERE operations IS NOT NULL;

COMMENT ON INDEX idx_tx_enrichment_contract_lower IS 'Index for case-insensitive contract address lookups';
COMMENT ON INDEX idx_tx_enrichment_operations_gin IS 'GIN index for JSONB operations searches (bridge queries)';
