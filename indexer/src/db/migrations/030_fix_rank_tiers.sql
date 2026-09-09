-- 030: Fix rank tier boundaries
-- 'Ink Drop' was seeded with min=0, max=99999, which shadowed every other
-- tier: getRankForPoints() returns the FIRST row containing the score
-- (ordered by min_points ASC), so every wallet below 100,000 points
-- displayed as 'Ink Drop'. Align all tier boundaries and colors with the
-- tiers documented on /how-it-works.
UPDATE ranks SET max_points = 499 WHERE name = 'Ink Drop' AND max_points = 99999;

-- Sync colors with the documented palette on /how-it-works
UPDATE ranks SET color = '#6B7280' WHERE name = 'Ink Drop';
UPDATE ranks SET color = '#10B981' WHERE name = 'Little Squid';
UPDATE ranks SET color = '#3B82F6' WHERE name = 'Explorer';
UPDATE ranks SET color = '#06B6D4' WHERE name = 'Deep Diver';
UPDATE ranks SET color = '#8B5CF6' WHERE name = 'Captain';
UPDATE ranks SET color = '#F59E0B' WHERE name = 'Commander';
UPDATE ranks SET color = '#A855F7' WHERE name = 'Abyss Lord';
UPDATE ranks SET color = '#EF4444' WHERE name = 'The Kraken';
UPDATE ranks SET color = '#FFD700' WHERE name = 'Ink God';

-- 'Phase1 Guaranteed' is a legacy marker row (min=0, max=999999) that ties
-- with 'Ink Drop' at min_points=0; the engine's ORDER BY min_points ASC has
-- no tiebreaker, so it can sort first and rank every wallet
-- 'Phase1 Guaranteed'. Nothing references it by name (no admin_score_overrides
-- row, no code reference) — deactivate it.
UPDATE ranks SET is_active = false WHERE name = 'Phase1 Guaranteed';
