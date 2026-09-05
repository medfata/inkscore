// One-time repair: remove 3500.00 fallback rows that price-service used to
// persist when CoinGecko failed (they polluted price history and mispriced
// historical USD analysis). The service no longer writes fallbacks.
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const d = await c.query("DELETE FROM eth_prices WHERE price_usd = 3500");
  console.log('deleted fallback rows:', d.rowCount);
  const r = await c.query('SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 3');
  r.rows.forEach((x) => console.log(x.price_usd));
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
