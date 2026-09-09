-- 031: Restore admin-points tables
-- native_metrics / points_rules / points_rule_metrics were dropped in the
-- 2026-09-07 legacy-indexer cleanup, but the new /admin/points feature
-- (routes /api/admin/points/*, lib/services/points-service.ts) depends on
-- them. Recreated EMPTY per the original 006/007 definitions — rules are
-- re-created via the admin UI. (transaction_details stays dropped: its
-- Next-side helpers catch and degrade to 0.)

CREATE TABLE IF NOT EXISTS native_metrics (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  value_type VARCHAR(20) NOT NULL,
  icon VARCHAR(50),
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO native_metrics (key, name, description, value_type, icon, display_order) VALUES
  ('wallet_age', 'Wallet Age', 'Days since first transaction on Ink chain', 'days', 'calendar', 1),
  ('total_tx', 'Total Transactions', 'Total number of transactions on Ink chain', 'count', 'activity', 2),
  ('nft_collections', 'NFT Holdings', 'Number of NFTs held', 'count', 'image', 3),
  ('erc20_tokens', 'Token Holdings', 'Total USD value of ERC-20 tokens held', 'usd', 'coins', 4)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS points_rules (
  id SERIAL PRIMARY KEY,
  metric_type VARCHAR(20) NOT NULL,
  platform_id INT REFERENCES platforms(id) ON DELETE CASCADE,
  native_metric_id INT REFERENCES native_metrics(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  calculation_mode VARCHAR(20) NOT NULL,
  ranges JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  display_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT check_metric_reference CHECK (
    (metric_type = 'platform' AND platform_id IS NOT NULL AND native_metric_id IS NULL) OR
    (metric_type = 'native' AND native_metric_id IS NOT NULL AND platform_id IS NULL) OR
    (metric_type = 'metric' AND platform_id IS NULL AND native_metric_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_points_rules_platform ON points_rules(platform_id);
CREATE INDEX IF NOT EXISTS idx_points_rules_native ON points_rules(native_metric_id);
CREATE INDEX IF NOT EXISTS idx_points_rules_active ON points_rules(is_active);

CREATE TABLE IF NOT EXISTS points_rule_metrics (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES points_rules(id) ON DELETE CASCADE,
  metric_id INT NOT NULL REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(rule_id, metric_id)
);

CREATE INDEX IF NOT EXISTS idx_prm_rule ON points_rule_metrics(rule_id);
CREATE INDEX IF NOT EXISTS idx_prm_metric ON points_rule_metrics(metric_id);
