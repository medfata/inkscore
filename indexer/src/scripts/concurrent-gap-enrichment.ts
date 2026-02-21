import 'dotenv/config';
import { pool } from '../db/index.js';
import { spawn, ChildProcess } from 'child_process';
import { cpus } from 'os';
import path from 'path';

/**
 * Concurrent Gap Enrichment Script
 * 
 * Utilizes multiple CPU cores to process transaction enrichment concurrently.
 * Spawns worker processes that each handle batches of transactions in parallel.
 * 
 * Architecture:
 * - Main process: Coordinates work distribution and monitors workers
 * - Worker processes: Each handles a batch of transactions independently
 * - Batch distribution: Ensures no overlap between workers
 * - Auto-scaling: Spawns workers based on available CPU cores
 * 
 * Usage:
 *   npm run concurrent-enrich                    # Process all contracts
 *   npm run concurrent-enrich -- --contract=0x... # Process specific contract
 *   npm run concurrent-enrich -- --workers=4      # Use specific number of workers
 *   npm run concurrent-enrich -- --dry-run        # Show what would be processed
 */

interface WorkerTask {
  id: number;
  contractAddress: string;
  contractName: string;
  startOffset: number;
  batchSize: number;
  totalTransactions: number;
}

interface WorkerProcess {
  id: number;
  process: ChildProcess;
  task: WorkerTask | null;
  startTime: number;
  processed: number;
  failed: number;
  isActive: boolean;
}

interface ContractGap {
  contract_address: string;
  contract_name: string;
  missing_count: number;
}

class ConcurrentGapEnrichmentService {
  private maxWorkers: number;
  private workers: Map<number, WorkerProcess> = new Map();
  private taskQueue: WorkerTask[] = [];
  private isRunning = false;
  private completedTasks = 0;
  private totalTasks = 0;
  private readonly BATCH_SIZE = 50; // Transactions per worker batch (reduced from 500 for faster DB inserts)
  private readonly WORKER_TIMEOUT_MS = 300000; // 5 minutes timeout per worker

  constructor(maxWorkers?: number) {
    // Use 25% of available cores, minimum 2, maximum 3 for API rate limiting
    // The Routerscan API heavily throttles concurrent requests
    const availableCores = cpus().length;
    this.maxWorkers = maxWorkers || Math.min(Math.max(Math.floor(availableCores * 0.25), 2), 3);
    console.log(`🚀 Concurrent Gap Enrichment Service`);
    console.log(`💻 Available cores: ${availableCores}, Using workers: ${this.maxWorkers}`);
    console.log(`⚠️  Note: API rate limiting detected - using conservative concurrency`);
  }

  async start(options: { contractAddress?: string; dryRun?: boolean } = {}): Promise<void> {
    console.log('═══════════════════════════════════════');
    console.log('');

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, shutting down workers...');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, shutting down workers...');
      this.shutdown();
    });

    try {
      // Test database connection
      await pool.query('SELECT 1');
      console.log('✅ Database connected');

      if (options.dryRun) {
        await this.performDryRun(options.contractAddress);
        return;
      }

      if (options.contractAddress) {
        await this.processContract(options.contractAddress);
      } else {
        await this.processAllContracts();
      }

      console.log('');
      console.log('✅ Concurrent gap enrichment completed successfully');

    } catch (error) {
      console.error('❌ Concurrent gap enrichment failed:', error);
      throw error;
    } finally {
      await this.shutdown();
    }
  }

  /**
   * Show what would be processed without actually doing it
   */
  private async performDryRun(contractAddress?: string): Promise<void> {
    console.log('🔍 DRY RUN - Analyzing concurrent processing plan');
    console.log('');

    const gaps = await this.getContractGaps(contractAddress);

    if (gaps.length === 0) {
      console.log('✅ No missing transactions found!');
      return;
    }

    console.log('📊 Concurrent Processing Plan:');
    console.log('');

    let totalMissing = 0;
    let totalBatches = 0;

    for (const gap of gaps) {
      const batches = Math.ceil(gap.missing_count / this.BATCH_SIZE);
      totalBatches += batches;
      totalMissing += gap.missing_count;

      console.log(`   ${gap.contract_name}`);
      console.log(`   ${gap.contract_address}`);
      console.log(`   Missing: ${gap.missing_count.toLocaleString()} transactions`);
      console.log(`   Batches: ${batches} (${this.BATCH_SIZE} tx each)`);
      console.log('');
    }

    console.log('═══════════════════════════════════════');
    console.log(`📈 Total: ${totalMissing.toLocaleString()} transactions, ${totalBatches} batches`);
    console.log(`🔧 Workers: ${this.maxWorkers} concurrent processes`);
    console.log(`⚡ Parallelization: ${Math.min(totalBatches, this.maxWorkers)}x speedup potential`);
    console.log('');

    const estimatedTime = this.estimateProcessingTime(totalMissing, totalBatches);
    console.log(`⏱️  Estimated processing time: ${estimatedTime}`);
    console.log('');
    console.log('To start concurrent processing:');
    console.log('  npm run concurrent-enrich                    # All contracts');
    console.log('  npm run concurrent-enrich -- --contract=0x... # Specific contract');
  }

  /**
   * Process all contracts with missing transactions
   */
  private async processAllContracts(): Promise<void> {
    const gaps = await this.getContractGaps();

    if (gaps.length === 0) {
      console.log('✅ No missing transactions found!');
      return;
    }

    console.log(`📊 Found ${gaps.length} contracts with missing transactions`);
    console.log('');

    // Sort by missing count (largest first) for better progress visibility
    gaps.sort((a, b) => b.missing_count - a.missing_count);

    for (const gap of gaps) {
      if (!this.isRunning && this.taskQueue.length === 0) break;

      console.log(`🔄 Processing: ${gap.contract_name}`);
      console.log(`   Address: ${gap.contract_address}`);
      console.log(`   Missing: ${gap.missing_count.toLocaleString()} transactions`);
      console.log('');

      await this.processContract(gap.contract_address);
    }
  }

  /**
   * Process a specific contract using concurrent workers
   */
  private async processContract(contractAddress: string): Promise<void> {
    const startTime = Date.now();
    this.isRunning = true;

    // Get contract info and total missing count
    const contractInfo = await this.getContractInfo(contractAddress);
    if (!contractInfo) {
      console.error(`❌ Contract not found: ${contractAddress}`);
      return;
    }

    const totalMissing = await this.getTotalMissingCount(contractAddress);
    if (totalMissing === 0) {
      console.log('✅ No missing transactions found!');
      return;
    }

    console.log(`📊 Contract: ${contractInfo.name}`);
    console.log(`📈 Total missing: ${totalMissing.toLocaleString()} transactions`);

    // Create task queue - divide work into batches
    this.taskQueue = [];
    this.completedTasks = 0;
    this.totalTasks = Math.ceil(totalMissing / this.BATCH_SIZE);

    for (let i = 0; i < this.totalTasks; i++) {
      this.taskQueue.push({
        id: i + 1,
        contractAddress,
        contractName: contractInfo.name,
        startOffset: i * this.BATCH_SIZE,
        batchSize: this.BATCH_SIZE,
        totalTransactions: totalMissing
      });
    }

    console.log(`🔧 Created ${this.totalTasks} batches for ${this.maxWorkers} workers`);
    console.log('');

    // Start workers
    await this.spawnWorkers();

    // Monitor progress
    await this.monitorProgress();

    const totalTime = (Date.now() - startTime) / 1000;
    const totalProcessed = this.workers.size > 0 ?
      Array.from(this.workers.values()).reduce((sum, w) => sum + w.processed, 0) : 0;

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('📊 Concurrent Processing Complete');
    console.log('═══════════════════════════════════════');
    console.log(`   Contract: ${contractInfo.name}`);
    console.log(`   Workers: ${this.maxWorkers} concurrent processes`);
    console.log(`   Batches: ${this.completedTasks}/${this.totalTasks} completed`);
    console.log(`   Processed: ${totalProcessed.toLocaleString()} transactions`);
    console.log(`   Duration: ${totalTime.toFixed(1)}s`);
    if (totalProcessed > 0) {
      console.log(`   Rate: ${(totalProcessed / totalTime).toFixed(1)} tx/s`);
      console.log(`   Speedup: ~${this.maxWorkers}x vs sequential`);
    }
    console.log('═══════════════════════════════════════');
  }

  /**
   * Spawn worker processes
   */
  private async spawnWorkers(): Promise<void> {
    // Only spawn as many workers as we have batches, up to maxWorkers
    const workersNeeded = Math.min(this.totalTasks, this.maxWorkers);
    console.log(`🚀 Spawning ${workersNeeded} worker processes (${this.totalTasks} batches available)...`);

    for (let i = 0; i < workersNeeded; i++) {
      await this.spawnWorker(i + 1);
      // Small delay between spawns to avoid overwhelming the system
      await this.sleep(100);
    }

    console.log(`✅ ${workersNeeded} workers spawned`);
  }

  /**
   * Spawn a single worker process
   */
  private async spawnWorker(workerId: number): Promise<void> {
    const workerScript = path.join(process.cwd(), 'dist/scripts/gap-enrichment-worker.js');

    const childProcess = spawn('node', [workerScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WORKER_ID: workerId.toString() }
    });

    const worker: WorkerProcess = {
      id: workerId,
      process: childProcess,
      task: null,
      startTime: Date.now(),
      processed: 0,
      failed: 0,
      isActive: true
    };

    this.workers.set(workerId, worker);

    // Handle worker output
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        // Split by newlines in case multiple lines are buffered together
        const lines = output.split('\n');
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          // Parse worker results
          if (trimmedLine.startsWith('RESULT:')) {
            try {
              const result = JSON.parse(trimmedLine.substring(7));
              worker.processed += result.processed;
              worker.failed += result.failed;
              this.completedTasks++;

              console.log(`✅ [Worker-${workerId}] Batch ${result.batchId} complete: +${result.processed} success, ${result.failed} failed`);

              // Assign next task
              this.assignNextTask(worker);
            } catch (error) {
              console.error(`❌ [Worker-${workerId}] Failed to parse result: ${trimmedLine}`);
            }
          } else {
            console.log(`[Worker-${workerId}] ${trimmedLine}`);
          }
        }
      }
    });

    childProcess.stderr?.on('data', (data) => {
      const error = data.toString().trim();
      if (error) {
        console.error(`[Worker-${workerId}] ERROR: ${error}`);
      }
    });

    // Handle worker exit
    childProcess.on('exit', (code) => {
      const runtime = (Date.now() - worker.startTime) / 1000;
      if (code === 0) {
        console.log(`✅ [Worker-${workerId}] Completed (${runtime.toFixed(1)}s)`);
      } else {
        console.error(`❌ [Worker-${workerId}] Failed with code ${code} (${runtime.toFixed(1)}s)`);
      }
      worker.isActive = false;
    });

    childProcess.on('error', (error) => {
      console.error(`❌ [Worker-${workerId}] Spawn error:`, error);
      worker.isActive = false;
    });

    // Assign initial task
    this.assignNextTask(worker);
  }

  /**
   * Assign next task to a worker
   */
  private assignNextTask(worker: WorkerProcess): void {
    if (this.taskQueue.length === 0) {
      // No more tasks, terminate worker
      worker.process.kill('SIGTERM');
      return;
    }

    const task = this.taskQueue.shift()!;
    worker.task = task;

    // Send task to worker
    const taskMessage = JSON.stringify(task) + '\n';
    worker.process.stdin?.write(taskMessage);

    console.log(`📦 [Worker-${worker.id}] Assigned batch ${task.id}: offset ${task.startOffset}, size ${task.batchSize}`);
  }

  /**
   * Monitor progress until all tasks are complete
   */
  private async monitorProgress(): Promise<void> {
    console.log('📊 Monitoring concurrent progress...');
    console.log('');

    while (this.isRunning && this.completedTasks < this.totalTasks) {
      // Check for stuck workers
      const now = Date.now();
      for (const worker of this.workers.values()) {
        if (worker.isActive && worker.task && (now - worker.startTime) > this.WORKER_TIMEOUT_MS) {
          console.log(`⚠️  [Worker-${worker.id}] Timeout, restarting...`);
          worker.process.kill('SIGKILL');
          await this.spawnWorker(worker.id);
        }
      }

      // Show progress
      const activeWorkers = Array.from(this.workers.values()).filter(w => w.isActive).length;
      const progress = (this.completedTasks / this.totalTasks * 100).toFixed(1);

      console.log(`📈 Progress: ${this.completedTasks}/${this.totalTasks} batches (${progress}%), ${activeWorkers} active workers`);

      // Check if we're done
      if (this.completedTasks >= this.totalTasks) {
        console.log('✅ All batches completed!');
        break;
      }

      await this.sleep(5000); // Check every 5 seconds
    }

    console.log('✅ All batches completed, shutting down workers...');
  }

  /**
   * Shutdown all workers
   */
  private async shutdown(): Promise<void> {
    if (!this.isRunning) return; // Prevent double shutdown

    this.isRunning = false;

    const workers = Array.from(this.workers.values());
    if (workers.length === 0) {
      // Close pool only if we haven't already
      try {
        await pool.end();
      } catch (error) {
        // Ignore "pool already ended" errors
      }
      return;
    }

    console.log(`🛑 Shutting down ${workers.length} workers...`);

    // Send SIGTERM to all workers
    for (const worker of workers) {
      if (worker.isActive) {
        try {
          worker.process.kill('SIGTERM');
        } catch (error) {
          console.error(`❌ Failed to terminate worker ${worker.id}:`, error);
        }
      }
    }

    // Wait for graceful shutdown
    await this.sleep(2000);

    // Force kill remaining workers
    for (const worker of workers) {
      if (worker.isActive) {
        try {
          worker.process.kill('SIGKILL');
        } catch (error) {
          // Ignore errors on force kill
        }
      }
    }

    this.workers.clear();

    // Close pool only once
    try {
      await pool.end();
    } catch (error) {
      // Ignore "pool already ended" errors
    }
  }  /**

   * Get contracts with missing transactions
   */
  private async getContractGaps(contractAddress?: string): Promise<ContractGap[]> {
    const startTime = Date.now();
    console.log('🔍 Analyzing contract gaps...');

    const whereClause = contractAddress ? 'AND c.address = $1' : '';
    const params = contractAddress ? [contractAddress] : [];

    const result = await pool.query(`
      WITH missing_counts AS (
        SELECT 
          c.address AS contract_address,
          c.name AS contract_name,
          COUNT(td.tx_hash) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM transaction_enrichment te 
              WHERE te.tx_hash = td.tx_hash
            )
          ) AS missing_count
        FROM contracts c
        LEFT JOIN transaction_details td ON td.contract_address = c.address
        WHERE c.contract_type = 'volume'
          AND c.is_active = true
          ${whereClause}
        GROUP BY c.address, c.name
      )
      SELECT contract_address, contract_name, missing_count
      FROM missing_counts
      WHERE missing_count > 0
      ORDER BY missing_count DESC
    `, params);

    const queryTime = Date.now() - startTime;
    console.log(`   ⏱️  Contract gaps query: ${queryTime}ms (${result.rows.length} contracts with gaps)`);

    return result.rows;
  }

  /**
   * Get contract information
   */
  private async getContractInfo(contractAddress: string): Promise<{ name: string } | null> {
    const result = await pool.query(`
      SELECT name FROM contracts 
      WHERE LOWER(address) = LOWER($1) AND contract_type = 'volume'
    `, [contractAddress]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get total missing transaction count for a contract
   */
  private async getTotalMissingCount(contractAddress: string): Promise<number> {
    const result = await pool.query(`
      SELECT COUNT(*) as count
      FROM transaction_details td
      WHERE td.contract_address = $1
        AND NOT EXISTS (
          SELECT 1 FROM transaction_enrichment te 
          WHERE te.tx_hash = td.tx_hash
        )
    `, [contractAddress]);

    return parseInt(result.rows[0].count) || 0;
  }

  /**
   * Estimate processing time with concurrent workers
   */
  private estimateProcessingTime(transactionCount: number, batchCount: number): string {
    // Estimate: ~10 tx/s per worker with rate limiting and retries
    const txPerSecondPerWorker = 10;
    const totalTxPerSecond = txPerSecondPerWorker * this.maxWorkers;

    // Account for coordination overhead
    const overheadFactor = 1.2;
    const estimatedSeconds = (transactionCount / totalTxPerSecond) * overheadFactor;

    if (estimatedSeconds < 60) {
      return `${Math.ceil(estimatedSeconds)} seconds`;
    } else if (estimatedSeconds < 3600) {
      return `${Math.ceil(estimatedSeconds / 60)} minutes`;
    } else {
      const hours = Math.floor(estimatedSeconds / 3600);
      const minutes = Math.ceil((estimatedSeconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  /**
   * Utility: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI argument parsing
function parseArgs(): { contractAddress?: string; dryRun?: boolean; workers?: number } {
  const args = process.argv.slice(2);
  const options: { contractAddress?: string; dryRun?: boolean; workers?: number } = {};

  for (const arg of args) {
    if (arg.startsWith('--contract=')) {
      options.contractAddress = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg.startsWith('--workers=')) {
      options.workers = parseInt(arg.split('=')[1]);
    }
  }

  return options;
}

// Main execution
async function main() {
  console.log('🚀 Starting Concurrent Gap Enrichment Service...');

  const options = parseArgs();
  console.log('📋 Options:', options);

  const service = new ConcurrentGapEnrichmentService(options.workers);

  try {
    await service.start(options);
    process.exit(0);
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run the main function
main();