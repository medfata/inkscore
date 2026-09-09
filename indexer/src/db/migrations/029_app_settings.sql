-- 029: App-level settings store
-- Key/value settings shared by the Next.js app and the api-server scoring
-- engine. Admin-managed (currently via /admin/points).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Signup bonus: points added to EVERY wallet's score on top of activity
-- points, rendered as its own 'bonus' entry in the score breakdown.
-- 0 = disabled (default until an admin enables it via /admin/points).
INSERT INTO app_settings (key, value)
VALUES ('signup_bonus_points', '{"points": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;
