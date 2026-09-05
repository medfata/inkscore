// Print the full address of the freshest non-test snapshot (for serve-path tests).
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT wallet, captured_at FROM wallet_metrics_snapshots
      WHERE wallet <> '0x8655df35818f348ea4e371a613e73677d816f589'
      ORDER BY captured_at DESC LIMIT 3`
  );
  r.rows.forEach((x) => console.log(x.wallet));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
