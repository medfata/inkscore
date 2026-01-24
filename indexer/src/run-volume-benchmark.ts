/**
 * Standalone script to run the volume indexer benchmark
 * Run with: npx tsx src/run-volume-benchmark.ts
 */

import { indexContractVolume } from './volumeIndexer.js';
import type { ContractConfig } from './config.js';

// Test contract for benchmarking
const TEST_CONTRACT: ContractConfig = {
    address: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
    name: 'BenchmarkTestContract',
    deployBlock: 2761426,
    abi: [],
    fetchTransactions: true,
};

async function main() {
    console.log('=== Volume Indexer Benchmark ===\n');
    console.log('Database inserts are DISABLED - measuring pure processing throughput\n');
    console.log(`Contract: ${TEST_CONTRACT.address}`);
    console.log(`Name: ${TEST_CONTRACT.name}\n`);

    const startTime = Date.now();

    await indexContractVolume(TEST_CONTRACT);

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n=== Benchmark Complete ===`);
    console.log(`Total time: ${elapsed.toFixed(2)} seconds`);
}

main().catch(console.error);
