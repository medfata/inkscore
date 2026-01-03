import 'dotenv/config';
import { pool } from './db/index.js';
import { VolumeEnrichmentService } from './services/VolumeEnrichmentService.js';

/**
 * Standalone Volume Enrichment Service
 * 
 * Fetches transaction details from Routerscan API and stores raw response data.
 * No processing - just fetch and save logs/operations for later analysis.
 * 
 * Usage: npm run enrichment
 */
async function main() {
  console.log('🎯 Ink Chain Volume Enrichment Service');
  console.log('📊 Autonomous mode - discovers and enriches volume contracts');
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

  const service = new VolumeEnrichmentService();

  try {
    await service.start();

    // Graceful shutdown handlers
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down...');
      await service.stop();
      await pool.end();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await service.stop();
      await pool.end();
      process.exit(0);
    });

    // Keep alive
    process.stdin.resume();

  } catch (error) {
    console.error('❌ Service failed to start:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
