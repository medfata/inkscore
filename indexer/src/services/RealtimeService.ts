import { pool } from '../db/index.js';
import { config } from '../config.js';
import https from 'https';

export interface Contract {
  id: number;
  address: string;
  name: string;
}

export interface ContractPollingState {
  lastPollTime: number;
  intervalMs: number;
  consecutiveEmptyPolls: number;
}

// Routescan API response structure
export interface RouterscanTransaction {
  chainId: string;
  blockNumber: number;
  index: number;
  timestamp: string;
  from: string;
  to: string;
  blockHash: string;
  txHash?: string;  // Some responses use 'id' instead
  id?: string;
  value: string;
  gasLimit: string;
  gasUsed: string;
  gasPrice: string;
  burnedFees: string;
  methodId: string | null;
  method: string | null;
  status: boolean;
}

interface ApiResponse {
  items: RouterscanTransaction[];
}

export class RealtimeService {
  private transactionLimit = 50;

  // Adaptive polling config - optimized based on activity analysis
  private readonly BASE_INTERVAL_MS = 15_000;      // 15 seconds for active contracts
  private readonly MAX_INTERVAL_MS = 120_000;      // 2 minutes max (down from 10 min)
  private readonly BACKOFF_MULTIPLIER = 2;
  
  // Activity-based thresholds
  private readonly HIGH_ACTIVITY_THRESHOLD = 5;    // 5+ tx per poll = stay at base interval
  private readonly MEDIUM_ACTIVITY_INTERVAL = 30_000;  // 30s for moderate activity (1-4 tx)
  private readonly LOW_ACTIVITY_INTERVAL = 60_000;     // 1 minute for low activity

  // In-memory polling state per contract
  private pollingState: Map<number, ContractPollingState> = new Map();

  // Track if service is running
  private isRunning = false;
  private pollLoopPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ [REALTIME] Service already running');
      return;
    }

    this.isRunning = true;
    console.log('🚀 [REALTIME] Starting adaptive polling service...');
    console.log(`   Base interval: ${this.BASE_INTERVAL_MS / 1000}s (high activity: 5+ tx)`);
    console.log(`   Medium activity: ${this.MEDIUM_ACTIVITY_INTERVAL / 1000}s (1-4 tx)`);
    console.log(`   Low activity: ${this.LOW_ACTIVITY_INTERVAL / 1000}s (0 tx)`);
    console.log(`   Max interval: ${this.MAX_INTERVAL_MS / 1000}s (multiple empty polls)`);

    this.pollLoopPromise = this.runPollLoop();
  }

  async stop(): Promise<void> {
    console.log('🛑 [REALTIME] Stopping service...');
    this.isRunning = false;
    if (this.pollLoopPromise) {
      await this.pollLoopPromise;
    }
    console.log('✅ [REALTIME] Service stopped');
  }

  private async runPollLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const contracts = await this.getActiveContracts();

        if (contracts.length === 0) {
          await this.sleep(5000);
          continue;
        }

        const contractToPoll = this.getNextContractToPoll(contracts);

        if (contractToPoll) {
          await this.pollContract(contractToPoll);
        }

        await this.sleep(100);

      } catch (error) {
        console.error('❌ [REALTIME] Poll loop error:', error);
        await this.sleep(5000);
      }
    }
  }

  getNextContractToPoll(contracts: Contract[]): Contract | null {
    const now = Date.now();
    let mostOverdue: Contract | null = null;
    let maxOverdueTime = 0;

    for (const contract of contracts) {
      const state = this.getPollingState(contract.id);
      const timeSinceLastPoll = now - state.lastPollTime;
      const overdueBy = timeSinceLastPoll - state.intervalMs;

      if (overdueBy > 0 && overdueBy > maxOverdueTime) {
        maxOverdueTime = overdueBy;
        mostOverdue = contract;
      }
    }

    return mostOverdue;
  }

  private async pollContract(contract: Contract): Promise<void> {
    const state = this.getPollingState(contract.id);
    const startTime = Date.now();

    try {
      const transactions = await this.fetchLatestTransactions(contract.address);

      if (transactions.length === 0) {
        this.updatePollingState(contract.id, 0, false);
        return;
      }

      const insertedCount = await this.insertTransactions(transactions, contract.address);

      if (insertedCount > 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ [REALTIME] ${contract.name}: +${insertedCount} new tx (${elapsed}s) [interval: ${(state.intervalMs / 1000).toFixed(0)}s]`);
      }

      this.updatePollingState(contract.id, insertedCount, false);

    } catch (error) {
      console.error(`❌ [REALTIME] ${contract.name} poll failed:`, error);
      this.updatePollingState(contract.id, 0, true);
    }
  }

  async fetchLatestTransactions(contractAddress: string): Promise<RouterscanTransaction[]> {
    const url = `https://api.routescan.io/v2/network/mainnet/evm/${config.chainId}/address/${contractAddress}/transactions?limit=${this.transactionLimit}&sort=desc`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response: ApiResponse = JSON.parse(data);
            if (response.items && Array.isArray(response.items)) {
              resolve(response.items);
            } else {
              resolve([]);
            }
          } catch (e) {
            reject(new Error(`Invalid API response: ${data.substring(0, 200)}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Insert transactions - maps Routescan response to transaction_details table
   */
  private async insertTransactions(transactions: RouterscanTransaction[], contractAddress: string): Promise<number> {
    if (transactions.length === 0) return 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;

      for (const tx of transactions) {
        const txHash = tx.txHash || tx.id;  // API uses 'id' as tx hash
        if (!txHash) continue;

        placeholders.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, ` +
          `$${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, ` +
          `$${paramIndex + 8}, $${paramIndex + 9})`
        );

        values.push(
          txHash,                                        // tx_hash
          tx.from?.toLowerCase() || null,                // wallet_address
          contractAddress.toLowerCase(),                 // contract_address
          tx.method?.split('(')[0] || tx.methodId || null,  // function_name (e.g., "gm" from "gm()" or methodId like "0xa07849e6")
          tx.value,                                      // eth_value
          tx.blockNumber,                                // block_number
          new Date(tx.timestamp),                        // block_timestamp
          tx.status ? 1 : 0,                             // status
          parseInt(tx.chainId),                          // chain_id
          tx.to?.toLowerCase() || null                   // to_address
        );

        paramIndex += 10;
      }

      const query = `
        INSERT INTO transaction_details (
          tx_hash, wallet_address, contract_address, function_name,
          eth_value, block_number, block_timestamp, status, chain_id, to_address
        ) VALUES ${placeholders.join(', ')}
        ON CONFLICT (tx_hash) DO NOTHING
      `;

      const result = await client.query(query, values);
      await client.query('COMMIT');

      return result.rowCount || 0;

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getPollingState(contractId: number): ContractPollingState {
    if (!this.pollingState.has(contractId)) {
      this.pollingState.set(contractId, {
        lastPollTime: 0,
        intervalMs: this.BASE_INTERVAL_MS,
        consecutiveEmptyPolls: 0
      });
    }
    return this.pollingState.get(contractId)!;
  }

  updatePollingState(contractId: number, newTxCount: number, hadError: boolean): void {
    const state = this.getPollingState(contractId);
    state.lastPollTime = Date.now();

    if (hadError) {
      // On error, increase interval but cap at max
      state.consecutiveEmptyPolls++;
      state.intervalMs = Math.min(state.intervalMs * this.BACKOFF_MULTIPLIER, this.MAX_INTERVAL_MS);
    } else if (newTxCount >= this.HIGH_ACTIVITY_THRESHOLD) {
      // High activity (5+ tx) - keep at base interval
      state.consecutiveEmptyPolls = 0;
      state.intervalMs = this.BASE_INTERVAL_MS;
    } else if (newTxCount > 0) {
      // Medium activity (1-4 tx) - use 30s interval
      state.consecutiveEmptyPolls = 0;
      state.intervalMs = this.MEDIUM_ACTIVITY_INTERVAL;
    } else {
      // No activity - gradually increase interval
      state.consecutiveEmptyPolls++;
      
      if (state.consecutiveEmptyPolls === 1) {
        // First empty poll - go to 1 minute
        state.intervalMs = this.LOW_ACTIVITY_INTERVAL;
      } else {
        // Multiple empty polls - increase up to max (2 minutes)
        state.intervalMs = Math.min(state.intervalMs * this.BACKOFF_MULTIPLIER, this.MAX_INTERVAL_MS);
      }
    }

    this.pollingState.set(contractId, state);
  }

  private async getActiveContracts(): Promise<Contract[]> {
    const result = await pool.query(`
      SELECT id, address, name
      FROM contracts 
      WHERE is_active = true 
        AND indexing_enabled = true
        AND indexing_status = 'complete'
      ORDER BY created_at ASC
    `);
    return result.rows;
  }

  getPollingStats(): { contractId: number; intervalMs: number; lastPollTime: number; consecutiveEmptyPolls: number }[] {
    const stats: { contractId: number; intervalMs: number; lastPollTime: number; consecutiveEmptyPolls: number }[] = [];
    this.pollingState.forEach((state, contractId) => {
      stats.push({ contractId, ...state });
    });
    return stats;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  resetPollingState(): void {
    this.pollingState.clear();
  }

  getConfig() {
    return {
      baseIntervalMs: this.BASE_INTERVAL_MS,
      maxIntervalMs: this.MAX_INTERVAL_MS,
      backoffMultiplier: this.BACKOFF_MULTIPLIER,
      highActivityThreshold: this.HIGH_ACTIVITY_THRESHOLD,
      mediumActivityIntervalMs: this.MEDIUM_ACTIVITY_INTERVAL,
      lowActivityIntervalMs: this.LOW_ACTIVITY_INTERVAL
    };
  }
}
