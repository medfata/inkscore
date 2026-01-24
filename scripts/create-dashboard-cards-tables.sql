-- Dashboard Cards Tables
-- Run this migration to add dashboard card management

-- Main dashboard cards table
CREATE TABLE IF NOT EXISTS dashboard_cards (
  id SERIAL PRIMARY KEY,
  row VARCHAR(10) NOT NULL CHECK (row IN ('row3', 'row4')),
  card_type VARCHAR(20) NOT NULL CHECK (card_type IN ('aggregate', 'single')),
  title VARCHAR(100) NOT NULL,
  subtitle VARCHAR(200),
  color VARCHAR(20) NOT NULL DEFAULT 'purple',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Link cards to metrics (many-to-many)
CREATE TABLE IF NOT EXISTS dashboard_card_metrics (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES dashboard_cards(id) ON DELETE CASCADE,
  metric_id INTEGER NOT NULL REFERENCES analytics_metrics(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(card_id, metric_id)
);

-- Link cards to platforms for logo display (many-to-many)
CREATE TABLE IF NOT EXISTS dashboard_card_platforms (
  id SERIAL PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES dashboard_cards(id) ON DELETE CASCADE,
  platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(card_id, platform_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_dashboard_cards_row ON dashboard_cards(row);
CREATE INDEX IF NOT EXISTS idx_dashboard_cards_active ON dashboard_cards(is_active);
CREATE INDEX IF NOT EXISTS idx_dashboard_cards_order ON dashboard_cards(row, display_order);
CREATE INDEX IF NOT EXISTS idx_dashboard_card_metrics_card ON dashboard_card_metrics(card_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_card_platforms_card ON dashboard_card_platforms(card_id);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_dashboard_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_dashboard_cards_updated_at ON dashboard_cards;
CREATE TRIGGER trigger_dashboard_cards_updated_at
  BEFORE UPDATE ON dashboard_cards
  FOR EACH ROW
  EXECUTE FUNCTION update_dashboard_cards_updated_at();
