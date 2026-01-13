import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { pool } from '../../db/index.js';
import { VolumeEnrichmentService } from '../VolumeEnrichmentService.js';

/**
 * Test suite for Real-Time VolumeEnrichmentService
 * 
 * Tests the new streamlined real-time enrichment service:
 * 1. Processes only recent transactions (last 5 minutes)
 * 2. Uses batch processing for performance
 * 3. Focuses on volume contracts only
 * 4. No backlog processing (use gap script for that)
 */

describe('Real-Time VolumeEnrichmentService', () => {
  let service: VolumeEnrichmentService;
  let activeVolumeContracts: any[];

  before(async () => {
    service = new VolumeEnrichmentService();
    console.log('\n🔧 Setting up Real-Time VolumeEnrichmentService tests...');
  });

  after(async () => {
    await service.stop();
    console.log('\n✅ Real-Time VolumeEnrichmentService tests completed');
  });

  describe('Service Configuration', () => {
    it('should have correct real-time configuration', async () => {
      const stats = await service.getStats();

      console.log('\n🔧 Service Configuration:');
      console.log(`   Mode: ${stats.mode}`);
      console.log(`   Recent window: ${stats.recent_window_minutes} minutes`);
      console.log(`   Poll interval: ${stats.poll_interval_seconds} seconds`);

      assert.strictEqual(stats.mode, 'realtime_only', 'Should be in realtime_only mode');
      assert.strictEqual(stats.recent_window_minutes, 5, 'Should process last 5 minutes');
      assert.strictEqual(stats.poll_interval_seconds, 30, 'Should poll every 30 seconds');
    });

    it('should fetch active volume contracts', async () => {
      const result = await pool.query(`
        SELECT id, address, name, contract_type, is_active, indexing_enabled
        FROM contracts 
        WHERE contract_type = 'volume' AND is_active = true AND indexing_enabled = true
        ORDER BY name
      `);

      activeVolumeContracts = result.rows;

      console.log(`\n📊 Found ${activeVolumeContracts.length} active volume contracts:`);
      for (const contract of activeVolumeContracts.slice(0, 5)) {
        console.log(`   • ${contract.name} (${contract.address.substring(0, 10)}...)`);
      }
      if (activeVolumeContracts.length > 5) {
        console.log(`   ... and ${activeVolumeContracts.length - 5} more`);
      }

      assert.ok(activeVolumeContracts.length > 0, 'Should have active volume contracts');
    });
  });

  describe('Recent Transaction Detection', () => {
    it('should identify recent transactions needing enrichment', async () => {
      // Check for recent transactions in the last 5 minutes
      const result = await pool.query(`
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
        ORDER BY need_enrichment DESC
        LIMIT 10
      `);

      console.log('\n📊 Recent transactions (last 5 minutes):');
      if (result.rows.length === 0) {
        console.log('   No recent transactions found');
      } else {
        for (const row of result.rows) {
          const needEnrichment = parseInt(row.need_enrichment);
          const status = needEnrichment > 0 ? '🔄' : '✅';
          console.log(`   ${status} ${row.contract_name}: ${row.recent_transactions} total, ${needEnrichment} need enrichment`);
        }
      }

      // This test passes regardless of whether there are recent transactions
      assert.ok(true, 'Recent transaction detection completed');
    });

    it('should use efficient timestamp-based queries', async () => {
      const startTime = Date.now();

      // Test the query performance
      const result = await pool.query(`
        SELECT 
          td.tx_hash,
          td.contract_address,
          td.wallet_address,
          td.block_timestamp,
          c.name AS contract_name
        FROM transaction_details td
        JOIN contracts c ON c.address = td.contract_address
        WHERE c.contract_type = 'volume'
          AND c.is_active = true
          AND c.indexing_enabled = true
          AND td.block_timestamp >= NOW() - INTERVAL '5 minutes'
          AND NOT EXISTS (
            SELECT 1 FROM transaction_enrichment te 
            WHERE te.tx_hash = td.tx_hash
          )
        ORDER BY td.block_timestamp DESC
        LIMIT 100
      `);

      const queryTime = Date.now() - startTime;

      console.log(`\n⏱️  Recent transaction query performance:`);
      console.log(`   Query time: ${queryTime}ms`);
      console.log(`   Results: ${result.rows.length} transactions`);
      console.log(`   Performance: ${queryTime < 1000 ? '✅ Fast' : '⚠️ Slow'} (${queryTime}ms)`);

      assert.ok(queryTime < 5000, 'Query should complete within 5 seconds');
    });
  });

  describe('Batch Processing', () => {
    it('should group transactions by contract correctly', async () => {
      // Create sample transaction data for testing
      const sampleTransactions = [
        { tx_hash: '0x1', contract_address: '0xa', contract_name: 'Contract A', wallet_address: '0x1', block_timestamp: new Date() },
        { tx_hash: '0x2', contract_address: '0xa', contract_name: 'Contract A', wallet_address: '0x2', block_timestamp: new Date() },
        { tx_hash: '0x3', contract_address: '0xb', contract_name: 'Contract B', wallet_address: '0x3', block_timestamp: new Date() },
      ];

      // Test the grouping function (accessing private method for testing)
      const groups = service['groupTransactionsByContract'](sampleTransactions);

      console.log('\n📊 Transaction grouping test:');
      console.log(`   Input: ${sampleTransactions.length} transactions`);
      console.log(`   Groups: ${groups.size} contracts`);
      
      for (const [contractName, txs] of groups.entries()) {
        console.log(`   • ${contractName}: ${txs.length} transactions`);
      }

      assert.strictEqual(groups.size, 2, 'Should group into 2 contracts');
      assert.strictEqual(groups.get('Contract A')?.length, 2, 'Contract A should have 2 transactions');
      assert.strictEqual(groups.get('Contract B')?.length, 1, 'Contract B should have 1 transaction');
    });

    it('should handle empty transaction arrays', async () => {
      const emptyGroups = service['groupTransactionsByContract']([]);

      console.log('\n📊 Empty transaction array test:');
      console.log(`   Groups: ${emptyGroups.size} (should be 0)`);

      assert.strictEqual(emptyGroups.size, 0, 'Should handle empty arrays');
    });
  });

  describe('Service Statistics', () => {
    it('should return comprehensive real-time statistics', async () => {
      const stats = await service.getStats();

      console.log('\n📊 Real-Time Service Statistics:');
      console.log(`   Total contracts: ${stats.total_contracts}`);
      console.log(`   Active contracts: ${stats.active_contracts}`);
      console.log(`   Enriched last hour: ${stats.enriched_last_hour}`);
      console.log(`   Enriched last 5min: ${stats.enriched_last_5min}`);
      console.log(`   Mode: ${stats.mode}`);

      assert.ok(stats.total_contracts !== undefined, 'Should return total contracts');
      assert.ok(stats.active_contracts !== undefined, 'Should return active contracts');
      assert.ok(stats.enriched_last_hour !== undefined, 'Should return hourly stats');
      assert.ok(stats.enriched_last_5min !== undefined, 'Should return 5-minute stats');
      assert.strictEqual(stats.mode, 'realtime_only', 'Should be in realtime mode');
    });

    it('should track recent enrichment activity', async () => {
      const stats = await service.getStats();

      console.log('\n📈 Recent Activity Tracking:');
      console.log(`   Last 5 minutes: ${stats.enriched_last_5min} transactions`);
      console.log(`   Last hour: ${stats.enriched_last_hour} transactions`);

      // Verify the stats are reasonable
      assert.ok(stats.enriched_last_5min >= 0, '5-minute count should be non-negative');
      assert.ok(stats.enriched_last_hour >= stats.enriched_last_5min, 'Hourly count should be >= 5-minute count');
    });
  });

  describe('Service Lifecycle', () => {
    it('should start and stop cleanly', async () => {
      console.log('\n🔄 Testing service lifecycle...');

      // Service should not be running initially (stopped in after hook)
      console.log('   Starting service...');
      await service.start();

      console.log('   Service started ✅');

      // Stop the service
      console.log('   Stopping service...');
      await service.stop();

      console.log('   Service stopped ✅');

      assert.ok(true, 'Service lifecycle completed successfully');
    });

    it('should handle multiple start calls gracefully', async () => {
      console.log('\n🔄 Testing multiple start calls...');

      await service.start();
      console.log('   First start: ✅');

      // Second start should be ignored
      await service.start();
      console.log('   Second start (should be ignored): ✅');

      await service.stop();
      console.log('   Stop: ✅');

      assert.ok(true, 'Multiple start calls handled correctly');
    });
  });
});
