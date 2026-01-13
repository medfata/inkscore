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
  private apiBatchSize = 25; // API calls in parallel
  private rateLimitDelay = 150; // ms between API batches
  private maxRetries = 3;
  private workerId: string;

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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
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

        return result.rows;
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a shared memory error
        if (error.code === '53100' || error.message?.includes('shared memory')) {
          console.log(`⚠️  Worker ${this.workerId} shared memory error (attempt ${attempt}/${maxRetries}), waiting...`);
          
          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = (1000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
            await this.sleep(delay);
            continue;
          }
        }
        
        // For other errors, don't retry
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

    // Batch API calls
    for (let i = 0; i < apiBatches.length; i++) {
      const batch = apiBatches[i];

      const results = await Promise.all(
        batch.map(async (tx) => {
          for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
              const details = await this.fetchTransactionDetails(tx.tx_hash);
              return { tx, details, success: true };
            } catch (error) {
              if (attempt === this.maxRetries) {
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

      // Collect successful results
      for (const result of results) {
        if (result.success && result.details) {
          enrichedData.push({ tx: result.tx, details: result.details });
        }
      }

      // Rate limiting between batches
      if (i < apiBatches.length - 1) {
        await this.sleep(this.rateLimitDelay);
      }
    }

    // Batch DB insert with retry logic for shared memory errors
    if (enrichedData.length > 0) {
      await this.batchInsertEnrichmentsWithRetry(enrichedData);
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
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else if (res.statusCode === 429) {
              reject(new Error('Rate limited'));
            } else if (res.statusCode === 404) {
              reject(new Error('Transaction not found'));
            } else {
              reject(new Error(`API returned ${res.statusCode}`));
            }
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
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

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.batchInsertEnrichments(enrichedData);
        return; // Success, exit retry loop
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a shared memory error
        if (error.code === '53100' || error.message?.includes('shared memory')) {
          console.log(`⚠️  Worker ${this.workerId} batch insert shared memory error (attempt ${attempt}/${maxRetries}), waiting...`);
          
          if (attempt < maxRetries) {
            // Exponential backoff with jitter
            const delay = (1000 * Math.pow(2, attempt - 1)) + Math.random() * 1000;
            await this.sleep(delay);
            continue;
          }
        }
        
        // For other errors, don't retry
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