/**
 * Standalone script to run the volume indexer BATCHER benchmark
 * Run with: npx tsx src/run-volume-benchmark-batcher.ts
 */

import { indexContractVolumeBatch, ensureBenchmarkTables, resetBenchmarkData } from './volumeIndexerBatcher.js';
import type { ContractConfig } from './config.js';

// Contracts for benchmarking
const BENCHMARK_CONTRACTS: ContractConfig[] = [
    {
        address: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
        name: 'BenchmarkContract1',
        deployBlock: 1895455,
        abi: [],
        fetchTransactions: true,
    }
];

async function main() {
    console.log('=== Volume Indexer BATCHER Benchmark ===\n');
    console.log('Database inserts ENABLED - saving to benchmark_transactions table');
    console.log('Using JSON-RPC BATCH requests for maximum efficiency\n');

    // Ensure temp benchmark table exists
    await ensureBenchmarkTables();
    console.log('✓ Benchmark tables ready\n');

    // Reset all data for a fresh start
    const contractAddresses = BENCHMARK_CONTRACTS.map(c => c.address);
    await resetBenchmarkData(contractAddresses);

    const startTime = Date.now();

    // Process all contracts
    for (const contract of BENCHMARK_CONTRACTS) {
        console.log(`\nProcessing contract: ${contract.name} (${contract.address})`);
        await indexContractVolumeBatch(contract);
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n=== Benchmark Complete ===`);
    console.log(`Total time: ${elapsed.toFixed(2)} seconds`);
    console.log(`Contracts processed: ${BENCHMARK_CONTRACTS.length}`);
}

main().catch(console.error);
