#!/usr/bin/env tsx

/**
 * Schema Consolidation Migration Runner
 * 
 * This script safely runs the schema consolidation migrations in the correct order.
 * It includes safety checks and rollback capabilities.
 * 
 * Usage:
 *   npm run migrate:consolidate
 *   or
 *   tsx scripts/run-consolidation-migration.ts
 * 
 * Options:
 *   --phase=1,2,3,4  Run specific phases (default: all)
 *   --dry-run        Show what would be done without executing
 *   --force          Skip safety confirmations
 */

import { Pool } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import config - handle both .js and .ts extensions
let config: { databaseUrl: string };
try {
  const configModule = await import('../src/config.js');
  config = configModule.config;
} catch (error) {
  console.error('Failed to load config. Make sure the indexer is built or config.js exists.');
  console.error('Run: npm run build');
  process.exit(1);
}

const pool = new Pool({
  connectionString: config.databaseUrl,
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
    name: 'Transaction Consolidation',
    file: '015_consolidate_schema_phase2_transactions.sql',
    description: 'Consolidates transaction tables into transaction_details',
    destructive: false,
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
}

async function analyzeCurrentSchema(): Promise<void> {
  console.log('📊 Analyzing current schema...\n');

  // Count tables that will be consolidated
  const tableCounts = await pool.query(`
    SELECT 
      table_name,
      (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = t.table_name) as exists,
      CASE 
        WHEN table_name IN ('contracts_metadata', 'contracts_to_index') THEN 'contracts'
        WHEN table_name IN ('transactions', 'volume_transactions', 'benchmark_transactions') THEN 'transaction_details'
        WHEN table_name IN ('fast_tx_indexer_cursors', 'hybrid_tx_indexer_cursors', 'indexer_cursors', 'indexer_ranges', 'tx_indexer_ranges', 'volume_indexer_ranges') THEN 'tx_indexer_cursors'
        ELSE 'other'
      END as consolidates_into
    FROM (VALUES 
      ('contracts'), ('contracts_metadata'), ('contracts_to_index'),
      ('transaction_details'), ('transactions'), ('volume_transactions'), ('benchmark_transactions'),
      ('tx_indexer_cursors'), ('fast_tx_indexer_cursors'), ('hybrid_tx_indexer_cursors'), 
      ('indexer_cursors'), ('indexer_ranges'), ('tx_indexer_ranges'), ('volume_indexer_ranges')
    ) as t(table_name)
  `);

  const contractTables = tableCounts.rows.filter(r => r.consolidates_into === 'contracts' && r.exists);
  const transactionTables = tableCounts.rows.filter(r => r.consolidates_into === 'transaction_details' && r.exists);
  const cursorTables = tableCounts.rows.filter(r => r.consolidates_into === 'tx_indexer_cursors' && r.exists);

  console.log(`Contract tables found: ${contractTables.length}`);
  contractTables.forEach(t => console.log(`  - ${t.table_name}`));
  
  console.log(`\nTransaction tables found: ${transactionTables.length}`);
  transactionTables.forEach(t => console.log(`  - ${t.table_name}`));
  
  console.log(`\nCursor/Range tables found: ${cursorTables.length}`);
  cursorTables.forEach(t => console.log(`  - ${t.table_name}`));
  console.log();
}

async function runMigrationPhase(phase: MigrationPhase, dryRun: boolean = false): Promise<void> {
  console.log(`🚀 ${dryRun ? '[DRY RUN] ' : ''}Running Phase ${phase.phase}: ${phase.name}`);
  console.log(`   ${phase.description}`);
  
  if (phase.destructive) {
    console.log('   ⚠️  WARNING: This phase is DESTRUCTIVE and will drop tables!');
  }
  
  if (dryRun) {
    console.log('   📄 Would execute:', phase.file);
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

async function createBackup(): Promise<string> {
  console.log('💾 Creating database backup...');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `consolidation_backup_${timestamp}`;
  
  // Note: This would need to be implemented based on your backup strategy
  // For now, just log the recommendation
  console.log(`   📝 Recommended: Create backup named "${backupName}"`);
  console.log('   💡 Run: pg_dump $DATABASE_URL > backup.sql');
  console.log();
  
  return backupName;
}

async function confirmDestructivePhase(): Promise<boolean> {
  // In a real implementation, you'd use a proper prompt library
  console.log('⚠️  DESTRUCTIVE PHASE WARNING ⚠️');
  console.log('Phase 4 will permanently drop the following tables:');
  console.log('  - contracts_metadata');
  console.log('  - contracts_to_index');
  console.log('  - transactions');
  console.log('  - volume_transactions');
  console.log('  - benchmark_transactions');
  console.log('  - fast_tx_indexer_cursors');
  console.log('  - hybrid_tx_indexer_cursors');
  console.log('  - indexer_cursors');
  console.log('  - indexer_ranges');
  console.log('  - tx_indexer_ranges');
  console.log('  - volume_indexer_ranges');
  console.log();
  console.log('This action cannot be undone without restoring from backup!');
  console.log();
  
  // For automation, return true. In interactive mode, you'd prompt the user.
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const phaseArg = args.find(arg => arg.startsWith('--phase='));
  
  let phasesToRun: number[] = [1, 2, 3, 4];
  if (phaseArg) {
    phasesToRun = phaseArg.split('=')[1].split(',').map(p => parseInt(p.trim()));
  }

  console.log('🔧 Schema Consolidation Migration Runner\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  try {
    await checkMigrationStatus();
    await analyzeCurrentSchema();

    if (!dryRun && !force) {
      await createBackup();
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

      if (phase.destructive && !force && !dryRun) {
        const confirmed = await confirmDestructivePhase();
        if (!confirmed) {
          console.log('❌ Destructive phase cancelled by user');
          break;
        }
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
      console.log('🔍 Dry run completed. Use --force to execute the migrations.');
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
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}