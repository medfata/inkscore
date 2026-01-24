/**
 * Indexer V2 - Database-driven contract indexing
 * 
 * This version reads contracts from the database instead of config.ts
 * Falls back to config.ts if no contracts are in the database yet
 */

import { config, CONTRACTS_TO_INDEX, BRIDGE_HOT_WALLETS } from './config.js';
import { indexContract } from './indexer.js';
import { indexContractTransactions, pollNewTransactions } from './txIndexer-v1.js';
import { runBridgeIndexer, pollBridgeTransfers } from './bridge-indexer.js';
import { pool } from './db/index.js';
import { 
  getContractsToIndex, 
  getContractsForBackfill, 
  hasContractsInDatabase,
  updateContractStatus,
  type IndexableContract 
} from './db/contracts.js';
import { getTxCursorStatus } from './txIndexer-v1.js';

/**
 * Sync progress from tx_indexer_cursors to contracts table
 * Updates all contracts with their current indexing progress
 */
async function syncContractProgressFromCursors(): Promise<void> {
  // Update all contracts with progress from cursor table
  const result = await pool.query(`
    UPDATE contracts c
    SET 
      current_block = cursor.total_indexed,
      total_blocks = cursor.total_indexed,
      progress_percent = CASE WHEN cursor.is_complete THEN 100.00 ELSE 0.00 END,
      updated_at = NOW()
    FROM tx_indexer_cursors cursor
    WHERE LOWER(c.address) = cursor.contract_address
      AND cursor.total_indexed > 0
  `);
  
  if (result.rowCount && result.rowCount > 0) {
    console.log(`  [Sync] Updated progress for ${result.rowCount} contracts`);
  }
}

// Convert database contract to config format for compatibility
function toContractConfig(contract: IndexableContract) {
  return {
    address: contract.address as `0x${string}`,
    name: contract.name,
    deployBlock: contract.deploy_block,
    fetchTransactions: contract.fetch_transactions,
    abi: [], // ABI not needed for Routerscan-based indexing
  };
}

/**
 * Index multiple contracts in parallel with a concurrency limit
 */
async function indexContractsInParallel(contracts: IndexableContract[], concurrencyLimit: number): Promise<void> {
  const queue = [...contracts];
  const active: Promise<void>[] = [];
  
  async function processContract(contract: IndexableContract): Promise<void> {
    try {
      await updateContractStatus(contract.address, 'indexing');
      await indexContractTransactions(toContractConfig(contract));
      
      const cursor = await getTxCursorStatus(contract.address);
      const totalIndexed = cursor?.total_indexed || 0;
      await updateContractStatus(contract.address, 'complete', totalIndexed, totalIndexed);
    } catch (err) {
      console.error(`TX Indexer error for ${contract.name}:`, err);
      await updateContractStatus(contract.address, 'error', undefined, undefined, String(err));
    }
  }
  
  while (queue.length > 0 || active.length > 0) {
    // Start new tasks up to the concurrency limit
    while (active.length < concurrencyLimit && queue.length > 0) {
      const contract = queue.shift()!;
      const promise = processContract(contract).then(() => {
        // Remove from active when done
        const index = active.indexOf(promise);
        if (index > -1) active.splice(index, 1);
      });
      active.push(promise);
    }
    
    // Wait for at least one to complete before continuing
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

async function main() {
  console.log('Ink Chain Indexer V2 starting...');
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);

  // Check if we should use database contracts or fall back to config.ts
  const useDatabase = await hasContractsInDatabase();
  
  if (useDatabase) {
    console.log('\n=== Using Database-Driven Contract Configuration ===\n');
    await runDatabaseDrivenIndexer();
  } else {
    console.log('\n=== Using Static Config (no contracts in database yet) ===\n');
    console.log('Run migration 006_platforms_points_system.sql to enable database-driven indexing\n');
    await runLegacyIndexer();
  }
}

/**
 * Database-driven indexer - reads contracts from DB
 */
async function runDatabaseDrivenIndexer() {
  // Get contracts from database
  const allContracts = await getContractsToIndex();
  const contractsForBackfill = await getContractsForBackfill();
  
  // Separate by indexing method
  const eventContracts = contractsForBackfill.filter(c => !c.fetch_transactions);
  const txContracts = contractsForBackfill.filter(c => c.fetch_transactions);

  console.log(`Total contracts in database: ${allContracts.length}`);
  console.log(`Contracts needing backfill: ${contractsForBackfill.length}`);
  console.log(`  - Event-based (RPC): ${eventContracts.length}`);
  console.log(`  - Transaction-based (Routerscan): ${txContracts.length}\n`);

  // Sync progress from tx_indexer_cursors to contracts table for any contracts
  // that are marked complete but have 0% progress (legacy data)
  console.log('Syncing contract progress from indexer cursors...');
  await syncContractProgressFromCursors();


  // 1. Index event-based contracts via RPC
  if (eventContracts.length > 0) {
    console.log('=== Starting Event-Based Indexing (RPC) ===\n');
    for (const contract of eventContracts) {
      try {
        await updateContractStatus(contract.address, 'indexing');
        await indexContract(toContractConfig(contract));
        await updateContractStatus(contract.address, 'complete');
      } catch (err) {
        console.error(`Event Indexer error for ${contract.name}:`, err);
        await updateContractStatus(contract.address, 'error', undefined, undefined, String(err));
      }
    }
  }

  // 2. Index transaction-based contracts via Routerscan API - PARALLEL
  if (txContracts.length > 0) {
    const PARALLEL_LIMIT = 3; // Index 3 contracts simultaneously
    console.log(`\n=== Starting PARALLEL Transaction Indexing (${PARALLEL_LIMIT} concurrent) for ${txContracts.length} contracts ===\n`);
    
    // Process contracts in parallel batches
    await indexContractsInParallel(txContracts, PARALLEL_LIMIT);
  }

  // 3. Index bridge transfers
  if (BRIDGE_HOT_WALLETS.length > 0) {
    console.log(`\n=== Starting Bridge Transfers Indexing for ${BRIDGE_HOT_WALLETS.length} platforms ===\n`);
    try {
      await runBridgeIndexer();
    } catch (err) {
      console.error('Bridge Indexer error:', err);
    }
  }

  console.log('\nBackfill complete! Switching to polling mode (15s)...\n');

  // Polling for real-time updates
  const REALTIME_POLL_MS = 15000;
  let pollCount = 0;

  setInterval(async () => {
    try {
      pollCount++;

      // Refresh contract list from database (in case admin added new ones)
      const allContracts = await getContractsToIndex();
      const contractsForBackfill = await getContractsForBackfill();

      // Check if there are new contracts that need backfill - run in parallel
      if (contractsForBackfill.length > 0) {
        console.log(`\n[Poll ${pollCount}] Found ${contractsForBackfill.length} new contracts needing backfill...`);
        
        const txContractsToBackfill = contractsForBackfill.filter(c => c.fetch_transactions);
        const eventContractsToBackfill = contractsForBackfill.filter(c => !c.fetch_transactions);
        
        // Index event contracts sequentially (usually fast)
        for (const contract of eventContractsToBackfill) {
          try {
            await updateContractStatus(contract.address, 'indexing');
            await indexContract(toContractConfig(contract));
            await updateContractStatus(contract.address, 'complete');
          } catch (err) {
            console.error(`Event Indexer error for ${contract.name}:`, err);
            await updateContractStatus(contract.address, 'error', undefined, undefined, String(err));
          }
        }
        
        // Index tx contracts in parallel
        if (txContractsToBackfill.length > 0) {
          await indexContractsInParallel(txContractsToBackfill, 3);
        }
      }

      // Sync progress from cursors every 10 polls (~2.5 minutes)
      if (pollCount % 10 === 0) {
        await syncContractProgressFromCursors();
      }

      // Poll for new transactions on completed contracts
      const completedContracts = allContracts.filter(c => c.indexing_status === 'complete');
      const eventContracts = completedContracts.filter(c => !c.fetch_transactions);
      const txContracts = completedContracts.filter(c => c.fetch_transactions);

      // Poll event-based contracts via RPC
      for (const contract of eventContracts) {
        await indexContract(toContractConfig(contract));
      }

      // Poll transaction-based contracts via Routerscan
      for (const contract of txContracts) {
        await pollNewTransactions(toContractConfig(contract));
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

/**
 * Legacy indexer - uses static config.ts
 */
async function runLegacyIndexer() {
  // Separate contracts by indexing method
  const eventContracts = CONTRACTS_TO_INDEX.filter((c) => !c.fetchTransactions);
  const txContracts = CONTRACTS_TO_INDEX.filter((c) => c.fetchTransactions);

  console.log(`Event-based contracts: ${eventContracts.length}`);
  console.log(`Transaction-based contracts (Routescan): ${txContracts.length}\n`);

  // 1. Index event-based contracts via RPC
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

  // 2. Index transaction-based contracts via Routescan API
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

  // 3. Index bridge transfers
  if (BRIDGE_HOT_WALLETS.length > 0) {
    console.log(`\n=== Starting Bridge Transfers Indexing for ${BRIDGE_HOT_WALLETS.length} platforms ===\n`);
    try {
      await runBridgeIndexer();
    } catch (err) {
      console.error('Bridge Indexer error:', err);
    }
  }

  console.log('\nBackfill complete! Switching to polling mode (15s)...\n');

  // Polling for real-time updates
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
        await sleep(500);
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
