import { pool } from '../db/index.js';
import https from 'https';

interface TransactionToEnrich {
  tx_hash: string;
  contract_address: string;
  wallet_address: string;
  block_timestamp: Date;
  contract_name: string;
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

/**
 * Streamlined Real-Time Volume Enrichment Service
 * 
 * Focuses ONLY on enriching new transactions as they arrive.
 * No backlog processing - use the gap enrichment script for that.
 * 
 * Features:
 * - Processes only recent transactions (last 5 minutes)
 * - Batch API calls and DB inserts for performance
 * - Lightweight and fast
 * - Volume contracts only
 */
export class VolumeEnrichmentService {
  private baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
  private batchSize = 25; // API batch size
  private rateLimitDelay = 100; // ms between API calls
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly RECENT_WINDOW_MINUTES = 5; // Only process transactions from last 5 minutes

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Real-Time Volume Enrichment Service is already running');
      return;
    }

    console.log('🚀 Starting Real-Time Volume Enrichment Service');
    console.log('📊 Processing only new transactions (last 5 minutes)');
    this.isRunning = true;

    // Initial processing
    await this.processRecentTransactions();

    // Set up regular processing
    this.processingInterval = setInterval(() => {
      this.processRecentTransactions();
    }, this.POLL_INTERVAL_MS);

    console.log(`✅ Real-Time Enrichment Service started (checking every ${this.POLL_INTERVAL_MS / 1000}s)`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Real-Time Volume Enrichment Service...');
    this.isRunning = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    console.log('✅ Real-Time Volume Enrichment Service stopped');
  }

  /**
   * Process only recent transactions that need enrichment
   */
  private async processRecentTransactions(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const startTime = Date.now();
      
      // Get recent unenriched transactions from volume contracts
      const recentTransactions = await this.getRecentUnenrichedTransactions();

      if (recentTransactions.length === 0) {
        console.log('✅ [REALTIME] No new transactions to enrich');
        return;
      }

      console.log(`🔄 [REALTIME] Found ${recentTransactions.length} new transactions to enrich`);

      // Group by contract for better logging
      const contractGroups = this.groupTransactionsByContract(recentTransactions);
      
      for (const [contractName, transactions] of contractGroups.entries()) {
        console.log(`   📊 ${contractName}: ${transactions.length} transactions`);
      }

      // Process all transactions in batches
      const successCount = await this.processBatchEnrichment(recentTransactions);
      
      const totalTime = (Date.now() - startTime) / 1000;
      const rate = successCount > 0 ? (successCount / totalTime).toFixed(1) : '0';
      
      console.log(`✅ [REALTIME] Enriched ${successCount}/${recentTransactions.length} transactions in ${totalTime.toFixed(1)}s (${rate} tx/s)`);

    } catch (error) {
      console.error('❌ [REALTIME] Processing error:', error);
    }
  }

  /**
   * Get recent unenriched transactions from volume contracts only
   */
  private async getRecentUnenrichedTransactions(): Promise<TransactionToEnrich[]> {
    const result = await pool.query(`
      SELECT 
        td.tx_hash,
        td.contract_address,
        td.wallet_address,
        td.block_timestamp,
        c.name AS contract_name
      FROM transaction_details td
      JOIN contracts c ON c.address = td.contract_address
      WHERE c.contract_type = 'volume'
        AND c.is_active = true
        AND c.indexing_enabled = true
        AND td.block_timestamp >= NOW() - INTERVAL '${this.RECENT_WINDOW_MINUTES} minutes'
        AND NOT EXISTS (
          SELECT 1 FROM transaction_enrichment te 
          WHERE te.tx_hash = td.tx_hash
        )
      ORDER BY td.block_timestamp DESC
    `);

    return result.rows;
  }

  /**
   * Group transactions by contract for better logging
   */
  private groupTransactionsByContract(transactions: TransactionToEnrich[]): Map<string, TransactionToEnrich[]> {
    const groups = new Map<string, TransactionToEnrich[]>();
    
    for (const tx of transactions) {
      const contractName = tx.contract_name;
      if (!groups.has(contractName)) {
        groups.set(contractName, []);
      }
      groups.get(contractName)!.push(tx);
    }
    
    return groups;
  }

  /**
   * Process transactions with batch API calls and batch DB inserts
   */
  private async processBatchEnrichment(transactions: TransactionToEnrich[]): Promise<number> {
    const apiBatches = this.chunkArray(transactions, this.batchSize);
    const enrichedData: Array<{ tx: TransactionToEnrich; details: RouterscanTransaction }> = [];
    let apiFailures = 0;

    // Batch API calls
    for (let i = 0; i < apiBatches.length && this.isRunning; i++) {
      const batch = apiBatches[i];

      const results = await Promise.all(
        batch.map(async (tx) => {
          try {
            const details = await this.fetchTransactionDetails(tx.tx_hash);
            return { tx, details, success: true };
          } catch (error) {
            apiFailures++;
            return { tx, details: null, success: false };
          }
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

    // Batch DB insert
    if (enrichedData.length > 0) {
      await this.batchInsertEnrichments(enrichedData);
    }

    if (apiFailures > 0) {
      console.log(`   ⚠️  ${apiFailures} API failures (will retry next cycle)`);
    }

    return enrichedData.length;
  }

  /**
   * Batch insert enrichment data for better performance
   */
  private async batchInsertEnrichments(enrichedData: Array<{ tx: TransactionToEnrich; details: RouterscanTransaction }>): Promise<void> {
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

    await pool.query(`
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
        (SELECT COUNT(*) FROM contracts WHERE contract_type = 'volume' AND is_active = true) as active_contracts,
        (SELECT COUNT(*) FROM transaction_enrichment WHERE created_at >= NOW() - INTERVAL '1 hour') as enriched_last_hour,
        (SELECT COUNT(*) FROM transaction_enrichment WHERE created_at >= NOW() - INTERVAL '5 minutes') as enriched_last_5min
    `);

    return {
      ...result.rows[0],
      mode: 'realtime_only',
      recent_window_minutes: this.RECENT_WINDOW_MINUTES,
      poll_interval_seconds: this.POLL_INTERVAL_MS / 1000
    };
  }
}
