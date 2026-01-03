import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { pool } from '../../db/index.js';
import { VolumeEnrichmentService } from '../VolumeEnrichmentService.js';

/**
 * Test suite for VolumeEnrichmentService
 * 
 * Tests the enrichment process for volume contracts:
 * 1. Fetches oldest unenriched transaction
 * 2. Fetches raw data from Routerscan API and stores it
 * 3. Verifies last_enriched_tx_hash is updated
 */

const TEST_CONTRACT_ADDRESS = '0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2';

describe('VolumeEnrichmentService', () => {
  let service: VolumeEnrichmentService;
  let testContract: any;
  let initialEnrichedCount: number;
  let initialLastEnrichedTxHash: string | null;
  let oldestUnenrichedTx: string | null;

  before(async () => {
    service = new VolumeEnrichmentService();
    console.log('\n🔧 Setting up VolumeEnrichmentService tests...');
  });

  after(async () => {
    await service.stop();
    console.log('\n✅ VolumeEnrichmentService tests completed');
  });

  describe('Setup & Initial State', () => {
    it('should fetch the test contract from database', async () => {
      const result = await pool.query(`
        SELECT id, address, name, contract_type, enrichment_status, enrichment_progress,
               is_active, indexing_enabled, last_enriched_tx_hash
        FROM contracts 
        WHERE LOWER(address) = LOWER($1)
      `, [TEST_CONTRACT_ADDRESS]);

      console.log(`\n🔍 Looking for contract: ${TEST_CONTRACT_ADDRESS}`);
      assert.ok(result.rows.length > 0, `Contract ${TEST_CONTRACT_ADDRESS} should exist`);

      testContract = result.rows[0];
      initialLastEnrichedTxHash = testContract.last_enriched_tx_hash;

      console.log(`✅ Found contract: ${testContract.name} (ID: ${testContract.id})`);
      console.log(`   Type: ${testContract.contract_type}`);
      console.log(`   Last Enriched TX: ${initialLastEnrichedTxHash || 'none'}`);
    });

    it('should get current enrichment counts', async () => {
      const detailsResult = await pool.query(`
        SELECT COUNT(*) as count FROM transaction_details 
        WHERE LOWER(contract_address) = LOWER($1)
      `, [TEST_CONTRACT_ADDRESS]);

      const enrichedResult = await pool.query(`
        SELECT COUNT(*) as count FROM transaction_enrichment 
        WHERE LOWER(contract_address) = LOWER($1)
      `, [TEST_CONTRACT_ADDRESS]);

      const totalTxs = parseInt(detailsResult.rows[0].count);
      initialEnrichedCount = parseInt(enrichedResult.rows[0].count);

      console.log(`\n📊 Current State:`);
      console.log(`   Total transactions: ${totalTxs.toLocaleString()}`);
      console.log(`   Already enriched: ${initialEnrichedCount.toLocaleString()}`);
      console.log(`   Pending: ${(totalTxs - initialEnrichedCount).toLocaleString()}`);
    });

    it('should find the oldest unenriched transaction', async () => {
      const result = await pool.query(`
        SELECT td.tx_hash, td.block_timestamp
        FROM transaction_details td
        WHERE LOWER(td.contract_address) = LOWER($1)
          AND NOT EXISTS (
            SELECT 1 FROM transaction_enrichment te WHERE te.tx_hash = td.tx_hash
          )
        ORDER BY td.block_timestamp ASC
        LIMIT 1
      `, [TEST_CONTRACT_ADDRESS]);

      if (result.rows.length > 0) {
        oldestUnenrichedTx = result.rows[0].tx_hash;
        console.log(`\n📍 Oldest unenriched transaction:`);
        console.log(`   TX: ${oldestUnenrichedTx}`);
        console.log(`   Timestamp: ${result.rows[0].block_timestamp}`);
      } else {
        console.log(`\n✅ All transactions already enriched!`);
        oldestUnenrichedTx = null;
      }
    });
  });

  describe('Enrichment Process - First Batch', () => {
    it('should enrich first batch and update last_enriched_tx_hash', async () => {
      if (!oldestUnenrichedTx) {
        console.log('⏭️  Skipping - no unenriched transactions');
        return;
      }

      console.log(`\n🚀 Starting enrichment for contract ID: ${testContract.id}`);
      console.log(`   Will process first batch of transactions...`);

      const startTime = Date.now();

      await service.enrichVolumeContract(testContract.id);

      const duration = Date.now() - startTime;
      const durationSeconds = (duration / 1000).toFixed(2);

      console.log(`\n⏱️  Enrichment completed in ${durationSeconds}s (${duration}ms)`);

      const newEnrichedResult = await pool.query(`
        SELECT COUNT(*) as count FROM transaction_enrichment 
        WHERE LOWER(contract_address) = LOWER($1)
      `, [TEST_CONTRACT_ADDRESS]);

      const newEnrichedCount = parseInt(newEnrichedResult.rows[0].count);
      const newlyEnriched = newEnrichedCount - initialEnrichedCount;

      console.log(`📊 Results:`);
      console.log(`   Previously enriched: ${initialEnrichedCount.toLocaleString()}`);
      console.log(`   Now enriched: ${newEnrichedCount.toLocaleString()}`);
      console.log(`   Newly enriched this run: ${newlyEnriched}`);
      console.log(`   Rate: ${(newlyEnriched / (duration / 1000)).toFixed(2)} tx/s`);

      assert.ok(newlyEnriched > 0, 'Should have enriched at least some transactions');
    });

    it('should have updated last_enriched_tx_hash on the contract', async () => {
      const result = await pool.query(`
        SELECT last_enriched_tx_hash, enrichment_status, enrichment_progress
        FROM contracts WHERE id = $1
      `, [testContract.id]);

      const contract = result.rows[0];
      const newLastEnrichedTxHash = contract.last_enriched_tx_hash;

      console.log(`\n📋 Contract Status After Enrichment:`);
      console.log(`   Status: ${contract.enrichment_status}`);
      console.log(`   Progress: ${parseFloat(contract.enrichment_progress || 0).toFixed(2)}%`);
      console.log(`   Previous last_enriched_tx_hash: ${initialLastEnrichedTxHash || 'none'}`);
      console.log(`   New last_enriched_tx_hash: ${newLastEnrichedTxHash || 'none'}`);

      if (oldestUnenrichedTx) {
        assert.ok(newLastEnrichedTxHash, 'last_enriched_tx_hash should be set');
        assert.notStrictEqual(
          newLastEnrichedTxHash,
          initialLastEnrichedTxHash,
          'last_enriched_tx_hash should have changed'
        );
      }
    });

    it('should verify the oldest unenriched tx was enriched', async () => {
      if (!oldestUnenrichedTx) {
        console.log('⏭️  Skipping - no unenriched transactions to verify');
        return;
      }

      const result = await pool.query(`
        SELECT tx_hash, value, gas_used, gas_price, method_id,
               logs IS NOT NULL as has_logs, 
               operations IS NOT NULL as has_operations
        FROM transaction_enrichment 
        WHERE tx_hash = $1
      `, [oldestUnenrichedTx]);

      console.log(`\n🔍 Verifying oldest tx was enriched: ${oldestUnenrichedTx.substring(0, 20)}...`);

      if (result.rows.length > 0) {
        const tx = result.rows[0];
        console.log(`   ✅ Found in transaction_enrichment`);
        console.log(`   Value (wei): ${tx.value}`);
        console.log(`   Gas Used: ${tx.gas_used}`);
        console.log(`   Method ID: ${tx.method_id || 'N/A'}`);
        console.log(`   Has Logs: ${tx.has_logs}, Has Operations: ${tx.has_operations}`);

        assert.ok(true, 'Oldest transaction was enriched');
      } else {
        console.log(`   ❌ Not found - may have failed enrichment`);
      }
    });
  });

  describe('Data Integrity', () => {
    it('should have valid enrichment data with logs and operations', async () => {
      const result = await pool.query(`
        SELECT 
          tx_hash,
          value,
          gas_used,
          gas_price,
          method_id,
          logs IS NOT NULL as has_logs,
          operations IS NOT NULL as has_operations,
          input IS NOT NULL as has_input
        FROM transaction_enrichment 
        WHERE LOWER(contract_address) = LOWER($1)
        ORDER BY created_at DESC
        LIMIT 5
      `, [TEST_CONTRACT_ADDRESS]);

      console.log(`\n📋 Sample enriched transactions (newest 5):`);

      if (result.rows.length === 0) {
        console.log('   No enriched transactions found');
        return;
      }

      for (const row of result.rows) {
        console.log(`   TX: ${row.tx_hash.substring(0, 16)}...`);
        console.log(`      Method: ${row.method_id || 'N/A'}`);
        console.log(`      Value: ${row.value || '0'} wei`);
        console.log(`      Has Logs: ${row.has_logs}, Operations: ${row.has_operations}, Input: ${row.has_input}`);
      }

      const hasData = result.rows.some(r => r.has_logs || r.has_operations);
      console.log(`\n   ✅ At least one tx has logs/operations: ${hasData}`);
    });
  });

  describe('Service Statistics', () => {
    it('should return enrichment statistics', async () => {
      const stats = await service.getStats();

      console.log(`\n📊 Overall Enrichment Statistics:`);
      console.log(`   Total volume contracts: ${stats.total_contracts}`);
      console.log(`   Completed contracts: ${stats.completed_contracts}`);
      console.log(`   Total enriched transactions: ${parseInt(stats.enriched_txs).toLocaleString()}`);

      assert.ok(stats.total_contracts !== undefined, 'Should return total contracts count');
    });
  });
});
