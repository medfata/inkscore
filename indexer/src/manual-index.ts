import { createPublicClient, http, decodeEventLog } from 'viem';
import { config } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { getOrCreateRanges, updateRangeProgress, areAllRangesComplete, type IndexerRange } from './db/ranges.js';
import { pool } from './db/index.js';
import os from 'os';

// Your specific contract
const CONTRACT_ADDRESS = '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F' as const;
const DEPLOY_BLOCK = 3816036;
const RESUME_FROM_BLOCK = 4801035; // Original resume block
// Worker-specific resume points (update these based on your last run)
const WORKER_RESUME_BLOCKS = [
  9971035,   // Worker 0: resume from 9,971,035 (last processed)
  20000000,  // Worker 1: COMPLETED - skip this range
  24650000,  // Worker 2: resume from 24,650,000 (last processed)
  33502384   // Worker 3: COMPLETED - skip this range
];
const CONTRACT_NAME = 'DailyGM';

// GM event ABI
const GM_ABI = [
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "user",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "GM",
    "type": "event"
  }
] as const;

// Create multiple RPC clients for load balancing
const RPC_ENDPOINTS = [
  config.rpcUrl,
  // Add more RPC endpoints if you have them for better load balancing
];

const clients = RPC_ENDPOINTS.map((url) =>
  createPublicClient({ transport: http(url) })
);

// Round-robin client selector
let clientIndex = 0;
function getNextClient() {
  const client = clients[clientIndex];
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}

// Default client for block number queries
const defaultClient = clients[0];

// Performance settings - reduced to match main indexer
const NUM_WORKERS = 4; // Fixed to 4 workers to avoid rate limits
const CHUNK_SIZE = 5000n; // Blocks per getLogs call
const BATCH_SIZE = 1000; // Transaction details per DB insert

// Stats tracking
let totalTransactions = 0;
let startTime = Date.now();

function logStats(workerId: number, batchCount: number, currentBlock: bigint, rangeStart: bigint, rangeEnd: bigint) {
  const elapsed = Date.now() - startTime;
  // Calculate progress within this worker's range
  const processedBlocks = Number(currentBlock - rangeStart);
  const totalRangeBlocks = Number(rangeEnd - rangeStart);
  const progress = totalRangeBlocks > 0 ? ((processedBlocks / totalRangeBlocks) * 100).toFixed(2) : '0.00';
  const txPerSec = elapsed > 0 ? (totalTransactions / (elapsed / 1000)).toFixed(1) : '0';
  const blocksPerSec = elapsed > 0 ? (processedBlocks / (elapsed / 1000)).toFixed(0) : '0';

  totalTransactions += batchCount;

  console.log(
    `  [Worker ${workerId}] +${batchCount} txs | Block ${currentBlock.toLocaleString()} | ` +
    `Progress: ${progress}% | Total: ${totalTransactions.toLocaleString()} | ` +
    `Speed: ${blocksPerSec} blocks/s, ${txPerSec} tx/s`
  );
}

async function processLogs(logs: any[], fromBlock: bigint, toBlock: bigint): Promise<TransactionDetail[]> {
  const transactions: TransactionDetail[] = [];

  if (logs.length === 0) return transactions;

  // Estimate base timestamp (roughly 1 second per block on Ink)
  const baseTimestamp = BigInt(Math.floor(Date.now() / 1000)) - (32000000n - fromBlock);

  for (const log of logs) {
    if (!log.blockNumber || !log.transactionHash) continue;

    let walletAddress: string | null = null;
    let functionName: string | null = null;

    try {
      // Try to decode the GM event
      const decoded = decodeEventLog({
        abi: GM_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.args && typeof decoded.args === 'object' && 'user' in decoded.args) {
        walletAddress = (decoded.args as { user: string }).user;
      }
      functionName = decoded.eventName === 'GM' ? 'gm' : (decoded.eventName ?? null);
    } catch {
      // Fallback: extract from indexed topic
      if (log.topics[1]) {
        walletAddress = '0x' + log.topics[1].slice(26);
      }
      functionName = 'gm';
    }

    if (!walletAddress) continue;

    // Estimate timestamp based on block number
    const estimatedTs = baseTimestamp + (log.blockNumber - fromBlock);

    transactions.push({
      tx_hash: log.transactionHash,
      wallet_address: walletAddress,
      contract_address: CONTRACT_ADDRESS,
      function_selector: log.topics[0]?.slice(0, 10) || '0x',
      function_name: functionName,
      input_data: null,
      eth_value: '0', // Events don't have ETH value
      gas_used: null,
      gas_price: null,
      block_number: Number(log.blockNumber),
      block_timestamp: new Date(Number(estimatedTs) * 1000),
      status: 1, // Events are only emitted for successful transactions
      chain_id: config.chainId,
      to_address: CONTRACT_ADDRESS,
      block_hash: null,
      transaction_index: null,
      gas_limit: null,
      effective_gas_price: null,
      max_fee_per_gas: null,
      max_priority_fee_per_gas: null,
      tx_fee_wei: null,
      burned_fees: null,
      nonce: null,
      tx_type: 0,
      l1_gas_price: null,
      l1_gas_used: null,
      l1_fee: null,
      l1_base_fee_scalar: null,
      l1_blob_base_fee: null,
      l1_blob_base_fee_scalar: null,
    });
  }

  return transactions;
}

// Global shutdown flag
let isShuttingDown = false;

async function processRange(
  range: IndexerRange,
  workerId: number,
  totalBlocks: number
) {
  const rangeStart = BigInt(range.range_start);
  const rangeEnd = BigInt(range.range_end);
  let currentBlock = BigInt(range.current_block);

  console.log(`[Worker ${workerId}] Starting range ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()} (from ${currentBlock.toLocaleString()})`);

  let batchTransactions: TransactionDetail[] = [];

  while (currentBlock <= rangeEnd && !isShuttingDown) {
    const fromBlock = currentBlock;
    const toBlock = currentBlock + CHUNK_SIZE - 1n > rangeEnd
      ? rangeEnd
      : currentBlock + CHUNK_SIZE - 1n;

    try {
      // Use round-robin RPC client for load balancing
      const rpcClient = getNextClient();
      const logs = await rpcClient.getLogs({
        address: CONTRACT_ADDRESS,
        fromBlock,
        toBlock,
      });

      // Process logs into transactions
      const chunkTransactions = await processLogs(logs, fromBlock, toBlock);
      batchTransactions.push(...chunkTransactions);

      // Insert batch if it's getting large
      if (batchTransactions.length >= BATCH_SIZE) {
        if (batchTransactions.length > 0) {
          await insertTransactionDetails(batchTransactions);
          logStats(workerId, batchTransactions.length, toBlock, rangeStart, rangeEnd);
          console.log(`💾 [Worker ${workerId}] Inserted ${batchTransactions.length} transactions to DB`);
        }
        batchTransactions = [];
      }

      // Remove the database range update since we're not using DB ranges
      // await updateRangeProgress(range.id, Number(toBlock), isComplete);

      currentBlock = toBlock + 1n;

      // Small delay to avoid overwhelming the RPC (increased from main indexer)
      await sleep(100);

    } catch (error) {
      console.error(`[Worker ${workerId}] Error processing blocks ${fromBlock}-${toBlock}:`, error);

      // Check if pool is closed and exit gracefully
      if (error instanceof Error && error.message.includes('pool after calling end')) {
        console.log(`[Worker ${workerId}] Pool closed, exiting gracefully...`);
        return;
      }

      console.log(`[Worker ${workerId}] ⏳ Waiting 2s before retry...`);
      await sleep(2000);

      // Don't increment currentBlock to retry this chunk
    }
  }

  // Insert remaining transactions
  if (batchTransactions.length > 0 && !isShuttingDown) {
    try {
      await insertTransactionDetails(batchTransactions);
      logStats(workerId, batchTransactions.length, rangeEnd, rangeStart, rangeEnd);
      console.log(`💾 [Worker ${workerId}] Inserted final ${batchTransactions.length} transactions to DB`);
    } catch (error) {
      console.error(`[Worker ${workerId}] Error inserting final batch:`, error);
    }
  }

  console.log(`[Worker ${workerId}] ✓ Range complete!`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function manualIndex() {
  console.log('🚀 Parallel Manual Indexer for DailyGM Contract (RESUMED)');
  console.log('========================================================');
  console.log(`📍 Contract: ${CONTRACT_ADDRESS}`);
  console.log(`🏗️  Original Deploy Block: ${DEPLOY_BLOCK.toLocaleString()}`);
  console.log(`🔄 Resuming from Block: ${RESUME_FROM_BLOCK.toLocaleString()}`);
  console.log(`🌐 RPC: ${config.rpcUrl}`);
  console.log(`� C hunk Size: ${CHUNK_SIZE.toLocaleString()} blocks`);
  console.log(`👥 Workers: ${NUM_WORKERS} (CPU cores: ${os.cpus().length})`);
  console.log('========================================================\n');

  try {
    // Get latest block
    const latestBlock = await defaultClient.getBlockNumber();
    const totalBlocks = Number(latestBlock) - RESUME_FROM_BLOCK;

    console.log(`📈 Latest Block: ${latestBlock.toLocaleString()}`);
    console.log(`🔢 Remaining Blocks to Process: ${totalBlocks.toLocaleString()}`);
    console.log(`⚡ Parallel Processing: ${NUM_WORKERS} workers\n`);

    if (latestBlock < BigInt(RESUME_FROM_BLOCK)) {
      console.error('❌ Latest block is before resume block!');
      return;
    }

    // Create ranges with proper resume points for each worker
    console.log(`Creating ranges with worker-specific resume points...`);

    // Define strategic ranges for better load balancing
    const workerRanges = [
      { start: RESUME_FROM_BLOCK, end: 12000000 },      // Worker 0: 4.8M - 12M
      { start: 12000001, end: 20000000 },               // Worker 1: 12M - 20M  
      { start: 20000001, end: 27000000 },               // Worker 2: 20M - 27M
      { start: 27000001, end: Number(latestBlock) }     // Worker 3: 27M - latest
    ];
    const ranges: IndexerRange[] = [];

    for (let i = 0; i < NUM_WORKERS && i < WORKER_RESUME_BLOCKS.length; i++) {
      const rangeStart = workerRanges[i].start;
      const rangeEnd = workerRanges[i].end;
      const resumeBlock = Math.max(WORKER_RESUME_BLOCKS[i], rangeStart);

      // Skip if this worker is already complete
      if (resumeBlock >= rangeEnd) {
        console.log(`  Worker ${i}: Already complete (${resumeBlock.toLocaleString()} >= ${rangeEnd.toLocaleString()})`);
        continue;
      }

      ranges.push({
        id: i + 1000,
        contract_address: CONTRACT_ADDRESS,
        range_start: rangeStart.toString(),
        range_end: rangeEnd.toString(),
        current_block: resumeBlock.toString(), // Resume from specific block
        is_complete: false
      });

      console.log(`  Worker ${i}: Range ${rangeStart.toLocaleString()}-${rangeEnd.toLocaleString()}, resuming from ${resumeBlock.toLocaleString()}`);
    }

    console.log(`\nCreated ${ranges.length} ranges to process\n`);

    if (ranges.length === 0) {
      console.log(`No ranges to process!`);
      return;
    }

    startTime = Date.now();
    totalTransactions = 0;

    console.log('🔄 Starting parallel indexing...\n');

    // Process all ranges in parallel (no need to filter incomplete since they're fresh)
    await Promise.all(
      ranges.map((range, idx) => processRange(range, idx, totalBlocks))
    );

    console.log(`\n✓ ${CONTRACT_NAME} parallel indexing complete!`);

    const elapsed = Date.now() - startTime;
    console.log('\n🎉 Parallel Indexing Complete!');
    console.log('==============================');
    console.log(`⏱️  Total Time: ${formatDuration(elapsed)}`);
    console.log(`📊 Total Transactions: ${totalTransactions.toLocaleString()}`);
    console.log(`🏎️  Average Speed: ${(totalTransactions / (elapsed / 1000)).toFixed(1)} transactions/sec`);
    console.log(`👥 Workers Used: ${NUM_WORKERS}`);

  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    if (!isShuttingDown) {
      await pool.end();
    }
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  isShuttingDown = true;

  // Give workers time to finish current chunks
  setTimeout(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error('Error closing pool:', error);
    }
    process.exit(0);
  }, 3000);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  isShuttingDown = true;

  setTimeout(async () => {
    try {
      await pool.end();
    } catch (error) {
      console.error('Error closing pool:', error);
    }
    process.exit(0);
  }, 3000);
});

// Run the indexer
manualIndex().catch(console.error);