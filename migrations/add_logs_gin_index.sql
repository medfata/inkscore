-- Add GIN index on logs JSONB column for faster bridge queries
-- This will significantly speed up queries that search within the logs array

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_logs_gin 
ON transaction_enrichment USING gin (logs) 
WHERE logs IS NOT NULL;

-- Optional: Add a more specific index for common log queries
-- This helps with queries that filter by contract_address and search logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_contract_logs 
ON transaction_enrichment (LOWER(contract_address)) 
WHERE logs IS NOT NULL;
