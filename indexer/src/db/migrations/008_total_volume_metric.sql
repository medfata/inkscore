-- ============================================================================
-- Migration 008: Add Total Volume Circulated Native Metric
-- ============================================================================
-- This migration adds a new native metric for tracking total ETH/USD volume
-- circulated by a wallet across all indexed transactions (incoming + outgoing)
-- ============================================================================

-- Add the new native metric
INSERT INTO native_metrics (key, name, description, value_type, icon, display_order, is_active) VALUES
  ('total_volume', 'Total Volume', 'Total ETH/USD volume circulated across all transactions', 'usd', 'trending-up', 5)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  value_type = EXCLUDED.value_type,
  icon = EXCLUDED.icon,
  display_order = EXCLUDED.display_order;

-- ============================================================================
-- DONE
-- ============================================================================
