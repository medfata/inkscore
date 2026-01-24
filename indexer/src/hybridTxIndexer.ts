import { createPublicClient, http, type PublicClient, type Block, type Transaction } from 'viem';
import { type ContractConfig, getNextRpc, config } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { pool } from './db/index.js';

const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = `https://cdn-canary.routescan.io/api/evm/${INK_CHAIN_ID}/transactions`;
const ROUTESCAN_PAGE_LIMIT = 50;
const ROUTESCAN_DELAY_MS = 200; // 5 requests per second
const CONCURRENT_REQUESTS = 3; // Fetch 3 pages concurrently
const CONCURRENT_BATCHES = 3; // Number of concurrent RPC batches
const RPC_BATCH_SIZE = 1000; // Blocks per RPC batch

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
  status: boolean;
}

interface RoutescanResponse {
  items: RoutescanTransaction[];
  count: number;
  countType: string;
  link: {
    next?: string;
    nextToken?: string;
    prev?: string;
    prevToken?: string;
  };
}

interface HybridTxIndexerCursor {
  id: number;
  contract_address: string;
  last_block_indexed: number;
  last_routescan_token: string | null;
  total_indexed: number;
  is_complete: boolean;
  indexing_method: 'rpc' | 'routescan' | 'hybrid';
}

let totalTxProcessed = 0;
let startTime = Date.now();
let useRpc = true; // Start with RPC, alternate with RouterScan

function logStats(contractName: string, batchCount: number, method: string, progress: string) {
  const elapsed = (Date.now() - startTime) / 1000;
  const txPerSec = elapsed > 0 ? (totalTxProcessed / elapsed).toFixed(1) : '0';
  console.log(
    `  [${contractName}] +${batchCount} txs | Total: ${totalTxProcessed} | ${txPerSec} tx/sec | ${method} | ${progress}`
  );
}

async function ensureCursorTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hybrid_tx_indexer_cursors (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) UNIQUE NOT NULL,
      last_block_indexed BIGINT NOT NULL DEFAULT 0,
      last_routescan_token TEXT,
      total_indexed BIGINT NOT NULL DEFAULT 0,
      is_complete BOOLEAN DEFAULT false,
      indexing_method VARCHAR(20) DEFAULT 'hybrid',
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getCursor(contractAddress: string): Promise<HybridTxIndexerCursor | null> {
  const result = await pool.query<HybridTxIndexerCursor>(
    'SELECT * FROM hybrid_tx_indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
  return result.rows[0] || null;
}

async function updateCursor(
  contractAddress: string,
  lastBlock: number,
  txCount: number,
  isComplete: boolean,
  routescanToken?: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO hybrid_tx_indexer_cursors (contract_address, last_block_indexed, last_routescan_token, total_indexed, is_complete, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (contract_address)
     DO UPDATE SET
       last_block_indexed = $2,
       last_routescan_token = $3,
       total_indexed = hybrid_tx_indexer_cursors.total_indexed + $4,
       is_complete = $5,
       updated_at = NOW()`,
    [contractAddress.toLowerCase(), lastBlock, routescanToken || null, txCount, isComplete]
  );
}

function createClient(): PublicClient {
  return createPublicClient({
    transport: http(getNextRpc(), {
      batch: true,
      retryCount: 3,
      retryDelay: 1000,
    }),
  });
}

// RPC-based transaction fetching
async function getTransactionsViaRpc(
  client: PublicClient,
  contractAddress: string,
  fromBlock: bigint,
  toBlock: bigint
): Promise<TransactionDetail[]> {
  const transactions: TransactionDetail[] = [];

  const blockPromises: Promise<Block>[] = [];
  for (let block = fromBlock; block <= toBlock; block++) {
    blockPromises.push(client.getBlock({ blockNumber: block, includeTransactions: true }));
  }

  const blocks = await Promise.all(blockPromises);

  for (const block of blocks) {
    if (!block.transactions || block.transactions.length === 0) continue;

    for (const tx of block.transactions as Transaction[]) {
      const isToContract = tx.to?.toLowerCase() === contractAddress.toLowerCase();
      const isFromContract = tx.from.toLowerCase() === contractAddress.toLowerCase();

      if (!isToContract && !isFromContract) continue;

      const receipt = await client.getTransactionReceipt({ hash: tx.hash });
      const functionSelector = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : '0x';
      const functionName = functionSelector !== '0x' ? `func_${functionSelector}` : null;

      const txDetail: TransactionDetail = {
        tx_hash: tx.hash,
        wallet_address: tx.from,
        contract_address: contractAddress.toLowerCase(),
        to_address: tx.to?.toLowerCase() || null,
        function_selector: functionSelector,
        function_name: functionName,
        input_data: tx.input,
        eth_value: tx.value.toString(),
        gas_limit: tx.gas?.toString() || null,
        gas_used: receipt.gasUsed?.toString() || null,
        gas_price: tx.gasPrice?.toString() || null,
        effective_gas_price: receipt.effectiveGasPrice?.toString() || null,
        max_fee_per_gas: tx.maxFeePerGas?.toString() || null,
        max_priority_fee_per_gas: tx.maxPriorityFeePerGas?.toString() || null,
        tx_fee_wei: null,
        burned_fees: null,
        block_number: Number(block.number),
        block_hash: block.hash || null,
        block_timestamp: new Date(Number(block.timestamp) * 1000),
        transaction_index: tx.transactionIndex || null,
        nonce: tx.nonce || null,
        tx_type: tx.type ? parseInt(tx.type, 16) : 0,
        status: receipt.status === 'success' ? 1 : 0,
        chain_id: config.chainId,
        l1_gas_price: null,
        l1_gas_used: null,
        l1_fee: null,
        l1_base_fee_scalar: null,
        l1_blob_base_fee: null,
        l1_blob_base_fee_scalar: null,
      };

      transactions.push(txDetail);
    }
  }

  if (transactions.length > 0) {
    await insertTransactionDetails(transactions);
  }

  return transactions;
}

// RouterScan-based transaction fetching
async function fetchRoutescanPage(
  contractAddress: string,
  nextToken?: string
): Promise<RoutescanResponse> {
  const params = new URLSearchParams({
    fromAddresses: contractAddress,
    toAddresses: contractAddress,
    count: 'true',
    limit: ROUTESCAN_PAGE_LIMIT.toString(),
    sort: 'asc',
  });

  if (nextToken) {
    params.append('nextToken', nextToken);
  }

  const url = `${ROUTESCAN_BASE_URL}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Routescan API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<RoutescanResponse>;
}

function transformRoutescanTx(
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
    input_data: null,
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

async function getTransactionsViaRoutescan(
  contractAddress: string,
  nextToken?: string
): Promise<{ transactions: TransactionDetail[]; nextToken: string | null }> {
  const response = await fetchRoutescanPage(contractAddress, nextToken);

  const transactions: TransactionDetail[] = [];

  for (const tx of response.items) {
    const txDetail = transformRoutescanTx(tx, contractAddress);
    transactions.push(txDetail);
  }

  if (transactions.length > 0) {
    await insertTransactionDetails(transactions);
  }

  return {
    transactions,
    nextToken: response.link.nextToken || null,
  };
}

export async function indexContractTransactionsHybrid(contract: ContractConfig): Promise<void> {
  await ensureCursorTable();

  const client = createClient();
  const contractAddress = contract.address.toLowerCase();

  console.log('========================================');
  console.log(`Hybrid TX Indexing ${contract.name} (${contract.address})`);
  console.log(`Deploy block: ${contract.deployBlock} | Chain: Ink (${INK_CHAIN_ID})`);
  console.log(`Using RPC + RouterScan (round-robin load balancing)`);
  console.log('========================================\n');

  let cursor = await getCursor(contractAddress);
  const startBlock = cursor?.last_block_indexed || contract.deployBlock;

  const latestBlock = await client.getBlockNumber();
  const endBlock = Number(latestBlock);

  if (startBlock >= endBlock) {
    console.log(`  [${contract.name}] Already up to date (block ${startBlock})\n`);
    return;
  }

  console.log(`  Indexing from block ${startBlock} to ${endBlock} (${endBlock - startBlock} blocks)\n`);

  totalTxProcessed = cursor?.total_indexed || 0;
  startTime = Date.now();

  let currentBlock = startBlock;
  let routescanToken = cursor?.last_routescan_token || undefined;

  // Start with RouterScan since RPC is having issues with large block ranges
  useRpc = false;
  let rpcFailureCount = 0;
  const MAX_RPC_FAILURES = 3; // After 3 RPC failures, stick to RouterScan

  while (currentBlock < endBlock) {
    try {
      // Skip RPC if it's failing too much
      if (useRpc && rpcFailureCount >= MAX_RPC_FAILURES) {
        console.log(`  [${contract.name}] RPC failing too much, switching to RouterScan only`);
        useRpc = false;
      }

      if (useRpc) {
        // Use RPC for this batch
        const batchPromises: Promise<TransactionDetail[]>[] = [];

        for (let i = 0; i < CONCURRENT_BATCHES && currentBlock < endBlock; i++) {
          const batchStart = BigInt(currentBlock);
          const batchEnd = BigInt(Math.min(currentBlock + RPC_BATCH_SIZE - 1, endBlock));

          batchPromises.push(
            getTransactionsViaRpc(client, contractAddress, batchStart, batchEnd)
          );

          currentBlock += RPC_BATCH_SIZE;
        }

        const results = await Promise.all(batchPromises);
        const batchTxCount = results.reduce((sum, txs) => sum + txs.length, 0);
        totalTxProcessed += batchTxCount;

        await updateCursor(contractAddress, currentBlock - 1, batchTxCount, currentBlock >= endBlock);

        const progress = `Block ${currentBlock}/${endBlock} (~${((currentBlock / endBlock) * 100).toFixed(1)}%)`;
        logStats(contract.name, batchTxCount, 'RPC', progress);

        // Reset failure count on success
        rpcFailureCount = 0;

      } else {
        // Use RouterScan for this batch
        const result = await getTransactionsViaRoutescan(contractAddress, routescanToken);

        totalTxProcessed += result.transactions.length;
        routescanToken = result.nextToken || undefined;

        if (result.transactions.length > 0) {
          const lastBlock = Math.max(...result.transactions.map(tx => tx.block_number));
          currentBlock = Math.max(currentBlock, lastBlock + 1);

          await updateCursor(contractAddress, lastBlock, result.transactions.length, !result.nextToken, result.nextToken);
        }

        const progress = result.nextToken ? 'More pages...' : 'Complete';
        logStats(contract.name, result.transactions.length, 'RouterScan', progress);

        // Rate limit for RouterScan
        await new Promise(resolve => setTimeout(resolve, ROUTESCAN_DELAY_MS));

        // If no more pages, switch to RPC
        if (!result.nextToken) {
          break;
        }
      }

      // Alternate between RPC and RouterScan
      useRpc = !useRpc;

    } catch (error) {
      console.error(`  [${contract.name}] Error (${useRpc ? 'RPC' : 'RouterScan'}):`, error);

      if (useRpc) {
        rpcFailureCount++;
        console.log(`  [${contract.name}] RPC failure count: ${rpcFailureCount}/${MAX_RPC_FAILURES}`);
      }

      // Switch to the other method on error
      useRpc = !useRpc;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n  [${contract.name}] ✅ Indexing complete! Total: ${totalTxProcessed} transactions\n`);
}

export async function pollNewTransactionsHybrid(contract: ContractConfig): Promise<void> {
  const client = createClient();
  const contractAddress = contract.address.toLowerCase();

  const cursor = await getCursor(contractAddress);
  if (!cursor) return;

  const latestBlock = await client.getBlockNumber();
  const startBlock = cursor.last_block_indexed + 1;

  if (startBlock > Number(latestBlock)) return;

  // For polling, always use RPC (faster for recent blocks)
  const transactions = await getTransactionsViaRpc(
    client,
    contractAddress,
    BigInt(startBlock),
    latestBlock
  );

  if (transactions.length > 0) {
    await updateCursor(contractAddress, Number(latestBlock), transactions.length, false);
    console.log(`  [${contract.name}] +${transactions.length} new txs (blocks ${startBlock}-${latestBlock})`);
  }
}

export async function resetHybridTxCursor(contractAddress: string): Promise<void> {
  await pool.query('DELETE FROM hybrid_tx_indexer_cursors WHERE contract_address = $1', [
    contractAddress.toLowerCase(),
  ]);
  console.log(`Reset Hybrid TX cursor for ${contractAddress}`);
}
