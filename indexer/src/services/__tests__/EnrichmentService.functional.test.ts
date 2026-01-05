import 'dotenv/config';
import { pool } from '../../db/index.js';
import { VolumeEnrichmentService } from '../VolumeEnrichmentService.js';

/**
 * Functional Test for Enrichment Service
 * 
 * Functional test that takes a contract_address and enriches it using the VolumeEnrichmentService.
 * Unlike the main enrichment service, this runs once and exits - no polling or chronological processing.
 * 
 * Usage: npx tsx src/services/__tests__/EnrichmentService.functional.test.ts <contract_address>
 * Example: npx tsx src/services/__tests__/EnrichmentService.functional.test.ts 0x1234567890abcdef...
 */

async function main() {
  const contractAddress = process.argv[2];

  if (!contractAddress) {
    console.error('❌ Usage: npx tsx src/services/__tests__/EnrichmentService.functional.test.ts <contract_address>');
    console.error('   Example: npx tsx src/services/__tests__/EnrichmentService.functional.test.ts 0x1234567890abcdef...');
    process.exit(1);
  }

  console.log('🧪 Functional Test: Enrichment Service');
  console.log(`📍 Contract: ${contractAddress}`);
  console.log('');

  // Check environment
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connected');

    // Find the contract by address
    const contractResult = await pool.query(`
      SELECT id, name, address, contract_type, enrichment_status, enrichment_progress
      FROM contracts 
      WHERE LOWER(address) = LOWER($1)
    `, [contractAddress]);

    if (contractResult.rows.length === 0) {
      console.error(`❌ Contract not found: ${contractAddress}`);
      await pool.end();
      process.exit(1);
    }

    const contract = contractResult.rows[0];
    console.log(`📛 Name: ${contract.name}`);
    console.log(`📊 Type: ${contract.contract_type}`);
    console.log(`📈 Status: ${contract.enrichment_status} (${contract.enrichment_progress}%)`);
    console.log('');

    // Check if it's a volume contract
    if (contract.contract_type !== 'volume') {
      console.error(`❌ Contract is not a volume contract (type: ${contract.contract_type})`);
      console.error('   Only volume contracts can be enriched');
      await pool.end();
      process.exit(1);
    }

    // Get transaction counts
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) as total_txs,
        (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as enriched_txs
    `, [contractAddress]);

    const { total_txs, enriched_txs } = statsResult.rows[0];
    const pending = parseInt(total_txs) - parseInt(enriched_txs);

    console.log(`📊 Transactions: ${enriched_txs}/${total_txs} enriched (${pending} pending)`);
    console.log('');

    if (pending === 0) {
      console.log('✅ All transactions already enriched!');
      await pool.end();
      process.exit(0);
    }

    // Run enrichment continuously until all transactions are processed
    console.log('🚀 Starting enrichment...');
    console.log('');

    const startTime = Date.now();
    const service = new VolumeEnrichmentService();
    let totalNewlyEnriched = 0;
    let cycles = 0;

    // Keep enriching until no more transactions are pending
    while (true) {
      cycles++;
      
      // Get current stats before this cycle
      const beforeResult = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) as total_txs,
          (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as enriched_txs
      `, [contractAddress]);

      const beforeStats = beforeResult.rows[0];
      const beforeEnriched = parseInt(beforeStats.enriched_txs);
      const beforePending = parseInt(beforeStats.total_txs) - beforeEnriched;

      if (beforePending === 0) {
        console.log('✅ All transactions already enriched!');
        break;
      }

      console.log(`🔄 Cycle ${cycles}: ${beforeEnriched}/${beforeStats.total_txs} enriched, ${beforePending} pending`);

      // Process one batch
      await service.enrichVolumeContract(contract.id);

      // Get stats after this cycle
      const afterResult = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) as total_txs,
          (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as enriched_txs
      `, [contractAddress]);

      const afterStats = afterResult.rows[0];
      const afterEnriched = parseInt(afterStats.enriched_txs);
      const cycleEnriched = afterEnriched - beforeEnriched;
      totalNewlyEnriched += cycleEnriched;

      const afterPending = parseInt(afterStats.total_txs) - afterEnriched;

      if (afterPending === 0) {
        console.log(`✅ Cycle ${cycles} complete: All ${afterStats.total_txs} transactions enriched!`);
        break;
      }

      if (cycleEnriched === 0) {
        console.log(`⚠️  Cycle ${cycles}: No progress made, stopping to avoid infinite loop`);
        break;
      }

      // Small delay between cycles
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const duration = (Date.now() - startTime) / 1000;

    // Get final stats
    const finalResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM transaction_details WHERE contract_address = $1) as total_txs,
        (SELECT COUNT(*) FROM transaction_enrichment WHERE contract_address = $1) as enriched_txs
    `, [contractAddress]);

    const finalStats = finalResult.rows[0];
    const newlyEnriched = totalNewlyEnriched;

    console.log('═══════════════════════════════════════');
    console.log('📊 Enrichment Test Complete');
    console.log('═══════════════════════════════════════');
    console.log(`   Contract: ${contract.name}`);
    console.log(`   Cycles: ${cycles}`);
    console.log(`   Enriched: ${newlyEnriched} transactions`);
    console.log(`   Total: ${finalStats.enriched_txs}/${finalStats.total_txs}`);
    console.log(`   Duration: ${duration.toFixed(1)}s`);
    if (newlyEnriched > 0) {
      console.log(`   Rate: ${(newlyEnriched / duration).toFixed(1)} tx/s`);
    }
    
    const finalPending = parseInt(finalStats.total_txs) - parseInt(finalStats.enriched_txs);
    if (finalPending === 0) {
      console.log('   Status: ✅ COMPLETE - All transactions enriched!');
    } else {
      console.log(`   Status: ⚠️  INCOMPLETE - ${finalPending} transactions still pending`);
    }
    console.log('═══════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});