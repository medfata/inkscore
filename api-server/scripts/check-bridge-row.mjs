// One-off bridge-row inspection.
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const c = new pg.Client({ connectionString: env.match(/DATABASE_URL=(.*)/)[1].trim() });
await c.connect();
const w = process.argv[2] || '0x8655df35818f348ea4e371a613e73677d816f589';
const r = await c.query(
  `SELECT complete, covered_newest,
          done_tt, done_it, done_tx,
          tt_cursor IS NOT NULL AS tt, it_cursor IS NOT NULL AS it, tx_cursor IS NOT NULL AS tx,
          jsonb_array_length(inflows) AS inflows, age(updated_at, now()) AS age
   FROM bs_bridge_inflows WHERE wallet_address = $1`, [w.toLowerCase()]);
console.log(r.rows[0] || 'no row');
await c.end();
