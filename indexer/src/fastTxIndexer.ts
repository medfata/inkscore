import { type ContractConfig } from './config.js';
import { insertTransactionDetails, type TransactionDetail } from './db/transactions.js';
import { insertInteractions, type Interaction } from './db/interactions.js';
import { pool } from './db/index.js';

const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = `https://cdn-canary.routescan.io/api/evm/${INK_CHAIN_ID}/transactions`;
const PAGE_LIMIT = 50;
const REQUEST_DELAY_MS = 500; // 2 requests per second to be safe

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

interface TxIndexerCursor {
  id: number;
  contract_address: string;
  last_next_token: string | null;
  total_indexed: number;
  is_complete: boolean;
}

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
    sort,
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
    input_data: null,
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
    CREATE TABLE IF NOT EXISTS fast_tx_indexer_cursors (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) UNIQUE NOT NULL,
      last_next_token TEXT,
      total_indexed BIGINT NOT NULL DEFAULT 0,
      is_complete BOOLEAN DEFAULT false,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getCursor(contractAddress: string): Promise<TxIndexerCursor | null> {
  const result = await pool.query<TxIndexerCursor>(
    'SELECT * FROM fast_tx_indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
  return result.rows[0] || null;
}

async function updateCursor(
  contractAddress: string,
  nextToken: string | null,
  txCount: number,
  isComplete: boolean
): Promise<void> {
  await pool.query(
    `INSERT INTO fast_tx_indexer_cursors (contract_address, last_next_token, total_indexed, is_complete, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (contract_address)
     DO UPDATE SET
       last_next_token = $2,
       total_indexed = fast_tx_indexer_cursors.total_indexed + $3,
       is_complete = $4,
       updated_at = NOW()`,
    [contractAddress.toLowerCase(), nextToken, txCount, isComplete]
  );
}

export async function indexContractTransactionsFast(contract: ContractConfig): Promise<void> {
  await ensureCursorTable();

  const contractAddress = contract.address.toLowerCase();

  console.log('========================================');
  console.log(`Fast TX Indexing ${contract.name} (${contract.address})`);
  console.log(`Deploy block: ${contract.deployBlock} | Chain: Ink (${INK_CHAIN_ID})`);
  console.log(`Using Routescan API (rate limit: 2 req/sec)`);
  console.log('========================================\n');

  let cursor = await getCursor(contractAddress);
  let nextToken = cursor?.last_next_token || undefined;

  // Get total count from first request
  const firstPage = await fetchRoutescanPage(contractAddress, nextToken);
  const apiTotalCount = firstPage.count;

  console.log(`  Total transactions to index: ${apiTotalCount}\n`);

  totalTxProcessed = cursor?.total_indexed || 0;
  startTime = Date.now();

  // Process first page
  const transactions: TransactionDetail[] = [];
  const interactions: Interaction[] = [];

  for (const tx of firstPage.items) {
    const txDetail = transformToTransactionDetail(tx, contractAddress);
    transactions.push(txDetail);

    const interaction: Interaction = {
      wallet_address: tx.from.id,
      contract_address: contractAddress.toLowerCase(),
      function_selector: tx.methodId || '0x',
      function_name: tx.method ? tx.method.split('(')[0] : null,
      tx_hash: tx.txHash,
      block_number: tx.blockNumber,
      block_timestamp: new Date(tx.timestamp),
    };

    interactions.push(interaction);
  }

  if (transactions.length > 0) {
    await insertTransactionDetails(transactions);
    await insertInteractions(interactions);
  }

  totalTxProcessed += firstPage.items.length;
  nextToken = firstPage.link.nextToken;

  await updateCursor(contractAddress, nextToken || null, firstPage.items.length, !nextToken);
  logStats(contract.name, firstPage.items.length, apiTotalCount);

  // Process remaining pages sequentially
  while (nextToken) {
    try {
      const page = await fetchRoutescanPage(contractAddress, nextToken);
      
      const batchTransactions: TransactionDetail[] = [];
      const batchInteractions: Interaction[] = [];

      for (const tx of page.items) {
        const txDetail = transformToTransactionDetail(tx, contractAddress);
        batchTransactions.push(txDetail);

        const interaction: Interaction = {
          wallet_address: tx.from.id,
          contract_address: contractAddress.toLowerCase(),
          function_selector: tx.methodId || '0x',
          function_name: tx.method ? tx.method.split('(')[0] : null,
          tx_hash: tx.txHash,
          block_number: tx.blockNumber,
          block_timestamp: new Date(tx.timestamp),
        };

        batchInteractions.push(interaction);
      }

      if (batchTransactions.length > 0) {
        await insertTransactionDetails(batchTransactions);
        await insertInteractions(batchInteractions);
      }

      totalTxProcessed += page.items.length;
      nextToken = page.link.nextToken || undefined;

      await updateCursor(contractAddress, nextToken || null, page.items.length, !nextToken);
      logStats(contract.name, page.items.length, apiTotalCount);

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

    } catch (error) {
      console.error(`  [${contract.name}] Error fetching page:`, error);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n  [${contract.name}] ✅ Indexing complete! Total: ${totalTxProcessed} transactions\n`);
}

export async function pollNewTransactionsFast(contract: ContractConfig): Promise<void> {
  const contractAddress = contract.address.toLowerCase();

  try {
    // Fetch latest transactions (desc order for polling)
    const response = await fetchRoutescanPage(contractAddress, undefined, 'desc');

    if (response.items.length === 0) return;

    const transactions: TransactionDetail[] = [];
    const interactions: Interaction[] = [];

    for (const tx of response.items) {
      const txDetail = transformToTransactionDetail(tx, contractAddress);
      transactions.push(txDetail);

      const interaction: Interaction = {
        wallet_address: tx.from.id,
        contract_address: contractAddress.toLowerCase(),
        function_selector: tx.methodId || '0x',
        function_name: tx.method ? tx.method.split('(')[0] : null,
        tx_hash: tx.txHash,
        block_number: tx.blockNumber,
        block_timestamp: new Date(tx.timestamp),
      };

      interactions.push(interaction);
    }

    if (transactions.length > 0) {
      await insertTransactionDetails(transactions);
      await insertInteractions(interactions);
      console.log(`  [${contract.name}] +${transactions.length} new txs`);
    }
  } catch (err) {
    console.error(`  [${contract.name}] Polling error:`, err);
  }
}

export async function resetFastTxCursor(contractAddress: string): Promise<void> {
  await pool.query('DELETE FROM fast_tx_indexer_cursors WHERE contract_address = $1', [
    contractAddress.toLowerCase(),
  ]);
  console.log(`Reset Fast TX cursor for ${contractAddress}`);
}
