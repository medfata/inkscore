import 'dotenv/config';
import { Pool } from 'pg';

// Create a smaller connection pool for workers to prevent shared memory exhaustion
const workerPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2, // Limit to 2 connections per worker
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
import https from 'https';

/**
 * Gap Enrichment Worker Process
 * 
 * Individual worker that processes a batch of transactions.
 * Spawned by the concurrent gap enrichment service.
 * 
 * Communication:
 * - Receives tasks via stdin (JSON)
 * - Sends results via stdout (JSON)
 * - Logs errors via stderr
 */

interface WorkerTask {
  id: number;
  contractAddress: string;
  contractName: string;
  startOffset: number;
  batchSize: number;
  totalTransactions: number;
}

interface MissingTransaction {
  tx_hash: string;
  contract_address: string;
  wallet_address: string;
  block_timestamp: Date;
  contract_name: string;
}

interface RouterscanTransaction {
  txHash: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  gasLimit: string;
  burnedFees: string;
  timestamp: string;
  methodId: string;
  method: string;
  input: string;
  contractVerified: boolean;
  from: { id: string };
  to: { id: string };
  l1GasPrice?: string;
  l1GasUsed?: string;
  l1Fee?: string;
  l1BaseFeeScalar?: number;
  l1BlobBaseFee?: string;
  l1BlobBaseFeeScalar?: number;
  logs?: any[];
  operations?: any[];
}

class GapEnrichmentWorker {
  private baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
  private apiBatchSize = 5; // API calls in parallel (reduced from 25 to avoid rate limiting)
  private rateLimitDelay = 500; // ms between API batches (increased from 150ms)
  private maxRetries = 3;
  private workerId: string;
  private consecutiveTimeouts = 0; // Track timeouts to detect rate limiting

  constructor() {
    this.workerId = process.env.WORKER_ID || 'unknown';
    console.log(`🔧 Worker ${this.workerId} initialized`);
  }

  async start(): Promise<void> {
    console.log(`🚀 Worker ${this.workerId} ready for tasks`);

    // Listen for tasks from parent process
    process.stdin.on('data', async (data) => {
      try {
        const task: WorkerTask = JSON.parse(data.toString().trim());
        await this.processTask(task);
      } catch (error) {
        console.error(`❌ Worker ${this.workerId} task error:`, error);
      }
    });

    // Keep the process alive
    process.stdin.resume();
  }

  /**
   * Process a single task (batch of transactions)
   */
  private async processTask(task: WorkerTask): Promise<void> {
    const startTime = Date.now();
    console.log(`📦 Worker ${this.workerId} processing batch ${task.id} (offset ${task.startOffset})`);

    try {
      // Get missing transactions for this batch
      const transactions = await this.getMissingTransactions(
        task.contractAddress,
        task.batchSize,
        task.startOffset
      );

      if (transactions.length === 0) {
        // Send result back to parent
        const result = {
          batchId: task.id,
          processed: 0,
          failed: 0,
          duration: Date.now() - startTime
        };
        console.log(`RESULT:${JSON.stringify(result)}`);
        return;
      }

      console.log(`   📊 Worker ${this.workerId} found ${transactions.length} transactions to enrich`);

      // Process transactions with batch API calls and batch DB insert
      const { processed, failed } = await this.processBatchEnrichment(transactions);

      const duration = Date.now() - startTime;
      const rate = processed > 0 ? (processed / (duration / 1000)).toFixed(1) : '0';

      console.log(`   ✅ Worker ${this.workerId} batch ${task.id}: ${processed} success, ${failed} failed (${rate} tx/s)`);

      // Send result back to parent
      const result = {
        batchId: task.id,
        processed,
        failed,
        duration
      };
      console.log(`RESULT:${JSON.stringify(result)}`);

    } catch (error) {
      console.error(`❌ Worker ${this.workerId} batch ${task.id} failed:`, error);

      // Send failure result
      const result = {
        batchId: task.id,
        processed: 0,
        failed: 0,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      console.log(`RESULT:${JSON.stringify(result)}`);
    }
  }

  /**
   * Get missing transactions for this worker's batch
   */
  private async getMissingTransactions(
    contractAddress: string,
    limit: number,
    offset: number
  ): Promise<MissingTransaction[]> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    console.log(`   🔍 Worker ${this.workerId} querying DB: limit=${limit}, offset=${offset}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const queryStartTime = Date.now();
        const result = await workerPool.query(`
          SELECT 
            td.tx_hash,
            td.contract_address,
            td.wallet_address,
            td.block_timestamp,
            c.name AS contract_name
          FROM transaction_details td
          JOIN contracts c ON c.address = td.contract_address
          WHERE td.contract_address = $1
            AND NOT EXISTS (
              SELECT 1 FROM transaction_enrichment te 
              WHERE te.tx_hash = td.tx_hash
            )
          ORDER BY td.block_timestamp ASC
          LIMIT $2 OFFSET $3
        `, [contractAddress, limit, offset]);

        const queryDuration = Date.now() - queryStartTime;
        console.log(`   ✅ Worker ${this.workerId} DB query complete: ${result.rows.length} rows in ${queryDuration}ms`);

        return result.rows;
      } catch (error: any) {
        lastError = error;

        // Check if it's a shared memory error
        if (error.code === '53100' || error.message?.includes('shared memory')) {
          console.log(`   ⚠️  Worker ${this.workerId} shared memory error (attempt ${attempt}/${maxRetries}), waiting...`);

          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = (1000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
            await this.sleep(delay);
            continue;
          }
        }

        // For other errors, don't retry
        console.error(`   ❌ Worker ${this.workerId} DB query error:`, error);
        throw error;
      }
    }

    throw lastError || new Error('Failed after retries');
  }

  /**
   * Process transactions with batch API calls and batch DB inserts
   */
  private async processBatchEnrichment(transactions: MissingTransaction[]): Promise<{ processed: number; failed: number }> {
    const apiBatches = this.chunkArray(transactions, this.apiBatchSize);
    const enrichedData: Array<{ tx: MissingTransaction; details: RouterscanTransaction }> = [];
    let apiFailures = 0;

    console.log(`   🔄 Worker ${this.workerId} starting API enrichment: ${apiBatches.length} batches of ${this.apiBatchSize} transactions`);

    // Batch API calls
    for (let i = 0; i < apiBatches.length; i++) {
      const batch = apiBatches[i];
      const batchStartTime = Date.now();

      console.log(`   📡 Worker ${this.workerId} processing API batch ${i + 1}/${apiBatches.length} (${batch.length} transactions)`);

      const results = await Promise.all(
        batch.map(async (tx) => {
          for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
              const details = await this.fetchTransactionDetails(tx.tx_hash);
              this.consecutiveTimeouts = 0; // Reset on success
              return { tx, details, success: true };
            } catch (error) {
              const isTimeout = error instanceof Error && (error.message.includes('timeout') || error.message.includes('hang up'));

              if (isTimeout) {
                this.consecutiveTimeouts++;
              }

              if (attempt === this.maxRetries) {
                console.log(`   ⚠️  Worker ${this.workerId} failed to fetch ${tx.tx_hash.substring(0, 10)}... after ${this.maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
                apiFailures++;
                return { tx, details: null, success: false };
              }
              // Exponential backoff for retries
              await this.sleep(1000 * Math.pow(2, attempt - 1));
            }
          }
          return { tx, details: null, success: false };
        })
      );

      const batchDuration = Date.now() - batchStartTime;
      const successCount = results.filter(r => r.success).length;
      console.log(`   ✅ Worker ${this.workerId} API batch ${i + 1}/${apiBatches.length} complete: ${successCount}/${batch.length} success in ${batchDuration}ms`);

      // Collect successful results
      for (const result of results) {
        if (result.success && result.details) {
          enrichedData.push({ tx: result.tx, details: result.details });
        }
      }

      // Adaptive rate limiting - slow down if we're getting timeouts
      if (i < apiBatches.length - 1) {
        let delay = this.rateLimitDelay;

        if (this.consecutiveTimeouts > 5) {
          delay = 2000; // 2 seconds if heavily rate limited
          console.log(`   ⚠️  Worker ${this.workerId} detected rate limiting (${this.consecutiveTimeouts} timeouts), slowing down to ${delay}ms`);
        } else if (this.consecutiveTimeouts > 2) {
          delay = 1000; // 1 second if moderately rate limited
        }

        await this.sleep(delay);
      }
    }

    console.log(`   💾 Worker ${this.workerId} starting DB insert: ${enrichedData.length} enriched transactions`);

    // Batch DB insert with retry logic for shared memory errors
    if (enrichedData.length > 0) {
      const dbStartTime = Date.now();
      await this.batchInsertEnrichmentsWithRetry(enrichedData);
      const dbDuration = Date.now() - dbStartTime;
      console.log(`   ✅ Worker ${this.workerId} DB insert complete in ${dbDuration}ms`);
    }

    return {
      processed: enrichedData.length,
      failed: apiFailures
    };
  }

  /**
   * Fetch transaction details from Routerscan API
   */
  private async fetchTransactionDetails(txHash: string): Promise<RouterscanTransaction> {
    const url = `${this.baseUrl}/${txHash}`;
    const requestStartTime = Date.now();

    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'accept': 'application/json',
          'Referer': 'https://inkonscan.xyz/'
        }
      }, (res) => {
        let data = '';

        res.on('data', chunk => data += chunk);

        res.on('end', () => {
          const requestDuration = Date.now() - requestStartTime;
          try {
            if (res.statusCode === 200) {
              console.log(`      ✓ Worker ${this.workerId} fetched ${txHash.substring(0, 10)}... in ${requestDuration}ms`);
              resolve(JSON.parse(data));
            } else if (res.statusCode === 429) {
              console.log(`      ⚠️  Worker ${this.workerId} rate limited for ${txHash.substring(0, 10)}... (${requestDuration}ms)`);
              reject(new Error('Rate limited'));
            } else if (res.statusCode === 404) {
              console.log(`      ⚠️  Worker ${this.workerId} not found ${txHash.substring(0, 10)}... (${requestDuration}ms)`);
              reject(new Error('Transaction not found'));
            } else {
              console.log(`      ⚠️  Worker ${this.workerId} API error ${res.statusCode} for ${txHash.substring(0, 10)}... (${requestDuration}ms)`);
              reject(new Error(`API returned ${res.statusCode}`));
            }
          } catch (error) {
            console.log(`      ⚠️  Worker ${this.workerId} parse error for ${txHash.substring(0, 10)}... (${requestDuration}ms)`);
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', (error) => {
        const requestDuration = Date.now() - requestStartTime;
        console.log(`      ❌ Worker ${this.workerId} request error for ${txHash.substring(0, 10)}... (${requestDuration}ms): ${error.message}`);
        reject(error);
      });

      req.setTimeout(15000, () => {
        const requestDuration = Date.now() - requestStartTime;
        console.log(`      ⏱️  Worker ${this.workerId} timeout for ${txHash.substring(0, 10)}... (${requestDuration}ms)`);
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Batch insert with retry logic for shared memory errors
   */
  private async batchInsertEnrichmentsWithRetry(enrichedData: Array<{ tx: MissingTransaction; details: RouterscanTransaction }>): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    console.log(`   💾 Worker ${this.workerId} attempting batch insert: ${enrichedData.length} records`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const insertStartTime = Date.now();
        await this.batchInsertEnrichments(enrichedData);
        const insertDuration = Date.now() - insertStartTime;
        console.log(`   ✅ Worker ${this.workerId} batch insert successful in ${insertDuration}ms`);
        return; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;

        // Check if it's a shared memory error
        if (error.code === '53100' || error.message?.includes('shared memory')) {
          console.log(`   ⚠️  Worker ${this.workerId} batch insert shared memory error (attempt ${attempt}/${maxRetries}), waiting...`);

          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = (1000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
            await this.sleep(delay);
            continue;
          }
        }

        // For other errors, don't retry
        console.error(`   ❌ Worker ${this.workerId} batch insert error:`, error);
        throw error;
      }
    }

    throw lastError || new Error('Batch insert failed after retries');
  }

  /**
   * Batch insert enrichment data for better performance
   */
  private async batchInsertEnrichments(enrichedData: Array<{ tx: MissingTransaction; details: RouterscanTransaction }>): Promise<void> {
    if (enrichedData.length === 0) return;

    const values: unknown[] = [];
    const placeholders: string[] = [];

    enrichedData.forEach((item, idx) => {
      const offset = idx * 20;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20})`
      );

      values.push(
        item.tx.tx_hash,
        item.tx.contract_address,
        item.tx.wallet_address,
        item.details.value || null,
        item.details.gasUsed || null,
        item.details.gasPrice || null,
        item.details.gasLimit || null,
        item.details.burnedFees || null,
        item.details.l1GasPrice || null,
        item.details.l1GasUsed || null,
        item.details.l1Fee || null,
        item.details.l1BaseFeeScalar || null,
        item.details.l1BlobBaseFee || null,
        item.details.l1BlobBaseFeeScalar || null,
        item.details.contractVerified || false,
        item.details.methodId || null,
        item.details.method || null,
        item.details.input || null,
        item.details.logs ? JSON.stringify(item.details.logs) : null,
        item.details.operations ? JSON.stringify(item.details.operations) : null
      );
    });

    await workerPool.query(`
      INSERT INTO transaction_enrichment (
        tx_hash, contract_address, wallet_address,
        value, gas_used, gas_price, gas_limit, burned_fees,
        l1_gas_price, l1_gas_used, l1_fee, l1_base_fee_scalar, l1_blob_base_fee, l1_blob_base_fee_scalar,
        contract_verified, method_id, method_full, input, logs, operations
      ) VALUES ${placeholders.join(', ')}
      ON CONFLICT (tx_hash) DO UPDATE SET
        logs = EXCLUDED.logs,
        operations = EXCLUDED.operations,
        updated_at = NOW()
    `, values);
  }

  /**
   * Utility: Split array into chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
const worker = new GapEnrichmentWorker();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`🛑 Worker ${process.env.WORKER_ID} shutting down...`);
  await workerPool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`🛑 Worker ${process.env.WORKER_ID} interrupted...`);
  await workerPool.end();
  process.exit(0);
});

worker.start().catch(async (error) => {
  console.error('💥 Worker fatal error:', error);
  await workerPool.end();
  process.exit(1);
});