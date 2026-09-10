// Migration 01 — drop inflated bs_protocol_counts rows so they rebuild exact.
// NOTE: since COUNT_REGISTRY_VERSION=cnt-v2, stored rows self-migrate on
// next touch (version mismatch => full rebuild). This script is now only an
// emergency tool (e.g. force-immediate rebuild of specific wallets) — NOT a
// required deploy step. Safe to run anytime: rebuilds are exact + idempotent.
// Snapshots self-heal via TTL; in-memory caches clear on server restart.
import pg from 'pg';

const PROTOCOLS = [
  'zns-deploy', 'zns-saygm', 'zns-saygm-v2', 'zns-register',
  'nado-all',
  'nft2me-created', 'nft2me-minted',
  'shellies-raffle-1', 'shellies-raffle-2', 'shellies-pay', 'shellies-staking',
  'inkypump-created',
  'inkbrokers-clockin', 'inkbrokers-claim',
];

const scope = process.argv[2] || '';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
if (scope === '--global') {
  const r = await c.query(`DELETE FROM bs_protocol_counts WHERE protocol = ANY($1)`, [PROTOCOLS]);
  console.log(`global: deleted ${r.rowCount} inflated count rows (${PROTOCOLS.length} protocols, all wallets)`);
} else if (/^0x[0-9a-f]{40}$/i.test(scope)) {
  const r = await c.query(
    `DELETE FROM bs_protocol_counts WHERE wallet_address = $1 AND protocol = ANY($2)`,
    [scope.toLowerCase(), PROTOCOLS]
  );
  console.log(`scoped ${scope.slice(0, 12)}: deleted ${r.rowCount} rows`);
} else {
  console.log('usage: node --env-file=.env scripts/migrate-fix-count-cursors.mjs [0xWallet|--global]');
  console.log(`would target ${PROTOCOLS.length} protocols: ${PROTOCOLS.join(',')}`);
}
await c.end();
