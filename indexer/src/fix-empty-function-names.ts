import 'dotenv/config';
import { pool } from './db/index.js';
import https from 'https';

/**
 * Fix Empty Function Names Script
 * 
 * Fetches transactions with empty function_name from the database,
 * retrieves the methodId/method from Routescan API, and updates them.
 * 
 * Usage: npx tsx src/fix-empty-function-names.ts
 */

const BATCH_SIZE = 100;
const API_BATCH_SIZE = 25; // Concurrent API requests
const RATE_LIMIT_DELAY = 100; // ms between API batches
const BASE_URL = 'https://cdn.routescan.io/api/evm/57073/transactions';

interface TransactionToFix {
    tx_hash: string;
}

interface RouterscanTransaction {
    txHash: string;
    methodId: string | null;
    method: string | null;
}

async function fetchTransactionDetails(txHash: string): Promise<RouterscanTransaction | null> {
    const url = `${BASE_URL}/${txHash}`;

    return new Promise((resolve) => {
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
                    } else {
                        console.error(`❌ API returned ${res.statusCode} for ${txHash}`);
                        resolve(null);
                    }
                } catch {
                    console.error(`❌ Invalid JSON for ${txHash}`);
                    resolve(null);
                }
            });
        });

        req.on('error', (err) => {
            console.error(`❌ Request error for ${txHash}:`, err.message);
            resolve(null);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            console.error(`❌ Timeout for ${txHash}`);
            resolve(null);
        });
    });
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

async function main() {
    console.log('🔧 Fix Empty Function Names Script');
    console.log('===================================\n');

    // Get count of transactions to fix
    const countResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM transaction_details
    WHERE function_name IS NULL OR TRIM(function_name) = ''
  `);
    const totalToFix = parseInt(countResult.rows[0].count);
    console.log(`📊 Found ${totalToFix} transactions with empty function_name\n`);

    if (totalToFix === 0) {
        console.log('✅ Nothing to fix!');
        await pool.end();
        return;
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalFailed = 0;
    const startTime = Date.now();

    while (true) {
        // Fetch batch of transactions to fix
        const result = await pool.query<TransactionToFix>(`
      SELECT tx_hash
      FROM transaction_details
      WHERE function_name IS NULL OR TRIM(function_name) = ''
      LIMIT ${BATCH_SIZE}
    `);

        const transactions = result.rows;

        if (transactions.length === 0) {
            console.log('\n✅ All transactions processed!');
            break;
        }

        console.log(`\n📦 Processing batch of ${transactions.length} transactions...`);

        // Process in smaller API batches for rate limiting
        const apiBatches = chunkArray(transactions, API_BATCH_SIZE);

        for (const apiBatch of apiBatches) {
            // Fetch all transaction details in parallel
            const detailsPromises = apiBatch.map(tx => fetchTransactionDetails(tx.tx_hash));
            const detailsResults = await Promise.all(detailsPromises);

            // Update each transaction
            for (let i = 0; i < apiBatch.length; i++) {
                const tx = apiBatch[i];
                const details = detailsResults[i];

                if (details) {
                    // Use method name if available, otherwise methodId
                    const functionName = details.method?.split('(')[0] || details.methodId || null;

                    if (functionName) {
                        await pool.query(
                            `UPDATE transaction_details SET function_name = $1, updated_at = NOW() WHERE tx_hash = $2`,
                            [functionName, tx.tx_hash]
                        );
                        totalUpdated++;
                    } else {
                        // No method info available, set to 'unknown' to avoid reprocessing
                        await pool.query(
                            `UPDATE transaction_details SET function_name = $1, updated_at = NOW() WHERE tx_hash = $2`,
                            ['unknown', tx.tx_hash]
                        );
                        totalFailed++;
                    }
                } else {
                    totalFailed++;
                }

                totalProcessed++;
            }

            // Rate limit delay between API batches
            await sleep(RATE_LIMIT_DELAY);
        }

        // Progress update
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        const remaining = totalToFix - totalProcessed;
        const eta = remaining / rate;

        console.log(`📈 Progress: ${totalProcessed}/${totalToFix} (${((totalProcessed / totalToFix) * 100).toFixed(1)}%)`);
        console.log(`   ✅ Updated: ${totalUpdated} | ❌ Failed: ${totalFailed}`);
        console.log(`   ⏱️  Rate: ${rate.toFixed(1)} tx/s | ETA: ${(eta / 60).toFixed(1)} min`);
    }

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('\n===================================');
    console.log('🎉 Script completed!');
    console.log(`📊 Total processed: ${totalProcessed}`);
    console.log(`✅ Updated: ${totalUpdated}`);
    console.log(`❌ Failed: ${totalFailed}`);
    console.log(`⏱️  Duration: ${(totalTime / 60).toFixed(1)} minutes`);

    await pool.end();
}

main().catch(error => {
    console.error('💥 Fatal error:', error);
    pool.end();
    process.exit(1);
});
