const https = require('https');
const fs = require('fs');
const path = require('path');

class EnrichmentBenchmark {
    constructor() {
        this.baseUrl = 'https://cdn.routescan.io/api/evm/57073/transactions';
        this.csvPath = '0xD00C96804e9fF35f10C7D2a92239C351Ff3F94e5/44535d16d07341eebacc438889d5cc2a.csv';
        this.testSizes = [1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 50, 75, 100]; // Extended range including higher values
        this.results = {};
        this.transactionHashes = [];
        this.debugCount = 0; // For debugging failed requests
    }

    async loadTransactionHashes() {
        console.log('Loading transaction hashes from CSV...');

        try {
            const csvContent = fs.readFileSync(this.csvPath, 'utf8');
            const lines = csvContent.split('\n');

            // Skip header and get transaction hashes
            for (let i = 1; i < lines.length && i <= 101; i++) { // Load first 100 transactions
                const line = lines[i].trim();
                if (line) {
                    const columns = line.split(',');
                    const txHash = columns[0]; // First column is Transaction Hash
                    if (txHash && txHash.startsWith('0x')) {
                        this.transactionHashes.push(txHash);
                    }
                }
            }

            console.log(`Loaded ${this.transactionHashes.length} transaction hashes`);
            return this.transactionHashes.length > 0;
        } catch (error) {
            console.error('Error loading CSV:', error.message);
            return false;
        }
    }

    makeRequest(url) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            https.get(url, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;

                    try {
                        const jsonData = JSON.parse(data);
                        resolve({
                            statusCode: res.statusCode,
                            data: jsonData,
                            duration: duration,
                            success: res.statusCode === 200
                        });
                    } catch (error) {
                        resolve({
                            statusCode: res.statusCode,
                            data: data,
                            duration: duration,
                            success: false,
                            error: error.message
                        });
                    }
                });
            }).on('error', (error) => {
                const endTime = Date.now();
                const duration = endTime - startTime;
                reject({ error: error.message, duration: duration });
            });
        });
    }

    async testSingleTransaction(txHash) {
        const url = `${this.baseUrl}/${txHash}`;

        try {
            const result = await this.makeRequest(url);

            // Debug first few failures
            if (!result.success && this.debugCount < 3) {
                console.log(`   🔍 Debug failed request:`);
                console.log(`   URL: ${url}`);
                console.log(`   Status: ${result.statusCode}`);
                console.log(`   Response: ${JSON.stringify(result.data).substring(0, 200)}...`);
                this.debugCount++;
            }

            return result;
        } catch (error) {
            if (this.debugCount < 3) {
                console.log(`   🔍 Debug error: ${error.error}`);
                this.debugCount++;
            }
            return { success: false, error: error.error, duration: error.duration };
        }
    }

    async testBatchSize(batchSize, testTransactions) {
        console.log(`\n🧪 Testing batch size: ${batchSize}`);

        const batches = [];
        for (let i = 0; i < testTransactions.length; i += batchSize) {
            batches.push(testTransactions.slice(i, i + batchSize));
        }

        const batchResults = [];
        const overallStart = Date.now();

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            const batchStart = Date.now();

            console.log(`   Batch ${batchIndex + 1}/${batches.length} (${batch.length} transactions)`);

            // Process batch concurrently
            const promises = batch.map(txHash => this.testSingleTransaction(txHash));
            const results = await Promise.all(promises);

            const batchEnd = Date.now();
            const batchDuration = batchEnd - batchStart;

            const successCount = results.filter(r => r.success).length;
            const avgResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

            batchResults.push({
                batchIndex: batchIndex + 1,
                size: batch.length,
                duration: batchDuration,
                successCount: successCount,
                failureCount: batch.length - successCount,
                avgResponseTime: avgResponseTime
            });

            console.log(`   ✅ Completed in ${batchDuration}ms | Success: ${successCount}/${batch.length} | Avg response: ${avgResponseTime.toFixed(0)}ms`);

            // Rate limiting between batches
            if (batchIndex < batches.length - 1) {
                await this.sleep(100);
            }
        }

        const overallEnd = Date.now();
        const overallDuration = overallEnd - overallStart;

        // Calculate metrics
        const totalRequests = testTransactions.length;
        const totalSuccesses = batchResults.reduce((sum, b) => sum + b.successCount, 0);
        const totalFailures = batchResults.reduce((sum, b) => sum + b.failureCount, 0);
        const avgBatchDuration = batchResults.reduce((sum, b) => sum + b.duration, 0) / batchResults.length;
        const avgResponseTime = batchResults.reduce((sum, b) => sum + b.avgResponseTime, 0) / batchResults.length;
        const requestsPerSecond = (totalRequests / overallDuration) * 1000;

        return {
            batchSize: batchSize,
            totalRequests: totalRequests,
            totalBatches: batches.length,
            overallDuration: overallDuration,
            avgBatchDuration: avgBatchDuration,
            avgResponseTime: avgResponseTime,
            successRate: (totalSuccesses / totalRequests) * 100,
            requestsPerSecond: requestsPerSecond,
            totalSuccesses: totalSuccesses,
            totalFailures: totalFailures,
            batchResults: batchResults
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async runBenchmark() {
        console.log('🚀 Starting Enrichment API Benchmark');
        console.log('=====================================');

        // Load transaction hashes
        const loaded = await this.loadTransactionHashes();
        if (!loaded) {
            console.error('Failed to load transaction hashes');
            return;
        }

        // Use first 50 transactions for testing (adjust based on your needs)
        const testTransactions = this.transactionHashes.slice(0, 50);
        console.log(`Testing with ${testTransactions.length} transactions`);

        // Test each batch size
        for (const batchSize of this.testSizes) {
            try {
                const result = await this.testBatchSize(batchSize, testTransactions);
                this.results[batchSize] = result;

                // Wait between different batch size tests
                await this.sleep(1000);
            } catch (error) {
                console.error(`Error testing batch size ${batchSize}:`, error.message);
                this.results[batchSize] = { error: error.message };
            }
        }

        this.printResults();
    }

    printResults() {
        console.log('\n📊 BENCHMARK RESULTS');
        console.log('====================');

        // Create results table
        const tableData = [];

        Object.entries(this.results).forEach(([batchSize, result]) => {
            if (result.error) {
                tableData.push({
                    batchSize: batchSize,
                    duration: 'ERROR',
                    requestsPerSec: 'ERROR',
                    successRate: 'ERROR',
                    avgResponse: 'ERROR'
                });
            } else {
                tableData.push({
                    batchSize: batchSize,
                    duration: `${(result.overallDuration / 1000).toFixed(2)}s`,
                    requestsPerSec: result.requestsPerSecond.toFixed(2),
                    successRate: `${result.successRate.toFixed(1)}%`,
                    avgResponse: `${result.avgResponseTime.toFixed(0)}ms`,
                    avgBatch: `${result.avgBatchDuration.toFixed(0)}ms`
                });
            }
        });

        // Print table header
        console.log('Batch Size | Total Time | Req/Sec | Success Rate | Avg Response | Avg Batch');
        console.log('-----------|------------|---------|--------------|--------------|----------');

        // Print table rows
        tableData.forEach(row => {
            console.log(`${row.batchSize.toString().padEnd(10)} | ${row.duration.padEnd(10)} | ${row.requestsPerSec.padEnd(7)} | ${row.successRate.padEnd(12)} | ${row.avgResponse.padEnd(12)} | ${row.avgBatch || 'N/A'}`);
        });

        // Find optimal batch size
        const validResults = Object.entries(this.results).filter(([_, result]) => !result.error);

        if (validResults.length > 0) {
            // Sort by requests per second (higher is better)
            const sortedBySpeed = validResults.sort((a, b) => b[1].requestsPerSecond - a[1].requestsPerSecond);
            const fastest = sortedBySpeed[0];

            // Sort by success rate (higher is better)
            const sortedBySuccess = validResults.sort((a, b) => b[1].successRate - a[1].successRate);
            const mostReliable = sortedBySuccess[0];

            console.log('\n🏆 RECOMMENDATIONS');
            console.log('==================');
            console.log(`Fastest: Batch size ${fastest[0]} (${fastest[1].requestsPerSecond.toFixed(2)} req/sec)`);
            console.log(`Most Reliable: Batch size ${mostReliable[0]} (${mostReliable[1].successRate.toFixed(1)}% success rate)`);

            // Find balanced recommendation (good speed + high success rate)
            const balanced = validResults.find(([_, result]) =>
                result.successRate >= 95 && result.requestsPerSecond >= fastest[1].requestsPerSecond * 0.8
            );

            if (balanced) {
                console.log(`Recommended: Batch size ${balanced[0]} (balanced speed and reliability)`);
            }
        }

        console.log('\n✅ Benchmark completed!');
    }
}

// Run the benchmark
if (require.main === module) {
    const benchmark = new EnrichmentBenchmark();
    benchmark.runBenchmark().catch(error => {
        console.error('Benchmark failed:', error);
        process.exit(1);
    });
}

module.exports = EnrichmentBenchmark;