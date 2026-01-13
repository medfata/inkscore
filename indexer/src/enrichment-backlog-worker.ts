import 'dotenv/config';
import { pool } from './db/index.js';
import { VolumeEnrichmentService } from './services/VolumeEnrichmentService.js';

/**
 * Enrichment Backlog Worker
 * 
 * Dedicated worker process for enriching a single contract with large backlog.
 * Spawned by MultiNodeEnrichmentService for contracts with 100+ pending transactions.
 * 
 * Usage: node enrichment-backlog-worker.js --contract-id=123 --contract-address=0x... --contract-name="Contract Name"
 */

interface WorkerArgs {
    contractId: number;
    contractAddress: string;
    contractName: string;
}

function parseArgs(): WorkerArgs {
    const args = process.argv.slice(2);
    const parsed: Partial<WorkerArgs> = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--contract-id=')) {
            parsed.contractId = parseInt(arg.split('=')[1]);
        } else if (arg.startsWith('--contract-address=')) {
            parsed.contractAddress = arg.split('=')[1];
        } else if (arg.startsWith('--contract-name=')) {
            // Handle contract names with spaces and special characters
            parsed.contractName = arg.substring('--contract-name='.length);
        }
    }

    if (!parsed.contractId || !parsed.contractAddress || !parsed.contractName) {
        console.error('❌ Missing required arguments');
        console.error('Usage: node enrichment-backlog-worker.js --contract-id=123 --contract-address=0x... --contract-name="Contract Name"');
        console.error('Received args:', process.argv.slice(2));
        process.exit(1);
    }

    return parsed as WorkerArgs;
}

async function main() {
    const { contractId, contractAddress, contractName } = parseArgs();

    console.log(`🔄 [WORKER] Starting backlog worker for ${contractName}`);
    console.log(`📍 [WORKER] Contract ID: ${contractId}`);
    console.log(`📍 [WORKER] Address: ${contractAddress}`);

    // Check environment
    if (!process.env.DATABASE_URL) {
        console.error('❌ [WORKER] DATABASE_URL environment variable is required');
        process.exit(1);
    }

    let service: VolumeEnrichmentService | null = null;
    let isShuttingDown = false;

    try {
        // Test database connection
        await pool.query('SELECT 1');
        console.log('✅ [WORKER] Database connected');

        // Get initial stats
        const initialStats = await getContractStats(contractAddress);
        console.log(`📊 [WORKER] Initial: ${initialStats.enriched}/${initialStats.total} enriched (${initialStats.pending} pending)`);

        if (initialStats.pending === 0) {
            console.log('✅ [WORKER] No pending transactions, exiting');
            process.exit(0);
        }

        // Create service and start enrichment
        service = new VolumeEnrichmentService();
        const startTime = Date.now();

        // Setup graceful shutdown
        const shutdown = async (signal: string) => {
            if (isShuttingDown) return;
            isShuttingDown = true;

            console.log(`\n🛑 [WORKER] Received ${signal}, shutting down...`);

            if (service) {
                await service.stop();
            }
            await pool.end();

            const runtime = (Date.now() - startTime) / 1000;
            console.log(`⏱️  [WORKER] Runtime: ${runtime.toFixed(1)}s`);
            process.exit(0);
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));

        // Start continuous enrichment for this contract
        console.log('🚀 [WORKER] Starting continuous enrichment...');
        await enrichContractContinuously(service, contractId, contractAddress, contractName, startTime);

        // If we reach here, enrichment is complete
        const finalStats = await getContractStats(contractAddress);
        const totalTime = (Date.now() - startTime) / 1000;
        const processed = finalStats.enriched - initialStats.enriched;

        console.log('');
        console.log('═══════════════════════════════════════');
        console.log('✅ [WORKER] Backlog Processing Complete');
        console.log('═══════════════════════════════════════');
        console.log(`   Contract: ${contractName}`);
        console.log(`   Processed: ${processed} transactions`);
        console.log(`   Final: ${finalStats.enriched}/${finalStats.total} enriched`);
        console.log(`   Duration: ${totalTime.toFixed(1)}s`);
        if (processed > 0) {
            console.log(`   Rate: ${(processed / totalTime).toFixed(1)} tx/s`);
        }
        console.log('═══════════════════════════════════════');

        process.exit(0);

    } catch (error) {
        console.error('❌ [WORKER] Fatal error:', error instanceof Error ? error.message : error);
        process.exit(1);
    } finally {
        if (service && !isShuttingDown) {
            await service.stop();
        }
        if (!isShuttingDown) {
            await pool.end();
        }
    }
}

/**
 * Continuously enrich a single contract until all transactions are processed
 */
async function enrichContractContinuously(
    service: VolumeEnrichmentService,
    contractId: number,
    contractAddress: string,
    contractName: string,
    startTime: number
): Promise<void> {
    let totalProcessed = 0;
    let cycleCount = 0;

    while (true) {
        cycleCount++;
        const cycleStart = Date.now();

        // Check if there are still pending transactions
        const stats = await getContractStats(contractAddress);

        if (stats.pending === 0) {
            console.log('✅ [WORKER] All transactions enriched!');
            break;
        }

        // DEPRECATED: enrichVolumeContract method removed from streamlined service
        // Use the concurrent gap enrichment script instead
        console.log(`⚠️  [BACKLOG-WORKER] This worker is deprecated. Use concurrent gap enrichment script instead.`);
        console.log(`   Run: npm run concurrent-enrich -- --contract=${contractAddress}`);
        break;

        // If no progress was made, wait a bit before retrying
        // if (processed === 0) {
        //     console.log('⏳ [WORKER] No progress, waiting 5s before retry...');
        //     await new Promise(resolve => setTimeout(resolve, 5000));
        // }

        // Small delay between cycles to prevent overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

/**
 * Get contract enrichment statistics
 */
async function getContractStats(contractAddress: string): Promise<{
    total: number;
    enriched: number;
    pending: number;
}> {
    const result = await pool.query(`
    SELECT 
      (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) as total,
      (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as enriched
  `, [contractAddress]);

    const { total, enriched } = result.rows[0];
    const totalNum = parseInt(total) || 0;
    const enrichedNum = parseInt(enriched) || 0;

    return {
        total: totalNum,
        enriched: enrichedNum,
        pending: totalNum - enrichedNum
    };
}

main().catch(error => {
    console.error('💥 [WORKER] Fatal error:', error);
    process.exit(1);
});