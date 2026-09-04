CREATE TABLE IF NOT EXISTS admin_score_overrides (
    wallet_address VARCHAR(42) PRIMARY KEY,
    score BIGINT NOT NULL,
    rank VARCHAR(50) NOT NULL DEFAULT 'Unranked',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
