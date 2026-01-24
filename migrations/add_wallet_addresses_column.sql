-- Add a denormalized column to store all wallet addresses found in operations and logs
-- This will dramatically speed up queries that search for specific wallets

-- Step 1: Add the column
ALTER TABLE transaction_enrichment 
ADD COLUMN IF NOT EXISTS related_wallets text[];

-- Step 2: Create a function to extract wallet addresses from operations and logs
CREATE OR REPLACE FUNCTION extract_wallet_addresses(ops jsonb, logs_data jsonb) 
RETURNS text[] AS $$
DECLARE
  wallets text[] := ARRAY[]::text[];
  op jsonb;
  log_entry jsonb;
  topic text;
BEGIN
  -- Extract from operations (to.id and from.id)
  IF ops IS NOT NULL THEN
    FOR op IN SELECT * FROM jsonb_array_elements(ops)
    LOOP
      IF op->'to'->>'id' IS NOT NULL THEN
        wallets := array_append(wallets, LOWER(op->'to'->>'id'));
      END IF;
      IF op->'from'->>'id' IS NOT NULL THEN
        wallets := array_append(wallets, LOWER(op->'from'->>'id'));
      END IF;
    END LOOP;
  END IF;
  
  -- Extract from logs (topics contain addresses)
  IF logs_data IS NOT NULL THEN
    FOR log_entry IN SELECT * FROM jsonb_array_elements(logs_data)
    LOOP
      -- Topics 1, 2, 3 often contain addresses (topic 0 is event signature)
      FOR topic IN SELECT * FROM jsonb_array_elements_text(log_entry->'topics')
      LOOP
        -- Extract address from topic (last 40 chars after 0x)
        IF length(topic) = 66 THEN
          wallets := array_append(wallets, LOWER('0x' || substring(topic from 27 for 40)));
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  
  -- Remove duplicates and return
  RETURN ARRAY(SELECT DISTINCT unnest(wallets));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Step 3: Populate the column for existing rows in batches of 500k
-- This prevents long locks and allows monitoring progress
-- Run each batch separately and monitor progress

-- Batch 1: First 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 100000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 2: Next 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 500000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 3: Next 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 500000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 4: Next 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 500000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 5: Next 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 500000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 6: Next 500k rows
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE tx_hash IN (
  SELECT tx_hash FROM transaction_enrichment
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL)
  ORDER BY tx_hash
  LIMIT 500000
);
-- Check progress: SELECT COUNT(*) FROM transaction_enrichment WHERE related_wallets IS NOT NULL;

-- Batch 7: Remaining rows (should be < 500k)
UPDATE transaction_enrichment 
SET related_wallets = extract_wallet_addresses(operations, logs)
WHERE related_wallets IS NULL 
  AND (operations IS NOT NULL OR logs IS NOT NULL);

-- Final check
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE related_wallets IS NOT NULL) as populated_rows,
  COUNT(*) FILTER (WHERE related_wallets IS NULL) as null_rows
FROM transaction_enrichmen

-- Step 4: Create GIN index on the array column for fast lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tx_enrichment_related_wallets 
ON transaction_enrichment USING gin (related_wallets);

-- Step 5: Create a trigger to auto-populate for new rows
CREATE OR REPLACE FUNCTION update_related_wallets() 
RETURNS TRIGGER AS $$
BEGIN
  NEW.related_wallets := extract_wallet_addresses(NEW.operations, NEW.logs);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_related_wallets
  BEFORE INSERT OR UPDATE OF operations, logs ON transaction_enrichment
  FOR EACH ROW
  EXECUTE FUNCTION update_related_wallets();
