// One-off row inspection for the native-outflow cursor convergence.
import { readFileSync } from 'node:fs';
import pg from 'pg';
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = env.match(/DATABASE_URL=(.*)/)[1].trim();
const c = new pg.Client({ connectionString: url });
await c.connect();
const w = process.argv[2] || '0x8655df35818f348ea4e371a613e73677d816f589';
const r = await c.query(
  `SELECT out_count, out_wei, done, covered_newest, next_cursor IS NOT NULL AS has_cursor,
          (SELECT count(*) FROM jsonb_array_elements(out_txs) t) AS stored
   FROM bs_native_volume WHERE wallet_address = $1`, [w.toLowerCase()]);
console.log(r.rows[0] || 'no row');
await c.end();
