import { pool } from '../db/index.js';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse';
import AdmZip from 'adm-zip';

export interface BackfillJobPayload {
  contractId: number;
  contractAddress: string;
  fromDate: string;  // ISO string - start date (oldest)
  toDate: string;    // ISO string - end date (newest)
}

interface ExportBatch {
  transactionCount: number;
  firstTransactionDate: string;  // newest in batch
  lastTransactionDate: string;   // oldest in batch
  hasMore: boolean;              // true if more data exists after toDate
}

/**
 * Simplified BackfillService - On-demand backfill processing
 * 
 * Flow:
 * 1. Admin creates job with fromDate -> toDate
 * 2. Service exports CSV from Routescan API (oldest to newest)
 * 3. If first transaction date is within range, continue with next batch
 * 4. Update fromDate to firstTransactionDate + 1 second for next batch
 * 5. Repeat until firstTransactionDate > toDate (no more data in range)
 */
export class BackfillService {
  private baseUrl = 'https://cdn.routescan.io/api/evm/all/exports';
  private chainId = '57073';
  private maxTransactionsPerBatch = 100000;
  private csvStoragePath = './csv_exports';

  constructor() {
    if (!fs.existsSync(this.csvStoragePath)) {
      fs.mkdirSync(this.csvStoragePath, { recursive: true });
    }
  }

  /**
   * Process a backfill job with the given payload
   * This is the main entry point called by JobQueueService
   */
  async processBackfillJob(jobId: number, payload: BackfillJobPayload): Promise<void> {
    const { contractId, contractAddress, fromDate, toDate } = payload;
    const startTime = Date.now();

    console.log(`\n🚀 [BACKFILL] Starting job ${jobId}`);
    console.log(`📍 [BACKFILL] Contract: ${contractAddress}`);
    console.log(`📅 [BACKFILL] Range: ${fromDate} → ${toDate}`);

    // Get contract name for logging
    const contract = await this.getContract(contractId);
    if (contract) {
      console.log(`📛 [BACKFILL] Name: ${contract.name}`);
    }

    try {
      // Update job status
      await this.updateJobProgress(jobId, 'processing', 0);

      let currentToDate = toDate;
      let batchNumber = 1;
      let totalProcessed = 0;
      let hasMore = true;
      let previousLastTransactionDate: string | null = null;

      while (hasMore) {
        console.log(`\n🔄 [BACKFILL] Batch ${batchNumber}`);
        console.log(`   📅 Range: ${fromDate} → ${currentToDate}`);

        const batch = await this.processBatch(
          jobId,
          contractAddress,
          fromDate,
          currentToDate,
          batchNumber
        );

        totalProcessed += batch.transactionCount;
        console.log(`   ✅ Processed: ${batch.transactionCount.toLocaleString()} transactions`);
        console.log(`   📊 Total so far: ${totalProcessed.toLocaleString()}`);

        // Check if we should continue
        // The API returns newest first, so lastTransactionDate is the oldest in batch
        // We need to continue backward from the oldest transaction
        if (!batch.hasMore || batch.transactionCount === 0) {
          hasMore = false;
          console.log(`   🏁 No more data in range`);
        } else if (previousLastTransactionDate === batch.lastTransactionDate) {
          // API is returning same data (likely cached export) - prevent infinite loop
          hasMore = false;
          console.log(`   🏁 Stopping - no progress being made (same lastTransactionDate)`);
        } else {
          // Move toDate backward to continue from where we left off
          // Subtract 2 seconds from lastTransactionDate to avoid getting stuck
          // at the same timestamp due to second-level precision
          previousLastTransactionDate = batch.lastTransactionDate;
          currentToDate = this.subtractSeconds(batch.lastTransactionDate, 2);
          console.log(`   ⬅️  Next batch to: ${currentToDate}`);

          // Safety check: if new toDate is before fromDate, stop
          if (new Date(currentToDate) < new Date(fromDate)) {
            hasMore = false;
            console.log(`   🏁 Reached start of date range`);
          }
        }

        batchNumber++;

        // Update progress (estimate based on date range covered)
        const progress = this.calculateProgress(fromDate, currentToDate, toDate);
        await this.updateJobProgress(jobId, 'processing', progress);
      }

      // Mark job as completed
      const totalTime = (Date.now() - startTime) / 1000;
      await this.updateJobProgress(jobId, 'completed', 100);

      console.log(`\n🎉 [BACKFILL] Job ${jobId} completed`);
      console.log(`📊 [BACKFILL] Total: ${totalProcessed.toLocaleString()} transactions`);
      console.log(`⏱️  [BACKFILL] Duration: ${this.formatDuration(totalTime)}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ [BACKFILL] Job ${jobId} failed:`, errorMessage);
      await this.updateJobProgress(jobId, 'failed', 0, errorMessage);
      throw error;
    }
  }

  /**
   * Process a single batch of transactions
   */
  private async processBatch(
    jobId: number,
    contractAddress: string,
    fromDate: string,
    toDate: string,
    batchNumber: number
  ): Promise<ExportBatch> {
    // Ensure proper ISO format
    const safeFromDate = this.ensureISOFormat(fromDate);
    const safeToDate = this.ensureISOFormat(toDate);

    // Step 1: Initiate CSV export
    console.log(`   📤 Initiating export...`);
    const exportId = await this.initiateExport(contractAddress, safeFromDate, safeToDate);
    console.log(`   ✅ Export ID: ${exportId}`);

    // Step 2: Poll for completion
    console.log(`   ⏳ Waiting for export...`);
    const downloadUrl = await this.pollForCompletion(exportId);

    // Step 3: Download ZIP
    console.log(`   📥 Downloading...`);
    const zipPath = path.join(this.csvStoragePath, `${exportId}.zip`);
    await this.downloadFile(downloadUrl, zipPath);

    // Step 4: Extract CSV
    const csvPath = await this.extractCsvFromZip(zipPath, exportId);

    // Step 5: Parse and store
    console.log(`   💾 Storing transactions...`);
    const result = await this.parseAndStoreTransactions(csvPath, contractAddress);

    // Clean up CSV file
    try {
      fs.unlinkSync(csvPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    // Determine if there's more data
    // If we got a full batch, there's likely more
    // Also check if the oldest transaction (lastDate) is still after our fromDate
    const hasMore =
      result.transactionCount >= this.maxTransactionsPerBatch &&
      new Date(result.lastDate) > new Date(fromDate);

    return {
      transactionCount: result.transactionCount,
      firstTransactionDate: result.firstDate,
      lastTransactionDate: result.lastDate,
      hasMore
    };
  }

  /**
   * Initiate CSV export from Routescan API
   */
  private async initiateExport(
    contractAddress: string,
    fromDate: string,
    toDate: string,
    retryCount = 0
  ): Promise<string> {
    const exportUrl = `${this.baseUrl}/transactions`;

    const params = new URLSearchParams({
      includedChainIds: this.chainId,
      address: contractAddress,
      limit: this.maxTransactionsPerBatch.toString(),
      dateFrom: fromDate,
      dateTo: toDate,
      csvSeparator: ','
    });

    const fullUrl = `${exportUrl}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      const req = https.request(fullUrl, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'Referer': 'https://inkonscan.xyz/'
        }
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', async () => {
          try {
            const response = JSON.parse(data);

            // Handle rate limiting
            if (response.statusCode === 403 && response.message?.includes('concurrent exports')) {
              if (retryCount < 3) {
                const delay = (retryCount + 1) * 30000;
                console.log(`   ⏳ Rate limited, retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
                const result = await this.initiateExport(contractAddress, fromDate, toDate, retryCount + 1);
                resolve(result);
                return;
              }
              reject(new Error('Rate limit exceeded after 3 retries'));
              return;
            }

            if (response.exportId) {
              resolve(response.exportId);
            } else {
              reject(new Error(`Export failed: ${data}`));
            }
          } catch (error) {
            reject(new Error(`Invalid response: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Poll for export completion
   */
  private async pollForCompletion(exportId: string, maxAttempts = 120): Promise<string> {
    const statusUrl = `${this.baseUrl}/${exportId}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.checkExportStatus(statusUrl);

      if (status.status === 'succeeded' && status.url) {
        return status.url;
      } else if (status.status === 'failed') {
        throw new Error('Export failed on server');
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error(`Export timeout after ${maxAttempts} attempts`);
  }

  private async checkExportStatus(statusUrl: string): Promise<{ status: string; url?: string }> {
    return new Promise((resolve, reject) => {
      https.get(statusUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error(`Invalid status response: ${data}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Download file with redirect handling
   */
  private async downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const downloadWithRedirect = (currentUrl: string, redirectCount = 0) => {
        if (redirectCount > 5) {
          reject(new Error('Too many redirects'));
          return;
        }

        const file = fs.createWriteStream(filePath);

        https.get(currentUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            file.close();
            fs.unlinkSync(filePath);
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              downloadWithRedirect(redirectUrl, redirectCount + 1);
            } else {
              reject(new Error('Redirect without location'));
            }
            return;
          }

          if (response.statusCode === 200) {
            response.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', reject);
          } else {
            file.close();
            fs.unlinkSync(filePath);
            reject(new Error(`Download failed: ${response.statusCode}`));
          }
        }).on('error', reject);
      };

      downloadWithRedirect(url);
    });
  }

  /**
   * Extract CSV from ZIP archive
   */
  private async extractCsvFromZip(zipPath: string, exportId: string): Promise<string> {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    const csvEntry = zipEntries.find(entry => entry.entryName.endsWith('.csv'));

    if (!csvEntry) {
      throw new Error('No CSV file found in ZIP');
    }

    const csvPath = path.join(this.csvStoragePath, `${exportId}.csv`);
    const csvContent = zip.readFile(csvEntry);

    if (!csvContent) {
      throw new Error('Failed to read CSV from ZIP');
    }

    fs.writeFileSync(csvPath, csvContent);
    fs.unlinkSync(zipPath);

    return csvPath;
  }

  /**
   * Parse CSV and store transactions in database
   */
  private async parseAndStoreTransactions(
    csvPath: string,
    contractAddress: string
  ): Promise<{ transactionCount: number; firstDate: string; lastDate: string }> {
    return new Promise((resolve, reject) => {
      const transactions: any[] = [];
      let firstTimestamp = '';
      let lastTimestamp = '';
      let firstTxHash = '';
      let lastTxHash = '';

      fs.createReadStream(csvPath)
        .pipe(parse({ columns: true, skip_empty_lines: true }))
        .on('data', (row: any) => {
          const currentTimestamp = row['DateTime (UTC)'];
          const currentTxHash = row['Transaction Hash'];

          if (transactions.length === 0) {
            firstTimestamp = currentTimestamp;
            firstTxHash = currentTxHash;
          }
          lastTimestamp = currentTimestamp;
          lastTxHash = currentTxHash;

          transactions.push({
            tx_hash: row['Transaction Hash'],
            wallet_address: row['From']?.toLowerCase() || null,
            contract_address: contractAddress.toLowerCase(),
            function_name: row['Method'] || null,
            eth_value: row['Value(ETH)'] || '0',
            block_number: parseInt(row['Blockno']) || 0,
            block_timestamp: new Date(row['DateTime (UTC)']),
            status: row['Status'] === 'true' ? 1 : 0,
            chain_id: parseInt(row['ChainId']) || 57073,
            to_address: row['To']?.toLowerCase() || null,
            unix_timestamp: parseInt(row['UnixTimestamp']) || null,
            value_in_eth: parseFloat(row['Value_IN(ETH)']) || null,
            value_out_eth: parseFloat(row['Value_OUT(ETH)']) || null,
            txn_fee_eth: parseFloat(row['TxnFee(ETH)']) || null,
            txn_fee_usd: parseFloat(row['TxnFee(USD)']) || null,
            historical_eth_price: parseFloat(row['Historical $Price/ETH']) || null,
          });
        })
        .on('end', async () => {
          try {
            // Log first and last transaction from CSV for debugging
            if (transactions.length > 0) {
              console.log(`   📋 CSV First TX: ${firstTxHash} @ ${firstTimestamp}`);
              console.log(`   📋 CSV Last TX:  ${lastTxHash} @ ${lastTimestamp}`);
              await this.batchInsertTransactions(transactions);
            }

            const firstDate = transactions.length > 0
              ? transactions[0].block_timestamp.toISOString()
              : firstTimestamp;
            const lastDate = transactions.length > 0
              ? transactions[transactions.length - 1].block_timestamp.toISOString()
              : lastTimestamp;

            resolve({
              transactionCount: transactions.length,
              firstDate,
              lastDate
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }


  /**
   * Batch insert transactions into database
   */
  private async batchInsertTransactions(transactions: any[]): Promise<void> {
    const client = await pool.connect();
    const BATCH_SIZE = 1000;

    try {
      await client.query('BEGIN');

      for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
        const batch = transactions.slice(i, i + BATCH_SIZE);
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const tx of batch) {
          placeholders.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13}, $${paramIndex + 14}, $${paramIndex + 15})`
          );

          values.push(
            tx.tx_hash,
            tx.wallet_address,
            tx.contract_address,
            tx.function_name,
            tx.eth_value,
            tx.block_number,
            tx.block_timestamp,
            tx.status,
            tx.chain_id,
            tx.to_address,
            tx.unix_timestamp,
            tx.value_in_eth,
            tx.value_out_eth,
            tx.txn_fee_eth,
            tx.txn_fee_usd,
            tx.historical_eth_price
          );

          paramIndex += 16;
        }

        const insertQuery = `
          INSERT INTO transaction_details (
            tx_hash, wallet_address, contract_address, function_name,
            eth_value, block_number, block_timestamp, status, chain_id, to_address,
            unix_timestamp, value_in_eth, value_out_eth,
            txn_fee_eth, txn_fee_usd, historical_eth_price
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (tx_hash) DO UPDATE SET
            wallet_address = EXCLUDED.wallet_address,
            contract_address = EXCLUDED.contract_address,
            function_name = EXCLUDED.function_name,
            eth_value = EXCLUDED.eth_value,
            block_number = EXCLUDED.block_number,
            block_timestamp = EXCLUDED.block_timestamp,
            status = EXCLUDED.status,
            chain_id = EXCLUDED.chain_id,
            to_address = EXCLUDED.to_address,
            unix_timestamp = EXCLUDED.unix_timestamp,
            value_in_eth = EXCLUDED.value_in_eth,
            value_out_eth = EXCLUDED.value_out_eth,
            txn_fee_eth = EXCLUDED.txn_fee_eth,
            txn_fee_usd = EXCLUDED.txn_fee_usd,
            historical_eth_price = EXCLUDED.historical_eth_price,
            updated_at = NOW()
        `;

        await client.query(insertQuery, values);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Helper methods
  private async getContract(contractId: number): Promise<{ name: string; address: string } | null> {
    const result = await pool.query(
      'SELECT name, address FROM contracts WHERE id = $1',
      [contractId]
    );
    return result.rows[0] || null;
  }

  private async updateJobProgress(
    jobId: number,
    status: string,
    progress: number,
    errorMessage?: string
  ): Promise<void> {
    const updates = ['status = $2'];
    const values: any[] = [jobId, status];

    if (status === 'processing') {
      updates.push('started_at = COALESCE(started_at, NOW())');
    } else if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = NOW()');
    }

    if (errorMessage) {
      updates.push(`error_message = $${values.length + 1}`);
      values.push(errorMessage);
    }

    // Store progress in payload
    updates.push(`payload = payload || jsonb_build_object('progress', ${progress})`);

    await pool.query(
      `UPDATE job_queue SET ${updates.join(', ')} WHERE id = $1`,
      values
    );
  }

  private ensureISOFormat(date: string): string {
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) {
        throw new Error('Invalid date');
      }
      return d.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  private addOneSecond(isoDate: string): string {
    const date = new Date(isoDate);
    date.setTime(date.getTime() + 1000);
    return date.toISOString();
  }

  private subtractOneSecond(isoDate: string): string {
    const date = new Date(isoDate);
    date.setTime(date.getTime() - 1000);
    return date.toISOString();
  }

  private subtractSeconds(isoDate: string, seconds: number): string {
    const date = new Date(isoDate);
    date.setTime(date.getTime() - (seconds * 1000));
    return date.toISOString();
  }

  private calculateProgress(fromDate: string, currentToDate: string, toDate: string): number {
    const from = new Date(fromDate).getTime();
    const currentTo = new Date(currentToDate).getTime();
    const to = new Date(toDate).getTime();

    if (to <= from) return 100;
    // Progress is how much of the range we've covered (from toDate going backward to fromDate)
    const progress = ((to - currentTo) / (to - from)) * 100;
    return Math.min(Math.max(progress, 0), 100);
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds.toFixed(0)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  }
}
