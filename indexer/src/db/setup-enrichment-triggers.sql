-- Setup Database Triggers for Event-Driven Enrichment
-- 
-- This creates PostgreSQL triggers that notify the enrichment service
-- immediately when new transactions are inserted into transaction_details
-- for volume contracts.

-- ============================================
-- 1. NOTIFICATION FUNCTION
-- ============================================
-- Function that sends notifications when new volume transactions are inserted

CREATE OR REPLACE FUNCTION notify_new_volume_transaction()
RETURNS TRIGGER AS $$
BEGIN
    -- Only notify for volume contracts
    IF EXISTS (
        SELECT 1 FROM contracts c 
        WHERE c.address = NEW.contract_address 
        AND c.contract_type = 'volume' 
        AND c.is_active = true 
        AND c.indexing_enabled = true
    ) THEN
        -- Send notification with contract address and transaction hash
        PERFORM pg_notify(
            'new_volume_transaction',
            json_build_object(
                'contract_address', NEW.contract_address,
                'tx_hash', NEW.tx_hash,
                'timestamp', NEW.block_timestamp
            )::text
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. TRIGGER SETUP
-- ============================================
-- Create trigger that fires after INSERT on transaction_details

DROP TRIGGER IF EXISTS trigger_new_volume_transaction ON transaction_details;

CREATE TRIGGER trigger_new_volume_transaction
    AFTER INSERT ON transaction_details
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_volume_transaction();

-- ============================================
-- 3. INDEXES FOR PERFORMANCE
-- ============================================
-- Ensure we have proper indexes for the enrichment queries

-- Index for finding missing transactions (used by enrichment service)
CREATE INDEX IF NOT EXISTS idx_transaction_details_contract_timestamp 
ON transaction_details(contract_address, block_timestamp DESC);

-- Index for checking enrichment status
CREATE INDEX IF NOT EXISTS idx_transaction_enrichment_tx_hash 
ON transaction_enrichment(tx_hash);

-- Composite index for volume contract lookups
CREATE INDEX IF NOT EXISTS idx_contracts_volume_active 
ON contracts(contract_type, is_active, indexing_enabled) 
WHERE contract_type = 'volume';

-- ============================================
-- 4. COMMENTS
-- ============================================
COMMENT ON FUNCTION notify_new_volume_transaction() IS 
'Sends PostgreSQL notifications when new transactions are inserted for active volume contracts';

COMMENT ON TRIGGER trigger_new_volume_transaction ON transaction_details IS 
'Triggers real-time enrichment notifications for volume contract transactions';

-- ============================================
-- 5. VERIFICATION
-- ============================================
-- Query to verify the trigger is working
-- SELECT * FROM pg_trigger WHERE tgname = 'trigger_new_volume_transaction';

-- Test notification (uncomment to test):
-- SELECT pg_notify('new_volume_transaction', '{"contract_address":"0x123","tx_hash":"0x456","timestamp":"2024-01-01"}');