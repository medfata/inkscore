import { config, CONTRACTS_TO_INDEX, BRIDGE_HOT_WALLETS } from './config.js';
import { indexContract } from './indexer.js';
import { indexContractTransactions, pollNewTransactions } from './txIndexer-v1.js';
import { runBridgeIndexer, pollBridgeTransfers } from './bridge-indexer.js';
import { pool } from './db/index.js';

// Separate contracts by indexing method
const eventContracts = CONTRACTS_TO_INDEX.filter((c) => !c.fetchTransactions);
const txContracts = CONTRACTS_TO_INDEX.filter((c) => c.fetchTransactions);

async function main() {
  console.log('Ink Chain Indexer starting...');
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`Event-based contracts: ${eventContracts.length}`);
  console.log(`Transaction-based contracts (Routescan): ${txContracts.length}\n`);

  // 1. Index event-based contracts via RPC (only contracts WITHOUT fetchTransactions)
  if (eventContracts.length > 0) {
    console.log('=== Starting Event-Based Indexing (RPC) ===\n');
    for (const contract of eventContracts) {
      try {
        await indexContract(contract);
      } catch (err) {
        console.error(`Event Indexer error for ${contract.name}:`, err);
      }
    }
  }

  // 2. Index transaction-based contracts via Routescan API (sequential due to rate limit)
  if (txContracts.length > 0) {
    console.log(`\n=== Starting Transaction Indexing (Routescan API) for ${txContracts.length} contracts ===\n`);
    for (const contract of txContracts) {
      try {
        await indexContractTransactions(contract);
      } catch (err) {
        console.error(`TX Indexer error for ${contract.name}:`, err);
      }
    }
  }

  // 3. Index bridge transfers (tracks ETH transfers FROM bridge hot wallets TO users)
  if (BRIDGE_HOT_WALLETS.length > 0) {
    console.log(`\n=== Starting Bridge Transfers Indexing for ${BRIDGE_HOT_WALLETS.length} platforms ===\n`);
    try {
      await runBridgeIndexer();
    } catch (err) {
      console.error('Bridge Indexer error:', err);
    }
  }

  console.log('\nBackfill complete! Switching to polling mode (15s)...\n');

  // Polling for real-time updates (15 seconds)
  const REALTIME_POLL_MS = 15000;

  setInterval(async () => {
    try {
      // Poll event-based contracts via RPC
      for (const contract of eventContracts) {
        await indexContract(contract);
      }

      // Poll transaction-based contracts via Routescan
      for (const contract of txContracts) {
        await pollNewTransactions(contract);
        await sleep(500); // Rate limit: 2 req/sec
      }

      // Poll bridge transfers
      for (const wallet of BRIDGE_HOT_WALLETS) {
        await pollBridgeTransfers(wallet);
        await sleep(500);
      }
    } catch (err) {
      console.error('Indexer error:', err);
    }
  }, REALTIME_POLL_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await pool.end();
  process.exit(0);
});

main().catch(console.error);
