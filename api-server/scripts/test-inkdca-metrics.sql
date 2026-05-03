-- Test InkDCA Metrics for wallet 0xf0246C84bB2dCB2C68A17047480a669D59E2F41C

-- 1. Count runDCA executions
SELECT COUNT(*) as run_dca_count
FROM transaction_details 
WHERE contract_address = lower('0x4286643d9612515F487c2F3272845bc53Ca80705')
  AND wallet_address = lower('0xf0246C84bB2dCB2C68A17047480a669D59E2F41C')
  AND function_name = 'runDCA'
  AND status = 1;

-- 2. Count registered DCAs (registerForDCAWithETH + registerForDCAWithToken)
SELECT COUNT(*) as registered_dca_count
FROM transaction_details 
WHERE contract_address = lower('0x4286643d9612515F487c2F3272845bc53Ca80705')
  AND wallet_address = lower('0xf0246C84bB2dCB2C68A17047480a669D59E2F41C')
  AND function_name IN ('registerForDCAWithETH', 'registerForDCAWithToken')
  AND status = 1;

-- 3. Breakdown by function name
SELECT 
  function_name,
  COUNT(*) as count
FROM transaction_details 
WHERE contract_address = lower('0x4286643d9612515F487c2F3272845bc53Ca80705')
  AND wallet_address = lower('0xf0246C84bB2dCB2C68A17047480a669D59E2F41C')
  AND status = 1
GROUP BY function_name
ORDER BY count DESC;

-- 4. All InkDCA functions for this wallet
SELECT 
  function_name,
  COUNT(*) as count,
  MIN(block_timestamp) as first_tx,
  MAX(block_timestamp) as last_tx
FROM transaction_details 
WHERE contract_address = lower('0x4286643d9612515F487c2F3272845bc53Ca80705')
  AND wallet_address = lower('0xf0246C84bB2dCB2C68A17047480a669D59E2F41C')
GROUP BY function_name
ORDER BY count DESC;
