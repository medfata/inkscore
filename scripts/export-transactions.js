const https = require('https');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse');

class TransactionExporter {
  constructor() {
    this.baseUrl = 'https://cdn.routescan.io/api/evm/all/exports';
    this.address = '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F'; // DailyGM contract
    this.chainId = '57073';
    this.contractCreatedDate = '2020-01-01T00:00:00.000Z'; // Start from early date
    // Testing with a much earlier date to see if API respects dateTo
    // Going back to July 28 instead of July 29 to force different cache
    this.currentDate = '2025-05-25T07:14:49.000Z';
    this.maxTransactionsPerBatch = 100000; // Same as BackfillService
    this.startTime = null;
    this.timings = {};
    this.batchResults = [];
  }

  makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve({ statusCode: res.statusCode, data: jsonData });
          } catch (error) {
            resolve({ statusCode: res.statusCode, data: data });
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  logTiming(step, startTime) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    this.timings[step] = duration;
    console.log(`⏱️  ${step}: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
    return endTime;
  }

  async initiateExport(fromDate, toDate, batchNumber = 1) {
    const exportUrl = `${this.baseUrl}/transactions`;
    const params = new URLSearchParams({
      includedChainIds: this.chainId,
      address: this.address,
      limit: this.maxTransactionsPerBatch.toString(),
      csvSeparator: ','
    });

    // Add date range - both fromDate and toDate are required for proper chaining
    params.append('dateFrom', fromDate);
    params.append('dateTo', toDate);

    // Add cache-busting parameter to force fresh export
    params.append('_t', Date.now().toString());

    const fullUrl = `${exportUrl}?${params.toString()}`;

    console.log(`\n🔄 [BATCH ${batchNumber}] Initiating export request...`);
    console.log(`📅 [BATCH ${batchNumber}] Date range: ${fromDate} to ${toDate}`);
    console.log(`🔗 [BATCH ${batchNumber}] URL: ${fullUrl}`);

    const stepStart = Date.now();

    try {
      const response = await this.makeRequest(fullUrl, {
        method: 'POST',
        headers: {
          'accept': '*/*',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,ar;q=0.7,fr;q=0.6',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'Referer': 'https://inkonscan.xyz/'
        }
      });

      if (response.statusCode === 200 && response.data.exportId) {
        this.logTiming(`Batch ${batchNumber} Export Initiation`, stepStart);
        console.log(`✅ [BATCH ${batchNumber}] Export initiated successfully!`);
        console.log(`📋 [BATCH ${batchNumber}] Export ID: ${response.data.exportId}`);
        return response.data.exportId;
      } else {
        throw new Error(`Failed to initiate export: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.error(`❌ [BATCH ${batchNumber}] Error initiating export:`, error.message);
      throw error;
    }
  }

  async checkExportStatus(exportId) {
    const statusUrl = `${this.baseUrl}/${exportId}`;

    try {
      const response = await this.makeRequest(statusUrl);

      if (response.statusCode === 200) {
        return response.data;
      } else {
        throw new Error(`Failed to check status: ${response.statusCode}`);
      }
    } catch (error) {
      console.error('Error checking export status:', error.message);
      throw error;
    }
  }

  async pollForCompletion(exportId, batchNumber = 1, maxAttempts = 120, intervalMs = 5000) {
    console.log(`⏳ [BATCH ${batchNumber}] Polling for export completion...`);
    const pollStart = Date.now();

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const status = await this.checkExportStatus(exportId);

        if (attempt % 10 === 0 || attempt <= 3) {
          console.log(`🔍 [BATCH ${batchNumber}] Attempt ${attempt}: Status = ${status.status}`);
        }

        if (status.status === 'succeeded') {
          this.logTiming(`Batch ${batchNumber} Export Processing`, pollStart);
          console.log(`✅ [BATCH ${batchNumber}] Export completed successfully!`);
          return status.url;
        } else if (status.status === 'failed') {
          throw new Error('Export failed');
        } else if (status.status === 'running') {
          if (attempt <= 3) {
            console.log(`⏳ [BATCH ${batchNumber}] Export still running... waiting ${intervalMs / 1000} seconds`);
          }
          await this.sleep(intervalMs);
        } else {
          console.log(`❓ [BATCH ${batchNumber}] Unknown status: ${status.status}`);
          await this.sleep(intervalMs);
        }
      } catch (error) {
        console.error(`❌ [BATCH ${batchNumber}] Error on attempt ${attempt}:`, error.message);
        if (attempt === maxAttempts) {
          throw error;
        }
        await this.sleep(intervalMs);
      }
    }

    throw new Error(`Export did not complete within ${maxAttempts} attempts`);
  }

  async downloadAndAnalyzeFile(url, batchNumber = 1, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
      console.log(`📥 [BATCH ${batchNumber}] Downloading and analyzing file...`);

      const downloadStart = Date.now();

      const downloadWithRedirect = (currentUrl, redirectCount = 0) => {
        if (redirectCount > maxRedirects) {
          reject(new Error('Too many redirects'));
          return;
        }

        https.get(currentUrl, (response) => {
          // Handle redirects
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
            const redirectUrl = response.headers.location;
            console.log(`🔄 [BATCH ${batchNumber}] Redirect ${response.statusCode} to: ${redirectUrl}`);

            if (redirectUrl) {
              downloadWithRedirect(redirectUrl, redirectCount + 1);
            } else {
              reject(new Error('Redirect without location header'));
            }
            return;
          }

          if (response.statusCode === 200) {
            let chunks = [];
            let totalSize = 0;

            response.on('data', (chunk) => {
              chunks.push(chunk);
              totalSize += chunk.length;
            });

            response.on('end', async () => {
              try {
                const downloadTime = Date.now() - downloadStart;
                this.timings[`Batch ${batchNumber} File Download`] = downloadTime;
                console.log(`⏱️  [BATCH ${batchNumber}] File Download: ${downloadTime}ms (${(downloadTime / 1000).toFixed(2)}s)`);
                console.log(`📁 [BATCH ${batchNumber}] Downloaded ${(totalSize / 1024 / 1024).toFixed(2)} MB`);

                // Combine chunks into buffer
                const buffer = Buffer.concat(chunks);

                // Extract and analyze CSV
                const analysis = await this.extractAndAnalyzeCsv(buffer, batchNumber);
                resolve(analysis);

              } catch (error) {
                reject(error);
              }
            });

            response.on('error', (error) => {
              reject(error);
            });
          } else {
            reject(new Error(`Failed to download file: ${response.statusCode}`));
          }
        }).on('error', (error) => {
          reject(error);
        });
      };

      downloadWithRedirect(url);
    });
  }

  async extractAndAnalyzeCsv(zipBuffer, batchNumber) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`📦 [BATCH ${batchNumber}] Extracting CSV from ZIP...`);

        // Extract CSV from ZIP buffer
        const zip = new AdmZip(zipBuffer);
        const zipEntries = zip.getEntries();

        const csvEntry = zipEntries.find(entry => entry.entryName.endsWith('.csv'));
        if (!csvEntry) {
          throw new Error('No CSV file found in ZIP archive');
        }

        const csvContent = zip.readAsText(csvEntry);
        console.log(`✅ [BATCH ${batchNumber}] CSV extracted: ${csvEntry.entryName}`);

        // Parse CSV and analyze
        const transactions = [];
        let rowCount = 0;

        const parser = parse({
          columns: true,
          skip_empty_lines: true
        });

        parser.on('data', (row) => {
          rowCount++;
          transactions.push({
            txHash: row['Transaction Hash'],
            blockNumber: parseInt(row['Blockno']) || 0,
            timestamp: row['DateTime (UTC)'],
            from: row['From'],
            to: row['To'],
            method: row['Method'] || null,
            status: row['Status'] === 'true'
          });
          if (rowCount >= 100000)
            console.log("last row: ", {
              txHash: row['Transaction Hash'],
              blockNumber: parseInt(row['Blockno']) || 0,
              timestamp: row['DateTime (UTC)'],
              from: row['From'],
              to: row['To'],
              method: row['Method'] || null,
              status: row['Status'] === 'true'
            })
        });

        parser.on('end', () => {
          // DO NOT sort - CSV is already sorted by API (newest first, oldest last)
          // firstTransaction = first row = newest
          // lastTransaction = last row = oldest (use this for next dateTo)

          // Log the last row (oldest transaction) for debugging
          // const lastRow = transactions[transactions.length - 1];
          // console.log(`📋 [BATCH ${batchNumber}] Last CSV row (oldest):`, JSON.stringify(lastRow, null, 2));

          const analysis = {
            batchNumber,
            totalTransactions: transactions.length,
            firstTransaction: transactions[0] || null,
            lastTransaction: transactions[transactions.length - 1] || null,
            dateRange: {
              newest: transactions[0]?.timestamp || null,
              oldest: transactions[transactions.length - 1]?.timestamp || null
            },
            uniqueHashes: new Set(transactions.map(tx => tx.txHash)).size,
            duplicateHashes: transactions.length - new Set(transactions.map(tx => tx.txHash)).size
          };

          console.log(`� [BATCH $ {batchNumber}] Analysis complete:`);
          console.log(`   � Total tnransactions: ${analysis.totalTransactions.toLocaleString()}`);
          console.log(`   � Datqe range: ${analysis.dateRange.newest} → ${analysis.dateRange.oldest}`);
          console.log(`   � Uniquce hashes: ${analysis.uniqueHashes.toLocaleString()}`);
          console.log(`   🔄 Duplicate hashes: ${analysis.duplicateHashes.toLocaleString()}`);

          if (analysis.firstTransaction) {
            console.log(`   🥇 First TX (newest): ${analysis.firstTransaction.txHash} (${analysis.firstTransaction.timestamp})`);
          }
          if (analysis.lastTransaction) {
            console.log(`   🏁 Last TX (oldest): ${analysis.lastTransaction.txHash} (${analysis.lastTransaction.timestamp})`);
          }

          resolve(analysis);
        });

        parser.on('error', (error) => {
          reject(error);
        });

        // Write CSV content to parser
        parser.write(csvContent);
        parser.end();

      } catch (error) {
        console.error(`❌ [BATCH ${batchNumber}] Error extracting/analyzing CSV:`, error);
        reject(error);
      }
    });
  }

  async getTotalTransactionCount() {
    const apiUrl = 'https://cdn.routescan.io/api/evm/all/transactions';
    const params = new URLSearchParams({
      fromAddresses: this.address,
      toAddresses: this.address,
      includedChainIds: this.chainId,
      count: 'true',  // This tells API to return count instead of transactions
      limit: '1'
    });

    const fullUrl = `${apiUrl}?${params.toString()}`;

    console.log('🔢 Getting total transaction count from API...');
    console.log(`🔗 Count URL: ${fullUrl}`);

    try {
      const response = await this.makeRequest(fullUrl, {
        headers: {
          'accept': 'application/json',
          'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8,ar;q=0.7,fr;q=0.6',
          'cache-control': 'no-cache',
          'pragma': 'no-cache',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'cross-site',
          'Referer': 'https://inkonscan.xyz/'
        }
      });

      if (response.statusCode === 200 && response.data.count !== undefined) {
        const count = parseInt(response.data.count.toString());
        console.log(`📊 API reports total transactions: ${count.toLocaleString()}`);
        return count;
      } else {
        console.warn('⚠️ No count field in API response, defaulting to 0');
        console.log('Response:', JSON.stringify(response.data, null, 2));
        return 0;
      }
    } catch (error) {
      console.error('❌ Failed to fetch transaction count:', error.message);
      throw error;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async processBatch(fromDate, toDate, batchNumber) {
    try {
      // Step 1: Initiate export
      const exportId = await this.initiateExport(fromDate, toDate, batchNumber);

      // Step 2: Poll for completion
      const downloadUrl = await this.pollForCompletion(exportId, batchNumber);

      // Step 3: Download and analyze
      const analysis = await this.downloadAndAnalyzeFile(downloadUrl, batchNumber);

      return analysis;

    } catch (error) {
      console.error(`❌ [BATCH ${batchNumber}] Batch processing failed:`, error.message);
      throw error;
    }
  }

  analyzeChaining() {
    console.log('\n🔍 === CHAINING ANALYSIS ===');

    if (this.batchResults.length === 0) {
      console.log('❌ No batch results to analyze');
      return;
    }

    // Check for overlaps and gaps - now expecting proper chronological progression
    for (let i = 0; i < this.batchResults.length - 1; i++) {
      const currentBatch = this.batchResults[i];
      const nextBatch = this.batchResults[i + 1];

      console.log(`\n📊 Batch ${currentBatch.batchNumber} → Batch ${nextBatch.batchNumber}:`);

      // Since we're working backwards, current batch should have NEWER dates than next batch
      // newest = first row, oldest = last row
      const currentOldestTime = new Date(currentBatch.dateRange.oldest).getTime();
      const nextNewestTime = new Date(nextBatch.dateRange.newest).getTime();

      if (currentOldestTime <= nextNewestTime) {
        const overlapMs = nextNewestTime - currentOldestTime;
        console.log(`   ⚠️  OVERLAP detected: ${overlapMs}ms (${(overlapMs / 1000).toFixed(2)}s)`);
        console.log(`   📅 Current batch oldest: ${currentBatch.dateRange.oldest}`);
        console.log(`   📅 Next batch newest: ${nextBatch.dateRange.newest}`);
      } else {
        const gapMs = currentOldestTime - nextNewestTime;
        console.log(`   ✅ GAP detected: ${gapMs}ms (${(gapMs / 1000).toFixed(2)}s)`);
        console.log(`   📅 Current batch oldest: ${currentBatch.dateRange.oldest}`);
        console.log(`   📅 Next batch newest: ${nextBatch.dateRange.newest}`);
      }
    }

    // Check for duplicate transactions across batches
    const allHashes = new Set();
    const duplicateHashes = new Set();
    let totalTransactions = 0;

    this.batchResults.forEach(batch => {
      totalTransactions += batch.totalTransactions;
    });

    console.log(`\n📈 SUMMARY:`);
    console.log(`   📦 Total batches: ${this.batchResults.length}`);
    console.log(`   📊 Total transactions: ${totalTransactions.toLocaleString()}`);
    console.log(`   📅 Overall date range: ${this.batchResults[0]?.dateRange.newest} → ${this.batchResults[this.batchResults.length - 1]?.dateRange.oldest}`);

    // Check if data is in proper chronological order (newest to oldest across batches)
    let isChronological = true;
    for (let i = 0; i < this.batchResults.length - 1; i++) {
      const currentOldest = new Date(this.batchResults[i].dateRange.oldest).getTime();
      const nextNewest = new Date(this.batchResults[i + 1].dateRange.newest).getTime();

      // Current batch's oldest should be newer than next batch's newest
      if (currentOldest <= nextNewest) {
        isChronological = false;
        break;
      }
    }

    console.log(`   ⏰ Chronological order: ${isChronological ? '✅ YES' : '❌ NO'}`);

    // Detect if we're getting the same data repeatedly
    const firstBatchRange = this.batchResults[0];
    const lastBatchRange = this.batchResults[this.batchResults.length - 1];

    if (firstBatchRange && lastBatchRange) {
      const firstStart = new Date(firstBatchRange.dateRange.oldest).getTime();
      const firstEnd = new Date(firstBatchRange.dateRange.newest).getTime();
      const lastStart = new Date(lastBatchRange.dateRange.oldest).getTime();
      const lastEnd = new Date(lastBatchRange.dateRange.newest).getTime();

      const rangeOverlap = Math.max(0, Math.min(firstEnd, lastEnd) - Math.max(firstStart, lastStart));
      const firstRange = firstEnd - firstStart;
      const overlapPercentage = firstRange > 0 ? (rangeOverlap / firstRange) * 100 : 0;

      if (overlapPercentage > 50) {
        console.log(`   🚨 MAJOR OVERLAP: ${overlapPercentage.toFixed(1)}% - API likely returning same data!`);
      }
    }
  }

  async run() {
    try {
      this.startTime = Date.now();
      let calculatedBatches = 3; // Default fallback

      console.log('=== Transaction Export Chaining Test ===');
      console.log(`🎯 Contract Address: ${this.address}`);
      console.log(`⛓️  Chain ID: ${this.chainId}`);
      console.log(`📅 Date Range: ${this.contractCreatedDate} to ${this.currentDate}`);
      console.log(`📦 Max Transactions Per Batch: ${this.maxTransactionsPerBatch.toLocaleString()}`);
      console.log(`🕐 Start Time: ${new Date().toISOString()}`);
      console.log('');

      // First, get the total transaction count from API
      const totalTransactionCount = await this.getTotalTransactionCount();

      if (totalTransactionCount === 0) {
        console.log('❌ No transactions found for this contract');
        process.exit(1);
      }

      // Calculate how many batches we need dynamically
      calculatedBatches = Math.ceil(totalTransactionCount / this.maxTransactionsPerBatch);
      console.log(`📊 Calculated batches needed: ${calculatedBatches} (${totalTransactionCount.toLocaleString()} ÷ ${this.maxTransactionsPerBatch.toLocaleString()})`);
      console.log('');

      // Process all calculated batches - working BACKWARDS in time
      // Since API returns newest transactions first, we need to work backwards
      let currentToDate = this.currentDate; // Start from current time
      const fixedFromDate = this.contractCreatedDate; // Always use contract creation date
      let totalProcessedTransactions = 0;
      let lastOldestTimestamp = null; // Track previous batch's oldest to detect loops

      for (let batchNum = 1; batchNum <= calculatedBatches; batchNum++) {
        console.log(`\n🚀 === PROCESSING BATCH ${batchNum}/${calculatedBatches} ===`);

        const batchResult = await this.processBatch(fixedFromDate, currentToDate, batchNum);
        this.batchResults.push(batchResult);
        totalProcessedTransactions += batchResult.totalTransactions;

        // Show progress
        const progressPercentage = (totalProcessedTransactions / totalTransactionCount) * 100;
        console.log(`📈 [PROGRESS] ${totalProcessedTransactions.toLocaleString()}/${totalTransactionCount.toLocaleString()} (${progressPercentage.toFixed(1)}%)`);

        // Use lastTransaction (last row in CSV = oldest) for next batch's dateTo
        // CSV is sorted newest→oldest, so lastTransaction is the oldest
        if (batchResult.lastTransaction) {
          const oldestInBatch = batchResult.lastTransaction.timestamp;
          const newestInBatch = batchResult.firstTransaction.timestamp;

          console.log(`📅 [BATCH ${batchNum}] Oldest TX: ${oldestInBatch}`);
          console.log(`📅 [BATCH ${batchNum}] Newest TX: ${newestInBatch}`);

          // Check if we're stuck in a loop (same oldest timestamp as previous batch)
          if (lastOldestTimestamp && oldestInBatch === lastOldestTimestamp) {
            // We're in a loop - jump to end of previous day (23:59:59.999)
            // This ensures we get all transactions from the day before
            const oldestDate = new Date(oldestInBatch);
            const endOfPreviousDay = new Date(Date.UTC(
              oldestDate.getUTCFullYear(),
              oldestDate.getUTCMonth(),
              oldestDate.getUTCDate() - 1,
              23, 59, 59, 999
            ));
            console.log(`⚠️ [BATCH ${batchNum}] LOOP DETECTED! Jumping to end of previous day: ${endOfPreviousDay.toISOString()}`);
            currentToDate = endOfPreviousDay.toISOString();
          } else {
            // Normal case - use oldest transaction - 1ms
            const nextToDate = new Date(new Date(oldestInBatch).getTime() - 1);
            currentToDate = nextToDate.toISOString();
          }

          lastOldestTimestamp = oldestInBatch;
          console.log(`📅 [BATCH ${batchNum}] Next batch dateTo: ${currentToDate}`);
        }

        // If we got fewer transactions than the limit, we might be done early
        if (batchResult.totalTransactions < this.maxTransactionsPerBatch) {
          console.log(`✅ [BATCH ${batchNum}] Got ${batchResult.totalTransactions.toLocaleString()} transactions (less than limit) - likely complete`);

          // Check if we've processed all expected transactions
          if (totalProcessedTransactions >= totalTransactionCount) {
            console.log(`🎉 [COMPLETE] Processed all expected transactions!`);
            break;
          }
        }

        // Add a small delay between batches to be nice to the API
        if (batchNum < calculatedBatches) {
          console.log(`⏳ Waiting 10 seconds before next batch...`);
          await this.sleep(10000);
        }
      }

      // Analyze the chaining behavior
      this.analyzeChaining();

      // Calculate total time
      const totalTime = Date.now() - this.startTime;
      this.timings['Total Process'] = totalTime;

      console.log('\n=== Performance Summary ===');
      console.log(`⏱️  Total Process: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
      console.log('');
      console.log('📊 Breakdown:');
      Object.entries(this.timings).forEach(([step, time]) => {
        const percentage = ((time / totalTime) * 100).toFixed(1);
        console.log(`   ${step}: ${time}ms (${(time / 1000).toFixed(2)}s) - ${percentage}%`);
      });

      console.log('\n=== Test Complete ===');
      console.log('🎯 Key Findings:');

      const totalBatchTransactions = this.batchResults.reduce((sum, batch) => sum + batch.totalTransactions, 0);

      console.log(`   � APDI Total Count: ${totalTransactionCount.toLocaleString()}`);
      console.log(`   📦 Batch Total Count: ${totalBatchTransactions.toLocaleString()}`);
      console.log(`   📈 Difference: ${(totalBatchTransactions - totalTransactionCount).toLocaleString()}`);

      if (totalBatchTransactions > totalTransactionCount) {
        console.log(`   🚨 ISSUE: Batches returned MORE transactions than API count - likely duplicates!`);
      } else if (totalBatchTransactions < totalTransactionCount) {
        console.log(`   ⚠️  WARNING: Batches returned FEWER transactions than API count - missing data!`);
      } else {
        console.log(`   ✅ SUCCESS: Batch count matches API count exactly!`);
      }

      if (this.batchResults.length > 1) {
        const firstBatch = this.batchResults[0];
        const lastBatch = this.batchResults[this.batchResults.length - 1];

        console.log(`   📦 Processed ${this.batchResults.length} batches`);
        console.log(`   📅 Date span: ${firstBatch.dateRange.newest} → ${lastBatch.dateRange.oldest}`);

        // Check if we're getting proper chaining or duplicates
        const hasOverlaps = this.batchResults.some((batch, i) => {
          if (i === 0) return false;
          const prevBatch = this.batchResults[i - 1];
          return new Date(prevBatch.dateRange.oldest).getTime() >= new Date(batch.dateRange.newest).getTime();
        });

        if (hasOverlaps) {
          console.log(`   🚨 ISSUE: Batches have overlapping date ranges - API not chaining properly!`);
        } else {
          console.log(`   ✅ SUCCESS: Batches have proper chronological progression`);
        }
      }

      // Exit successfully
      process.exit(0);

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    }
  }
}

// Run the script
if (require.main === module) {
  const exporter = new TransactionExporter();
  exporter.run();
}

module.exports = TransactionExporter;