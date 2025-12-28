/**
 * VOLUME INDEXER
 * 
 * High-performance indexer for contracts that need USD volume tracking.
 * Uses eth_getLogs to find blocks with activity, then eth_getBlockReceipts
 * to get ALL asset transfers in those blocks.
 * 
 * Captures:
 * - Native ETH transfers (from tx.value via getBlock)
 * - ERC20 token transfers (Transfer events)
 * - ERC721 NFT transfers (Transfer events)
 * - ERC1155 NFT transfers (TransferSingle/TransferBatch events)
 */

import { createPublicClient, http, type PublicClient, type Log, type TransactionReceipt } from 'viem';
import { RPC_ENDPOINTS, type ContractConfig } from './config.js';
import { getOrCreateVolumeRanges, updateVolumeRangeProgress, areAllVolumeRangesComplete } from './db/volumeRanges.js';
import type { VolumeIndexerRange } from './db/volumeRanges.ts';
// BENCHMARK MODE: Database inserts commented out
// import { insertAssetTransfers, insertVolumeTransactions } from './db/assetTransfers.js';
import type { AssetTransfer } from './db/assetTransfers.ts';
// import { pool } from './db/index.js';

// Create multiple RPC clients for load balancing
const clients: PublicClient[] = RPC_ENDPOINTS.map((url) =>
    createPublicClient({
        transport: http(url, { retryCount: 3, retryDelay: 1000, timeout: 60000 }),
    })
);

let clientIndex = 0;
function getNextClient(): PublicClient {
    const client = clients[clientIndex];
    clientIndex = (clientIndex + 1) % clients.length;
    return client;
}

const defaultClient = clients[0];

// Performance tuning
const LOGS_CHUNK_SIZE = 10000n; // Blocks per getLogs call - increased for fewer RPC calls
const NUM_WORKERS = 2; // Reduced workers to avoid rate limits with 2 RPCs
const RECEIPTS_BATCH_SIZE = 5; // Blocks to fetch receipts for at once
const RATE_LIMIT_BACKOFF_MS = 5000; // Wait time on rate limit
const INTER_REQUEST_DELAY_MS = 200; // Delay between batches to avoid rate limits

// Event signatures for asset transfers
const EVENT_SIGNATURES = {
    // ERC20 & ERC721 Transfer(address indexed from, address indexed to, uint256 value/tokenId)
    TRANSFER: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
    // ERC1155 TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
    TRANSFER_SINGLE: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
    // ERC1155 TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
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

function logStats(workerId: number, txCount: number, transferCount: number, blocksProcessed: number) {
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
 * Main entry point - index a contract for volume data
 */
export async function indexContractVolume(contract: ContractConfig) {
    const { address, deployBlock, name } = contract;
    const latestBlock = await defaultClient.getBlockNumber();

    console.log(`\n========================================`);
    console.log(`Volume Indexing ${name} (${address})`);
    console.log(`Deploy block: ${deployBlock}, Latest: ${latestBlock}`);
    console.log(`Total blocks: ${Number(latestBlock) - deployBlock}`);
    console.log(`Workers: ${NUM_WORKERS}`);
    console.log(`Method: eth_getLogs + eth_getBlockReceipts`);
    console.log(`========================================\n`);

    // Get or create parallel ranges
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

    // Process all incomplete ranges in parallel
    await Promise.all(
        incompleteRanges.map((range: VolumeIndexerRange, idx: number) => processVolumeRange(range, idx, address))
    );

    const isComplete = await areAllVolumeRangesComplete(address);
    if (isComplete) {
        console.log(`\n✓ ${name} volume indexing complete!`);
        console.log(`  Total transactions: ${totalTxProcessed}`);
        console.log(`  Total asset transfers: ${totalTransfersProcessed}`);
    }
}

/**
 * Process a single range of blocks
 */
async function processVolumeRange(
    range: VolumeIndexerRange,
    workerId: number,
    contractAddress: string
) {
    const rangeStart = BigInt(range.range_start);
    const rangeEnd = BigInt(range.range_end);
    let currentBlock = BigInt(range.current_block);

    const totalRangeBlocks = rangeEnd - rangeStart;

    console.log(`[Worker ${workerId}] Starting range ${rangeStart}-${rangeEnd} (from ${currentBlock})`);

    while (currentBlock <= rangeEnd) {
        const fromBlock = currentBlock;
        const toBlock = currentBlock + LOGS_CHUNK_SIZE - 1n > rangeEnd
            ? rangeEnd
            : currentBlock + LOGS_CHUNK_SIZE - 1n;

        try {
            // Step 1: Get logs to find which blocks have activity for this contract
            const rpcClient = getNextClient();
            const logs = await rpcClient.getLogs({
                address: contractAddress as `0x${string}`,
                fromBlock,
                toBlock,
            });

            if (logs.length > 0) {
                // Get unique block numbers that have activity
                const blockNumbers = [...new Set(logs.map(l => l.blockNumber).filter(Boolean))] as bigint[];

                // Step 2: Fetch receipts and transactions for those blocks
                const { txCount, transferCount } = await processBlocksWithReceipts(
                    rpcClient,
                    blockNumbers,
                    contractAddress,
                    logs
                );

                if (txCount > 0) {
                    totalTxProcessed += txCount;
                    totalTransfersProcessed += transferCount;
                    totalBlocksProcessed += Number(toBlock - fromBlock + 1n);

                    logStats(workerId, txCount, transferCount, Number(toBlock - fromBlock + 1n));
                }
            } else {
                // No activity in this chunk, still count blocks processed
                totalBlocksProcessed += Number(toBlock - fromBlock + 1n);
            }

            // Update progress
            const isComplete = toBlock >= rangeEnd;
            await updateVolumeRangeProgress(range.id, Number(toBlock), isComplete);

            currentBlock = toBlock + 1n;
        } catch (err: any) {
            const isRateLimit = err?.status === 429 || err?.message?.includes('Rate limit');
            const backoffMs = isRateLimit ? RATE_LIMIT_BACKOFF_MS : 2000;
            console.error(`[Worker ${workerId}] ${isRateLimit ? 'Rate limited' : 'Error'} at block ${fromBlock}, waiting ${backoffMs}ms...`);
            await sleep(backoffMs);
        }
    }

    console.log(`[Worker ${workerId}] ✓ Range complete!`);
}

/**
 * Process blocks using eth_getBlockReceipts for efficiency
 */
async function processBlocksWithReceipts(
    client: PublicClient,
    blockNumbers: bigint[],
    contractAddress: string,
    contractLogs: Log[]
): Promise<{ txCount: number; transferCount: number }> {
    let txCount = 0;
    let transferCount = 0;

    // Get tx hashes from contract logs (these are the transactions we care about)
    const contractTxHashes = new Set(
        contractLogs.map(l => l.transactionHash?.toLowerCase()).filter(Boolean)
    );

    // Process blocks in batches
    for (let i = 0; i < blockNumbers.length; i += RECEIPTS_BATCH_SIZE) {
        const batchBlocks = blockNumbers.slice(i, i + RECEIPTS_BATCH_SIZE);

        // Fetch block receipts and block data in parallel
        const [receiptsResults, blocksResults] = await Promise.all([
            Promise.all(batchBlocks.map(blockNum =>
                fetchBlockReceipts(client, blockNum).catch(() => null)
            )),
            Promise.all(batchBlocks.map(blockNum =>
                client.getBlock({ blockNumber: blockNum, includeTransactions: true }).catch(() => null)
            )),
        ]);

        // Process each block
        for (let j = 0; j < batchBlocks.length; j++) {
            const receipts = receiptsResults[j];
            const block = blocksResults[j];

            if (!receipts || !block) continue;

            // Filter to only transactions that interacted with our contract
            const relevantReceipts = receipts.filter(r =>
                contractTxHashes.has(r.transactionHash.toLowerCase())
            );

            for (const receipt of relevantReceipts) {
                // Find the transaction data for ETH value
                const tx = block.transactions.find(t =>
                    typeof t === 'object' && t.hash.toLowerCase() === receipt.transactionHash.toLowerCase()
                );

                if (!tx || typeof tx === 'string') continue;

                const transfers: AssetTransfer[] = [];

                // 1. Native ETH transfer (if tx.value > 0)
                if (tx.value && tx.value > BigInt(0)) {
                    transfers.push({
                        tx_hash: receipt.transactionHash,
                        log_index: -1, // Special index for native ETH
                        asset_type: 'ETH',
                        asset_address: null,
                        from_address: tx.from.toLowerCase(),
                        to_address: (tx.to || contractAddress).toLowerCase(),
                        amount_raw: tx.value.toString(),
                        token_id: null,
                        block_number: Number(block.number),
                        block_timestamp: new Date(Number(block.timestamp) * 1000),
                    });
                }

                // 2. Parse Transfer events from receipt logs
                for (const log of receipt.logs) {
                    const transfer = parseTransferEvent(log, Number(block.number), block.timestamp);
                    if (transfer) {
                        transfers.push(transfer);
                    }
                }

                // BENCHMARK MODE: Database inserts commented out - only counting throughput
                // Insert transfers
                if (transfers.length > 0) {
                    // await insertAssetTransfers(transfers);
                    transferCount += transfers.length;
                }

                // Insert transaction summary
                // await insertVolumeTransactions([{
                //     tx_hash: receipt.transactionHash,
                //     wallet_address: tx.from.toLowerCase(),
                //     contract_address: contractAddress.toLowerCase(),
                //     eth_value: tx.value?.toString() || '0',
                //     block_number: Number(block.number),
                //     block_timestamp: new Date(Number(block.timestamp) * 1000),
                //     transfer_count: transfers.length,
                //     status: receipt.status === 'success' ? 1 : 0,
                // }]);

                txCount++;
            }
        }

        // Small delay between batches to avoid rate limits
        if (i + RECEIPTS_BATCH_SIZE < blockNumbers.length) {
            await sleep(INTER_REQUEST_DELAY_MS);
        }
    }

    return { txCount, transferCount };
}

/**
 * Fetch block receipts using eth_getBlockReceipts RPC method
 */
async function fetchBlockReceipts(
    client: PublicClient,
    blockNumber: bigint
): Promise<TransactionReceipt[]> {
    // Use raw RPC call since viem doesn't have built-in support for eth_getBlockReceipts
    const result = await client.request({
        method: 'eth_getBlockReceipts' as any,
        params: [`0x${blockNumber.toString(16)}`],
    });

    if (!result || !Array.isArray(result)) {
        return [];
    }

    // Transform raw receipts to viem format
    return result.map((r: any) => ({
        transactionHash: r.transactionHash,
        transactionIndex: parseInt(r.transactionIndex, 16),
        blockHash: r.blockHash,
        blockNumber: BigInt(r.blockNumber),
        from: r.from,
        to: r.to,
        cumulativeGasUsed: BigInt(r.cumulativeGasUsed),
        gasUsed: BigInt(r.gasUsed),
        contractAddress: r.contractAddress,
        logs: r.logs.map((l: any) => ({
            address: l.address,
            topics: l.topics,
            data: l.data,
            blockNumber: BigInt(l.blockNumber),
            transactionHash: l.transactionHash,
            transactionIndex: parseInt(l.transactionIndex, 16),
            blockHash: l.blockHash,
            logIndex: parseInt(l.logIndex, 16),
            removed: l.removed,
        })),
        logsBloom: r.logsBloom,
        status: r.status === '0x1' ? 'success' : 'reverted',
        effectiveGasPrice: BigInt(r.effectiveGasPrice || '0'),
        type: r.type,
    })) as TransactionReceipt[];
}

/**
 * Parse a log entry to extract transfer information
 */
function parseTransferEvent(
    log: any,
    blockNumber: number,
    blockTimestamp: bigint
): AssetTransfer | null {
    const topic0 = log.topics[0];

    // ERC20/ERC721 Transfer
    if (topic0 === EVENT_SIGNATURES.TRANSFER) {
        // ERC721 has 4 topics (tokenId is indexed), ERC20 has 3 topics
        const isERC721 = log.topics.length === 4;

        const from = '0x' + log.topics[1]?.slice(26);
        const to = '0x' + log.topics[2]?.slice(26);

        if (isERC721) {
            // ERC721: tokenId is in topics[3]
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
                block_timestamp: new Date(Number(blockTimestamp) * 1000),
            };
        } else {
            // ERC20: amount is in data
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
                block_timestamp: new Date(Number(blockTimestamp) * 1000),
            };
        }
    }

    // ERC1155 TransferSingle
    if (topic0 === EVENT_SIGNATURES.TRANSFER_SINGLE) {
        const from = '0x' + log.topics[2]?.slice(26);
        const to = '0x' + log.topics[3]?.slice(26);

        // Data contains: id (uint256) + value (uint256)
        const data = log.data.slice(2); // Remove 0x
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
            block_timestamp: new Date(Number(blockTimestamp) * 1000),
        };
    }

    // ERC1155 TransferBatch - store as single record with null amounts (complex to decode)
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
            amount_raw: null, // Batch data stored in raw form
            token_id: null,
            block_number: blockNumber,
            block_timestamp: new Date(Number(blockTimestamp) * 1000),
        };
    }

    return null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run volume indexer for all contracts marked with fetchVolume: true
 */
export async function runVolumeIndexer() {
    // Import contracts config
    const { CONTRACTS_TO_INDEX } = await import('./config.js');

    // Filter to contracts that need volume indexing
    const volumeContracts = CONTRACTS_TO_INDEX.filter(c => c.fetchTransactions);

    console.log('Starting Volume Indexer...');
    console.log(`Config: ${NUM_WORKERS} workers, ${LOGS_CHUNK_SIZE} blocks/chunk`);
    console.log(`RPC endpoints: ${RPC_ENDPOINTS.length} (load balanced)`);
    console.log(`Contracts to index: ${volumeContracts.length}\n`);

    for (const contract of volumeContracts) {
        try {
            await indexContractVolume(contract);
        } catch (err) {
            console.error(`Error indexing ${contract.name}:`, err);
        }
    }
}
