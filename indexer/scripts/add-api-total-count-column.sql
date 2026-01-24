-- Add api_total_count column to tx_indexer_cursors table
-- This column stores the total transaction count reported by the Routescan API
-- Used to calculate accurate indexing progress percentage

ALTER TABLE tx_indexer_cursors 
ADD COLUMN IF NOT EXISTS api_total_count INTEGER DEFAULT 0;

-- Verify the column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'tx_indexer_cursors' 
ORDER BY ordinal_position;
