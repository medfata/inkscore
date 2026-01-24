import 'dotenv/config';
import { pool } from './db/index.js';
import { JobQueueService } from './services/JobQueueService.js';

/**
 * Hybrid Indexer - On-demand backfill processing
 * 
 * This service simply polls the job_queue table and processes jobs.
 * Jobs are created by admins via the admin UI.
 * 
 * No auto-detection or auto-queuing - fully on-demand.
 */
export class HybridIndexer {
  private jobQueue: JobQueueService;
  private isRunning = false;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.jobQueue = new JobQueueService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Hybrid Indexer is already running');
      return;
    }

    console.log('');
    console.log('🚀 ═══════════════════════════════════════════════');
    console.log('   INK CHAIN INDEXER - On-Demand Backfill Service');
    console.log('═══════════════════════════════════════════════════');
    console.log('');

    this.isRunning = true;

    try {
      // Check database connection
      await this.checkDatabaseConnection();

      // Start job queue service
      await this.jobQueue.start();

      // Start health check (every 5 minutes)
      this.startHealthCheck();

      console.log('');
      console.log('✅ Indexer is running and waiting for jobs...');
      console.log('📝 Create backfill jobs via the admin UI');
      console.log('');

      // Keep process alive
      this.keepAlive();

    } catch (error) {
      console.error('❌ Failed to start Hybrid Indexer:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️  Hybrid Indexer is not running');
      return;
    }

    console.log('🛑 Stopping Hybrid Indexer...');
    this.isRunning = false;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    await this.jobQueue.stop();

    console.log('✅ Hybrid Indexer stopped');
  }

  private async checkDatabaseConnection(): Promise<void> {
    try {
      const result = await pool.query(`
        SELECT 
          NOW() as current_time,
          (SELECT COUNT(*) FROM contracts WHERE is_active = true) as contract_count,
          (SELECT COUNT(*) FROM job_queue WHERE status = 'pending') as pending_jobs
      `);

      const { current_time, contract_count, pending_jobs } = result.rows[0];

      console.log('✅ Database connected');
      console.log(`📊 Active contracts: ${contract_count}`);
      console.log(`📋 Pending jobs: ${pending_jobs}`);

    } catch (error) {
      console.error('❌ Database connection failed:', error);
      throw error;
    }
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        const stats = await this.jobQueue.getJobStats();
        const memory = process.memoryUsage();

        console.log('');
        console.log('📊 ─── Health Check ───');
        console.log(`   Jobs: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed`);
        console.log(`   Memory: ${(memory.heapUsed / 1024 / 1024).toFixed(1)}MB heap`);
        console.log('───────────────────────');

      } catch (error) {
        console.error('❌ Health check error:', error);
      }
    }, 300000); // 5 minutes
  }

  private keepAlive(): void {
    const keepAliveInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(keepAliveInterval);
      }
    }, 1000);

    process.stdin.resume();
  }
}

// Main entry point
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const indexer = new HybridIndexer();

  try {
    await indexer.start();

    // Graceful shutdown handlers
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down...');
      await indexer.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down...');
      await indexer.stop();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      console.error('💥 Uncaught Exception:', error);
      await indexer.stop();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('💥 Unhandled Rejection:', reason);
      await indexer.stop();
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Indexer failed to start:', error);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith('hybrid-indexer.js');

if (isMainModule) {
  main().catch(error => {
    console.error('💥 Main function failed:', error);
    process.exit(1);
  });
}
