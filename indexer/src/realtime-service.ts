import 'dotenv/config';
import { pool } from './db/index.js';
import { RealtimeService } from './services/RealtimeService.js';

/**
 * Standalone Realtime Indexing Service
 * 
 * Polls contracts for new transactions with adaptive intervals.
 * Active contracts get polled more frequently (15s), idle ones back off (up to 10min).
 * 
 * Usage: npm run start:realtime
 */
async function main() {
  console.log('🔄 Ink Chain Realtime Indexing Service');
  console.log('📊 Adaptive polling - active contracts polled more frequently');
  console.log('');

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Test database connection and show stats
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_contracts,
        COUNT(*) FILTER (WHERE indexing_status = 'complete') as ready_for_realtime
      FROM contracts
      WHERE is_active = true AND indexing_enabled = true
    `);
    const { total_contracts, ready_for_realtime } = result.rows[0];
    console.log(`✅ Database connected`);
    console.log(`📊 Contracts: ${total_contracts} total, ${ready_for_realtime} ready for realtime sync`);
    console.log('');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  const service = new RealtimeService();

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
