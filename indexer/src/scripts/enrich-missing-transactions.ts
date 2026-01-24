import 'dotenv/config';
import { pool } from '../db/index.js';
import https from 'https';

/**
 * Gap Enrichment Script
 * 
 * Identifies and enriches transactions that were missed by the main enrichment loop.
 * Handles the 71,641 unenriched transactions across volume contracts.
 * 
 * Features:
 * - Identifies exact missing transaction hashes
 * - Batch processing with rate limiting
 * - Retry logic for failed API calls
 * - Progress tracking and resumable processing
 * - Contract-by-contract processing for better control
 * 
 * Usage:
 *   npm run gap-enrich                    # Process all contracts
 *   npm run gap-enrich -- --contract=0x... # Process specific contract
 *   npm run gap-enrich -- --dry-run       # Show what would be processed
 *   
 * Run natively on your PC - no Docker required
 */

interface MissingTransaction {
  tx_hash: string;
  contract_address: string;
  wallet_address: string;
  block_timestamp: Date;
  contract_name: string;
}

interface ContractGap {
  contract_address: string;
  contract_name: string;
  missing_count: number;
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

class GapEnrichmentService {
  private baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
  private batchSize = 25; // API batch size
  private processingBatchSize = 500; // DB query batch size
  private rateLimitDelay = 150; // ms between API calls
  private retryDelay = 2000; // ms between retries
  private maxRetries = 3;
  private isRunning = true;

  async start(options: { contractAddress?: string; dryRun?: boolean } = {}): Promise<void> {
    console.log('🔍 Gap Enrichment Service');
    console.log('═══════════════════════════════════════');
    console.log('');

    // Setup graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, stopping...');
      this.isRunning = false;
    });

    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, stopping...');
      this.isRunning = false;
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
      console.log('✅ Gap enrichment completed successfully');

    } catch (error) {
      console.error('❌ Gap enrichment failed:', error);
      throw error;
    }
  }

  /**
   * Show what would be processed without actually doing it
   */
  private async performDryRun(contractAddress?: string): Promise<void> {
    console.log('🔍 DRY RUN - Analyzing missing transactions');
    console.log('');

    const gaps = await this.getContractGaps(contractAddress);

    if (gaps.length === 0) {
      console.log('✅ No missing transactions found!');
      return;
    }

    console.log('📊 Missing Transactions by Contract:');
    console.log('');

    let totalMissing = 0;
    for (const gap of gaps) {
      console.log(`   ${gap.contract_name}`);
      console.log(`   ${gap.contract_address}`);
      console.log(`   Missing: ${gap.missing_count.toLocaleString()} transactions`);
      console.log('');
      totalMissing += parseInt(gap.missing_count.toString());
    }

    console.log('═══════════════════════════════════════');
    console.log(`📈 Total: ${totalMissing.toLocaleString()} transactions across ${gaps.length} contracts`);
    console.log('');

    const estimatedTime = this.estimateProcessingTime(totalMissing);
    console.log(`⏱️  Estimated processing time: ${estimatedTime}`);
    console.log('');
    console.log('To start processing:');
    console.log('  npm run gap-enrich                    # All contracts');
    console.log('  npm run gap-enrich -- --contract=0x... # Specific contract');
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

    let totalProcessed = 0;
    let totalMissing = gaps.reduce((sum, gap) => sum + gap.missing_count, 0);

    for (let i = 0; i < gaps.length && this.isRunning; i++) {
      const gap = gaps[i];
      console.log(`🔄 [${i + 1}/${gaps.length}] Processing: ${gap.contract_name}`);
      console.log(`   Address: ${gap.contract_address}`);
      console.log(`   Missing: ${gap.missing_count.toLocaleString()} transactions`);
      console.log('');

      const processed = await this.processContract(gap.contract_address);
      totalProcessed += processed;

      const remaining = totalMissing - totalProcessed;
      console.log(`📈 Progress: ${totalProcessed.toLocaleString()}/${totalMissing.toLocaleString()} (${remaining.toLocaleString()} remaining)`);
      console.log('');
    }
  }

  /**
   * Process a specific contract's missing transactions
   */
  private async processContract(contractAddress: string): Promise<number> {
    const startTime = Date.now();
    let totalProcessed = 0;
    let totalFailed = 0;
    let offset = 0;
    let totalQueryTime = 0;
    let totalApiTime = 0;

    // Get total count first for progress tracking
    console.log('   🔍 Getting total missing transaction count...');
    const totalCountResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM transaction_details td
      WHERE td.contract_address = $1
        AND NOT EXISTS (
          SELECT 1 FROM transaction_enrichment te 
          WHERE te.tx_hash = td.tx_hash
        )
    `, [contractAddress]);
    
    const totalMissing = parseInt(totalCountResult.rows[0].count);
    console.log(`   📊 Total missing transactions: ${totalMissing.toLocaleString()}`);
    console.log('');

    if (totalMissing === 0) {
      console.log('   ✅ No missing transactions found!');
      return 0;
    }

    while (this.isRunning) {
      // Get next batch of missing transactions
      const queryStart = Date.now();
      const missingTxs = await this.getMissingTransactions(contractAddress, this.processingBatchSize, offset);
      totalQueryTime += (Date.now() - queryStart);

      if (missingTxs.length === 0) {
        console.log('   ✅ No more missing transactions found');
        break; // No more missing transactions
      }

      const progress = ((offset + missingTxs.length) / totalMissing * 100).toFixed(1);
      console.log(`   📦 Processing batch: ${offset + 1}-${offset + missingTxs.length} (${progress}% of ${totalMissing.toLocaleString()})`);

      // Process in API-sized batches
      const apiBatches = this.chunkArray(missingTxs, this.batchSize);
      let batchProcessed = 0;
      let batchFailed = 0;

      // Collect all successful enrichments for batch DB insert
      const enrichedData: Array<{ tx: MissingTransaction; details: RouterscanTransaction }> = [];

      const apiStart = Date.now();
      for (let i = 0; i < apiBatches.length && this.isRunning; i++) {
        const batch = apiBatches[i];

        const results = await Promise.all(
          batch.map(async (tx) => {
            try {
              const details = await this.fetchTransactionDetails(tx.tx_hash);
              return { tx, details, success: true };
            } catch (error) {
              const msg = error instanceof Error ? error.message : 'Unknown error';
              console.error(`   ❌ API failed for ${tx.tx_hash}: ${msg}`);
              return { tx, details: null, success: false };
            }
          })
        );

        // Collect successful results for batch insert
        for (const result of results) {
          if (result.success && result.details) {
            enrichedData.push({ tx: result.tx, details: result.details });
            batchProcessed++;
          } else {
            batchFailed++;
          }
        }

        // Rate limiting between API batches
        if (i < apiBatches.length - 1) {
          await this.sleep(this.rateLimitDelay);
        }
      }
      totalApiTime += (Date.now() - apiStart);

      // Batch insert all successful enrichments
      if (enrichedData.length > 0) {
        const dbStartTime = Date.now();
        await this.batchInsertEnrichments(enrichedData);
        const dbTime = Date.now() - dbStartTime;
        console.log(`   💾 Batch DB insert: ${enrichedData.length} records in ${dbTime}ms (${(dbTime / enrichedData.length).toFixed(1)}ms per record)`);
      }

      totalProcessed += batchProcessed;
      totalFailed += batchFailed;
      offset += missingTxs.length;

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalProcessed > 0 ? (totalProcessed / elapsed).toFixed(1) : '0';
      const overallProgress = (totalProcessed / totalMissing * 100).toFixed(1);

      console.log(`   ✅ Batch complete: +${batchProcessed} success, ${batchFailed} failed (${rate} tx/s overall, ${overallProgress}% complete)`);

      // Small delay between processing batches
      await this.sleep(500);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log(`   📊 Contract complete: ${totalProcessed}/${totalMissing} enriched, ${totalFailed} failed in ${totalTime.toFixed(1)}s`);
    console.log(`   ⏱️  Query time: ${(totalQueryTime / 1000).toFixed(1)}s, API time: ${(totalApiTime / 1000).toFixed(1)}s`);

    return totalProcessed;
  }

  /**
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
   * Get missing transactions for a specific contract
   */
  private async getMissingTransactions(
    contractAddress: string, 
    limit: number, 
    offset: number = 0
  ): Promise<MissingTransaction[]> {
    const startTime = Date.now();

    const result = await pool.query(`
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

    const queryTime = Date.now() - startTime;
    console.log(`   ⏱️  Missing transactions query: ${queryTime}ms (${result.rows.length} transactions, offset ${offset})`);
    
    // Add warning for slow queries
    if (queryTime > 30000) {
      console.log(`   ⚠️  Query is very slow (${(queryTime/1000).toFixed(1)}s) - consider adding database indexes`);
    }

    return result.rows;
  }

  /**
   * Batch insert enrichment data to database for better performance
   */
  private async batchInsertEnrichments(enrichedData: Array<{ tx: MissingTransaction; details: RouterscanTransaction }>): Promise<void> {
    if (enrichedData.length === 0) return;

    // Build bulk INSERT query
    const values: unknown[] = [];
    const placeholders: string[] = [];

    enrichedData.forEach((item, idx) => {
      const offset = idx * 20; // 20 parameters per row
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
   * Estimate processing time based on transaction count
   */
  private estimateProcessingTime(transactionCount: number): string {
    // Estimate: ~10 tx/s with rate limiting and retries
    const estimatedSeconds = transactionCount / 10;
    
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

// CLI argument parsing
function parseArgs(): { contractAddress?: string; dryRun?: boolean } {
  const args = process.argv.slice(2);
  const options: { contractAddress?: string; dryRun?: boolean } = {};

  for (const arg of args) {
    if (arg.startsWith('--contract=')) {
      options.contractAddress = arg.split('=')[1];
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

// Main execution
async function main() {
  console.log('🚀 Starting Gap Enrichment Service...');
  
  const options = parseArgs();
  console.log('📋 Options:', options);
  
  const service = new GapEnrichmentService();

  try {
    await service.start(options);
    process.exit(0);
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the main function
main();

export { GapEnrichmentService };