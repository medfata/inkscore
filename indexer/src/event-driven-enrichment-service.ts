import 'dotenv/config';
import { pool } from './db/index.js';
import { PureEventDrivenEnrichmentService } from './services/PureEventDrivenEnrichmentService.js';

/**
 * Pure Event-Driven Volume Enrichment Service Entry Point
 * 
 * Ultra-simplified enrichment service that:
 * - ONLY processes new transactions as they're triggered by database events
 * - No polling, no backlog processing, no batch processing
 * - Instant enrichment of individual transactions
 * - All historical/backlog data handled by separate concurrent gap script
 * 
 * How the trigger system works:
 * 1. New transaction inserted into transaction_details
 * 2. Database trigger fires automatically
 * 3. PostgreSQL NOTIFY sent with tx_hash and contract_address
 * 4. Service receives notification instantly
 * 5. Service enriches that specific transaction immediately
 * 
 * Usage: npm run start:event-enrichment
 */

async function main() {
  console.log('🎯 Pure Event-Driven Ink Chain Volume Enrichment Service');
  console.log('⚡ Instant processing via database triggers - zero polling overhead');
  console.log('📊 Only processes new triggered transactions - no backlog handling');
  console.log('');

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Test database connection and show current state
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE contract_type = 'volume') as volume_contracts,
        COUNT(*) FILTER (WHERE contract_type = 'volume' AND is_active = true) as active_contracts
      FROM contracts
    `);
    
    const stats = result.rows[0];
    console.log(`✅ Database connected`);
    console.log(`📊 Volume contracts: ${stats.volume_contracts} total, ${stats.active_contracts} active`);
    console.log('💡 For any existing backlogs, run: npm run concurrent-enrich');
    console.log('');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  const service = new PureEventDrivenEnrichmentService();

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

    // Show periodic stats (every 10 minutes)
    const statsInterval = setInterval(async () => {
      try {
        const stats = await service.getStats();
        console.log(`📊 [STATS] Active: ${stats.listener_active}, Queue: ${stats.processing_queue_size}, Last 5min: ${stats.enriched_last_5min} enriched`);
      } catch (error) {
        // Ignore stats errors
      }
    }, 600000); // Every 10 minutes

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