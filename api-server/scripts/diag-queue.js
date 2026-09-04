// Diagnostic: leaderboard contents + refresh queue state.
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const lb = await c.query(
    "SELECT entry->>'wallet_address' AS w, entry->>'score' AS s FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry WHERE id = 1 ORDER BY (entry->>'score')::numeric DESC LIMIT 12"
  );
  console.log('LEADERBOARD TOP:');
  lb.rows.forEach((r, i) => console.log(' ', i + 1, r.w, String(r.s).slice(0, 12)));
  const q = await c.query('SELECT wallet_address, protocol, attempts, next_run FROM bs_refresh_queue ORDER BY next_run LIMIT 15');
  console.log('QUEUE ROWS:', q.rows.length);
  q.rows.forEach((r) => console.log(' ', r.wallet_address.slice(0, 14), r.protocol || '(wallet)', 'attempts=' + r.attempts));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
