import { createPublicClient, http, type PublicClient } from 'viem';
import { pool } from './db/index.js';
import { RPC_ENDPOINTS } from './config.js';

/**
 * Input Data Filler Service
 * 
 * This service fills in missing input_data for transactions that were indexed
 * without it (e.g., from Routescan API which doesn't include input in list responses).
 * 
 * Uses load balancing across multiple RPC endpoints for higher throughput.
 */

const BATCH_SIZE = 100; // Process 100 transactions at a time
const DELAY_BETWEEN_BATCHES_MS = 500; // Rate limiting

// Create multiple RPC clients for load balancing
// Each endpoint has 20 req/sec limit, so 2 endpoints = 40 req/sec effective
const rpcClients: PublicClient[] = RPC_ENDPOINTS.map((url) =>
    createPublicClient({
        transport: http(url, {
            retryCount: 2,
            retryDelay: 500,
        }),
    })
);

// Round-robin client selector
let rpcClientIndex = 0;
function getNextRpcClient(): PublicClient {
    const client = rpcClients[rpcClientIndex];
    rpcClientIndex = (rpcClientIndex + 1) % rpcClients.length;
    return client;
}

// With 2 RPCs at 20 req/sec each, we can do ~35 req/sec safely
const RPC_CHUNK_SIZE = 35;
const RPC_CHUNK_DELAY_MS = 1000;

interface TransactionToFill {
    tx_hash: string;
    contract_address: string;
}

/**
 * Get transactions that are missing input_data
 */
async function getTransactionsWithoutInput(
    contractAddresses?: string[],
    limit: number = 1000
): Promise<TransactionToFill[]> {
    let query = `
    SELECT tx_hash, contract_address
    FROM transaction_details
    WHERE (input_data IS NULL OR input_data = '')
  `;

    const params: unknown[] = [];

    if (contractAddresses && contractAddresses.length > 0) {
        const placeholders = contractAddresses.map((_, i) => `$${i + 1}`).join(', ');
        query += ` AND LOWER(contract_address) IN (${placeholders})`;
        params.push(...contractAddresses.map(a => a.toLowerCase()));
    }

    query += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows as TransactionToFill[];
}

/**
 * Fetch input data from RPC for a batch of transactions
 * Uses load balancing across multiple RPC endpoints
 */
async function fetchInputDataBatch(txHashes: string[]): Promise<Map<string, string>> {
    const inputMap = new Map<string, string>();

    if (txHashes.length === 0) return inputMap;

    // Process in chunks, distributing across RPC endpoints
    for (let i = 0; i < txHashes.length; i += RPC_CHUNK_SIZE) {
        const chunk = txHashes.slice(i, i + RPC_CHUNK_SIZE);

        try {
            const txPromises = chunk.map(hash => {
                const client = getNextRpcClient();
                return client.getTransaction({ hash: hash as `0x${string}` })
                    .catch(() => null);
            });

            const transactions = await Promise.all(txPromises);

            for (let j = 0; j < chunk.length; j++) {
                const tx = transactions[j];
                if (tx && tx.input && tx.input !== '0x') {
                    inputMap.set(chunk[j].toLowerCase(), tx.input);
                }
            }
        } catch {
            // Silent fail
        }

        // Wait between chunks (except for last chunk)
        if (i + RPC_CHUNK_SIZE < txHashes.length) {
            await sleep(RPC_CHUNK_DELAY_MS);
        }
    }

    return inputMap;
}

/**
 * Update transactions with input data
 */
async function updateInputData(updates: Array<{ tx_hash: string; input_data: string }>): Promise<number> {
    if (updates.length === 0) return 0;

    let updated = 0;

    for (const update of updates) {
        try {
            await pool.query(
                `UPDATE transaction_details SET input_data = $1 WHERE tx_hash = $2`,
                [update.input_data, update.tx_hash]
            );
            updated++;
        } catch {
            // Silent fail
        }
    }

    return updated;
}

/**
 * Fill input data for transactions missing it
 */
export async function fillInputData(contractAddresses?: string[]): Promise<{
    processed: number;
    filled: number;
    failed: number;
}> {
    console.log('\n========================================');
    console.log('Input Data Filler Service');
    console.log(`RPC endpoints: ${RPC_ENDPOINTS.length} (load balanced)`);
    console.log('========================================');

    if (contractAddresses && contractAddresses.length > 0) {
        console.log(`Target contracts: ${contractAddresses.join(', ')}`);
    } else {
        console.log('Target: All contracts with missing input data');
    }
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log('========================================\n');

    let totalProcessed = 0;
    let totalFilled = 0;
    let totalFailed = 0;
    let batchNum = 0;

    while (true) {
        batchNum++;

        const transactions = await getTransactionsWithoutInput(contractAddresses, BATCH_SIZE);

        if (transactions.length === 0) {
            console.log('\n✓ No more transactions to fill!');
            break;
        }

        console.log(`[Batch ${batchNum}] Processing ${transactions.length} transactions...`);

        const txHashes = transactions.map(t => t.tx_hash);
        const inputDataMap = await fetchInputDataBatch(txHashes);

        const updates: Array<{ tx_hash: string; input_data: string }> = [];
        for (const tx of transactions) {
            const input = inputDataMap.get(tx.tx_hash.toLowerCase());
            if (input) {
                updates.push({ tx_hash: tx.tx_hash, input_data: input });
            }
        }

        const updated = await updateInputData(updates);

        totalProcessed += transactions.length;
        totalFilled += updated;
        totalFailed += transactions.length - updates.length;

        console.log(`  → Filled: ${updated}/${transactions.length} | Total: ${totalFilled}/${totalProcessed}`);

        await sleep(DELAY_BETWEEN_BATCHES_MS);
    }

    console.log('\n========================================');
    console.log('Input Data Filler Complete!');
    console.log(`  Processed: ${totalProcessed}`);
    console.log(`  Filled: ${totalFilled}`);
    console.log(`  Failed/Skipped: ${totalFailed}`);
    console.log('========================================\n');

    return { processed: totalProcessed, filled: totalFilled, failed: totalFailed };
}

/**
 * Get stats on transactions missing input data
 */
export async function getInputDataStats(contractAddresses?: string[]): Promise<{
    total_missing: number;
    by_contract: Array<{ contract_address: string; missing_count: number }>;
}> {
    let query = `
    SELECT contract_address, COUNT(*) as missing_count
    FROM transaction_details
    WHERE (input_data IS NULL OR input_data = '')
  `;

    const params: unknown[] = [];

    if (contractAddresses && contractAddresses.length > 0) {
        const placeholders = contractAddresses.map((_, i) => `$${i + 1}`).join(', ');
        query += ` AND LOWER(contract_address) IN (${placeholders})`;
        params.push(...contractAddresses.map(a => a.toLowerCase()));
    }

    query += ` GROUP BY contract_address ORDER BY missing_count DESC`;

    const result = await pool.query(query, params);
    const byContract = result.rows.map(r => ({
        contract_address: r.contract_address,
        missing_count: parseInt(r.missing_count),
    }));

    const totalMissing = byContract.reduce((sum, c) => sum + c.missing_count, 0);

    return { total_missing: totalMissing, by_contract: byContract };
}

/**
 * Fill ONE BATCH of input data (used in polling mode)
 */
export async function fillInputDataBatch(): Promise<number> {
    const result = await pool.query(`
        SELECT tx_hash, contract_address
        FROM transaction_details
        WHERE (input_data IS NULL OR input_data = '')
        LIMIT ${RPC_CHUNK_SIZE}
    `);

    const transactions = result.rows as TransactionToFill[];

    if (transactions.length === 0) {
        return 0;
    }

    const txHashes = transactions.map(t => t.tx_hash);
    const inputDataMap = await fetchInputDataBatch(txHashes);

    const updates: Array<{ tx_hash: string; input_data: string }> = [];
    for (const tx of transactions) {
        const input = inputDataMap.get(tx.tx_hash.toLowerCase());
        if (input) {
            updates.push({ tx_hash: tx.tx_hash, input_data: input });
        }
    }

    const updated = await updateInputData(updates);

    if (updated > 0) {
        console.log(`  [Input Filler] Filled ${updated}/${transactions.length} transactions`);
    }

    return updated;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// CLI entry point
if (process.argv[1]?.includes('inputDataFiller')) {
    const args = process.argv.slice(2);

    if (args[0] === 'stats') {
        getInputDataStats().then(stats => {
            console.log('\nTransactions missing input_data:');
            console.log(`Total: ${stats.total_missing}\n`);
            for (const c of stats.by_contract) {
                console.log(`  ${c.contract_address}: ${c.missing_count}`);
            }
            process.exit(0);
        });
    } else {
        const contractAddresses = args.length > 0 ? args : undefined;
        fillInputData(contractAddresses).then(() => {
            process.exit(0);
        }).catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
    }
}
