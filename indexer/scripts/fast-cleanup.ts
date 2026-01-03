#!/usr/bin/env tsx

/**
 * Fast Schema Cleanup - No Migration, Just Drop Duplicates
 * 
 * This script quickly drops duplicate tables without any data migration.
 * Use this when you're confident transaction_details has all the data you need.
 */

import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fastCleanup(): Promise<void> {
  console.log('🚀 Fast Schema Cleanup - Dropping Duplicate Tables\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    // Verify transaction_details has data
    const txCount = await pool.query('SELECT COUNT(*) as count FROM transaction_details');
    const count = parseInt(txCount.rows[0].count);
    
    console.log(`📊 transaction_details has ${count.toLocaleString()} records`);
    
    if (count === 0) {
      console.error('❌ transaction_details is empty! Aborting cleanup.');
      process.exit(1);
    }

    console.log('\n🗑️  Dropping duplicate transaction tables...');

    // Drop duplicate transaction tables
    const tablesToDrop = [
      'transactions',
      'volume_transactions', 
      'benchmark_transactions'
    ];

    for (const table of tablesToDrop) {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✅ Dropped ${table}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop ${table}:`, error.message);
      }
    }

    // Drop sequences
    const sequencesToDrop = [
      'transactions_id_seq',
      'volume_transactions_id_seq'
    ];

    for (const sequence of sequencesToDrop) {
      try {
        await pool.query(`DROP SEQUENCE IF EXISTS ${sequence} CASCADE`);
        console.log(`  ✅ Dropped sequence ${sequence}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop sequence ${sequence}:`, error.message);
      }
    }

    console.log('\n🗑️  Dropping duplicate cursor tables...');

    // Drop duplicate cursor tables
    const cursorTablesToDrop = [
      'fast_tx_indexer_cursors',
      'hybrid_tx_indexer_cursors',
      'indexer_cursors',
      'indexer_ranges',
      'tx_indexer_ranges',
      'volume_indexer_ranges'
    ];

    for (const table of cursorTablesToDrop) {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✅ Dropped ${table}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop ${table}:`, error.message);
      }
    }

    // Drop cursor sequences
    const cursorSequencesToDrop = [
      'fast_tx_indexer_cursors_id_seq',
      'hybrid_tx_indexer_cursors_id_seq',
      'indexer_ranges_id_seq',
      'tx_indexer_ranges_id_seq',
      'volume_indexer_ranges_id_seq'
    ];

    for (const sequence of cursorSequencesToDrop) {
      try {
        await pool.query(`DROP SEQUENCE IF EXISTS ${sequence} CASCADE`);
        console.log(`  ✅ Dropped sequence ${sequence}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop sequence ${sequence}:`, error.message);
      }
    }

    console.log('\n🗑️  Dropping duplicate contract tables...');

    // Drop duplicate contract tables (keep contracts as main)
    const contractTablesToDrop = [
      'contracts_metadata',
      'contracts_to_index'
    ];

    for (const table of contractTablesToDrop) {
      try {
        await pool.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`  ✅ Dropped ${table}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop ${table}:`, error.message);
      }
    }

    // Drop contract sequences
    const contractSequencesToDrop = [
      'contracts_metadata_id_seq',
      'contracts_to_index_id_seq'
    ];

    for (const sequence of contractSequencesToDrop) {
      try {
        await pool.query(`DROP SEQUENCE IF EXISTS ${sequence} CASCADE`);
        console.log(`  ✅ Dropped sequence ${sequence}`);
      } catch (error) {
        console.log(`  ⚠️  Failed to drop sequence ${sequence}:`, error.message);
      }
    }

    console.log('\n🔧 Optimizing remaining tables...');

    // Optimize main tables
    await pool.query('ANALYZE transaction_details');
    await pool.query('ANALYZE contracts');
    await pool.query('ANALYZE tx_indexer_cursors');
    console.log('  ✅ Updated table statistics');

    // Final verification
    const remainingTables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND (
          table_name LIKE '%transaction%' OR
          table_name LIKE '%contract%' OR
          table_name LIKE '%cursor%' OR
          table_name LIKE '%range%'
        )
      ORDER BY table_name
    `);

    console.log('\n📊 Remaining relevant tables:');
    for (const row of remainingTables.rows) {
      console.log(`  - ${row.table_name}`);
    }

    console.log('\n🎉 Fast cleanup completed successfully!');
    console.log('\nMain tables preserved:');
    console.log('  ✅ transaction_details (all transaction data)');
    console.log('  ✅ contracts (all contract data)');
    console.log('  ✅ tx_indexer_cursors (indexing progress)');
    console.log('\nDuplicate tables removed:');
    console.log('  ❌ transactions, volume_transactions, benchmark_transactions');
    console.log('  ❌ contracts_metadata, contracts_to_index');
    console.log('  ❌ 6 experimental cursor/range tables');

  } catch (error) {
    console.error('💥 Fast cleanup failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Cleanup interrupted by user');
  await pool.end();
  process.exit(1);
});

// Run the cleanup
fastCleanup().catch(console.error);