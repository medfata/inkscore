import 'dotenv/config';
import { pool } from './db/index.js';
import { MultiNodeEnrichmentService } from './services/MultiNodeEnrichmentService.js';

/**
 * Multi-Node Volume Enrichment Service Entry Point
 * 
 * Main orchestrator that manages multiple enrichment processes:
 * - Handles quick wins (<100 pending) in main process
 * - Spawns dedicated workers for large backlogs (100+ pending)
 * - Manages worker lifecycle and graceful shutdown
 * 
 * Usage: npm run start:multi-enrichment
 */

async function main() {
  console.log('🎯 Multi-Node Ink Chain Volume Enrichment Service');
  console.log('📊 Intelligent workload distribution with dedicated backlog workers');
  console.log('');

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Test database connection
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE contract_type = 'volume') as volume_contracts,
        COUNT(*) FILTER (WHERE contract_type = 'volume' AND enrichment_status = 'completed') as enriched
      FROM contracts
    `);
    const { volume_contracts, enriched } = result.rows[0];
    console.log(`✅ Database connected`);
    console.log(`📊 Volume contracts: ${volume_contracts} (${enriched} fully enriched)`);
    console.log('');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  const service = new MultiNodeEnrichmentService();

  try {
    await service.start();

    // Keep alive and show periodic stats
    const statsInterval = setInterval(async () => {
      try {
        const stats = await service.getStats();
        if (stats.active_workers > 0) {
          console.log(`📊 [MULTI-NODE] Active workers: ${stats.active_workers}`);
          for (const worker of stats.worker_contracts) {
            console.log(`   🔄 ${worker.contract_name}: ${worker.runtime_seconds}s runtime`);
          }
        }
      } catch (error) {
        // Ignore stats errors
      }
    }, 60000); // Every minute

    // Graceful shutdown handlers are already set up in the service
    process.stdin.resume();

  } catch (error) {
    console.error('❌ Multi-Node Service failed to start:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});