// Space + backfill growth tracker (read-only).
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const dbs = await c.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS db, pg_database_size(current_database()) AS bytes');
  const legs = await c.query(`SELECT COUNT(*) n, pg_total_relation_size('bs_tx_legs') b FROM bs_tx_legs`);
  const h = await c.query(`SELECT COUNT(*) n, pg_total_relation_size('bs_protocol_tx_hashes') b FROM bs_protocol_tx_hashes`);
  const logs = await c.query(`SELECT COUNT(*) n, pg_total_relation_size('bs_tx_logs') b FROM bs_tx_logs`);
  const disc = await c.query(`SELECT COUNT(*) n FROM bs_tx_discovery`);
  const wal = await c.query('SELECT pg_size_pretty(COALESCE(SUM(size),0)) wal FROM pg_ls_waldir()');
  console.log('DB total:', dbs.rows[0].db, '(' + Math.round(dbs.rows[0].bytes / 1e9) + ' GB)');
  console.log('bs_tx_legs:            ', legs.rows[0].n, 'rows,', Math.round(legs.rows[0].b / 1048576), 'MB');
  console.log('bs_protocol_tx_hashes: ', h.rows[0].n, 'rows,', Math.round(h.rows[0].b / 1048576), 'MB');
  console.log('bs_tx_logs:            ', logs.rows[0].n, 'rows,', Math.round(logs.rows[0].b / 1048576), 'MB');
  console.log('bs_tx_discovery:       ', disc.rows[0].n, 'cursors');
  console.log('WAL dir:               ', wal.rows[0].wal);
  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
