-- Migration: Normalize wallet addresses to lowercase
-- This fixes data inconsistency where some wallet_address values were stored with mixed case
-- (checksummed format) instead of lowercase

-- Update transaction_details table
UPDATE transaction_details 
SET wallet_address = LOWER(wallet_address)
WHERE wallet_address != LOWER(wallet_address);

-- Update to_address as well for consistency
UPDATE transaction_details 
SET to_address = LOWER(to_address)
WHERE to_address IS NOT NULL AND to_address != LOWER(to_address);

-- Verify the fix
-- SELECT COUNT(*) as remaining_mixed_case FROM transaction_details WHERE wallet_address != LOWER(wallet_address);
