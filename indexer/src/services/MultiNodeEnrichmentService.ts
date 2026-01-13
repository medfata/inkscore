import { pool } from '../db/index.js';
import { VolumeEnrichmentService } from './VolumeEnrichmentService.js';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

interface VolumeContract {
  id: number;
  address: string;
  name: string;
  enrichment_status: string;
  enrichment_progress: number;
}

interface BacklogWorker {
  contractId: number;
  contractAddress: string;
  contractName: string;
  process: ChildProcess;
  startTime: number;
  pendingCount: number;
}

/**
 * Multi-Node Volume Enrichment Service
 * 
 * Main orchestrator that:
 * 1. Handles contracts with <100 pending transactions
 * 2. Spawns dedicated child nodes for contracts with 100+ pending
 * 3. Manages child process lifecycle
 * 4. Graceful shutdown of all child processes
 */
export class MultiNodeEnrichmentService {
  private baseEnrichmentService: VolumeEnrichmentService;
  private backlogWorkers: Map<number, BacklogWorker> = new Map();
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 15000;
  private readonly BACKLOG_THRESHOLD = 100;

  constructor() {
    this.baseEnrichmentService = new VolumeEnrichmentService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Multi-Node Enrichment Service is already running');
      return;
    }

    console.log('🚀 Starting Multi-Node Volume Enrichment Service');
    this.isRunning = true;

    // Initial contract assessment and worker spawning
    await this.assessAndSpawnWorkers();

    // Start regular cycle for quick wins and worker management
    this.processingInterval = setInterval(() => {
      this.processEnrichmentCycle();
    }, this.POLL_INTERVAL_MS);

    console.log(`✅ Multi-Node Enrichment Service started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Multi-Node Enrichment Service...');
    this.isRunning = false;

    // Stop polling interval
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Stop base service
    await this.baseEnrichmentService.stop();

    // Gracefully shutdown all child workers
    await this.shutdownAllWorkers();

    console.log('✅ Multi-Node Enrichment Service stopped');
  }

  private async processEnrichmentCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // 1. Assess contracts and spawn new workers if needed
      await this.assessAndSpawnWorkers();

      // 2. Process quick wins (contracts with <100 pending)
      await this.processQuickWins();

      // 3. Check worker health and cleanup completed ones
      await this.manageWorkers();

    } catch (error) {
      console.error('❌ [MULTI-NODE] Cycle error:', error);
    }
  }

  /**
   * Assess all contracts and spawn workers for those with 100+ pending
   */
  private async assessAndSpawnWorkers(): Promise<void> {
    const contracts = await this.getVolumeContractsNeedingEnrichment();
    
    for (const contract of contracts) {
      // Skip if already has a worker
      if (this.backlogWorkers.has(contract.id)) continue;

      const pendingCount = await this.getPendingCount(contract.address);
      
      if (pendingCount >= this.BACKLOG_THRESHOLD) {
        await this.spawnBacklogWorker(contract, pendingCount);
      }
    }
  }

  /**
   * Process contracts with <100 pending using the main service
   */
  private async processQuickWins(): Promise<void> {
    const contracts = await this.getVolumeContractsNeedingEnrichment();
    const quickWins: Array<VolumeContract & { pendingCount: number }> = [];

    for (const contract of contracts) {
      // Skip if has a dedicated worker
      if (this.backlogWorkers.has(contract.id)) continue;

      const pendingCount = await this.getPendingCount(contract.address);
      
      if (pendingCount > 0 && pendingCount < this.BACKLOG_THRESHOLD) {
        quickWins.push({ ...contract, pendingCount });
      }
    }

    if (quickWins.length > 0) {
      console.log(`💰 [MULTI-NODE] Found ${quickWins.length} quick win contract(s)`);
      console.log(`⚠️  [MULTI-NODE] This service is deprecated. Use the new real-time enrichment service + concurrent gap script.`);
      console.log(`   Real-time: Handled by streamlined VolumeEnrichmentService`);
      console.log(`   Backlogs: Run 'npm run concurrent-enrich' for much better performance`);
      
      // DEPRECATED: enrichVolumeContract method removed from streamlined service
      // for (const contract of quickWins) {
      //   if (!this.isRunning) break;
      //   await this.baseEnrichmentService.enrichVolumeContract(contract.id);
      // }
    }
  }

  /**
   * Spawn a dedicated worker for a contract with large backlog
   */
  private async spawnBacklogWorker(contract: VolumeContract, pendingCount: number): Promise<void> {
    console.log(`🔄 [MULTI-NODE] Spawning worker for ${contract.name} (${pendingCount} pending)`);

    const workerScript = path.join(process.cwd(), 'dist/enrichment-backlog-worker.js');
    
    const childProcess = spawn('node', [
      workerScript,
      `--contract-id=${contract.id}`,
      `--contract-address=${contract.address}`,
      `--contract-name=${contract.name}`
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    const worker: BacklogWorker = {
      contractId: contract.id,
      contractAddress: contract.address,
      contractName: contract.name,
      process: childProcess,
      startTime: Date.now(),
      pendingCount
    };

    this.backlogWorkers.set(contract.id, worker);

    // Handle worker output
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        console.log(`[WORKER-${contract.id}] ${output}`);
      }
    });

    childProcess.stderr?.on('data', (data) => {
      const error = data.toString().trim();
      if (error) {
        console.error(`[WORKER-${contract.id}] ERROR: ${error}`);
      }
    });

    // Handle worker exit
    childProcess.on('exit', (code) => {
      const runtime = (Date.now() - worker.startTime) / 1000;
      if (code === 0) {
        console.log(`✅ [MULTI-NODE] Worker for ${contract.name} completed (${runtime.toFixed(1)}s)`);
      } else {
        console.error(`❌ [MULTI-NODE] Worker for ${contract.name} failed with code ${code} (${runtime.toFixed(1)}s)`);
      }
      this.backlogWorkers.delete(contract.id);
    });

    childProcess.on('error', (error) => {
      console.error(`❌ [MULTI-NODE] Worker spawn error for ${contract.name}:`, error);
      this.backlogWorkers.delete(contract.id);
    });
  }

  /**
   * Check worker health and cleanup completed ones
   */
  private async manageWorkers(): Promise<void> {
    const activeWorkers = Array.from(this.backlogWorkers.values());
    
    if (activeWorkers.length > 0) {
      console.log(`🔧 [MULTI-NODE] Managing ${activeWorkers.length} active worker(s)`);
      
      for (const worker of activeWorkers) {
        const runtime = (Date.now() - worker.startTime) / 1000;
        const pendingCount = await this.getPendingCount(worker.contractAddress);
        
        console.log(`   📊 ${worker.contractName}: ${pendingCount} pending (running ${runtime.toFixed(0)}s)`);
        
        // If no more pending transactions, the worker should exit soon
        if (pendingCount === 0) {
          console.log(`   ✅ ${worker.contractName}: All transactions enriched, worker should exit`);
        }
      }
    }
  }

  /**
   * Gracefully shutdown all child workers
   */
  private async shutdownAllWorkers(): Promise<void> {
    const workers = Array.from(this.backlogWorkers.values());
    
    if (workers.length === 0) return;

    console.log(`🛑 [MULTI-NODE] Shutting down ${workers.length} worker(s)...`);

    // Send SIGTERM to all workers
    for (const worker of workers) {
      try {
        worker.process.kill('SIGTERM');
      } catch (error) {
        console.error(`❌ Failed to terminate worker for ${worker.contractName}:`, error);
      }
    }

    // Wait for workers to exit gracefully (max 10 seconds)
    const shutdownPromise = new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.backlogWorkers.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        // Force kill remaining workers
        for (const worker of this.backlogWorkers.values()) {
          try {
            worker.process.kill('SIGKILL');
          } catch (error) {
            // Ignore errors on force kill
          }
        }
        this.backlogWorkers.clear();
        resolve();
      }, 10000);
    });

    await Promise.race([shutdownPromise, timeoutPromise]);
    console.log('✅ [MULTI-NODE] All workers shut down');
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 [MULTI-NODE] Received ${signal}, shutting down...`);
      await this.stop();
      await pool.end();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }

  // Helper methods (reuse from VolumeEnrichmentService)
  private async getVolumeContractsNeedingEnrichment(): Promise<VolumeContract[]> {
    const result = await pool.query(`
      SELECT 
        c.id,
        c.address,
        c.name,
        c.enrichment_status,
        c.enrichment_progress
      FROM contracts c
      WHERE c.contract_type = 'volume'
        AND c.is_active = true
        AND c.indexing_enabled = true
        AND (SELECT COUNT(*) FROM transaction_details td WHERE td.contract_address = c.address) >
            (SELECT COUNT(*) FROM transaction_enrichment te WHERE te.contract_address = c.address)
      ORDER BY c.id ASC
    `);

    return result.rows;
  }

  private async getPendingCount(contractAddress: string): Promise<number> {
    const result = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) -
        (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as pending
    `, [contractAddress]);
    return parseInt(result.rows[0].pending) || 0;
  }

  async getStats(): Promise<any> {
    const baseStats = await this.baseEnrichmentService.getStats();
    const activeWorkers = Array.from(this.backlogWorkers.values());
    
    return {
      ...baseStats,
      multi_node_enabled: true,
      active_workers: activeWorkers.length,
      worker_contracts: activeWorkers.map(w => ({
        contract_name: w.contractName,
        contract_address: w.contractAddress,
        pending_count: w.pendingCount,
        runtime_seconds: Math.floor((Date.now() - w.startTime) / 1000)
      }))
    };
  }
}