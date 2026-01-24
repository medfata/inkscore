/**
 * VOLUME INDEXER BATCHER
 * 
 * High-performance indexer using JSON-RPC batch requests.
 * Uses eth_getLogs to find transactions, then batches eth_getTransactionReceipt
 * calls for maximum throughput.
 * 
 * Key difference from volumeIndexer:
 * - Uses JSON-RPC batch requests (multiple calls in single HTTP request)
 * - More efficient for high-volume transaction fetching
 */

import { createPublicClient, http, type PublicClient, type Log } from 'viem';
import { RPC_ENDPOINTS, type ContractConfig, config } from './config.js';
import { getOrCreateVolumeRanges, updateVolumeRangeProgress, areAllVolumeRangesComplete } from './db/volumeRanges.js';
import { query } from './db/index.js';
import type { VolumeIndexerRange } from './db/volumeRanges.ts';
import type { AssetTransfer } from './db/assetTransfers.ts';

// Benchmark transaction interface
interface BenchmarkTransaction {
    tx_hash: string;
    contract_address: string;
    wallet_address: string;
    to_address: string | null;
    eth_value: string;
    block_number: number;
    block_timestamp: Date;
    block_hash: string;
    transaction_index: number;
    gas_used: string;
    gas_price: string;
    effective_gas_price: string;
    tx_fee_wei: string;
    method_id: string | null;
    status: number;
    transfer_count: number;
}

/**
 * Reset all benchmark data (tables + ranges) for a fresh start
 */
export async function resetBenchmarkData(contractAddresses: string[]): Promise<void> {
    console.log('Resetting benchmark data...');

    // Delete from benchmark_transactions for these contracts
    for (const address of contractAddresses) {
        await query(
            'DELETE FROM benchmark_transactions WHERE contract_address = $1',
            [address.toLowerCase()]
        );
        console.log(`  ✓ Cleared benchmark_transactions for ${address}`);
    }

    // Delete volume_indexer_ranges for these contracts
    for (const address of contractAddresses) {
        await query(
            'DELETE FROM volume_indexer_ranges WHERE contract_address = $1',
            [address.toLowerCase()]
        );
        console.log(`  ✓ Cleared volume_indexer_ranges for ${address}`);
    }

    console.log('Reset complete!\n');
}

/**
 * Create benchmark tables if they don't exist
 */
export async function ensureBenchmarkTables(): Promise<void> {
    await query(`
        CREATE TABLE IF NOT EXISTS benchmark_transactions (
            tx_hash VARCHAR(66) NOT NULL,
            contract_address VARCHAR(42) NOT NULL,
            wallet_address VARCHAR(42) NOT NULL,
            to_address VARCHAR(42),
            eth_value VARCHAR(78),
            block_number INTEGER NOT NULL,
            block_timestamp TIMESTAMP,
            block_hash VARCHAR(66),
            transaction_index INTEGER,
            gas_used VARCHAR(78),
            gas_price VARCHAR(78),
            effective_gas_price VARCHAR(78),
            tx_fee_wei VARCHAR(78),
            method_id VARCHAR(10),
            status INTEGER DEFAULT 1,
            transfer_count INTEGER DEFAULT 0,
            chain_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            PRIMARY KEY (tx_hash, contract_address)
        );

        CREATE INDEX IF NOT EXISTS idx_bench_tx_contract ON benchmark_transactions(contract_address);
        CREATE INDEX IF NOT EXISTS idx_bench_tx_wallet ON benchmark_transactions(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_bench_tx_block ON benchmark_transactions(block_number);
        CREATE INDEX IF NOT EXISTS idx_bench_tx_timestamp ON benchmark_transactions(block_timestamp);
        CREATE INDEX IF NOT EXISTS idx_bench_tx_method ON benchmark_transactions(method_id);
    `);
}

/**
 * Insert benchmark transactions in batches
 */
async function insertBenchmarkTransactions(txs: BenchmarkTransaction[]): Promise<void> {
    if (txs.length === 0) return;

    const values: unknown[] = [];
    const placeholders: string[] = [];

    txs.forEach((t, idx) => {
        const offset = idx * 17;
        placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17})`
        );
        values.push(
            t.tx_hash,
            t.contract_address,
            t.wallet_address,
            t.to_address,
            t.eth_value,
            t.block_number,
            t.block_timestamp,
            t.block_hash,
            t.transaction_index,
            t.gas_used,
            t.gas_price,
            t.effective_gas_price,
            t.tx_fee_wei,
            t.method_id,
            t.status,
            t.transfer_count,
            config.chainId
        );
    });

    await query(
        `INSERT INTO benchmark_transactions 
         (tx_hash, contract_address, wallet_address, to_address, eth_value, block_number, block_timestamp, block_hash, transaction_index, gas_used, gas_price, effective_gas_price, tx_fee_wei, method_id, status, transfer_count, chain_id)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (tx_hash, contract_address) DO NOTHING`,
        values
    );
}

// Create RPC clients with batch support
const clients: PublicClient[] = RPC_ENDPOINTS.map((url) =>
    createPublicClient({
        transport: http(url, {
            retryCount: 3,
            retryDelay: 1000,
            timeout: 60000,
            batch: true, // Enable batching
        }),
    })
);

let clientIndex = 0;
function getNextClient(): PublicClient {
    const client = clients[clientIndex];
    clientIndex = (clientIndex + 1) % clients.length;
    return client;
}

const defaultClient = clients[0];

// Performance tuning - BALANCED (reduced to avoid RPC errors)
const LOGS_CHUNK_SIZE = 10000n; // Blocks per getLogs call (RPC limit)
const NUM_WORKERS = 4; // Parallel workers
const BATCH_SIZE = 50; // Transactions per batch request
const RATE_LIMIT_BACKOFF_MS = 3000;

// Event signatures
const EVENT_SIGNATURES = {
    TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    TRANSFER_SINGLE: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    TRANSFER_BATCH: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
};

// Stats tracking
let totalTxProcessed = 0;
let totalTransfersProcessed = 0;
let totalBlocksProcessed = 0;
let totalBlocksToProcess = 0;
let startTime = Date.now();


function formatETA(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return 'calculating...';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function logStats(workerId: number, txCount: number, transferCount: number) {
    const elapsed = (Date.now() - startTime) / 1000;
    const txPerSec = elapsed > 0 ? (totalTxProcessed / elapsed).toFixed(1) : '0';
    const blocksPerSec = elapsed > 0 ? totalBlocksProcessed / elapsed : 0;
    const remainingBlocks = totalBlocksToProcess - totalBlocksProcessed;
    const etaSeconds = blocksPerSec > 0 ? remainingBlocks / blocksPerSec : 0;
    const progress = totalBlocksToProcess > 0 ? ((totalBlocksProcessed / totalBlocksToProcess) * 100).toFixed(1) : '0';

    console.log(
        `  [Worker ${workerId}] +${txCount} txs, +${transferCount} transfers | Total: ${totalTxProcessed} txs | ${txPerSec} tx/sec | ${progress}% | ETA: ${formatETA(etaSeconds)}`
    );
}

/**
 * Main entry point
 */
export async function indexContractVolumeBatch(contract: ContractConfig) {
    const { address, deployBlock, name } = contract;
    const latestBlock = await defaultClient.getBlockNumber();

    console.log(`\n========================================`);
    console.log(`Volume Indexer BATCHER - ${name} (${address})`);
    console.log(`Deploy block: ${deployBlock}, Latest: ${latestBlock}`);
    console.log(`Total blocks: ${Number(latestBlock) - deployBlock}`);
    console.log(`Workers: ${NUM_WORKERS}, Batch size: ${BATCH_SIZE}`);
    console.log(`Method: eth_getLogs + BATCH eth_getTransactionReceipt`);
    console.log(`========================================\n`);

    const ranges = await getOrCreateVolumeRanges(address, deployBlock, Number(latestBlock), NUM_WORKERS);
    const incompleteRanges = ranges.filter((r: VolumeIndexerRange) => !r.is_complete);

    console.log(`Found ${ranges.length} ranges, ${incompleteRanges.length} incomplete\n`);

    if (incompleteRanges.length === 0) {
        console.log(`${name} volume indexing is complete!`);
        return;
    }

    startTime = Date.now();
    totalTxProcessed = 0;
    totalTransfersProcessed = 0;
    totalBlocksProcessed = 0;
    totalBlocksToProcess = incompleteRanges.reduce((sum: number, r: VolumeIndexerRange) =>
        sum + (Number(r.range_end) - Number(r.current_block)), 0
    );

    await Promise.all(
        incompleteRanges.map((range: VolumeIndexerRange, idx: number) =>
            processRangeBatch(range, idx, address)
        )
    );

    const isComplete = await areAllVolumeRangesComplete(address);
    if (isComplete) {
        console.log(`\n✓ ${name} volume indexing complete!`);
        console.log(`  Total transactions: ${totalTxProcessed}`);
        console.log(`  Total asset transfers: ${totalTransfersProcessed}`);
    }
}


/**
 * Process a range using batch RPC requests
 */
async function processRangeBatch(
    range: VolumeIndexerRange,
    workerId: number,
    contractAddress: string
) {
    const rangeEnd = BigInt(range.range_end);
    let currentBlock = BigInt(range.current_block);

    console.log(`[Worker ${workerId}] Starting range ${range.range_start}-${range.range_end} (from ${currentBlock})`);

    while (currentBlock <= rangeEnd) {
        const fromBlock = currentBlock;
        const toBlock = currentBlock + LOGS_CHUNK_SIZE - 1n > rangeEnd
            ? rangeEnd
            : currentBlock + LOGS_CHUNK_SIZE - 1n;

        try {
            const rpcClient = getNextClient();

            // Step 1: Get logs to find transactions
            const logs = await rpcClient.getLogs({
                address: contractAddress as `0x${string}`,
                fromBlock,
                toBlock,
            });

            if (logs.length > 0) {
                // Get unique tx hashes
                const txHashes = [...new Set(logs.map(l => l.transactionHash).filter(Boolean))] as `0x${string}`[];

                // Step 2: Batch fetch receipts and transactions
                const { txCount, transferCount } = await batchFetchTransactions(
                    rpcClient,
                    txHashes,
                    contractAddress,
                    logs
                );

                if (txCount > 0) {
                    totalTxProcessed += txCount;
                    totalTransfersProcessed += transferCount;
                    logStats(workerId, txCount, transferCount);
                }
            }

            totalBlocksProcessed += Number(toBlock - fromBlock + 1n);

            // Update progress
            const isComplete = toBlock >= rangeEnd;
            await updateVolumeRangeProgress(range.id, Number(toBlock), isComplete);

            currentBlock = toBlock + 1n;
        } catch (err: any) {
            const isRateLimit = err?.status === 429 || err?.message?.includes('Rate limit') || err?.message?.includes('429');
            const isRangeLimit = err?.message?.includes('range') || err?.message?.includes('block range') || err?.message?.includes('exceed');
            const backoffMs = isRateLimit ? RATE_LIMIT_BACKOFF_MS : 2000;

            // Log actual error for debugging
            const errMsg = err?.message || err?.toString() || 'Unknown error';
            console.error(`[Worker ${workerId}] Error at block ${fromBlock}: ${errMsg.slice(0, 100)}`);

            if (isRangeLimit) {
                console.error(`[Worker ${workerId}] Block range too large, consider reducing LOGS_CHUNK_SIZE`);
            }

            await sleep(backoffMs);
        }
    }

    console.log(`[Worker ${workerId}] ✓ Range complete!`);
}


/**
 * Batch fetch transaction receipts using JSON-RPC batch requests
 * OPTIMIZED: Combines receipts + transactions + blocks in batch calls
 */
async function batchFetchTransactions(
    client: PublicClient,
    txHashes: `0x${string}`[],
    contractAddress: string,
    logs: Log[]
): Promise<{ txCount: number; transferCount: number }> {
    let txCount = 0;
    let transferCount = 0;
    const txsToInsert: BenchmarkTransaction[] = [];

    // Process in batches
    for (let i = 0; i < txHashes.length; i += BATCH_SIZE) {
        const batchHashes = txHashes.slice(i, i + BATCH_SIZE);

        // Batch call for receipts AND transactions
        const results = await batchGetReceiptsAndTransactions(batchHashes);

        // Get unique block numbers to fetch timestamps
        const blockNumbers = new Set<string>();
        for (const receipt of results.receipts) {
            if (receipt?.blockNumber) blockNumbers.add(receipt.blockNumber);
        }

        // Fetch block data for timestamps
        const blockData = await batchGetBlocks([...blockNumbers]);

        // Process each transaction
        for (let j = 0; j < batchHashes.length; j++) {
            const receipt = results.receipts[j];
            const tx = results.transactions[j];

            if (!receipt || !tx) continue;

            // Get block timestamp
            const block = blockData.get(receipt.blockNumber);
            const blockTimestamp = block?.timestamp
                ? new Date(parseInt(block.timestamp, 16) * 1000)
                : new Date();

            const transfers: AssetTransfer[] = [];

            // 1. Native ETH transfer
            if (tx.value && BigInt(tx.value) > 0n) {
                transfers.push({
                    tx_hash: tx.hash,
                    log_index: -1,
                    asset_type: 'ETH',
                    asset_address: null,
                    from_address: tx.from?.toLowerCase(),
                    to_address: (tx.to || contractAddress).toLowerCase(),
                    amount_raw: BigInt(tx.value).toString(),
                    token_id: null,
                    block_number: parseInt(tx.blockNumber, 16),
                    block_timestamp: blockTimestamp,
                });
            }

            // 2. Parse Transfer events from receipt logs
            for (const log of receipt.logs || []) {
                const transfer = parseTransferEvent(log, parseInt(receipt.blockNumber, 16));
                if (transfer) {
                    transfer.block_timestamp = blockTimestamp;
                    transfers.push(transfer);
                }
            }

            // Build benchmark transaction for DB insert
            const benchmarkTx: BenchmarkTransaction = {
                tx_hash: tx.hash,
                contract_address: contractAddress.toLowerCase(),
                wallet_address: tx.from?.toLowerCase() || '',
                to_address: tx.to?.toLowerCase() || null,
                eth_value: BigInt(tx.value || 0).toString(),
                block_number: parseInt(tx.blockNumber, 16),
                block_timestamp: blockTimestamp,
                block_hash: tx.blockHash,
                transaction_index: parseInt(receipt.transactionIndex, 16),
                gas_used: BigInt(receipt.gasUsed || 0).toString(),
                gas_price: BigInt(tx.gasPrice || 0).toString(),
                effective_gas_price: BigInt(receipt.effectiveGasPrice || tx.gasPrice || 0).toString(),
                tx_fee_wei: (BigInt(receipt.gasUsed || 0) * BigInt(receipt.effectiveGasPrice || tx.gasPrice || 0)).toString(),
                method_id: tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : null,
                status: receipt.status === '0x1' ? 1 : 0,
                transfer_count: transfers.length,
            };

            txsToInsert.push(benchmarkTx);
            transferCount += transfers.length;
            txCount++;
        }
    }

    // Insert all transactions to DB
    if (txsToInsert.length > 0) {
        await insertBenchmarkTransactions(txsToInsert);
    }

    return { txCount, transferCount };
}

/**
 * Batch get blocks by block number (hex)
 */
async function batchGetBlocks(
    blockNumbers: string[]
): Promise<Map<string, any>> {
    if (blockNumbers.length === 0) return new Map();

    const batch = blockNumbers.map((blockNum, id) => ({
        jsonrpc: '2.0',
        id,
        method: 'eth_getBlockByNumber',
        params: [blockNum, false], // false = don't include full tx objects
    }));

    try {
        const response = await fetch(RPC_ENDPOINTS[clientIndex % RPC_ENDPOINTS.length], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        });

        const json = await response.json();
        const results = Array.isArray(json) ? json : [json];

        const blockMap = new Map<string, any>();
        for (const r of results) {
            if (r?.result) {
                blockMap.set(r.result.number, r.result);
            }
        }
        return blockMap;
    } catch (err) {
        console.error('Batch block fetch error:', err);
        return new Map();
    }
}

/**
 * OPTIMIZED: Single batch request for both receipts and transactions
 */
async function batchGetReceiptsAndTransactions(
    txHashes: `0x${string}`[]
): Promise<{ receipts: (any | null)[]; transactions: (any | null)[] }> {
    // Build combined batch - receipts first, then transactions
    const batch: any[] = [];

    txHashes.forEach((hash, idx) => {
        batch.push({
            jsonrpc: '2.0',
            id: idx, // 0 to n-1 for receipts
            method: 'eth_getTransactionReceipt',
            params: [hash],
        });
        batch.push({
            jsonrpc: '2.0',
            id: idx + txHashes.length, // n to 2n-1 for transactions
            method: 'eth_getTransactionByHash',
            params: [hash],
        });
    });

    try {
        const response = await fetch(RPC_ENDPOINTS[clientIndex % RPC_ENDPOINTS.length], {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        });

        const json = await response.json();
        const results = Array.isArray(json) ? json : [json];

        // Separate receipts and transactions by id
        const receipts: (any | null)[] = new Array(txHashes.length).fill(null);
        const transactions: (any | null)[] = new Array(txHashes.length).fill(null);

        for (const r of results) {
            if (r?.id !== undefined && r?.result) {
                if (r.id < txHashes.length) {
                    receipts[r.id] = r.result;
                } else {
                    transactions[r.id - txHashes.length] = r.result;
                }
            }
        }

        return { receipts, transactions };
    } catch (err) {
        console.error('Batch fetch error:', err);
        return {
            receipts: txHashes.map(() => null),
            transactions: txHashes.map(() => null),
        };
    }
}


/**
 * Parse transfer event from log
 */
function parseTransferEvent(log: any, blockNumber: number): AssetTransfer | null {
    const topic0 = log.topics?.[0];
    if (!topic0) return null;

    // ERC20/ERC721 Transfer
    if (topic0 === EVENT_SIGNATURES.TRANSFER) {
        const isERC721 = log.topics.length === 4;
        const from = '0x' + log.topics[1]?.slice(26);
        const to = '0x' + log.topics[2]?.slice(26);

        if (isERC721) {
            const tokenId = BigInt(log.topics[3] || '0').toString();
            return {
                tx_hash: log.transactionHash,
                log_index: typeof log.logIndex === 'number' ? log.logIndex : parseInt(log.logIndex, 16),
                asset_type: 'ERC721',
                asset_address: log.address.toLowerCase(),
                from_address: from.toLowerCase(),
                to_address: to.toLowerCase(),
                amount_raw: '1',
                token_id: tokenId,
                block_number: blockNumber,
                block_timestamp: new Date(),
            };
        } else {
            const amount = BigInt(log.data || '0').toString();
            return {
                tx_hash: log.transactionHash,
                log_index: typeof log.logIndex === 'number' ? log.logIndex : parseInt(log.logIndex, 16),
                asset_type: 'ERC20',
                asset_address: log.address.toLowerCase(),
                from_address: from.toLowerCase(),
                to_address: to.toLowerCase(),
                amount_raw: amount,
                token_id: null,
                block_number: blockNumber,
                block_timestamp: new Date(),
            };
        }
    }

    // ERC1155 TransferSingle
    if (topic0 === EVENT_SIGNATURES.TRANSFER_SINGLE) {
        const from = '0x' + log.topics[2]?.slice(26);
        const to = '0x' + log.topics[3]?.slice(26);
        const data = log.data.slice(2);
        const tokenId = BigInt('0x' + data.slice(0, 64)).toString();
        const amount = BigInt('0x' + data.slice(64, 128)).toString();

        return {
            tx_hash: log.transactionHash,
            log_index: typeof log.logIndex === 'number' ? log.logIndex : parseInt(log.logIndex, 16),
            asset_type: 'ERC1155',
            asset_address: log.address.toLowerCase(),
            from_address: from.toLowerCase(),
            to_address: to.toLowerCase(),
            amount_raw: amount,
            token_id: tokenId,
            block_number: blockNumber,
            block_timestamp: new Date(),
        };
    }

    // ERC1155 TransferBatch
    if (topic0 === EVENT_SIGNATURES.TRANSFER_BATCH) {
        const from = '0x' + log.topics[2]?.slice(26);
        const to = '0x' + log.topics[3]?.slice(26);

        return {
            tx_hash: log.transactionHash,
            log_index: typeof log.logIndex === 'number' ? log.logIndex : parseInt(log.logIndex, 16),
            asset_type: 'ERC1155_BATCH',
            asset_address: log.address.toLowerCase(),
            from_address: from.toLowerCase(),
            to_address: to.toLowerCase(),
            amount_raw: null,
            token_id: null,
            block_number: blockNumber,
            block_timestamp: new Date(),
        };
    }

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
