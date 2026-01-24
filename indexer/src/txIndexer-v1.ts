/**
 * TX Indexer V1
 *
 * Uses Routescan API to fetch transactions, then batches RPC calls
 * for additional data (input_data).
 *
 * Configuration:
 * - 50 transactions per Routescan page
 * - 10 transactions per RPC batch
 * - No cursor/pagination token storage (simpler, restarts from beginning)
 */

import { type ContractConfig, RPC_ENDPOINTS, config } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { pool } from './db/index.js';

// Routescan API configuration
const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn.routescan.io/api/evm/all/transactions';
const PAGE_LIMIT = 50; // Reduced from 100
const REQUEST_DELAY_MS = 500; // 2 requests per second for Routescan
const RPC_BATCH_SIZE = 10; // 10 transactions per RPC batch

interface RoutescanTransaction {
    chainId: string;
    blockNumber: number;
    txIndex: number;
    timestamp: string;
    from: { id: string; isContract: boolean };
    to: { id: string; isContract: boolean };
    txHash: string;
    value: string;
    gasLimit?: string;
    gasUsed?: string;
    gasPrice: string;
    burnedFees?: string;
    methodId?: string;
    method?: string;
    input?: string;
    status: boolean;
}

interface RoutescanResponse {
    items: RoutescanTransaction[];
    count: number;
    link: {
        next?: string;
        nextToken?: string;
    };
}

// Stats tracking
let totalTxProcessed = 0;
let startTime = Date.now();

function logStats(contractName: string, batchCount: number, apiTotalCount: number) {
    const elapsed = (Date.now() - startTime) / 1000;
    const txPerSec = elapsed > 0 ? (totalTxProcessed / elapsed).toFixed(1) : '0';
    const progress = apiTotalCount > 0 ? ((totalTxProcessed / apiTotalCount) * 100).toFixed(1) : '0';
    console.log(
        `  [${contractName}] +${batchCount} txs | Total: ${totalTxProcessed} | ${txPerSec} tx/sec | ~${progress}%`
    );
}


/**
 * Fetch a page from Routescan API
 */
async function fetchRoutescanPage(
    contractAddress: string,
    nextToken?: string,
    sort: 'asc' | 'desc' = 'asc'
): Promise<RoutescanResponse> {
    const params = new URLSearchParams({
        fromAddresses: contractAddress,
        toAddresses: contractAddress,
        includedChainIds: INK_CHAIN_ID,
        count: 'true',
        limit: PAGE_LIMIT.toString(),
        sort,
    });

    if (nextToken) {
        params.append('next', nextToken);
    }

    const url = `${ROUTESCAN_BASE_URL}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Routescan API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<RoutescanResponse>;
}

/**
 * Batch fetch input data from RPC (10 transactions per batch)
 */
async function batchFetchInputData(txHashes: string[]): Promise<Map<string, string>> {
    const inputMap = new Map<string, string>();
    if (txHashes.length === 0) return inputMap;

    // Process in batches of 10
    for (let i = 0; i < txHashes.length; i += RPC_BATCH_SIZE) {
        const batchHashes = txHashes.slice(i, i + RPC_BATCH_SIZE);

        // Build batch request
        const batch = batchHashes.map((hash, idx) => ({
            jsonrpc: '2.0',
            id: idx,
            method: 'eth_getTransactionByHash',
            params: [hash],
        }));

        try {
            const rpcUrl = RPC_ENDPOINTS[0];
            const response = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(batch),
            });

            const results = await response.json();
            const resultsArray = Array.isArray(results) ? results : [results];

            for (const r of resultsArray) {
                if (r?.result?.input && r.result.input !== '0x') {
                    const hash = batchHashes[r.id];
                    inputMap.set(hash.toLowerCase(), r.result.input);
                }
            }
        } catch (err) {
            console.error('RPC batch fetch error:', err);
        }
    }

    return inputMap;
}

/**
 * Transform Routescan transaction to our DB format
 */
function transformToTransactionDetail(
    tx: RoutescanTransaction,
    contractAddress: string
): TransactionDetail {
    return {
        tx_hash: tx.txHash,
        wallet_address: tx.from.id,
        contract_address: contractAddress,
        to_address: tx.to?.id || null,
        function_selector: tx.methodId || null,
        function_name: tx.method ? tx.method.split('(')[0] : null,
        input_data: tx.input || null,
        eth_value: tx.value,
        gas_limit: tx.gasLimit || null,
        gas_used: tx.gasUsed || null,
        gas_price: tx.gasPrice || null,
        effective_gas_price: null,
        max_fee_per_gas: null,
        max_priority_fee_per_gas: null,
        tx_fee_wei: null,
        burned_fees: tx.burnedFees || null,
        block_number: tx.blockNumber,
        block_hash: null,
        block_timestamp: new Date(tx.timestamp),
        transaction_index: tx.txIndex || null,
        nonce: null,
        tx_type: 0,
        status: tx.status ? 1 : 0,
        chain_id: config.chainId,
        l1_gas_price: null,
        l1_gas_used: null,
        l1_fee: null,
        l1_base_fee_scalar: null,
        l1_blob_base_fee: null,
        l1_blob_base_fee_scalar: null,
    };
}


/**
 * Index all transactions for a contract using Routescan API
 * No cursor storage - always starts from the beginning
 */
export async function indexContractTransactions(contract: ContractConfig): Promise<void> {
    const { address, name, deployBlock } = contract;

    console.log(`\n========================================`);
    console.log(`TX Indexing ${name} (${address})`);
    console.log(`Deploy block: ${deployBlock} | Chain: Ink (${INK_CHAIN_ID})`);
    console.log(`Using Routescan API (${PAGE_LIMIT} per page, ${RPC_BATCH_SIZE} per RPC batch)`);
    console.log(`========================================\n`);

    // Reset stats
    startTime = Date.now();
    totalTxProcessed = 0;

    let nextToken: string | undefined;
    let pageCount = 0;
    let apiTotalCount = 0;
    let consecutiveErrors = 0;

    while (true) {
        try {
            pageCount++;
            const response = await fetchRoutescanPage(address, nextToken, 'asc');
            apiTotalCount = response.count;
            consecutiveErrors = 0;

            if (response.items.length === 0) {
                console.log(`\n✓ No more transactions to index.`);
                break;
            }

            // Filter transactions before deploy block
            const validTransactions = response.items.filter(
                (tx) => tx.blockNumber >= deployBlock
            );

            if (validTransactions.length > 0) {
                // Batch fetch input data from RPC (10 at a time)
                const txHashes = validTransactions.map(tx => tx.txHash);
                const inputDataMap = await batchFetchInputData(txHashes);

                // Transform to DB format
                const txDetails = validTransactions.map((tx) => {
                    const detail = transformToTransactionDetail(tx, address);
                    const rpcInput = inputDataMap.get(tx.txHash.toLowerCase());
                    if (rpcInput) {
                        detail.input_data = rpcInput;
                    }
                    return detail;
                });

                // Insert transaction details directly (no more wallet_interactions)
                await insertTransactionDetails(txDetails);

                totalTxProcessed += txDetails.length;
                logStats(name, txDetails.length, apiTotalCount);
            }

            // Check for more pages
            if (!response.link.nextToken) {
                console.log(`\n✓ Reached end of transaction history!`);
                break;
            }

            nextToken = response.link.nextToken;
            await sleep(REQUEST_DELAY_MS);

        } catch (err) {
            consecutiveErrors++;
            console.error(`[Page ${pageCount}] Error:`, err);

            if (consecutiveErrors >= 5) {
                console.error(`Too many consecutive errors. Stopping.`);
                break;
            }

            const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
            console.log(`Retrying in ${backoffMs / 1000}s...`);
            await sleep(backoffMs);
        }
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n========================================`);
    console.log(`${name} TX indexing summary:`);
    console.log(`  Total indexed: ${totalTxProcessed}`);
    console.log(`  Time elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`  Average speed: ${(totalTxProcessed / elapsed).toFixed(1)} tx/sec`);
    console.log(`  Pages fetched: ${pageCount}`);
    console.log(`========================================\n`);
}


/**
 * Poll for new transactions (real-time mode)
 * Fetches newest transactions until it finds one already in DB
 */
export async function pollNewTransactions(contract: ContractConfig): Promise<number> {
    const { address, name, deployBlock } = contract;
    let newTxCount = 0;
    let nextToken: string | undefined;
    let pageCount = 0;
    const MAX_PAGES = 10;

    try {
        while (pageCount < MAX_PAGES) {
            pageCount++;

            // Fetch newest first (sort=desc)
            const response = await fetchRoutescanPage(address, nextToken, 'desc');

            if (response.items.length === 0) break;

            // Filter by deploy block
            const validTransactions = response.items.filter(
                (tx) => tx.blockNumber >= deployBlock
            );

            if (validTransactions.length === 0) {
                if (response.link.nextToken) {
                    nextToken = response.link.nextToken;
                    await sleep(REQUEST_DELAY_MS);
                    continue;
                }
                break;
            }

            // Check which are new
            const newTransactions: RoutescanTransaction[] = [];
            let foundExisting = false;

            for (const tx of validTransactions) {
                const exists = await txExists(tx.txHash);
                if (exists) {
                    foundExisting = true;
                    break;
                }
                newTransactions.push(tx);
            }

            // Insert new transactions
            if (newTransactions.length > 0) {
                const txHashes = newTransactions.map(tx => tx.txHash);
                const inputDataMap = await batchFetchInputData(txHashes);

                const txDetails = newTransactions.map((tx) => {
                    const detail = transformToTransactionDetail(tx, address);
                    const rpcInput = inputDataMap.get(tx.txHash.toLowerCase());
                    if (rpcInput) {
                        detail.input_data = rpcInput;
                    }
                    return detail;
                });

                // Insert transaction details directly (no more wallet_interactions)
                await insertTransactionDetails(txDetails);
                newTxCount += newTransactions.length;
            }

            if (foundExisting) break;
            if (!response.link.nextToken) break;

            nextToken = response.link.nextToken;
            await sleep(REQUEST_DELAY_MS);
        }

        if (newTxCount > 0) {
            console.log(`  [${name}] Polled ${newTxCount} new transactions`);
        }
    } catch (err) {
        console.error(`[${name}] Poll error:`, err);
    }

    return newTxCount;
}

/**
 * Check if transaction exists in DB
 */
async function txExists(txHash: string): Promise<boolean> {
    const result = await pool.query(
        'SELECT 1 FROM transaction_details WHERE tx_hash = $1 LIMIT 1',
        [txHash]
    );
    return result.rows.length > 0;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Get cursor status (for compatibility with index-v2.ts)
 * Checks DB count against Routescan total to determine completion
 */
export async function getTxCursorStatus(contractAddress: string): Promise<{
    total_indexed: number;
    api_total_count: number;
    is_complete: boolean;
} | null> {
    // Count transactions in DB for this contract
    const dbResult = await pool.query(
        `SELECT COUNT(*) as count FROM transaction_details WHERE LOWER(contract_address) = $1`,
        [contractAddress.toLowerCase()]
    );
    const dbCount = parseInt(dbResult.rows[0]?.count || '0', 10);

    // Get total count from Routescan API
    let apiTotalCount = 0;
    try {
        const response = await fetchRoutescanPage(contractAddress, undefined, 'asc');
        apiTotalCount = response.count;
    } catch (err) {
        console.error(`Failed to fetch Routescan count for ${contractAddress}:`, err);
    }

    // Consider complete if we have at least (apiTotal - 100) transactions
    // This accounts for potential duplicates or filtering differences
    const isComplete = apiTotalCount > 0 && dbCount >= apiTotalCount - 100;

    return {
        total_indexed: dbCount,
        api_total_count: apiTotalCount,
        is_complete: isComplete,
    };
}

/**
 * Reset cursor (no-op since we don't store cursors)
 */
export async function resetTxCursor(contractAddress: string): Promise<void> {
    console.log(`TX cursor reset requested for ${contractAddress} (no cursor storage in v1)`);
}
