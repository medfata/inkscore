import { config } from './config.js';
import { runIndexer } from './indexer.js';
import { pool } from './db/index.js';

async function main() {
  console.log('Ink Chain Indexer starting...');
  console.log(`RPC: ${config.rpcUrl}`);
  console.log(`Poll interval: ${config.pollIntervalMs}ms`);

  // Initial run
  await runIndexer();

  // Poll for new blocks
  setInterval(async () => {
    try {
      await runIndexer();
    } catch (err) {
      console.error('Indexer error:', err);
    }
  }, config.pollIntervalMs);
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
