// Diagnostic: inspect wallet_metrics_snapshots (ages, partial flags, sizes).
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT wallet, partial, captured_at,
            ROUND(EXTRACT(EPOCH FROM (NOW() - captured_at))) AS age_s,
            LENGTH(inputs::text) AS bytes
       FROM wallet_metrics_snapshots
      ORDER BY captured_at DESC`
  );
  for (const x of r.rows) {
    console.log(x.wallet.slice(0, 12), `partial=${x.partial}`, `age=${x.age_s}s`, `bytes=${x.bytes}`);
  }
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
