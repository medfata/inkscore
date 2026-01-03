import { pool } from '../db/index.js';
import https from 'https';

interface VolumeContract {
  id: number;
  address: string;
  name: string;
  enrichment_status: string;
  enrichment_progress: number;
}

interface TransactionToEnrich {
  tx_hash: string;
  contract_address: string;
  wallet_address: string;
  block_timestamp: Date;
}

// Raw API response - stored as-is, no processing
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

export class VolumeEnrichmentService {
  private baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
  private batchSize = 25;
  private jobBatchSize = 500;
  private rateLimitDelay = 100;
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 15000;

  // Backlog processing - contracts with large pending counts get dedicated processing
  private readonly BACKLOG_THRESHOLD = 100; // Contracts with >100 pending get dedicated processing
  private backlogContract: VolumeContract | null = null;
  private isProcessingBacklog = false;
  private backlogProcessingPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Volume Enrichment Service is already running');
      return;
    }

    console.log('🚀 Starting Volume Enrichment Service');
    this.isRunning = true;

    await this.processEnrichmentCycle();

    this.processingInterval = setInterval(() => {
      this.processEnrichmentCycle();
    }, this.POLL_INTERVAL_MS);

    console.log(`✅ Volume Enrichment Service started (polling every ${this.POLL_INTERVAL_MS / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Volume Enrichment Service...');
    this.isRunning = false;
    this.isProcessingBacklog = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    // Wait for backlog processing to finish
    if (this.backlogProcessingPromise) {
      await this.backlogProcessingPromise;
    }

    console.log('✅ Volume Enrichment Service stopped');
  }

  async enrichVolumeContract(contractId: number): Promise<void> {
    const result = await pool.query(`
      SELECT id, address, name, enrichment_status, enrichment_progress
      FROM contracts WHERE id = $1 AND contract_type = 'volume'
    `, [contractId]);

    const contract = result.rows[0];
    if (!contract) {
      console.log(`⚠️ [ENRICHMENT] Contract ${contractId} not found or not a volume contract`);
      return;
    }

    const wasRunning = this.isRunning;
    this.isRunning = true;

    try {
      await this.processContract(contract);
    } finally {
      this.isRunning = wasRunning;
    }
  }

  private async processEnrichmentCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // If we're processing a backlog contract, skip the expensive query
      // Just let the backlog processor continue uninterrupted
      if (this.isProcessingBacklog && this.backlogContract) {
        return;
      }

      const contracts = await this.getVolumeContractsNeedingEnrichment();

      if (contracts.length === 0) return;

      // Separate contracts into quick wins (small pending) vs backlogs (large pending)
      const quickWins: Array<VolumeContract & { pendingCount: number }> = [];
      const backlogs: Array<VolumeContract & { pendingCount: number }> = [];

      for (const contract of contracts) {
        const pendingCount = await this.getPendingCount(contract.address);

        if (pendingCount > this.BACKLOG_THRESHOLD) {
          backlogs.push({ ...contract, pendingCount });
        } else if (pendingCount > 0) {
          quickWins.push({ ...contract, pendingCount });
        }
      }

      // Process quick wins first (contracts nearly caught up)
      if (quickWins.length > 0) {
        console.log(`💰 [ENRICHMENT] Found ${quickWins.length} contract(s) with small backlogs`);
        for (const contract of quickWins) {
          if (!this.isRunning) break;
          await this.processContract(contract);
        }
      }

      // Start dedicated backlog processing for large backlogs (if not already running)
      if (backlogs.length > 0 && !this.isProcessingBacklog) {
        // Pick the contract with the largest backlog for dedicated processing
        const largestBacklog = backlogs.sort((a, b) => b.pendingCount - a.pendingCount)[0];
        console.log(`🔄 [ENRICHMENT] Starting dedicated backlog processing for ${largestBacklog.name} (${largestBacklog.pendingCount} pending)`);
        this.startBacklogProcessing(largestBacklog);
      }

    } catch (error) {
      console.error('❌ [ENRICHMENT] Cycle error:', error);
    }
  }

  /**
   * Start dedicated backlog processing for a contract with large pending count.
   * This runs continuously without being interrupted by the regular cycle.
   */
  private startBacklogProcessing(contract: VolumeContract): void {
    if (this.isProcessingBacklog) return;

    this.isProcessingBacklog = true;
    this.backlogContract = contract;

    this.backlogProcessingPromise = this.processBacklogContinuously(contract)
      .finally(() => {
        this.isProcessingBacklog = false;
        this.backlogContract = null;
        this.backlogProcessingPromise = null;
        console.log(`✅ [ENRICHMENT] Backlog processing completed for ${contract.name}`);
      });
  }

  /**
   * Process a contract's backlog continuously until caught up or stopped.
   * No interruptions from the regular enrichment cycle.
   */
  private async processBacklogContinuously(contract: VolumeContract): Promise<void> {
    console.log(`🚀 [BACKLOG] Starting continuous processing for ${contract.name}`);

    let totalProcessed = 0;
    const startTime = Date.now();

    while (this.isRunning && this.isProcessingBacklog) {
      const transactions = await this.getUnenrichedTransactions(contract.address, this.jobBatchSize);

      if (transactions.length === 0) {
        console.log(`✅ [BACKLOG] ${contract.name} - All transactions enriched!`);
        await this.updateContractStatus(contract.id, 'completed', 100);
        break;
      }

      // Log progress every batch
      const totalCount = await this.getTotalTransactionCount(contract.address);
      const enrichedCount = await this.getEnrichedTransactionCount(contract.address);
      const pendingCount = totalCount - enrichedCount;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalProcessed > 0 ? (totalProcessed / elapsed).toFixed(1) : '0';

      console.log(`📊 [BACKLOG] ${contract.name}: ${enrichedCount}/${totalCount} enriched, ${pendingCount} pending (${rate} tx/s overall)`);

      const progress = totalCount > 0 ? (enrichedCount / totalCount) * 100 : 0;
      await this.updateContractStatus(contract.id, 'in_progress', progress);

      // Process this batch
      const batchProcessed = await this.processTransactionsBatch(contract, transactions);
      totalProcessed += batchProcessed;

      // Small delay between batches to prevent overwhelming the API
      await this.sleep(500);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`📈 [BACKLOG] ${contract.name}: Processed ${totalProcessed} transactions in ${totalTime.toFixed(1)}s`);
  }

  /**
   * Get pending count for a contract (cached query, faster than full enrichment check)
   */
  private async getPendingCount(contractAddress: string): Promise<number> {
    const result = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) -
        (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as pending
    `, [contractAddress]);
    return parseInt(result.rows[0].pending) || 0;
  }

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

  private async processContract(contract: VolumeContract): Promise<void> {
    console.log(`🔍 [ENRICHMENT] Processing: ${contract.name} (${contract.address})`);

    try {
      const transactions = await this.getUnenrichedTransactions(contract.address, this.jobBatchSize);

      if (transactions.length === 0) {
        console.log(`✅ [ENRICHMENT] ${contract.name} - All transactions enriched`);
        await this.updateContractStatus(contract.id, 'completed', 100);
        return;
      }

      const totalCount = await this.getTotalTransactionCount(contract.address);
      const enrichedCount = await this.getEnrichedTransactionCount(contract.address);
      const pendingCount = totalCount - enrichedCount;

      console.log(`📊 [ENRICHMENT] ${contract.name}: ${enrichedCount}/${totalCount} enriched, ${pendingCount} pending`);

      const progress = totalCount > 0 ? (enrichedCount / totalCount) * 100 : 0;
      await this.updateContractStatus(contract.id, 'in_progress', progress);

      await this.processTransactions(contract, transactions);

      const newEnrichedCount = await this.getEnrichedTransactionCount(contract.address);
      const newProgress = totalCount > 0 ? (newEnrichedCount / totalCount) * 100 : 100;

      const status = newEnrichedCount >= totalCount ? 'completed' : 'in_progress';
      await this.updateContractStatus(contract.id, status, newProgress);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [ENRICHMENT] Failed for ${contract.name}:`, errorMessage);
      await this.updateContractStatus(contract.id, 'failed', 0, errorMessage);
    }
  }

  private async getUnenrichedTransactions(contractAddress: string, limit: number): Promise<TransactionToEnrich[]> {
    const result = await pool.query(`
      SELECT td.tx_hash, td.contract_address, td.wallet_address, td.block_timestamp
      FROM transaction_details td
      WHERE td.contract_address = $1
        AND NOT EXISTS (
          SELECT 1 FROM transaction_enrichment te 
          WHERE te.tx_hash = td.tx_hash
        )
      ORDER BY td.block_timestamp ASC
      LIMIT $2
    `, [contractAddress, limit]);

    return result.rows;
  }

  private async processTransactions(contract: VolumeContract, transactions: TransactionToEnrich[]): Promise<void> {
    await this.processTransactionsBatch(contract, transactions);
  }

  /**
   * Process a batch of transactions and return the success count
   */
  private async processTransactionsBatch(contract: VolumeContract, transactions: TransactionToEnrich[]): Promise<number> {
    const startTime = Date.now();
    let successCount = 0;
    let failureCount = 0;
    let lastSuccessfulTxHash: string | null = null;

    const apiBatches = this.chunkArray(transactions, this.batchSize);

    for (let i = 0; i < apiBatches.length; i++) {
      if (!this.isRunning) {
        console.log('⏸️  [ENRICHMENT] Service stopping...');
        break;
      }

      const batch = apiBatches[i];

      const results = await Promise.all(
        batch.map(tx => this.fetchAndSaveTransaction(tx))
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j]) {
          successCount++;
          lastSuccessfulTxHash = batch[j].tx_hash;
        } else {
          failureCount++;
        }
      }

      if (lastSuccessfulTxHash) {
        await this.updateLastEnrichedTxHash(contract.id, lastSuccessfulTxHash);
      }

      if ((i + 1) % 5 === 0 || i === apiBatches.length - 1) {
        const elapsed = (Date.now() - startTime) / 1000;
        const processed = (i + 1) * this.batchSize;
        console.log(`📈 [ENRICHMENT] ${contract.name}: ${Math.min(processed, transactions.length)}/${transactions.length} - ${(processed / elapsed).toFixed(1)} tx/s`);
      }

      if (i < apiBatches.length - 1) {
        await this.sleep(this.rateLimitDelay);
      }
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`📊 [ENRICHMENT] ${contract.name}: ${successCount} success, ${failureCount} failed in ${totalTime.toFixed(1)}s`);

    return successCount;
  }

  /**
   * Fetch transaction from Routerscan API and save raw response to DB
   * No processing - just store the API response as-is
   */
  private async fetchAndSaveTransaction(tx: TransactionToEnrich): Promise<boolean> {
    try {
      const details = await this.fetchTransactionDetails(tx.tx_hash);

      // Save raw API response - no processing
      await pool.query(`
        INSERT INTO transaction_enrichment (
          tx_hash, contract_address, wallet_address,
          value, gas_used, gas_price, gas_limit, burned_fees,
          l1_gas_price, l1_gas_used, l1_fee, l1_base_fee_scalar, l1_blob_base_fee, l1_blob_base_fee_scalar,
          contract_verified, method_id, method_full, input, logs, operations
        ) VALUES (
          $1, $2, $3,
          $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20
        )
        ON CONFLICT (tx_hash) DO UPDATE SET
          logs = EXCLUDED.logs,
          operations = EXCLUDED.operations,
          updated_at = NOW()
      `, [
        tx.tx_hash,
        tx.contract_address,
        tx.wallet_address,
        details.value || null,
        details.gasUsed || null,
        details.gasPrice || null,
        details.gasLimit || null,
        details.burnedFees || null,
        details.l1GasPrice || null,
        details.l1GasUsed || null,
        details.l1Fee || null,
        details.l1BaseFeeScalar || null,
        details.l1BlobBaseFee || null,
        details.l1BlobBaseFeeScalar || null,
        details.contractVerified || false,
        details.methodId || null,
        details.method || null,
        details.input || null,
        details.logs ? JSON.stringify(details.logs) : null,
        details.operations ? JSON.stringify(details.operations) : null
      ]);

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to enrich ${tx.tx_hash}: ${msg}`);
      return false;
    }
  }

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
            } else {
              reject(new Error(`API returned ${res.statusCode}`));
            }
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  private async getTotalTransactionCount(contractAddress: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM transaction_details WHERE contract_address = $1',
      [contractAddress]
    );
    return parseInt(result.rows[0].count);
  }

  private async getEnrichedTransactionCount(contractAddress: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM transaction_enrichment WHERE contract_address = $1',
      [contractAddress]
    );
    return parseInt(result.rows[0].count);
  }

  private async updateContractStatus(contractId: number, status: string, progress: number, error?: string): Promise<void> {
    await pool.query(`
      UPDATE contracts 
      SET enrichment_status = $1, enrichment_progress = $2, enrichment_error = $3
      WHERE id = $4
    `, [status, progress, error || null, contractId]);
  }

  private async updateLastEnrichedTxHash(contractId: number, txHash: string): Promise<void> {
    await pool.query(`
      UPDATE contracts 
      SET last_enriched_tx_hash = $1
      WHERE id = $2
    `, [txHash, contractId]);
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getStats(): Promise<any> {
    const result = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM contracts WHERE contract_type = 'volume') as total_contracts,
        (SELECT COUNT(*) FROM contracts WHERE contract_type = 'volume' AND enrichment_status = 'completed') as completed_contracts,
        (SELECT COUNT(*) FROM transaction_enrichment) as enriched_txs
    `);

    const stats = result.rows[0];

    // Add backlog processing status
    return {
      ...stats,
      backlog_processing: this.isProcessingBacklog,
      backlog_contract: this.backlogContract?.name || null,
      backlog_contract_address: this.backlogContract?.address || null
    };
  }
}
