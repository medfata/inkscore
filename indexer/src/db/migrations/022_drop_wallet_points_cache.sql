-- Migration: Drop wallet_points_cache table
-- This table is no longer used - scores are calculated on-demand with in-memory caching only

-- Drop indexes first
DROP INDEX IF EXISTS idx_wpc_wallet;
DROP INDEX IF EXISTS idx_wpc_points;
DROP INDEX IF EXISTS idx_wpc_rank;

-- Drop the table
DROP TABLE IF EXISTS wallet_points_cache;
