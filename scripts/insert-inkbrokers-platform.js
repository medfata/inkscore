// Ink Brokers: register platform + contracts + analytics metric (registry
// rows only — fetch_transactions=false, so the legacy indexer never touches
// them; per-wallet scanning is handled by api-server blockscout walkers).
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, connectionTimeoutMillis: 8000 });

const CONTRACTS = [
  { address: '0xDe773cf5e6973e29aff7e7125fB4dF21BbdE713E', name: 'BrokerDesk', category: 'nft_desk' },
  { address: '0xf006Eca4Cd5CF93C55D2F763F42f694125f0255A', name: 'BrokerCounter', category: 'nft_amm' },
  { address: '0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f', name: 'InkBrokersNFT', category: 'nft_collection' },
  { address: '0x1b18889ca21a0de73a8541b12ef2bcdd3d6a24ef', name: 'InkBrokersToken', category: 'token' },
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Platform
    const platformRes = await client.query(
      `INSERT INTO platforms (slug, name, description, website_url, platform_type, is_active, display_order)
       VALUES ('ink_brokers', 'Ink Brokers', $1, 'https://inkbrokers.com', 'nft', true, 0)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      ['Ink Brokers — ERC-6551 broker desks: clock in, hold a tiered seat, claim fee rounds']
    );
    let platformId;
    if (platformRes.rows.length > 0) {
      platformId = platformRes.rows[0].id;
    } else {
      const existing = await client.query(`SELECT id FROM platforms WHERE slug = 'ink_brokers'`);
      platformId = existing.rows[0].id;
    }
    console.log('platform id:', platformId);

    // 2. Contracts (registry only — no indexer scanning)
    const contractIds = {};
    for (const c of CONTRACTS) {
      const res = await client.query(
        `INSERT INTO contracts (address, name, category, chain_id, fetch_transactions, indexing_enabled, indexing_status, is_active)
         VALUES ($1, $2, $3, 57073, false, false, 'not_indexed', true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [c.address.toLowerCase(), c.name, c.category]
      );
      let id;
      if (res.rows.length > 0) {
        id = res.rows[0].id;
      } else {
        const existing = await client.query('SELECT id FROM contracts WHERE address = $1', [c.address.toLowerCase()]);
        id = existing.rows[0].id;
        // Ensure the registry-only flags even if the row pre-existed
        await client.query(
          'UPDATE contracts SET fetch_transactions = false, indexing_enabled = false WHERE id = $1',
          [id]
        );
      }
      contractIds[c.name] = id;
      console.log('contract:', c.name, 'id:', id);
    }

    // 3. Links
    for (const name of Object.keys(contractIds)) {
      const res = await client.query(
        `INSERT INTO platform_contracts (platform_id, contract_id)
         SELECT $1, $2 WHERE NOT EXISTS (
           SELECT 1 FROM platform_contracts WHERE platform_id = $1 AND contract_id = $2
         )`,
        [platformId, contractIds[name]]
      );
      if (res.rowCount > 0) console.log('linked:', name);
    }

    // 4. Analytics metric (for future dashboard card / points wiring)
    const metric = await client.query(
      `INSERT INTO analytics_metrics (slug, name, description, aggregation_type, currency, is_active, icon)
       VALUES ('ink_brokers', 'Ink Brokers', $1, 'count', 'COUNT', true, '🏛️')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      ['Ink Brokers desk activity: clock-ins, claims, active seats']
    );
    console.log('analytics_metrics:', metric.rows.length > 0 ? 'inserted id ' + metric.rows[0].id : 'already exists');

    await client.query('COMMIT');
    console.log('DONE');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('FAILED, rolled back:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
