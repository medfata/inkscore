// DB cleanup inventory: tables by size, unused indexes, and usage classification.
// READ-ONLY — prints a report, changes nothing.
require('dotenv').config();
const { Client } = require('pg');

// Tables the CURRENT api-server code path reads/writes (grep-verified).
const API_OWNED = new Set([
  'bs_wallet_stats', 'bs_holdings', 'bs_protocol_counts', 'bs_tx_legs', 'bs_native_volume',
  'bs_tx_logs', 'bs_bridge_inflows', 'bs_refresh_queue', 'bs_tx_metas', 'bs_tx_discovery',
  'bs_protocol_tx_hashes', 'opensea_wallet_counts', 'wallet_metrics_snapshots',
  'wallet_dashboard_snapshots', 'eth_prices', 'cached_leaderboard', 'admin_score_overrides',
  'dashboard_cards', 'dashboard_card_metrics', 'dashboard_card_platforms', 'platforms',
  'contracts', 'platform_contracts', 'user_analytics_cache', 'ranks', 'users', 'admin_users',
  'nft_mints', 'nft_metadata_cache', 'meme_coins', 'sessions',
]);

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const tables = await c.query(`
    SELECT relname AS table_name, n_live_tup AS rows,
           pg_total_relation_size(relid) AS total_bytes,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC`);
  console.log('=== TABLES (total size desc) ===');
  for (const t of tables.rows) {
    const tag = API_OWNED.has(t.table_name) ? 'API' : '?';
    console.log(`  [${tag}] ${t.table_name.padEnd(36)} ${String(t.rows).padStart(10)} rows  ${t.total_size.padStart(10)}`);
  }

  const idx = await c.query(`
    SELECT s.relname AS table_name, s.indexrelname AS index_name,
           s.idx_scan AS scans, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
      FROM pg_stat_user_indexes s
      JOIN pg_index i ON i.indexrelid = s.indexrelid
      WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
      ORDER BY pg_relation_size(s.indexrelid) DESC
      LIMIT 40`);
  console.log('\n=== NEVER-SCANNED NON-UNIQUE INDEXES (candidates to drop) ===');
  if (idx.rows.length === 0) console.log('  (none)');
  for (const x of idx.rows) {
    console.log(`  ${x.table_name}.${x.index_name.padEnd(44)} scans=0  size=${x.size}`);
  }

  const views = await c.query(`SELECT viewname FROM pg_views WHERE schemaname='public'`);
  console.log('\n=== VIEWS ===');
  views.rows.forEach((v) => console.log('  ' + v.viewname));

  await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
