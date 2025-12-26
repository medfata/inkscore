/**
 * Migration script for tracked_assets table
 * Run with: npx ts-node scripts/migrate-tracked-assets.ts
 * Or: npx tsx scripts/migrate-tracked-assets.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Running tracked_assets migration...');
    
    const migrationPath = path.join(__dirname, '../indexer/src/db/migrations/008_tracked_assets.sql');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify the data
    const result = await pool.query('SELECT asset_type, COUNT(*) as count FROM tracked_assets GROUP BY asset_type');
    console.log('\nAssets created:');
    for (const row of result.rows) {
      console.log(`  - ${row.asset_type}: ${row.count}`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
