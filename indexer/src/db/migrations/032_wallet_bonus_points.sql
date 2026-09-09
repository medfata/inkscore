-- 032: Per-wallet bonus points
-- Complements the global signup bonus (029: app_settings.signup_bonus_points).
-- Stores a list of { address, points } entries applied ON TOP of the global
-- bonus, keyed by lowercase wallet address. Managed at /admin/points via
-- /api/admin/points/wallet-bonus. Empty list = feature disabled.
INSERT INTO app_settings (key, value)
VALUES ('wallet_bonus_points', '{"wallets": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;
