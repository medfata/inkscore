-- Part 2: Populate existing rows in batches of 500k
-- Run each batch separately and monitor progress between batches
-- You can run these one at a time or all at once

-- Check how many rows need updating
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE operations IS NOT NULL OR logs IS NOT NULL) as rows_to_update,
  COUNT(*) FILTER (WHERE related_wallets IS NOT NULL) as already_populated
FROM transaction_enrichment;

-- Batch 1: First 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 1: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 2: Next 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 2: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 3: Next 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 3: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 4: Next 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 4: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 5: Next 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 5: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 6: Next 500k rows
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE tx_hash IN (
    SELECT tx_hash FROM transaction_enrichment
    WHERE related_wallets IS NULL 
      AND (operations IS NOT NULL OR logs IS NOT NULL)
    ORDER BY tx_hash
    LIMIT 500000
  );
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 6: Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Batch 7: Remaining rows (should be < 500k)
DO $$
DECLARE
  batch_start TIMESTAMP := clock_timestamp();
  rows_updated INTEGER;
BEGIN
  UPDATE transaction_enrichment 
  SET related_wallets = extract_wallet_addresses(operations, logs)
  WHERE related_wallets IS NULL 
    AND (operations IS NOT NULL OR logs IS NOT NULL);
  
  GET DIAGNOSTICS rows_updated = ROW_COUNT;
  RAISE NOTICE 'Batch 7 (final): Updated % rows in %', rows_updated, clock_timestamp() - batch_start;
END $$;

-- Final check
SELECT 
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE related_wallets IS NOT NULL) as populated_rows,
  COUNT(*) FILTER (WHERE related_wallets IS NULL) as null_rows,
  COUNT(*) FILTER (WHERE operations IS NOT NULL OR logs IS NOT NULL) as should_be_populated
FROM transaction_enrichment;
