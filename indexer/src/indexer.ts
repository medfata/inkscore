import { createPublicClient, http, decodeEventLog, type PublicClient } from 'viem';
import { config, CONTRACTS_TO_INDEX, RPC_ENDPOINTS, type ContractConfig } from './config.js';
import { getOrCreateRanges, updateRangeProgress, areAllRangesComplete, type IndexerRange } from './db/ranges.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';

// Create multiple RPC clients for load balancing
const clients: PublicClient[] = RPC_ENDPOINTS.map((url) =>
  createPublicClient({ transport: http(url) })
);

// Round-robin client selector
let clientIndex = 0;
function getNextClient(): PublicClient {
  const client = clients[clientIndex];
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}

// Default client for block number queries
const defaultClient = clients[0];

// Performance tuning - reduced workers to avoid rate limiting
const LOGS_CHUNK_SIZE = 5000n; // Blocks per getLogs call
const NUM_WORKERS = 4; // Number of parallel range workers (reduced to avoid rate limits)

// Stats tracking
let totalTxProcessed = 0;
let startTime = Date.now();

function logStats(workerId: number, batchCount: number, progress: string) {
  const elapsed = (Date.now() - startTime) / 1000;
  const txPerSec = elapsed > 0 ? (totalTxProcessed / elapsed).toFixed(1) : '0';
  console.log(
    `  [Worker ${workerId}] +${batchCount} txs | Total: ${totalTxProcessed} | ${txPerSec} tx/sec | ${progress}%`
  );
}

export async function indexContract(contract: ContractConfig) {
  const { address, deployBlock, abi, name } = contract;
  const latestBlock = await defaultClient.getBlockNumber();

  console.log(`\n========================================`);
  console.log(`Indexing ${name} (${address})`);
  console.log(`Deploy block: ${deployBlock}, Latest: ${latestBlock}`);
  console.log(`Total blocks: ${Number(latestBlock) - deployBlock}`);
  console.log(`Workers: ${NUM_WORKERS}`);
  console.log(`========================================\n`);

  // Get or create parallel ranges
  const ranges = await getOrCreateRanges(address, deployBlock, Number(latestBlock), NUM_WORKERS);

  const incompleteRanges = ranges.filter((r) => !r.is_complete);
  console.log(`Found ${ranges.length} ranges, ${incompleteRanges.length} incomplete\n`);

  if (incompleteRanges.length === 0) {
    console.log(`${name} is fully indexed!`);
    return;
  }

  startTime = Date.now();
  totalTxProcessed = 0;

  // Process all incomplete ranges in parallel
  await Promise.all(
    incompleteRanges.map((range, idx) => processRange(range, idx, abi, address))
  );

  const isComplete = await areAllRangesComplete(address);
  if (isComplete) {
    console.log(`\n✓ ${name} indexing complete!`);
  }
}

async function processRange(
  range: IndexerRange,
  workerId: number,
  abi: ContractConfig['abi'],
  contractAddress: `0x${string}`
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
      // Use round-robin RPC client for load balancing
      const rpcClient = getNextClient();
      const logs = await rpcClient.getLogs({
        address: contractAddress,
        fromBlock,
        toBlock,
      });

      if (logs.length > 0) {
        const transactions = processLogs(logs, abi, contractAddress);

        if (transactions.length > 0) {
          await insertTransactionDetails(transactions);
          totalTxProcessed += transactions.length;

          const progress = ((Number(currentBlock - rangeStart) / Number(totalRangeBlocks)) * 100).toFixed(1);
          logStats(workerId, transactions.length, progress);
        }
      }

      // Update progress
      const isComplete = toBlock >= rangeEnd;
      await updateRangeProgress(range.id, Number(toBlock), isComplete);

      currentBlock = toBlock + 1n;
    } catch (err) {
      console.error(`[Worker ${workerId}] Error at block ${fromBlock}:`, err);
      // Wait and retry
      await sleep(2000);
    }
  }

  console.log(`[Worker ${workerId}] ✓ Range complete!`);
}

function processLogs(
  logs: Awaited<ReturnType<PublicClient['getLogs']>>,
  abi: ContractConfig['abi'],
  contractAddress: `0x${string}`
): TransactionDetail[] {
  const transactions: TransactionDetail[] = [];

  // Get min/max blocks for timestamp estimation
  let minBlock = logs[0]?.blockNumber || 0n;
  let maxBlock = logs[0]?.blockNumber || 0n;

  for (const log of logs) {
    if (log.blockNumber) {
      if (log.blockNumber < minBlock) minBlock = log.blockNumber;
      if (log.blockNumber > maxBlock) maxBlock = log.blockNumber;
    }
  }

  // Estimate base timestamp (roughly 1 second per block on Ink)
  const baseTimestamp = BigInt(Math.floor(Date.now() / 1000)) - (32000000n - minBlock);

  for (const log of logs) {
    if (!log.blockNumber || !log.transactionHash) continue;

    let walletAddress: string | null = null;
    let functionName: string | null = null;

    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.args && typeof decoded.args === 'object' && 'user' in decoded.args) {
        walletAddress = (decoded.args as { user: string }).user;
      }
      functionName = decoded.eventName === 'GM' ? 'gm' : (decoded.eventName ?? null);
    } catch {
      // Extract from indexed topic
      if (log.topics[1]) {
        walletAddress = '0x' + log.topics[1].slice(26);
      }
      functionName = 'gm';
    }

    if (!walletAddress) continue;

    // Estimate timestamp based on block number
    const estimatedTs = baseTimestamp + (log.blockNumber - minBlock);

    transactions.push({
      tx_hash: log.transactionHash,
      wallet_address: walletAddress,
      contract_address: contractAddress,
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
      to_address: contractAddress,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runIndexer() {
  console.log('Starting parallel indexer...');
  console.log(`Config: ${NUM_WORKERS} workers, ${LOGS_CHUNK_SIZE} blocks/chunk`);
  console.log(`RPC endpoints: ${RPC_ENDPOINTS.length} (load balanced)\n`);

  for (const contract of CONTRACTS_TO_INDEX) {
    try {
      await indexContract(contract);
    } catch (err) {
      console.error(`Error indexing ${contract.name}:`, err);
    }
  }
}
