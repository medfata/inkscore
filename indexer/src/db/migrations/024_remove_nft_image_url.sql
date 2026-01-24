-- Migration: Remove redundant nft_image_url column
-- Description: Remove nft_image_url since we can derive it from wallet address via contract
-- Created: 2026-01-24

-- Drop the nft_image_url column
ALTER TABLE nft_mints DROP COLUMN IF EXISTS nft_image_url;

-- Drop the token_id column (also derived from contract)
ALTER TABLE nft_mints DROP COLUMN IF EXISTS token_id;

-- Add comment
COMMENT ON TABLE nft_mints IS 'Tracks minted Score NFTs for leaderboard display (tokenId and image URL derived from contract)';
