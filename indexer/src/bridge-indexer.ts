import { BRIDGE_HOT_WALLETS, type BridgeHotWallet } from './config.js';
import { insertBridgeTransfers, type BridgeTransfer } from './db/bridge-transfers.js';
import { pool } from './db/index.js';

// Routescan API configuration
const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn-canary.routescan.io/api/evm/all/transactions';
const PAGE_LIMIT = 50;
const REQUEST_DELAY_MS = 500; // 2 requests per second max

interface RoutescanTransaction {
  chainId: string;
  blockNumber: number;
  timestamp: string;
  from: { id: string };
  to: { id: string };
  txHash: string;
  value: string;
  methodId?: string;
  status: boolean;
}

interface RoutescanResponse {
  items: RoutescanTransaction[];
  count: number;
  link: {
    nextToken?: string;
  };
}

// Stats tracking
let totalTransfersProcessed = 0;
let startTime = Date.now();

function logProgress(platform: string, batchCount: number, total: number, apiTotal: number) {
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? (total / elapsed).toFixed(1) : '0';
  const progress = apiTotal > 0 ? ((total / apiTotal) * 100).toFixed(1) : '0';
  console.log(`  [${platform}] +${batchCount} | Total: ${total} | ${rate}/sec | ~${progress}%`);
}

async function fetchRoutescanPage(
  walletAddress: string,
  nextToken?: string,
  sort: 'asc' | 'desc' = 'asc'
): Promise<RoutescanResponse> {
  const params = new URLSearchParams({
    fromAddresses: walletAddress,
    includedChainIds: INK_CHAIN_ID,
    ecosystem: 'all',
    count: 'true',
    limit: PAGE_LIMIT.toString(),
    sort,
  });

  if (nextToken) {
    params.append('next', nextToken);
  }

  const url = `${ROUTESCAN_BASE_URL}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Routescan API error: ${response.status}`);
  }

  return response.json() as Promise<RoutescanResponse>;
}

// Cursor management
async function ensureBridgeCursorTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bridge_indexer_cursors (
      id SERIAL PRIMARY KEY,
      wallet_address VARCHAR(42) UNIQUE NOT NULL,
      platform VARCHAR(50) NOT NULL,
      last_next_token TEXT,
      total_indexed INTEGER DEFAULT 0,
      is_complete BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getCursor(walletAddress: string, platform: string) {
  await ensureBridgeCursorTable();

  const result = await pool.query(
    'SELECT * FROM bridge_indexer_cursors WHERE wallet_address = $1',
    [walletAddress.toLowerCase()]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const insertResult = await pool.query(
    `INSERT INTO bridge_indexer_cursors (wallet_address, platform, total_indexed, is_complete)
     VALUES ($1, $2, 0, FALSE) RETURNING *`,
    [walletAddress.toLowerCase(), platform]
  );

  return insertResult.rows[0];
}

async function updateCursor(
  walletAddress: string,
  nextToken: string | null,
  totalIndexed: number,
  isComplete: boolean
): Promise<void> {
  await pool.query(
    `UPDATE bridge_indexer_cursors 
     SET last_next_token = $1, total_indexed = $2, is_complete = $3, updated_at = NOW()
     WHERE wallet_address = $4`,
    [nextToken, totalIndexed, isComplete, walletAddress.toLowerCase()]
  );
}

export async function indexBridgeWallet(wallet: BridgeHotWallet): Promise<void> {
  const { platform, walletAddress } = wallet;

  console.log(`\n========================================`);
  console.log(`Indexing Bridge: ${platform}`);
  console.log(`Hot Wallet: ${walletAddress}`);
  console.log(`Using Routescan API`);
  console.log(`========================================\n`);

  const cursor = await getCursor(walletAddress, platform);

  if (cursor.is_complete) {
    console.log(`${platform} bridge indexing already complete! (${cursor.total_indexed} transfers)`);
    return;
  }

  startTime = Date.now();
  let localTotal = cursor.total_indexed || 0;
  let nextToken = cursor.last_next_token || undefined;
  let apiTotalCount = 0;
  let consecutiveErrors = 0;

  if (localTotal > 0) {
    console.log(`Resuming from ${localTotal} previously indexed transfers\n`);
  }

  while (true) {
    try {
      const response = await fetchRoutescanPage(walletAddress, nextToken);
      apiTotalCount = response.count;
      consecutiveErrors = 0;

      if (response.items.length === 0) {
        console.log(`\n✓ No more transfers to index.`);
        await updateCursor(walletAddress, null, localTotal, true);
        break;
      }

      // Filter: only successful transactions with value > 0
      const validTxs = response.items.filter(
        (tx) => tx.status && tx.value && BigInt(tx.value) > 0n && tx.to?.id
      );

      if (validTxs.length > 0) {
        const transfers: BridgeTransfer[] = validTxs.map((tx) => {
          // Determine sub-platform based on method selector
          let subPlatform: string | undefined;
          if (wallet.methodSelectors && tx.methodId) {
            const match = wallet.methodSelectors.find((m) => m.selector === tx.methodId);
            subPlatform = match?.subPlatform;
          }

          // Convert wei to ETH
          const ethValue = (Number(BigInt(tx.value)) / 1e18).toString();

          return {
            tx_hash: tx.txHash,
            from_address: tx.from.id,
            to_address: tx.to.id,
            platform: wallet.platform,
            sub_platform: subPlatform,
            method_selector: tx.methodId || undefined,
            eth_value: ethValue,
            block_number: tx.blockNumber,
            block_timestamp: new Date(tx.timestamp),
          };
        });

        await insertBridgeTransfers(transfers);
        localTotal += transfers.length;
        totalTransfersProcessed += transfers.length;
        logProgress(platform, transfers.length, localTotal, apiTotalCount);
      }

      // Check for more pages
      if (!response.link.nextToken) {
        console.log(`\n✓ Reached end of transfer history!`);
        await updateCursor(walletAddress, null, localTotal, true);
        break;
      }

      nextToken = response.link.nextToken;
      await updateCursor(walletAddress, nextToken, localTotal, false);
      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      consecutiveErrors++;
      console.error(`[${platform}] Error:`, err);

      if (consecutiveErrors >= 5) {
        console.error(`Too many errors. Progress saved.`);
        break;
      }

      const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
      console.log(`Retrying in ${backoffMs / 1000}s...`);
      await sleep(backoffMs);
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n${platform} summary: ${localTotal} transfers in ${elapsed.toFixed(1)}s\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBridgeIndexer(): Promise<void> {
  console.log('Starting Bridge Transfers Indexer...');
  console.log(`Tracking ${BRIDGE_HOT_WALLETS.length} bridge platforms\n`);

  totalTransfersProcessed = 0;

  for (const wallet of BRIDGE_HOT_WALLETS) {
    try {
      await indexBridgeWallet(wallet);
    } catch (err) {
      console.error(`Error indexing ${wallet.platform}:`, err);
    }
  }

  console.log(`\n========================================`);
  console.log(`Bridge indexing complete!`);
  console.log(`Total transfers: ${totalTransfersProcessed}`);
  console.log(`========================================\n`);
}

// Poll for new bridge transfers (real-time mode)
export async function pollBridgeTransfers(wallet: BridgeHotWallet): Promise<number> {
  const { platform, walletAddress } = wallet;
  let newCount = 0;
  let nextToken: string | undefined;
  const MAX_PAGES = 10;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await fetchRoutescanPage(walletAddress, nextToken, 'desc');

      if (response.items.length === 0) break;

      const validTxs = response.items.filter(
        (tx) => tx.status && tx.value && BigInt(tx.value) > 0n && tx.to?.id
      );

      if (validTxs.length === 0) {
        if (response.link.nextToken) {
          nextToken = response.link.nextToken;
          await sleep(REQUEST_DELAY_MS);
          continue;
        }
        break;
      }

      // Check if we've seen these transactions
      const newTxs: typeof validTxs = [];
      for (const tx of validTxs) {
        const exists = await pool.query(
          'SELECT 1 FROM bridge_transfers WHERE tx_hash = $1 LIMIT 1',
          [tx.txHash]
        );
        if (exists.rows.length === 0) {
          newTxs.push(tx);
        } else {
          // Found existing tx, we've caught up
          break;
        }
      }

      if (newTxs.length > 0) {
        const transfers: BridgeTransfer[] = newTxs.map((tx) => {
          let subPlatform: string | undefined;
          if (wallet.methodSelectors && tx.methodId) {
            const match = wallet.methodSelectors.find((m) => m.selector === tx.methodId);
            subPlatform = match?.subPlatform;
          }
          const ethValue = (Number(BigInt(tx.value)) / 1e18).toString();

          return {
            tx_hash: tx.txHash,
            from_address: tx.from.id,
            to_address: tx.to.id,
            platform: wallet.platform,
            sub_platform: subPlatform,
            method_selector: tx.methodId || undefined,
            eth_value: ethValue,
            block_number: tx.blockNumber,
            block_timestamp: new Date(tx.timestamp),
          };
        });

        await insertBridgeTransfers(transfers);
        newCount += transfers.length;
      }

      if (!response.link.nextToken || newTxs.length < validTxs.length) break;
      nextToken = response.link.nextToken;
      await sleep(REQUEST_DELAY_MS);
    }

    if (newCount > 0) {
      console.log(`  [${platform}] Polled ${newCount} new bridge transfers`);
    }
  } catch (err) {
    console.error(`[${platform}] Poll error:`, err);
  }

  return newCount;
}
