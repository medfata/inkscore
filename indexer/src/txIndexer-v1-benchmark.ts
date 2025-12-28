/**
 * TX Indexer V1 Benchmark
 * 
 * Uses Routerscan to discover transactions, then fetches full details from RPC.
 * Maps RPC data to Routerscan format using the mapper.
 * 
 * Run with: npx tsx src/txIndexer-v1-benchmark.ts
 */

import { RPC_ENDPOINTS, type ContractConfig } from './config.js';
import { mapRpcToRouterscan, type RouterscanTx } from './rpcToRouterscanMapper.js';

// Configuration
const INK_CHAIN_ID = '57073';
const ROUTESCAN_API_BASE = 'https://cdn.routescan.io/api/evm/all/transactions';
const PAGE_LIMIT = 100;
const RPC_BATCH_SIZE = 25; // Batch size for RPC requests
const REQUEST_DELAY_MS = 500; // Delay between Routerscan pages

// Contracts to benchmark
const BENCHMARK_CONTRACTS: ContractConfig[] = [
    {
        address: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
        name: 'InkyPump',
        deployBlock: 1895455,
        abi: [],
        fetchTransactions: true,
    },
];

// RPC client index for round-robin
let rpcIndex = 0;
function getNextRpc(): string {
    const rpc = RPC_ENDPOINTS[rpcIndex];
    rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length;
    return rpc;
}

interface RouterscanPageResponse {
    items: { txHash: string; blockNumber: number }[];
    count: number;
    link: {
        next?: string;
        nextToken?: string;
    };
}

// Stats tracking
interface BenchmarkStats {
    totalTxFetched: number;
    totalTxFromRpc: number;
    missingInRpc: number;
    startTime: number;
    pagesProcessed: number;
    apiTotalCount: number;
}

function createStats(): BenchmarkStats {
    return {
        totalTxFetched: 0,
        totalTxFromRpc: 0,
        missingInRpc: 0,
        startTime: Date.now(),
        pagesProcessed: 0,
        apiTotalCount: 0,
    };
}

function formatETA(remainingTx: number, txPerSec: number): string {
    if (txPerSec <= 0) return 'calculating...';
    const seconds = remainingTx / txPerSec;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function logProgress(contractName: string, stats: BenchmarkStats) {
    const elapsed = (Date.now() - stats.startTime) / 1000;
    const txPerSec = elapsed > 0 ? stats.totalTxFetched / elapsed : 0;
    const progress = stats.apiTotalCount > 0 
        ? ((stats.totalTxFetched / stats.apiTotalCount) * 100).toFixed(1) 
        : '0';
    const remaining = stats.apiTotalCount - stats.totalTxFetched;
    const eta = formatETA(remaining, txPerSec);

    console.log(
        `  [${contractName}] ${stats.totalTxFetched}/${stats.apiTotalCount} txs | ` +
        `${txPerSec.toFixed(1)} tx/sec | ${progress}% | ETA: ${eta}`
    );
}

/**
 * Fetch a page of transactions from Routerscan (only tx hashes)
 */
async function fetchRouterscanPage(
    contractAddress: string,
    nextToken?: string
): Promise<RouterscanPageResponse> {
    const params = new URLSearchParams({
        toAddresses: contractAddress,
        includedChainIds: INK_CHAIN_ID,
        count: 'true',
        limit: PAGE_LIMIT.toString(),
        sort: 'asc',
    });

    if (nextToken) {
        params.append('next', nextToken);
    }

    const url = `${ROUTESCAN_API_BASE}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Routerscan API error: ${response.status}`);
    }

    return response.json() as Promise<RouterscanPageResponse>;
}

/**
 * Batch fetch transactions and receipts from RPC
 */
async function batchFetchFromRpc(
    txHashes: string[]
): Promise<RouterscanTx[]> {
    if (txHashes.length === 0) return [];

    // Build batch request for both tx and receipt
    const batch: any[] = [];
    txHashes.forEach((hash, idx) => {
        batch.push({
            jsonrpc: '2.0',
            id: idx,
            method: 'eth_getTransactionByHash',
            params: [hash],
        });
        batch.push({
            jsonrpc: '2.0',
            id: idx + txHashes.length,
            method: 'eth_getTransactionReceipt',
            params: [hash],
        });
    });

    const transactions = new Map<string, any>();
    const receipts = new Map<string, any>();

    try {
        const rpcUrl = getNextRpc();
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        });

        const results = await response.json();
        const resultsArray = Array.isArray(results) ? results : [results];

        for (const r of resultsArray) {
            if (r?.result) {
                if (r.id < txHashes.length) {
                    transactions.set(txHashes[r.id].toLowerCase(), r.result);
                } else {
                    receipts.set(txHashes[r.id - txHashes.length].toLowerCase(), r.result);
                }
            }
        }
    } catch (err) {
        console.error('RPC batch fetch error:', err);
        return [];
    }

    // Map RPC data to Routerscan format
    const mappedTxs: RouterscanTx[] = [];
    for (const hash of txHashes) {
        const tx = transactions.get(hash.toLowerCase());
        const receipt = receipts.get(hash.toLowerCase());
        
        if (tx && receipt) {
            mappedTxs.push(mapRpcToRouterscan(tx, receipt));
        }
    }

    return mappedTxs;
}

/**
 * Main benchmark function for a single contract
 */
async function benchmarkContract(contract: ContractConfig): Promise<BenchmarkStats> {
    const { address, name, deployBlock } = contract;
    const stats = createStats();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmarking: ${name} (${address})`);
    console.log(`Deploy block: ${deployBlock}`);
    console.log(`${'='.repeat(60)}\n`);

    let nextToken: string | undefined;
    let consecutiveErrors = 0;

    while (true) {
        try {
            // Step 1: Fetch page from Routerscan (just tx hashes)
            const page = await fetchRouterscanPage(address, nextToken);
            stats.apiTotalCount = page.count;
            stats.pagesProcessed++;
            consecutiveErrors = 0;

            if (page.items.length === 0) {
                console.log('\n✓ No more transactions to process.');
                break;
            }

            // Filter by deploy block
            const validTxs = page.items.filter(tx => tx.blockNumber >= deployBlock);

            if (validTxs.length > 0) {
                // Step 2: Batch fetch from RPC and map to Routerscan format
                const txHashes = validTxs.map(tx => tx.txHash);
                
                for (let i = 0; i < txHashes.length; i += RPC_BATCH_SIZE) {
                    const batchHashes = txHashes.slice(i, i + RPC_BATCH_SIZE);
                    const mappedTxs = await batchFetchFromRpc(batchHashes);

                    stats.totalTxFromRpc += mappedTxs.length;
                    stats.missingInRpc += batchHashes.length - mappedTxs.length;
                    stats.totalTxFetched += batchHashes.length;
                }

                logProgress(name, stats);
            }

            // Check for more pages
            if (!page.link.nextToken) {
                console.log('\n✓ Reached end of transaction history.');
                break;
            }

            nextToken = page.link.nextToken;
            await sleep(REQUEST_DELAY_MS);

        } catch (err) {
            consecutiveErrors++;
            console.error(`Error on page ${stats.pagesProcessed}:`, err);

            if (consecutiveErrors >= 5) {
                console.error('Too many consecutive errors. Stopping.');
                break;
            }

            await sleep(2000 * consecutiveErrors);
        }
    }

    return stats;
}

/**
 * Print benchmark summary
 */
function printSummary(contractName: string, stats: BenchmarkStats) {
    const elapsed = (Date.now() - stats.startTime) / 1000;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`BENCHMARK SUMMARY: ${contractName}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total transactions (Routerscan API count): ${stats.apiTotalCount}`);
    console.log(`Total transactions fetched: ${stats.totalTxFetched}`);
    console.log(`Successfully mapped from RPC: ${stats.totalTxFromRpc}`);
    console.log(`Missing in RPC: ${stats.missingInRpc}`);
    console.log(`Pages processed: ${stats.pagesProcessed}`);
    console.log(`Time elapsed: ${elapsed.toFixed(1)}s`);
    console.log(`Average speed: ${(stats.totalTxFetched / elapsed).toFixed(1)} tx/sec`);
    console.log(`${'='.repeat(60)}\n`);
}

/**
 * Main entry point
 */
async function main() {
    console.log('=== TX Indexer V1 Benchmark ===\n');
    console.log('Fetching tx hashes from Routerscan, full data from RPC');
    console.log(`Contracts to benchmark: ${BENCHMARK_CONTRACTS.length}`);
    console.log(`RPC endpoints: ${RPC_ENDPOINTS.length}`);
    console.log(`Batch size: ${RPC_BATCH_SIZE}\n`);

    const overallStart = Date.now();

    for (const contract of BENCHMARK_CONTRACTS) {
        const stats = await benchmarkContract(contract);
        printSummary(contract.name, stats);
    }

    const totalElapsed = (Date.now() - overallStart) / 1000;
    console.log(`\nTotal benchmark time: ${totalElapsed.toFixed(1)}s`);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(console.error);
