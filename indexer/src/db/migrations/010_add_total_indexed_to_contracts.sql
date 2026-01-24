-- Add total_indexed column to contracts table for fast progress queries
-- This avoids expensive COUNT(*) queries on wallet_interactions

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS total_indexed BIGINT DEFAULT 0;

-- Direct updates for event-based contracts (pre-computed counts)
-- GM Contract
UPDATE contracts SET total_indexed = 22139853 WHERE LOWER(address) = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';
-- Second event contract
UPDATE contracts SET total_indexed = 190403 WHERE LOWER(address) = '0x9b17690de96fcfa80a3acaefe11d936629cd7a77';

-- Sync from tx_indexer_cursors for all tx-based contracts (instant)
UPDATE contracts c
SET total_indexed = cursor.total_indexed
FROM tx_indexer_cursors cursor
WHERE LOWER(c.address) = cursor.contract_address;

COMMENT ON COLUMN contracts.total_indexed IS 'Pre-computed count of indexed transactions/interactions for this contract';
