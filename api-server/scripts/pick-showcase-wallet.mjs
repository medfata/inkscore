// Pick showcase wallets: top-ranked leaderboard entries that have complete
// metric snapshots (instant UI loads).
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const c = new pg.Client({ connectionString: env.match(/DATABASE_URL=(.*)/)[1].trim() });
await c.connect();
const r = await c.query(`
  SELECT entry->>'wallet_address' AS wallet,
         entry->>'score' AS score,
         EXISTS (SELECT 1 FROM wallet_metrics_snapshots s
                  WHERE s.wallet = entry->>'wallet_address' AND s.partial = false) AS snap,
         EXISTS (SELECT 1 FROM wallet_dashboard_snapshots d
                  WHERE d.wallet = entry->>'wallet_address') AS dash
  FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
  WHERE id = 1
  ORDER BY (entry->>'score')::numeric DESC
  LIMIT 12`);
for (const row of r.rows) console.log(`${row.snap ? 'SNAP ' : 'live '} wallet=${row.wallet} score=${row.score} dash=${row.dash}`);
await c.end();
