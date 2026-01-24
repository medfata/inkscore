-- Migration: Consolidate wallet_interactions into transaction_details
-- This migration moves all data from wallet_interactions to transaction_details
-- and removes the wallet_interactions table to eliminate duplication

-- Step 1: Insert wallet_interactions data into transaction_details where it doesn't exist
INSERT INTO transaction_details (
    tx_hash,
    wallet_address,
    contract_address,
    function_selector,
    function_name,
    eth_value,
    block_number,
    block_timestamp,
    status,
    chain_id,
    created_at
)
SELECT DISTINCT
    wi.tx_hash,
    wi.wallet_address,
    wi.contract_address,
    wi.function_selector,
    wi.function_name,
    '0'::character varying(78) as eth_value, -- Default to 0 for count-based contracts
    wi.block_number,
    wi.block_timestamp,
    wi.status,
    wi.chain_id,
    wi.created_at
FROM wallet_interactions wi
WHERE NOT EXISTS (
    SELECT 1 FROM transaction_details td 
    WHERE td.tx_hash = wi.tx_hash 
    AND td.wallet_address = wi.wallet_address 
    AND td.contract_address = wi.contract_address
)
ON CONFLICT (tx_hash) DO NOTHING;

-- Step 2: Update any missing wallet_address in transaction_details from wallet_interactions
UPDATE transaction_details 
SET wallet_address = wi.wallet_address,
    function_selector = COALESCE(transaction_details.function_selector, wi.function_selector),
    function_name = COALESCE(transaction_details.function_name, wi.function_name),
    status = COALESCE(transaction_details.status, wi.status)
FROM wallet_interactions wi
WHERE transaction_details.tx_hash = wi.tx_hash
  AND transaction_details.contract_address = wi.contract_address
  AND (transaction_details.wallet_address IS NULL OR transaction_details.wallet_address = '');

-- Step 3: Add indexes optimized for both count and volume queries on transaction_details
-- These replace the wallet_interactions indexes

-- Index for wallet + contract queries (most common)
CREATE INDEX IF NOT EXISTS idx_td_wallet_contract_status 
ON transaction_details(wallet_address, contract_address, status);

-- Index for contract-based queries (platform stats)
CREATE INDEX IF NOT EXISTS idx_td_contract_status 
ON transaction_details(contract_address, status);

-- Index for wallet + contract + function queries
CREATE INDEX IF NOT EXISTS idx_td_wallet_contract_function 
ON transaction_details(wallet_address, contract_address, function_selector);

-- Index for contract + block queries (indexer progress)
CREATE INDEX IF NOT EXISTS idx_td_contract_block 
ON transaction_details(contract_address, block_number);

-- Index for function-based queries
CREATE INDEX IF NOT EXISTS idx_td_function_name 
ON transaction_details(function_name) WHERE function_name IS NOT NULL;

-- Index for contract + function queries
CREATE INDEX IF NOT EXISTS idx_td_contract_function_name 
ON transaction_details(contract_address, function_name) WHERE function_name IS NOT NULL;

-- Index for tx_hash lookups (already exists as PK, but ensuring)
-- CREATE INDEX IF NOT EXISTS idx_td_tx_hash ON transaction_details(tx_hash); -- Already PK

-- Step 4: Drop wallet_interactions related indexes
DROP INDEX IF EXISTS idx_wallet_contract;
DROP INDEX IF EXISTS idx_contract_status;
DROP INDEX IF EXISTS idx_wallet_contract_fn;
DROP INDEX IF EXISTS idx_contract_block;
DROP INDEX IF EXISTS idx_wi_wallet_contract;
DROP INDEX IF EXISTS idx_wi_block;
DROP INDEX IF EXISTS idx_wi_function;
DROP INDEX IF EXISTS idx_wi_contract_function;
DROP INDEX IF EXISTS idx_wallet_interactions_tx_hash;

-- Step 5: Drop wallet_interactions table and sequence
DROP TABLE IF EXISTS wallet_interactions CASCADE;
DROP SEQUENCE IF EXISTS wallet_interactions_id_seq CASCADE;

-- Step 6: Update any views or functions that might reference wallet_interactions
-- (Add any custom views/functions here if they exist)

-- Migration complete - all wallet interaction data is now in transaction_details