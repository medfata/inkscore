#!/usr/bin/env tsx

/**
 * Simple Schema Consolidation Migration Runner
 * 
 * This script safely runs the schema consolidation migrations in the correct order.
 * 
 * Usage:
 *   tsx scripts/run-consolidation-migration-simple.ts [--dry-run] [--phase=1,2,3,4]
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface MigrationPhase {
  phase: number;
  name: string;
  file: string;
  description: string;
  destructive: boolean;
}

const MIGRATION_PHASES: MigrationPhase[] = [
  {
    phase: 1,
    name: 'Contract Consolidation',
    file: '014_consolidate_schema_phase1_contracts.sql',
    description: 'Consolidates contracts, contracts_metadata, and contracts_to_index into a single contracts table',
    destructive: false,
  },
  {
    phase: 2,
    name: 'Fast Transaction Cleanup',
    file: '015_consolidate_schema_phase2_transactions_fast.sql',
    description: 'Drops redundant transaction tables, keeps transaction_details',
    destructive: true,
  },
  {
    phase: 3,
    name: 'Cursor Consolidation',
    file: '016_consolidate_schema_phase3_cursors.sql',
    description: 'Consolidates indexer cursor and range tables',
    destructive: false,
  },
  {
    phase: 4,
    name: 'Final Cleanup',
    file: '017_consolidate_schema_phase4_cleanup.sql',
    description: 'Drops all deprecated tables (DESTRUCTIVE)',
    destructive: true,
  },
];

async function checkMigrationStatus(): Promise<void> {
  console.log('🔍 Checking current migration status...\n');

  try {
    // Check if schema_migrations table exists
    const migrationTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'schema_migrations'
      );
    `);

    if (!migrationTableExists.rows[0].exists) {
      console.log('❌ schema_migrations table not found. Please run initial migrations first.');
      process.exit(1);
    }

    // Check which consolidation migrations have been run
    const completedMigrations = await pool.query(`
      SELECT filename FROM schema_migrations 
      WHERE filename LIKE '%consolidate_schema%'
      ORDER BY filename
    `);

    console.log('Completed consolidation migrations:');
    if (completedMigrations.rows.length === 0) {
      console.log('  None');
    } else {
      for (const row of completedMigrations.rows) {
        console.log(`  ✅ ${row.filename}`);
      }
    }
    console.log();
  } catch (error) {
    console.error('❌ Failed to check migration status:', error);
    process.exit(1);
  }
}

async function analyzeCurrentSchema(): Promise<void> {
  console.log('📊 Analyzing current schema...\n');

  try {
    // Check which tables exist
    const existingTables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'contracts', 'contracts_metadata', 'contracts_to_index',
          'transaction_details', 'transactions', 'volume_transactions', 'benchmark_transactions',
          'tx_indexer_cursors', 'fast_tx_indexer_cursors', 'hybrid_tx_indexer_cursors', 
          'indexer_cursors', 'indexer_ranges', 'tx_indexer_ranges', 'volume_indexer_ranges'
        )
      ORDER BY table_name
    `);

    const tableNames = existingTables.rows.map(r => r.table_name);
    
    const contractTables = tableNames.filter(t => t.includes('contract'));
    const transactionTables = tableNames.filter(t => t.includes('transaction'));
    const cursorTables = tableNames.filter(t => t.includes('cursor') || t.includes('range'));

    console.log(`Contract tables found (${contractTables.length}):`);
    contractTables.forEach(t => console.log(`  - ${t}`));
    
    console.log(`\nTransaction tables found (${transactionTables.length}):`);
    transactionTables.forEach(t => console.log(`  - ${t}`));
    
    console.log(`\nCursor/Range tables found (${cursorTables.length}):`);
    cursorTables.forEach(t => console.log(`  - ${t}`));
    console.log();
  } catch (error) {
    console.error('❌ Failed to analyze schema:', error);
    process.exit(1);
  }
}

async function runMigrationPhase(phase: MigrationPhase, dryRun: boolean = false): Promise<void> {
  console.log(`🚀 ${dryRun ? '[DRY RUN] ' : ''}Running Phase ${phase.phase}: ${phase.name}`);
  console.log(`   ${phase.description}`);
  
  if (phase.destructive) {
    console.log('   ⚠️  WARNING: This phase is DESTRUCTIVE and will drop tables!');
  }
  
  if (dryRun) {
    console.log(`   📄 Would execute: ${phase.file}`);
    return;
  }

  const migrationPath = join(__dirname, '../src/db/migrations', phase.file);
  
  // Check if migration file exists
  if (!existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  try {
    const sql = readFileSync(migrationPath, 'utf-8');
    
    console.log(`   📄 Executing ${phase.file}...`);
    const startTime = Date.now();
    
    await pool.query(sql);
    
    const duration = Date.now() - startTime;
    console.log(`   ✅ Phase ${phase.phase} completed in ${duration}ms\n`);
    
  } catch (error) {
    console.error(`   ❌ Phase ${phase.phase} failed:`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const phaseArg = args.find(arg => arg.startsWith('--phase='));
  
  let phasesToRun: number[] = [1, 2, 3, 4];
  if (phaseArg) {
    phasesToRun = phaseArg.split('=')[1].split(',').map(p => parseInt(p.trim()));
  }

  console.log('🔧 Schema Consolidation Migration Runner\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    await checkMigrationStatus();
    await analyzeCurrentSchema();

    if (!dryRun) {
      console.log('💾 BACKUP RECOMMENDATION:');
      console.log('   Before running destructive Phase 4, create a backup:');
      console.log('   pg_dump $DATABASE_URL > consolidation_backup.sql\n');
    }

    for (const phaseNum of phasesToRun) {
      const phase = MIGRATION_PHASES.find(p => p.phase === phaseNum);
      if (!phase) {
        console.log(`❌ Invalid phase: ${phaseNum}`);
        continue;
      }

      // Check if this migration was already run
      const alreadyRun = await pool.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [phase.file]
      );

      if (alreadyRun.rows.length > 0) {
        console.log(`⏭️  Phase ${phase.phase} already completed, skipping...\n`);
        continue;
      }

      if (phase.destructive && !dryRun) {
        console.log('⚠️  DESTRUCTIVE PHASE WARNING ⚠️');
        console.log('Phase 4 will permanently drop deprecated tables.');
        console.log('Make sure you have a backup before proceeding!\n');
      }

      await runMigrationPhase(phase, dryRun);
    }

    if (!dryRun) {
      console.log('🎉 Schema consolidation completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Update your application code to use the consolidated tables');
      console.log('2. Replace old service files with the updated versions');
      console.log('3. Test thoroughly');
      console.log('4. Monitor performance');
    } else {
      console.log('🔍 Dry run completed. Remove --dry-run to execute the migrations.');
    }

  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Migration interrupted by user');
  await pool.end();
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Migration terminated');
  await pool.end();
  process.exit(1);
});

// Run the script if it's executed directly
main().catch(console.error);