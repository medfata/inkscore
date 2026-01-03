import 'dotenv/config';
import { pool } from './dist/db/index.js';

async function cleanupFailedJobs() {
  try {
    console.log('🧹 Cleaning up failed jobs...');
    
    // Delete failed jobs
    const deleteResult = await pool.query(`
      DELETE FROM job_queue 
      WHERE status = 'failed' 
      OR error_message IS NOT NULL
    `);
    
    console.log(`✅ Deleted ${deleteResult.rowCount} failed jobs`);
    
    // Reset stuck processing jobs
    const resetResult = await pool.query(`
      UPDATE job_queue 
      SET status = 'pending', 
          started_at = NULL, 
          error_message = NULL,
          attempts = 0
      WHERE status = 'processing' 
      AND started_at < NOW() - INTERVAL '1 hour'
    `);
    
    console.log(`✅ Reset ${resetResult.rowCount} stuck jobs`);
    
    // Clean up orphaned batch records
    const batchResult = await pool.query(`
      DELETE FROM backfill_batches 
      WHERE status = 'failed' 
      OR error_message IS NOT NULL
    `);
    
    console.log(`✅ Deleted ${batchResult.rowCount} failed batch records`);
    
    // Reset contract backfill status for failed contracts
    const contractResult = await pool.query(`
      UPDATE contracts 
      SET backfill_status = 'pending',
          backfill_progress = 0
      WHERE backfill_status = 'failed'
    `);
    
    console.log(`✅ Reset ${contractResult.rowCount} failed contracts`);
    
    console.log('🎉 Cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    await pool.end();
  }
}

cleanupFailedJobs();