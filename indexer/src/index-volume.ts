/**
 * Volume Indexer Entry Point
 * 
 * Run with: npx tsx src/index-volume.ts
 * 
 * This indexes contracts that need USD volume tracking using:
 * - eth_getLogs to find blocks with activity
 * - eth_getBlockReceipts to get ALL asset transfers efficiently
 */

import { CONTRACTS_TO_INDEX } from './config.js';
import { indexContractVolume } from './volumeIndexer.js';
import { pool } from './db/index.js';

async function main() {
  console.log('='.repeat(60));
  console.log('VOLUME INDEXER');
  console.log('='.repeat(60));
  console.log('\nThis indexer captures ALL asset transfers for USD volume metrics:');
  console.log('  - Native ETH transfers');
  console.log('  - ERC20 token transfers');
  console.log('  - ERC721 NFT transfers');
  console.log('  - ERC1155 NFT transfers\n');

  // Filter to contracts that need volume indexing (fetchTransactions: true)
  const volumeContracts = CONTRACTS_TO_INDEX.filter(c => c.fetchTransactions);

  console.log(`Found ${volumeContracts.length} contracts to index for volume:\n`);
  volumeContracts.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.name} (${c.address})`);
  });
  console.log('');

  for (const contract of volumeContracts) {
    try {
      await indexContractVolume(contract);
    } catch (err) {
      console.error(`Error indexing ${contract.name}:`, err);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Volume indexing complete!');
  console.log('='.repeat(60));
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await pool.end();
  process.exit(0);
});

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Fatal error:', err);
    pool.end();
    process.exit(1);
  });
