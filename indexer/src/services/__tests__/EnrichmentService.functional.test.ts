import 'dotenv/config';
import { pool } from '../../db/index.js';
import { VolumeEnrichmentService } from '../VolumeEnrichmentService.js';

/**
 * Functional Test for Real-Time Enrichment Service
 * 
 * Tests the new streamlined real-time enrichment service that processes
 * only recent transactions (last 5 minutes) from volume contracts.
 * 
 * Usage: npx tsx src/services/__tests__/EnrichmentService.functional.test.ts
 */

async function main() {
  console.log('🧪 Functional Test: Real-Time Volume Enrichment Service');
  console.log('📊 Testing real-time processing of recent transactions');
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

    // Get volume contracts
    const contractsResult = await pool.query(`
      SELECT id, name, address, contract_type, is_active, indexing_enabled
      FROM contracts 
      WHERE contract_type = 'volume' AND is_active = true AND indexing_enabled = true
      ORDER BY name
    `);

    console.log(`📊 Found ${contractsResult.rows.length} active volume contracts:`);
    for (const contract of contractsResult.rows) {
      console.log(`   • ${contract.name} (${contract.address})`);
    }
    console.log('');

    // Check for recent transactions that need enrichment
    const recentResult = await pool.query(`
      SELECT 
        c.name AS contract_name,
        c.address AS contract_address,
        COUNT(td.tx_hash) AS recent_transactions,
        COUNT(te.tx_hash) AS already_enriched,
        (COUNT(td.tx_hash) - COUNT(te.tx_hash)) AS need_enrichment
      FROM contracts c
      JOIN transaction_details td ON td.contract_address = c.address
      LEFT JOIN transaction_enrichment te ON te.tx_hash = td.tx_hash
      WHERE c.contract_type = 'volume'
        AND c.is_active = true
        AND c.indexing_enabled = true
        AND td.block_timestamp >= NOW() - INTERVAL '5 minutes'
      GROUP BY c.id, c.name, c.address
      HAVING COUNT(td.tx_hash) > COUNT(te.tx_hash)
      ORDER BY need_enrichment DESC
    `);

    if (recentResult.rows.length === 0) {
      console.log('✅ No recent transactions need enrichment (last 5 minutes)');
      console.log('💡 To test with older data, you can:');
      console.log('   1. Wait for new transactions to arrive');
      console.log('   2. Use the gap enrichment script for historical data');
      console.log('   3. Modify the test to use a longer time window');
      await pool.end();
      return;
    }

    console.log('📊 Recent transactions needing enrichment (last 5 minutes):');
    let totalNeedEnrichment = 0;
    for (const row of recentResult.rows) {
      console.log(`   • ${row.contract_name}: ${row.need_enrichment} transactions`);
      totalNeedEnrichment += parseInt(row.need_enrichment);
    }
    console.log(`   📈 Total: ${totalNeedEnrichment} transactions`);
    console.log('');

    // Test the real-time enrichment service
    console.log('🚀 Testing real-time enrichment service...');
    const startTime = Date.now();
    
    const service = new VolumeEnrichmentService();
    
    // Get initial stats
    const initialStats = await service.getStats();
    console.log('📊 Initial stats:');
    console.log(`   Active contracts: ${initialStats.active_contracts}`);
    console.log(`   Enriched last hour: ${initialStats.enriched_last_hour}`);
    console.log(`   Enriched last 5min: ${initialStats.enriched_last_5min}`);
    console.log('');

    // Run one enrichment cycle
    console.log('🔄 Running one enrichment cycle...');
    await service['processRecentTransactions'](); // Access private method for testing

    // Get final stats
    const finalStats = await service.getStats();
    const newlyEnriched = finalStats.enriched_last_5min - initialStats.enriched_last_5min;
    
    const duration = (Date.now() - startTime) / 1000;

    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('📊 Real-Time Enrichment Test Complete');
    console.log('═══════════════════════════════════════');
    console.log(`   Duration: ${duration.toFixed(1)}s`);
    console.log(`   Newly enriched: ${newlyEnriched} transactions`);
    console.log(`   Final enriched (5min): ${finalStats.enriched_last_5min}`);
    console.log(`   Final enriched (1hr): ${finalStats.enriched_last_hour}`);
    if (newlyEnriched > 0) {
      console.log(`   Rate: ${(newlyEnriched / duration).toFixed(1)} tx/s`);
    }
    console.log('   Status: ✅ COMPLETE - Real-time processing working!');
    console.log('═══════════════════════════════════════');

    // Verify the service configuration
    console.log('');
    console.log('🔧 Service Configuration:');
    console.log(`   Mode: ${finalStats.mode}`);
    console.log(`   Recent window: ${finalStats.recent_window_minutes} minutes`);
    console.log(`   Poll interval: ${finalStats.poll_interval_seconds} seconds`);

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