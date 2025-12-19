-- Migration: Sync transaction_details to wallet_interactions
-- This ensures all contracts have entries in wallet_interactions
-- and transaction_details references wallet_interactions via tx_hash

-- Step 1: Insert wallet_interactions from transaction_details
-- (for contracts that were indexed via tx indexer but not event indexer)
-- Using the composite unique constraint (tx_hash, wallet_address, contract_address)
INSERT INTO wallet_interactions (
  wallet_address,
  contract_address,
  function_selector,
  function_name,
  tx_hash,
  block_number,
  block_timestamp,
  chain_id
)
SELECT 
  td.wallet_address,
  td.contract_address,
  COALESCE(td.function_selector, '0x'),
  td.function_name,
  td.tx_hash,
  td.block_number,
  td.block_timestamp,
  td.chain_id
FROM transaction_details td
WHERE NOT EXISTS (
  SELECT 1 FROM wallet_interactions wi 
  WHERE wi.tx_hash = td.tx_hash 
    AND wi.wallet_address = td.wallet_address 
    AND wi.contract_address = td.contract_address
)
ON CONFLICT (tx_hash, wallet_address, contract_address) DO NOTHING;

-- Step 2: Add index on tx_hash for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_wallet_interactions_tx_hash 
ON wallet_interactions(tx_hash);

-- Step 3: Verify the migration
SELECT 'wallet_interactions' as table_name, COUNT(*) as total FROM wallet_interactions
UNION ALL
SELECT 'transaction_details' as table_name, COUNT(*) as total FROM transaction_details;

-- Show contract breakdown in wallet_interactions
SELECT 
  contract_address, 
  COUNT(*) as total 
FROM wallet_interactions 
GROUP BY contract_address
ORDER BY total DESC;
