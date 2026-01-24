-- Migration: NFT Mints Tracking
-- Description: Track minted Score NFTs for leaderboard display
-- Created: 2026-01-24

-- Create nft_mints table
CREATE TABLE IF NOT EXISTS nft_mints (
    wallet_address VARCHAR(42) PRIMARY KEY,
    token_id BIGINT NOT NULL,
    score BIGINT NOT NULL DEFAULT 0,
    rank VARCHAR(50) NOT NULL DEFAULT 'Unranked',
    nft_image_url TEXT NOT NULL,
    minted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for ordering by score (leaderboard queries)
CREATE INDEX idx_nft_mints_score_desc ON nft_mints(score DESC, minted_at ASC);

-- Create index for rank filtering
CREATE INDEX idx_nft_mints_rank ON nft_mints(rank);

-- Add comment
COMMENT ON TABLE nft_mints IS 'Tracks minted Score NFTs for leaderboard display';
COMMENT ON COLUMN nft_mints.wallet_address IS 'Wallet address (primary key, lowercase)';
COMMENT ON COLUMN nft_mints.token_id IS 'Current NFT token ID for this wallet';
COMMENT ON COLUMN nft_mints.score IS 'Score at time of mint/update';
COMMENT ON COLUMN nft_mints.rank IS 'Rank tier at time of mint/update';
COMMENT ON COLUMN nft_mints.nft_image_url IS 'URL to NFT metadata endpoint';
COMMENT ON COLUMN nft_mints.minted_at IS 'First mint timestamp';
COMMENT ON COLUMN nft_mints.updated_at IS 'Last update timestamp';
