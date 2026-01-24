import { pool } from '../db/index.js';
import { BackfillService, BackfillJobPayload } from './BackfillService.js';

interface Job {
  id: number;
  job_type: string;
  contract_id: number;
  priority: number;
  status: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  created_at: Date;
  next_retry_at?: Date;
}

/**
 * Simplified JobQueueService - On-demand job processing
 * 
 * Only processes jobs that admins explicitly create.
 * No auto-detection or auto-queuing of jobs.
 */
export class JobQueueService {
  private backfillService: BackfillService;
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 10000; // 10 seconds

  constructor() {
    this.backfillService = new BackfillService();
  }

  async start(): Promise<void> {
    console.log('🚀 Starting Job Queue Service');

    if (this.isProcessing) {
      console.log('⚠️  Job queue is already running');
      return;
    }

    this.isProcessing = true;

    // Log current queue status
    await this.logQueueStatus();

    // Start processing immediately
    this.processNextJob();

    // Set up polling interval
    this.processingInterval = setInterval(() => {
      this.processNextJob();
    }, this.POLL_INTERVAL_MS);

    console.log(`✅ Job Queue Service started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
  }

  async stop(): Promise<void> {
    console.log('🛑 Stopping Job Queue Service');

    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    console.log('✅ Job Queue Service stopped');
  }

  /**
   * Process the next pending job in the queue
   */
  private async processNextJob(): Promise<void> {
    if (!this.isProcessing) return;

    try {
      const job = await this.getNextJob();

      if (!job) {
        return; // No jobs to process
      }

      console.log(`\n🔄 Processing job ${job.id}: ${job.job_type}`);

      // Mark as processing
      await this.updateJobStatus(job.id, 'processing');

      try {
        switch (job.job_type) {
          case 'backfill':
            await this.processBackfillJob(job);
            break;
          default:
            console.log(`⚠️  Unknown job type: ${job.job_type}`);
        }

        await this.updateJobStatus(job.id, 'completed');
        console.log(`✅ Job ${job.id} completed`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Job ${job.id} failed:`, errorMessage);
        await this.handleJobFailure(job, errorMessage);
      }

    } catch (error) {
      console.error('Error in job processing:', error);
    }
  }

  /**
   * Get the next pending job (highest priority, oldest first)
   */
  private async getNextJob(): Promise<Job | null> {
    const result = await pool.query(`
      SELECT id, job_type, contract_id, priority, status, payload, 
             attempts, max_attempts, created_at, next_retry_at
      FROM job_queue
      WHERE status IN ('pending', 'failed') 
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND attempts < max_attempts
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `);

    return result.rows[0] || null;
  }

  /**
   * Process a backfill job
   */
  private async processBackfillJob(job: Job): Promise<void> {
    const payload = job.payload as BackfillJobPayload;

    // Validate payload
    if (!payload.contractAddress || !payload.fromDate || !payload.toDate) {
      throw new Error('Invalid backfill job payload: missing contractAddress, fromDate, or toDate');
    }

    // Get contract ID if not in payload
    let contractId = payload.contractId || job.contract_id;
    if (!contractId && payload.contractAddress) {
      const contract = await pool.query(
        'SELECT id FROM contracts WHERE address = $1',
        [payload.contractAddress.toLowerCase()]
      );
      if (contract.rows[0]) {
        contractId = contract.rows[0].id;
      }
    }

    const fullPayload: BackfillJobPayload = {
      contractId,
      contractAddress: payload.contractAddress,
      fromDate: payload.fromDate,
      toDate: payload.toDate
    };

    await this.backfillService.processBackfillJob(job.id, fullPayload);
  }

  private async updateJobStatus(jobId: number, status: string): Promise<void> {
    const updates = ['status = $2'];
    const values = [jobId, status];

    if (status === 'processing') {
      updates.push('started_at = NOW()');
    } else if (status === 'completed') {
      updates.push('completed_at = NOW()');
    }

    await pool.query(
      `UPDATE job_queue SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
  }

  private async handleJobFailure(job: Job, errorMessage: string): Promise<void> {
    const newAttempts = job.attempts + 1;

    if (newAttempts >= job.max_attempts) {
      await pool.query(`
        UPDATE job_queue 
        SET status = 'failed', attempts = $2, error_message = $3, completed_at = NOW()
        WHERE id = $1
      `, [job.id, newAttempts, errorMessage]);

      console.log(`💀 Job ${job.id} failed permanently after ${newAttempts} attempts`);
    } else {
      // Exponential backoff: 1min, 2min, 4min, 8min...
      const retryDelayMinutes = Math.pow(2, newAttempts - 1);
      const nextRetryAt = new Date(Date.now() + retryDelayMinutes * 60 * 1000);

      await pool.query(`
        UPDATE job_queue 
        SET status = 'pending', attempts = $2, error_message = $3, next_retry_at = $4
        WHERE id = $1
      `, [job.id, newAttempts, errorMessage, nextRetryAt]);

      console.log(`🔄 Job ${job.id} will retry in ${retryDelayMinutes}m (attempt ${newAttempts}/${job.max_attempts})`);
    }
  }

  /**
   * Log current queue status
   */
  private async logQueueStatus(): Promise<void> {
    const stats = await this.getJobStats();
    console.log(`📊 Queue Status: ${stats.pending} pending, ${stats.processing} processing, ${stats.failed} failed`);
  }

  // Public methods for monitoring and management

  async getJobStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
  }> {
    const result = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM job_queue
      GROUP BY status
    `);

    const stats = { pending: 0, processing: 0, completed: 0, failed: 0, total: 0 };

    result.rows.forEach((row: { status: string; count: string }) => {
      const status = row.status as keyof typeof stats;
      if (status in stats) {
        stats[status] = parseInt(row.count);
        stats.total += parseInt(row.count);
      }
    });

    return stats;
  }

  async getRecentJobs(limit = 20): Promise<Job[]> {
    const result = await pool.query(`
      SELECT j.*, c.name as contract_name, c.address as contract_address
      FROM job_queue j
      LEFT JOIN contracts c ON j.contract_id = c.id
      ORDER BY j.created_at DESC
      LIMIT $1
    `, [limit]);

    return result.rows;
  }

  async cancelJob(jobId: number): Promise<boolean> {
    const result = await pool.query(`
      UPDATE job_queue 
      SET status = 'failed', error_message = 'Cancelled by admin', completed_at = NOW()
      WHERE id = $1 AND status IN ('pending', 'failed')
      RETURNING id
    `, [jobId]);

    return result.rows.length > 0;
  }

  async retryJob(jobId: number): Promise<boolean> {
    const result = await pool.query(`
      UPDATE job_queue 
      SET status = 'pending', error_message = NULL, next_retry_at = NULL, attempts = 0
      WHERE id = $1 AND status = 'failed'
      RETURNING id
    `, [jobId]);

    return result.rows.length > 0;
  }
}
