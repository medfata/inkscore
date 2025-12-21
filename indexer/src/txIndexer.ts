import { type ContractConfig } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { insertInteractions, type Interaction } from './db/interactions.js';
import { pool } from './db/index.js';

// Routescan API configuration - using chain-specific endpoint for Ink (57073)
const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = `https://cdn-canary.routescan.io/api/evm/${INK_CHAIN_ID}/transactions`;
const PAGE_LIMIT = 50;
const REQUEST_DELAY_MS = 250; // 4 requests per second (increased from 2)

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
  is_complete: boolean;
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

async function fetchRoutescanPage(
  contractAddress: string,
  nextToken?: string,
  sort: 'asc' | 'desc' = 'asc'
): Promise<RoutescanResponse> {
  const params = new URLSearchParams({
    fromAddresses: contractAddress,
    toAddresses: contractAddress,
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
    function_selector: tx.methodId || null,
    function_name: tx.method ? tx.method.split('(')[0] : null,
    input_data: null, // Routescan doesn't provide full input data
    eth_value: tx.value,
    gas_used: tx.gasUsed ? parseInt(tx.gasUsed, 10) : null,
    gas_price: tx.gasPrice,
    block_number: tx.blockNumber,
    block_timestamp: new Date(tx.timestamp),
    status: tx.status ? 1 : 0,
  };
}

async function ensureCursorTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tx_indexer_cursors (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) UNIQUE NOT NULL,
      last_next_token TEXT,
      total_indexed INTEGER DEFAULT 0,
      is_complete BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
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
  isComplete: boolean
): Promise<void> {
  await pool.query(
    `UPDATE tx_indexer_cursors 
     SET last_next_token = $1, total_indexed = $2, is_complete = $3, updated_at = NOW()
     WHERE contract_address = $4`,
    [nextToken, totalIndexed, isComplete, contractAddress.toLowerCase()]
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

  startTime = Date.now();
  totalTxProcessed = cursor.total_indexed;

  let nextToken = cursor.last_next_token || undefined;
  let pageCount = 0;
  let apiTotalCount = 0;
  let consecutiveErrors = 0;
  let skippedBeforeDeployBlock = 0;

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
        await updateCursorProgress(address, null, totalTxProcessed, true);
        break;
      }

      // Filter transactions:
      // 1. Must be at or after deploy block
      // 2. Must be successful (status = true)
      const validTransactions = response.items.filter((tx) => {
        // Skip transactions before contract was deployed
        if (tx.blockNumber < deployBlock) {
          skippedBeforeDeployBlock++;
          return false;
        }
        // Skip failed transactions
        if (!tx.status) {
          return false;
        }
        return true;
      });

      if (validTransactions.length > 0) {
        const txDetails = validTransactions.map((tx) => transformToTransactionDetail(tx, address));

        // Insert into wallet_interactions first (parent table)
        const interactions: Interaction[] = txDetails.map((tx) => ({
          wallet_address: tx.wallet_address,
          contract_address: tx.contract_address,
          function_selector: tx.function_selector || '0x',
          function_name: tx.function_name,
          tx_hash: tx.tx_hash,
          block_number: tx.block_number,
          block_timestamp: tx.block_timestamp,
        }));
        await insertInteractions(interactions);

        // Then insert detailed tx data (child table)
        await insertTransactionDetails(txDetails);

        totalTxProcessed += txDetails.length;
        logStats(name, txDetails.length, apiTotalCount);
      }

      // Check if we have more pages
      if (!response.link.nextToken) {
        console.log(`\n✓ Reached end of transaction history!`);
        await updateCursorProgress(address, null, totalTxProcessed, true);
        break;
      }

      // Save progress and continue
      nextToken = response.link.nextToken;
      await updateCursorProgress(address, nextToken, totalTxProcessed, false);

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

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n========================================`);
  console.log(`${name} TX indexing summary:`);
  console.log(`  Total indexed: ${totalTxProcessed}`);
  console.log(`  Skipped (before deploy block ${deployBlock}): ${skippedBeforeDeployBlock}`);
  console.log(`  Time elapsed: ${elapsed.toFixed(1)}s`);
  console.log(`  Average speed: ${(totalTxProcessed / elapsed).toFixed(1)} tx/sec`);
  console.log(`  Pages fetched: ${pageCount}`);
  console.log(`========================================\n`);
}

// Reset cursor to re-index from scratch
export async function resetTxCursor(contractAddress: string): Promise<void> {
  await ensureCursorTable();
  await pool.query(
    `UPDATE tx_indexer_cursors 
     SET last_next_token = NULL, total_indexed = 0, is_complete = FALSE, updated_at = NOW()
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

      // Filter by deploy block and status
      const validTransactions = response.items.filter(
        (tx) => tx.blockNumber >= deployBlock && tx.status === true
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
        const txDetails = newTransactions.map((tx) => transformToTransactionDetail(tx, address));

        // Insert into wallet_interactions first (parent table)
        const interactions: Interaction[] = txDetails.map((tx) => ({
          wallet_address: tx.wallet_address,
          contract_address: tx.contract_address,
          function_selector: tx.function_selector || '0x',
          function_name: tx.function_name,
          tx_hash: tx.tx_hash,
          block_number: tx.block_number,
          block_timestamp: tx.block_timestamp,
        }));
        await insertInteractions(interactions);

        // Then insert detailed tx data (child table)
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
