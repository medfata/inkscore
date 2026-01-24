-- ============================================================================
-- Migration 007: Points Rules linked to Analytics Metrics
-- ============================================================================
-- This migration changes points_rules to link to analytics_metrics instead of
-- directly to platforms. This allows:
-- 1. Rules that span multiple platforms (via metrics using contracts from multiple platforms)
-- 2. Rules targeting specific metrics (e.g., only swap volume, not all platform activity)
-- 3. More granular control over what activity earns points
--
-- New relationship: Points Rule -> Analytics Metrics -> Contracts -> Platforms
-- ============================================================================

-- ============================================================================
-- PART 1: CREATE JUNCTION TABLE FOR RULES <-> METRICS
-- ============================================================================

-- Junction table for points_rules <-> analytics_metrics (M:N relationship)
CREATE TABLE IF NOT EXISTS points_rule_metrics (
  id SERIAL PRIMARY KEY,
  rule_id INT NOT NULL REFERENCES points_rules(id) ON DELETE CASCADE,
  metric_id INT NOT NULL REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(rule_id, metric_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_prm_rule ON points_rule_metrics(rule_id);
CREATE INDEX IF NOT EXISTS idx_prm_metric ON points_rule_metrics(metric_id);

-- ============================================================================
-- PART 2: UPDATE POINTS_RULES TABLE
-- ============================================================================

-- Add new metric_type value 'metric' for rules linked to analytics_metrics
-- Keep 'platform' and 'native' for backward compatibility during transition
ALTER TABLE points_rules DROP CONSTRAINT IF EXISTS check_metric_reference;

-- Add new constraint that allows 'metric' type
ALTER TABLE points_rules ADD CONSTRAINT check_metric_reference CHECK (
  (metric_type = 'platform' AND platform_id IS NOT NULL AND native_metric_id IS NULL) OR
  (metric_type = 'native' AND native_metric_id IS NOT NULL AND platform_id IS NULL) OR
  (metric_type = 'metric' AND platform_id IS NULL AND native_metric_id IS NULL)
);

-- ============================================================================
-- PART 3: MIGRATE EXISTING PLATFORM RULES TO METRIC-BASED RULES
-- ============================================================================

-- For existing platform-based rules, we'll keep them as-is for now
-- They can be manually migrated to metric-based rules via the admin UI
-- This ensures no data loss and backward compatibility

-- ============================================================================
-- PART 4: HELPER VIEW FOR RULE -> METRICS -> CONTRACTS -> PLATFORMS
-- ============================================================================

-- View to easily see the full relationship chain
CREATE OR REPLACE VIEW v_points_rule_details AS
SELECT 
  pr.id as rule_id,
  pr.name as rule_name,
  pr.metric_type,
  pr.calculation_mode,
  pr.is_active as rule_active,
  -- For metric-based rules
  am.id as metric_id,
  am.name as metric_name,
  am.slug as metric_slug,
  am.aggregation_type,
  am.currency,
  -- Contract info (from analytics_metric_contracts)
  amc.contract_address,
  c.name as contract_name,
  -- Platform info (from platform_contracts)
  p.id as platform_id,
  p.name as platform_name,
  p.slug as platform_slug
FROM points_rules pr
LEFT JOIN points_rule_metrics prm ON pr.id = prm.rule_id
LEFT JOIN analytics_metrics am ON prm.metric_id = am.id
LEFT JOIN analytics_metric_contracts amc ON am.id = amc.metric_id
LEFT JOIN contracts c ON LOWER(amc.contract_address) = LOWER(c.address)
LEFT JOIN platform_contracts pc ON c.id = pc.contract_id
LEFT JOIN platforms p ON pc.platform_id = p.id
WHERE pr.metric_type = 'metric'

UNION ALL

-- For legacy platform-based rules (backward compatibility)
SELECT 
  pr.id as rule_id,
  pr.name as rule_name,
  pr.metric_type,
  pr.calculation_mode,
  pr.is_active as rule_active,
  NULL as metric_id,
  NULL as metric_name,
  NULL as metric_slug,
  NULL as aggregation_type,
  NULL as currency,
  c.address as contract_address,
  c.name as contract_name,
  p.id as platform_id,
  p.name as platform_name,
  p.slug as platform_slug
FROM points_rules pr
JOIN platforms p ON pr.platform_id = p.id
JOIN platform_contracts pc ON p.id = pc.platform_id
JOIN contracts c ON pc.contract_id = c.id
WHERE pr.metric_type = 'platform'

UNION ALL

-- For native metric rules
SELECT 
  pr.id as rule_id,
  pr.name as rule_name,
  pr.metric_type,
  pr.calculation_mode,
  pr.is_active as rule_active,
  NULL as metric_id,
  nm.name as metric_name,
  nm.key as metric_slug,
  NULL as aggregation_type,
  NULL as currency,
  NULL as contract_address,
  NULL as contract_name,
  NULL as platform_id,
  NULL as platform_name,
  NULL as platform_slug
FROM points_rules pr
JOIN native_metrics nm ON pr.native_metric_id = nm.id
WHERE pr.metric_type = 'native';

-- ============================================================================
-- DONE
-- ============================================================================
