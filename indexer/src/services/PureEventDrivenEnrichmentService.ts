import { pool } from '../db/index.js';
import https from 'https';

/**
 * Pure Event-Driven Volume Enrichment Service
 * 
 * Simplified approach that ONLY:
 * 1. Listens for database triggers when new transactions are inserted
 * 2. Enriches the specific triggered transaction immediately
 * 3. No polling, no backlog processing, no batch processing
 * 4. Pure real-time processing of individual transactions
 * 
 * How it works:
 * - PostgreSQL trigger fires when new transaction inserted
 * - Trigger sends NOTIFY with transaction hash and contract address
 * - Service receives notification instantly
 * - Service enriches that specific transaction immediately
 * - All historical/backlog processing handled by separate concurrent script
 */

interface TransactionToEnrich {
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

export class PureEventDrivenEnrichmentService {
  private baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
  private isRunning = false;
  private processingQueue: Set<string> = new Set(); // Track transactions being processed
  private listenerClient: any = null;

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Pure Event-Driven Enrichment Service is already running');
      return;
    }

    console.log('🚀 Starting Pure Event-Driven Volume Enrichment Service');
    console.log('⚡ Only processes new triggered transactions - no backlog processing');
    console.log('📊 Use concurrent gap script for any historical/backlog data');
    this.isRunning = true;

    // Setup database notification listener
    await this.setupDatabaseListener();

    console.log('✅ Pure Event-Driven Enrichment Service started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('🛑 Stopping Pure Event-Driven Volume Enrichment Service...');
    this.isRunning = false;

    // Close listener connection
    if (this.listenerClient) {
      this.listenerClient.release();
      this.listenerClient = null;
    }

    console.log('✅ Pure Event-Driven Volume Enrichment Service stopped');
  }

  /**
   * Setup database listener for new transaction notifications
   */
  private async setupDatabaseListener(): Promise<void> {
    try {
      // Create a dedicated connection for listening
      this.listenerClient = await pool.connect();

      // Listen for new transaction notifications
      await this.listenerClient.query('LISTEN new_volume_transaction');

      this.listenerClient.on('notification', async (msg: any) => {
        if (msg.channel === 'new_volume_transaction' && msg.payload) {
          try {
            const data = JSON.parse(msg.payload);
            await this.handleNewTransaction(data.contract_address, data.tx_hash);
          } catch (error) {
            console.error('❌ [EVENT] Failed to process notification:', error);
          }
        }
      });

      console.log('✅ Database listener setup complete - ready for real-time events');
    } catch (error) {
      console.error('❌ Failed to setup database listener:', error);
      console.error('💡 Make sure database triggers are installed:');
      console.error('   psql $DATABASE_URL -f src/db/setup-enrichment-triggers.sql');
      throw error;
    }
  }

  /**
   * Handle notification of a new transaction
   */
  private async handleNewTransaction(contractAddress: string, txHash: string): Promise<void> {
    if (!this.isRunning || this.processingQueue.has(txHash)) {
      return; // Skip if not running or already processing this transaction
    }

    console.log(`🔔 [EVENT] New transaction: ${txHash.substring(0, 16)}... for contract ${contractAddress.substring(0, 10)}...`);

    // Process this specific transaction immediately
    await this.enrichSingleTransaction(txHash, contractAddress);
  }

  /**
   * Enrich a single specific transaction immediately
   */
  private async enrichSingleTransaction(txHash: string, contractAddress: string): Promise<void> {
    if (this.processingQueue.has(txHash)) {
      return; // Already processing
    }

    this.processingQueue.add(txHash);

    try {
      const startTime = Date.now();

      // Get contract info
      const contractInfo = await this.getContractInfo(contractAddress);
      if (!contractInfo) {
        console.log(`⚠️  [PROCESS] Contract not found: ${contractAddress}`);
        return;
      }

      // Check if transaction is already enriched
      const isEnriched = await this.isTransactionEnriched(txHash);
      if (isEnriched) {
        console.log(`✅ [PROCESS] Transaction ${txHash.substring(0, 16)}... already enriched`);
        return;
      }

      // Get transaction details from transaction_details table
      const transactionData = await this.getTransactionData(txHash, contractAddress);
      if (!transactionData) {
        console.log(`⚠️  [PROCESS] Transaction data not found: ${txHash}`);
        return;
      }

      console.log(`🔄 [PROCESS] ${contractInfo.name}: Enriching transaction ${txHash.substring(0, 16)}...`);

      // Fetch from Routerscan API and save to database
      try {
        const details = await this.fetchTransactionDetails(txHash);
        await this.insertEnrichmentData(transactionData, details);

        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`✅ [PROCESS] ${contractInfo.name}: Transaction enriched in ${totalTime.toFixed(2)}s`);

      } catch (apiError) {
        console.error(`❌ [PROCESS] API failed for ${txHash}: ${apiError instanceof Error ? apiError.message : apiError}`);
      }

    } finally {
      this.processingQueue.delete(txHash);
    }
  }

  /**
   * Check if a transaction is already enriched
   */
  private async isTransactionEnriched(txHash: string): Promise<boolean> {
    const result = await pool.query(`
      SELECT 1 FROM transaction_enrichment WHERE tx_hash = $1
    `, [txHash]);

    return result.rows.length > 0;
  }

  /**
   * Get transaction data from transaction_details
   */
  private async getTransactionData(txHash: string, contractAddress: string): Promise<TransactionToEnrich | null> {
    const result = await pool.query(`
      SELECT 
        td.tx_hash,
        td.contract_address,
        td.wallet_address,
        td.block_timestamp,
        c.name AS contract_name
      FROM transaction_details td
      JOIN contracts c ON c.address = td.contract_address
      WHERE td.tx_hash = $1 AND td.contract_address = $2
    `, [txHash, contractAddress]);

    return result.rows.length > 0 ? result.rows[0] : null;
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
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Insert enrichment data for a single transaction
   */
  private async insertEnrichmentData(tx: TransactionToEnrich, details: RouterscanTransaction): Promise<void> {
    await pool.query(`
      INSERT INTO transaction_enrichment (
        tx_hash, contract_address, wallet_address,
        value, gas_used, gas_price, gas_limit, burned_fees,
        l1_gas_price, l1_gas_used, l1_fee, l1_base_fee_scalar, l1_blob_base_fee, l1_blob_base_fee_scalar,
        contract_verified, method_id, method_full, input, logs, operations
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
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
  }

  /**
   * Get service statistics
   */
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
      mode: 'pure_event_driven',
      processing_queue_size: this.processingQueue.size,
      listener_active: this.listenerClient !== null
    };
  }
}