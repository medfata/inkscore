import { createPublicClient, http, type PublicClient, type Block, type Transaction } from 'viem';
import { type ContractConfig, getNextRpc, config } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { pool } from './db/index.js';

const INK_CHAIN_ID = 57073;
const BATCH_SIZE = 100; // Process 100 blocks at a time
const CONCURRENT_BATCHES = 5; // Process 5 batches in parallel

interface RpcTxIndexerCursor {
  id: number;
  contract_address: string;
  last_block_indexed: number;
  total_indexed: number;
  is_complete: boolean;
}

let totalTxProcessed = 0;
let startTime = Date.now();

function logStats(contractName: string, batchCount: number, currentBlock: number, latestBlock: number) {
  const elapsed = (Date.now() - startTime) / 1000;
  const txPerSec = elapsed > 0 ? (totalTxProcessed / elapsed).toFixed(1) : '0';
  const progress = latestBlock > 0 ? ((currentBlock / latestBlock) * 100).toFixed(1) : '0';
  console.log(
    `  [${contractName}] +${batchCount} txs | Total: ${totalTxProcessed} | ${txPerSec} tx/sec | Block ${currentBlock}/${latestBlock} (~${progress}%)`
  );
}

async function ensureCursorTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rpc_tx_indexer_cursors (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) UNIQUE NOT NULL,
      last_block_indexed BIGINT NOT NULL DEFAULT 0,
      total_indexed BIGINT NOT NULL DEFAULT 0,
      is_complete BOOLEAN DEFAULT false,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getCursor(contractAddress: string): Promise<RpcTxIndexerCursor | null> {
  const result = await pool.query<RpcTxIndexerCursor>(
    'SELECT * FROM rpc_tx_indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
  return result.rows[0] || null;
}

async function updateCursor(
  contractAddress: string,
  lastBlock: number,
  txCount: number,
  isComplete: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO rpc_tx_indexer_cursors (contract_address, last_block_indexed, total_indexed, is_complete, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (contract_address)
     DO UPDATE SET
       last_block_indexed = $2,
       total_indexed = rpc_tx_indexer_cursors.total_indexed + $3,
       is_complete = $4,
       updated_at = NOW()`,
    [contractAddress.toLowerCase(), lastBlock, txCount, isComplete]
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

async function getTransactionsForContract(
  client: PublicClient,
  contractAddress: string,
  fromBlock: bigint,
  toBlock: bigint
): Promise<TransactionDetail[]> {
  const transactions: TransactionDetail[] = [];

  // Fetch blocks in the range
  const blockPromises: Promise<Block>[] = [];
  for (let block = fromBlock; block <= toBlock; block++) {
    blockPromises.push(client.getBlock({ blockNumber: block, includeTransactions: true }));
  }

  const blocks = await Promise.all(blockPromises);

  for (const block of blocks) {
    if (!block.transactions || block.transactions.length === 0) continue;

    for (const tx of block.transactions as Transaction[]) {
      // Check if transaction is to or from the contract
      const isToContract = tx.to?.toLowerCase() === contractAddress.toLowerCase();
      const isFromContract = tx.from.toLowerCase() === contractAddress.toLowerCase();

      if (!isToContract && !isFromContract) continue;

      // Get transaction receipt for status
      const receipt = await client.getTransactionReceipt({ hash: tx.hash });

      // Extract function selector (first 4 bytes of input data)
      const functionSelector = tx.input && tx.input.length >= 10 ? tx.input.slice(0, 10) : '0x';

      // Try to decode function name (basic approach - just use selector)
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

  // Insert in batches
  if (transactions.length > 0) {
    await insertTransactionDetails(transactions);
  }

  return transactions;
}

export async function indexContractTransactionsRpc(contract: ContractConfig): Promise<void> {
  await ensureCursorTable();

  const client = createClient();
  const contractAddress = contract.address.toLowerCase();

  console.log('========================================');
  console.log(`RPC TX Indexing ${contract.name} (${contract.address})`);
  console.log(`Deploy block: ${contract.deployBlock} | Chain: Ink (${INK_CHAIN_ID})`);
  console.log(`Using RPC with ${CONCURRENT_BATCHES} concurrent batches`);
  console.log('========================================\n');

  // Get current cursor
  let cursor = await getCursor(contractAddress);
  const startBlock = cursor?.last_block_indexed || contract.deployBlock;

  // Get latest block
  const latestBlock = await client.getBlockNumber();
  const endBlock = Number(latestBlock);

  if (startBlock >= endBlock) {
    console.log(`  [${contract.name}] Already up to date (block ${startBlock})\n`);
    return;
  }

  console.log(`  Indexing from block ${startBlock} to ${endBlock} (${endBlock - startBlock} blocks)\n`);

  // Reset stats
  totalTxProcessed = cursor?.total_indexed || 0;
  startTime = Date.now();

  // Process in batches
  let currentBlock = startBlock;

  while (currentBlock < endBlock) {
    const batchPromises: Promise<TransactionDetail[]>[] = [];

    // Create concurrent batches
    for (let i = 0; i < CONCURRENT_BATCHES && currentBlock < endBlock; i++) {
      const batchStart = BigInt(currentBlock);
      const batchEnd = BigInt(Math.min(currentBlock + BATCH_SIZE - 1, endBlock));

      batchPromises.push(
        getTransactionsForContract(client, contractAddress, batchStart, batchEnd)
      );

      currentBlock += BATCH_SIZE;
    }

    // Wait for all batches to complete
    const results = await Promise.all(batchPromises);
    const batchTxCount = results.reduce((sum, txs) => sum + txs.length, 0);

    totalTxProcessed += batchTxCount;

    // Update cursor
    await updateCursor(contractAddress, currentBlock - 1, batchTxCount, currentBlock >= endBlock);

    // Log progress
    if (batchTxCount > 0 || currentBlock % 1000 === 0) {
      logStats(contract.name, batchTxCount, currentBlock, endBlock);
    }
  }

  console.log(`\n  [${contract.name}] ✅ Indexing complete! Total: ${totalTxProcessed} transactions\n`);
}

export async function pollNewTransactionsRpc(contract: ContractConfig): Promise<void> {
  const client = createClient();
  const contractAddress = contract.address.toLowerCase();

  const cursor = await getCursor(contractAddress);
  if (!cursor) return;

  const latestBlock = await client.getBlockNumber();
  const startBlock = cursor.last_block_indexed + 1;

  if (startBlock > Number(latestBlock)) return;

  const transactions = await getTransactionsForContract(
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

// Helper function to reset cursor (for re-indexing)
export async function resetRpcTxCursor(contractAddress: string): Promise<void> {
  await pool.query('DELETE FROM rpc_tx_indexer_cursors WHERE contract_address = $1', [
    contractAddress.toLowerCase(),
  ]);
  console.log(`Reset RPC TX cursor for ${contractAddress}`);
}
