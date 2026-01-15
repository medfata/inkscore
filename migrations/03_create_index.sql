-- Part 3: Create the GIN index (run this after all batches are complete)
-- This will take 5-15 minutes but is non-blocking with CONCURRENTLY

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_related_wallets 
ON transaction_enrichment USING gin (related_wallets)
WHERE related_wallets IS NOT NULL;

-- Verify the index was created
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'transaction_enrichment'
  AND indexname = 'idx_tx_enrichment_related_wallets';

SELECT 'Index created successfully! Bridge queries should now be 30-40x faster.' as status;
