-- Migration: Add composite index for efficient bridge volume queries on transaction_enrichment
-- This index optimizes queries for Native Bridge (USDT0) volume calculations

-- Composite index for Bridge OUT queries: contract_address + wallet_address
-- Used when querying transactions where user called OFT Adapter directly
-- Note: Existing indexes idx_tx_enrichment_contract and idx_tx_enrichment_wallet 
-- already cover single-column queries, this adds the composite for better performance
CREATE INDEX IF NOT EXISTS idx_tx_enrichment_contract_wallet 
ON transaction_enrichment(contract_address, wallet_address);

COMMENT ON INDEX idx_tx_enrichment_contract_wallet IS 'Composite index for bridge queries (contract + wallet)';
