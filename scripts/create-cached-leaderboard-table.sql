-- Migration: Create cached_leaderboard table for storing leaderboard cache
-- This table stores the complete leaderboard data as JSONB with TTL support

CREATE TABLE IF NOT EXISTS cached_leaderboard (
  id INTEGER PRIMARY KEY DEFAULT 1,
  leaderboard_data JSONB NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficiently checking expiration
CREATE INDEX IF NOT EXISTS idx_cached_leaderboard_expires 
ON cached_leaderboard(expires_at);

-- Initialize with empty data if not exists
INSERT INTO cached_leaderboard (id, leaderboard_data, total_count, expires_at, created_at, updated_at)
SELECT 1, '[]', 0, NOW() - INTERVAL '1 second', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM cached_leaderboard WHERE id = 1);
