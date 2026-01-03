import { type ContractConfig, RPC_ENDPOINTS, config } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { pool } from './db/index.js';
import { createPublicClient, http, type PublicClient } from 'viem';

// Routescan API configuration - using the ALL chains endpoint with chain filter
const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn.routescan.io/api/evm/all/transactions';
const PAGE_LIMIT = 100; // Routescan supports up to 1000
const REQUEST_DELAY_MS = 100; // 10 requests per second

// Create multiple RPC clients for load balancing (same as event indexer)
// Each endpoint has 20 req/sec limit, so 2 endpoints = 40 req/sec effective
const rpcClients: PublicClient[] = RPC_ENDPOINTS.map((url) =>
  createPublicClient({
    transport: http(url, {
      retryCount: 2,
      retryDelay: 500,
    }),
  })
);

// Round-robin client selector for load balancing
let rpcClientIndex = 0;
function getNextRpcClient(): PublicClient {
  const client = rpcClients[rpcClientIndex];
  rpcClientIndex = (rpcClientIndex + 1) % rpcClients.length;
  return client;
}

// With 2 RPCs at 20 req/sec each, we can do ~35 req/sec safely
// Process in batches with minimal delay
const RPC_BATCH_SIZE = 35;
const RPC_BATCH_DELAY_MS = 1000; // 1 second between batches

/**
 * Batch fetch input data from RPC for multiple transactions
 * Uses load balancing across multiple RPC endpoints for higher throughput
 */
async function fetchInputDataFromRpc(txHashes: string[]): Promise<Map<string, string>> {
  const inputMap = new Map<string, string>();
  if (txHashes.length === 0) return inputMap;

  // Process in batches, distributing across RPC endpoints
  for (let i = 0; i < txHashes.length; i += RPC_BATCH_SIZE) {
    const batch = txHashes.slice(i, i + RPC_BATCH_SIZE);

    try {
      // Distribute requests across RPC clients
      const txPromises = batch.map(hash => {
        const client = getNextRpcClient();
        return client.getTransaction({ hash: hash as `0x${string}` })
          .catch(() => null);
      });

      const transactions = await Promise.all(txPromises);

      for (let j = 0; j < batch.length; j++) {
        const tx = transactions[j];
        if (tx && tx.input && tx.input !== '0x') {
          inputMap.set(batch[j].toLowerCase(), tx.input);
        }
      }
    } catch {
      // Silent fail - inputDataFiller will catch these later
    }

    // Wait between batches to respect rate limit (except for last batch)
    if (i + RPC_BATCH_SIZE < txHashes.length) {
      await sleep(RPC_BATCH_DELAY_MS);
    }
  }

  return inputMap;
}

interface RoutescanTransaction {
  chainId: string;
  blockNumber: number;
  txIndex: number;
  timestamp: string;
  from: {
    id: string;
    isContract: boolean;
  };
  to: {
    id: string;
    isContract: boolean;
  };
  txHash: string;
  value: string;
  gasLimit?: string;
  gasUsed?: string;
  gasPrice: string;
  burnedFees?: string;
  methodId?: string;
  method?: string;
  input?: string; // Full input data (calldata)
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

// Cursor tracking for resumable indexing
interface TxIndexerCursor {
  id: number;
  contract_address: string;
  last_next_token: string | null;
  total_indexed: number;
  api_total_count: number; // Total transactions reported by API
  is_complete: boolean;
}

// Stats tracking - now per-contract instead of global
interface IndexerStats {
  totalTxProcessed: number;
  startTime: number;
  seenTxHashes: Set<string>; // Track seen tx hashes to detect loops
}

function createStats(initialCount: number = 0): IndexerStats {
  return {
    totalTxProcessed: initialCount,
    startTime: Date.now(),
    seenTxHashes: new Set(),
  };
}

function logStats(contractName: string, batchCount: number, stats: IndexerStats, apiTotalCount: number) {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const txPerSec = elapsed > 0 ? (stats.totalTxProcessed / elapsed).toFixed(1) : '0';
  const progress = apiTotalCount > 0 ? ((stats.totalTxProcessed / apiTotalCount) * 100).toFixed(1) : '0';
  console.log(
    `  [${contractName}] +${batchCount} txs | Total: ${stats.totalTxProcessed} | ${txPerSec} tx/sec | ~${progress}%`
  );
}

async function fetchRoutescanPage(
  contractAddress: string,
  nextToken?: string,
  sort: 'asc' | 'desc' = 'asc'
): Promise<RoutescanResponse> {
  const params = new URLSearchParams({
    fromAddresses: contractAddress,
    toAddresses: contractAddress,
    includedChainIds: INK_CHAIN_ID, // Filter to Ink chain only
    count: 'true',
    limit: PAGE_LIMIT.toString(),
    sort, // asc for backfill (oldest first), desc for polling (newest first)
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

async function ensureCursorTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tx_indexer_cursors (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) UNIQUE NOT NULL,
      last_next_token TEXT,
      total_indexed INTEGER DEFAULT 0,
      api_total_count INTEGER DEFAULT 0,
      is_complete BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Add api_total_count column if it doesn't exist (migration for existing tables)
  await pool.query(`
    ALTER TABLE tx_indexer_cursors 
    ADD COLUMN IF NOT EXISTS api_total_count INTEGER DEFAULT 0
  `);
}

async function getOrCreateCursor(contractAddress: string): Promise<TxIndexerCursor> {
  await ensureCursorTable();

  const result = await pool.query(
    'SELECT * FROM tx_indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );

  if (result.rows.length > 0) {
    return result.rows[0] as TxIndexerCursor;
  }

  // Create new cursor
  const insertResult = await pool.query(
    `INSERT INTO tx_indexer_cursors (contract_address, last_next_token, total_indexed, is_complete) 
     VALUES ($1, NULL, 0, FALSE) 
     RETURNING *`,
    [contractAddress.toLowerCase()]
  );

  return insertResult.rows[0] as TxIndexerCursor;
}

async function updateCursorProgress(
  contractAddress: string,
  nextToken: string | null,
  totalIndexed: number,
  apiTotalCount: number,
  isComplete: boolean
): Promise<void> {
  await pool.query(
    `UPDATE tx_indexer_cursors 
     SET last_next_token = $1, total_indexed = $2, api_total_count = $3, is_complete = $4, updated_at = NOW()
     WHERE contract_address = $5`,
    [nextToken, totalIndexed, apiTotalCount, isComplete, contractAddress.toLowerCase()]
  );

  // Also sync to contracts table for unified progress tracking
  await pool.query(
    `UPDATE contracts 
     SET total_indexed = $1, updated_at = NOW()
     WHERE LOWER(address) = $2`,
    [totalIndexed, contractAddress.toLowerCase()]
  );
}

export async function indexContractTransactions(contract: ContractConfig): Promise<void> {
  const { address, name, deployBlock } = contract;

  console.log(`\n========================================`);
  console.log(`TX Indexing ${name} (${address})`);
  console.log(`Deploy block: ${deployBlock} | Chain: Ink (${INK_CHAIN_ID})`);
  console.log(`Using Routescan API (rate limit: 2 req/sec)`);
  console.log(`========================================\n`);

  // Get or create cursor for resumable indexing
  const cursor = await getOrCreateCursor(address);

  if (cursor.is_complete) {
    console.log(`${name} TX indexing already complete! (${cursor.total_indexed} transactions)`);
    console.log(`To re-index, run: resetTxCursor('${address}')`);
    return;
  }

  // Create per-contract stats (not global!)
  const stats = createStats(cursor.total_indexed);

  let nextToken = cursor.last_next_token || undefined;
  let pageCount = 0;
  let apiTotalCount = 0;
  let consecutiveErrors = 0;
  let skippedBeforeDeployBlock = 0;
  let duplicateDetected = 0;

  if (cursor.total_indexed > 0) {
    console.log(`Resuming from ${cursor.total_indexed} previously indexed transactions\n`);
  }

  while (true) {
    try {
      pageCount++;
      const response = await fetchRoutescanPage(address, nextToken);
      apiTotalCount = response.count;
      consecutiveErrors = 0; // Reset on success

      if (response.items.length === 0) {
        console.log(`\n✓ No more transactions to index.`);
        await updateCursorProgress(address, null, stats.totalTxProcessed, apiTotalCount, true);
        break;
      }

      // Check for pagination loop - if we've seen ALL tx hashes in this batch before, we're looping
      const batchHashes = response.items.map(tx => tx.txHash);
      const allSeenBefore = batchHashes.every(hash => stats.seenTxHashes.has(hash));

      if (allSeenBefore && batchHashes.length > 0) {
        duplicateDetected++;
        console.log(`\n⚠️ Detected pagination loop (all ${batchHashes.length} txs already seen). Attempt ${duplicateDetected}/3`);

        if (duplicateDetected >= 3) {
          console.log(`\n✓ Pagination loop confirmed. Marking as complete.`);
          await updateCursorProgress(address, null, stats.totalTxProcessed, apiTotalCount, true);
          break;
        }

        // Try to skip ahead
        if (response.link.nextToken) {
          nextToken = response.link.nextToken;
          await sleep(REQUEST_DELAY_MS);
          continue;
        } else {
          console.log(`\n✓ No more pages. Marking as complete.`);
          await updateCursorProgress(address, null, stats.totalTxProcessed, apiTotalCount, true);
          break;
        }
      } else {
        duplicateDetected = 0; // Reset if we found new txs
      }

      // Add all hashes to seen set
      batchHashes.forEach(hash => stats.seenTxHashes.add(hash));

      // Filter transactions: only skip those before deploy block
      // We now include failed transactions to match Routescan count
      const validTransactions = response.items.filter((tx) => {
        // Skip transactions before contract was deployed
        if (tx.blockNumber < deployBlock) {
          skippedBeforeDeployBlock++;
          return false;
        }
        return true;
      });

      if (validTransactions.length > 0) {
        // Fetch input data from RPC for all transactions (load balanced across multiple RPCs)
        const txHashes = validTransactions.map(tx => tx.txHash);
        const inputDataMap = await fetchInputDataFromRpc(txHashes);

        const txDetails = validTransactions.map((tx) => {
          const detail = transformToTransactionDetail(tx, address);
          // Add input data from RPC if available
          const rpcInput = inputDataMap.get(tx.txHash.toLowerCase());
          if (rpcInput) {
            detail.input_data = rpcInput;
          }
          return detail;
        });

        // Insert detailed tx data directly (no more wallet_interactions table)
        await insertTransactionDetails(txDetails);

        stats.totalTxProcessed += txDetails.length;
        logStats(name, txDetails.length, stats, apiTotalCount);
      }

      // Safety check: if we've indexed way more than the API says exists, something is wrong
      if (stats.totalTxProcessed > apiTotalCount * 1.1 && apiTotalCount > 0) {
        console.log(`\n⚠️ WARNING: Indexed ${stats.totalTxProcessed} txs but API reports only ${apiTotalCount}. Possible loop detected.`);
        console.log(`Marking as complete to prevent infinite loop.`);
        await updateCursorProgress(address, null, stats.totalTxProcessed, apiTotalCount, true);
        break;
      }

      // Check if we have more pages
      if (!response.link.nextToken) {
        console.log(`\n✓ Reached end of transaction history!`);
        await updateCursorProgress(address, null, stats.totalTxProcessed, apiTotalCount, true);
        break;
      }

      // Save progress and continue
      nextToken = response.link.nextToken;
      await updateCursorProgress(address, nextToken, stats.totalTxProcessed, apiTotalCount, false);

      // Rate limiting: 2 requests per second
      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      consecutiveErrors++;
      console.error(`[Page ${pageCount}] Error:`, err);

      if (consecutiveErrors >= 5) {
        console.error(`Too many consecutive errors. Stopping. Progress saved.`);
        break;
      }

      // Exponential backoff on errors
      const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
      console.log(`Retrying in ${backoffMs / 1000}s...`);
      await sleep(backoffMs);
    }
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n========================================`);
  console.log(`${name} TX indexing summary:`);
  console.log(`  Total indexed: ${stats.totalTxProcessed}`);
  console.log(`  Skipped (before deploy block ${deployBlock}): ${skippedBeforeDeployBlock}`);
  console.log(`  Time elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  Average speed: ${(stats.totalTxProcessed / elapsed).toFixed(1)} tx/sec`);
  console.log(`  Pages fetched: ${pageCount}`);
  console.log(`========================================\n`);
}

// Reset cursor to re-index from scratch
export async function resetTxCursor(contractAddress: string): Promise<void> {
  await ensureCursorTable();
  await pool.query(
    `UPDATE tx_indexer_cursors 
     SET last_next_token = NULL, total_indexed = 0, api_total_count = 0, is_complete = FALSE, updated_at = NOW()
     WHERE contract_address = $1`,
    [contractAddress.toLowerCase()]
  );
  console.log(`TX cursor reset for ${contractAddress}`);
}

// Check cursor status
export async function getTxCursorStatus(contractAddress: string): Promise<TxIndexerCursor | null> {
  await ensureCursorTable();
  const result = await pool.query(
    'SELECT * FROM tx_indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
  return result.rows[0] || null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


// Check if a transaction already exists in the database
async function txExists(txHash: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT 1 FROM transaction_details WHERE tx_hash = $1 LIMIT 1',
    [txHash]
  );
  return result.rows.length > 0;
}

// Poll for new transactions (real-time mode)
// Paginates through newest txs until it hits an already-indexed transaction
export async function pollNewTransactions(contract: ContractConfig): Promise<number> {
  const { address, name, deployBlock } = contract;
  let newTxCount = 0;
  let nextToken: string | undefined;
  let pageCount = 0;
  const MAX_PAGES = 20; // Safety limit to prevent infinite loops

  try {
    while (pageCount < MAX_PAGES) {
      pageCount++;

      // Fetch newest transactions first (sort=desc)
      const response = await fetchRoutescanPage(address, nextToken, 'desc');

      if (response.items.length === 0) {
        break;
      }

      // Filter by deploy block only - include failed transactions
      const validTransactions = response.items.filter(
        (tx) => tx.blockNumber >= deployBlock
      );

      if (validTransactions.length === 0) {
        // No valid txs on this page, check next page
        if (response.link.nextToken) {
          nextToken = response.link.nextToken;
          await sleep(REQUEST_DELAY_MS);
          continue;
        }
        break;
      }

      // Check which transactions are new (not in DB)
      const newTransactions: RoutescanTransaction[] = [];
      let foundExisting = false;

      for (const tx of validTransactions) {
        const exists = await txExists(tx.txHash);
        if (exists) {
          // Found an existing tx - we've caught up!
          foundExisting = true;
          break;
        }
        newTransactions.push(tx);
      }

      // Insert new transactions
      if (newTransactions.length > 0) {
        // Fetch input data from RPC (load balanced across multiple RPCs)
        const txHashes = newTransactions.map(tx => tx.txHash);
        const inputDataMap = await fetchInputDataFromRpc(txHashes);

        const txDetails = newTransactions.map((tx) => {
          const detail = transformToTransactionDetail(tx, address);
          // Add input data from RPC if available
          const rpcInput = inputDataMap.get(tx.txHash.toLowerCase());
          if (rpcInput) {
            detail.input_data = rpcInput;
          }
          return detail;
        });

        // Insert detailed tx data directly (no more wallet_interactions table)
        await insertTransactionDetails(txDetails);

        newTxCount += newTransactions.length;
      }

      // If we found an existing tx, we've caught up - stop paginating
      if (foundExisting) {
        break;
      }

      // If no more pages, stop
      if (!response.link.nextToken) {
        break;
      }

      // Continue to next page
      nextToken = response.link.nextToken;
      await sleep(REQUEST_DELAY_MS);
    }

    if (newTxCount > 0) {
      console.log(`  [${name}] Polled ${newTxCount} new transactions (${pageCount} pages)`);
    }
  } catch (err) {
    console.error(`[${name}] Poll error:`, err);
  }

  return newTxCount;
}
