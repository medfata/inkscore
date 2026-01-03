import 'dotenv/config';
import { pool } from './dist/db/index.js';
import fs from 'fs';

async function runMigration() {
  try {
    console.log('Running hybrid migration...');
    
    const sql = fs.readFileSync('./src/db/migrate-hybrid.sql', 'utf-8');
    await pool.query(sql);
    
    console.log('✅ Hybrid migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

runMigration();