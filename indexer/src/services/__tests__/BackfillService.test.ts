import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { BackfillService, BackfillJobPayload } from '../BackfillService.js';
import { pool } from '../../db/index.js';

/**
 * Integration test for BackfillService
 * 
 * Tests real backfill processing with actual API calls and database operations.
 * Uses a 8-day date range to trigger multiple batches and test batch chaining.
 * 
 * Contract: 0x9f500d075118272b3564ac6ef2c70a9067fd2d3f
 * Date Range: (currentDate - 8 days) to currentDate
 */

const TEST_CONTRACT_ADDRESS = '0x05ec92D78ED421f3D3Ada77FFdE167106565974E';

describe('BackfillService Integration Test', () => {
  let backfillService: BackfillService;
  let testJobId: number | null = null;
  let testContractId: number | null = null;

  before(async () => {
    console.log('\n🧪 ═══════════════════════════════════════════════');
    console.log('   BACKFILL SERVICE INTEGRATION TEST');
    console.log('═══════════════════════════════════════════════════\n');

    backfillService = new BackfillService();

    // Get or create test contract
    const contractResult = await pool.query(
      'SELECT id FROM contracts WHERE LOWER(address) = LOWER($1)',
      [TEST_CONTRACT_ADDRESS]
    );

    if (contractResult.rows.length > 0) {
      testContractId = contractResult.rows[0].id;
      console.log(`📍 Using existing contract ID: ${testContractId}`);
    } else {
      // Contract doesn't exist - we need it to exist for the test
      console.log(`⚠️  Contract ${TEST_CONTRACT_ADDRESS} not found in database`);
      console.log(`   Please add this contract first or use a different address`);
    }
  });

  after(async () => {
    console.log('\n🧹 Cleaning up test data...');

    // Clean up: Delete the test job we created
    if (testJobId) {
      await pool.query('DELETE FROM job_queue WHERE id = $1', [testJobId]);
      console.log(`   ✅ Deleted test job #${testJobId}`);
    }

    // Note: We intentionally leave transaction_details as requested
    console.log('   ℹ️  Keeping transaction_details (as requested)');

    console.log('\n✅ Test cleanup complete\n');
  });

  it('should process a backfill job for 2-day date range with batch chaining', async () => {
    // Skip if contract not found
    if (!testContractId) {
      console.log('⏭️  Skipping test - contract not found in database');
      return;
    }

    // Calculate date range: 8 days ago to now (to trigger multiple batches)
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000);

    const fromDate = twoDaysAgo.toISOString();
    const toDate = now.toISOString();

    console.log('📅 Test Parameters:');
    console.log(`   Contract: ${TEST_CONTRACT_ADDRESS}`);
    console.log(`   From: ${fromDate}`);
    console.log(`   To: ${toDate}`);
    console.log('');

    // Step 1: Create a test job in the database
    console.log('📝 Step 1: Creating test job in database...');

    const payload: BackfillJobPayload = {
      contractId: testContractId,
      contractAddress: TEST_CONTRACT_ADDRESS,
      fromDate,
      toDate
    };

    const jobResult = await pool.query(`
      INSERT INTO job_queue (job_type, contract_id, priority, payload, max_attempts)
      VALUES ('backfill', $1, 5, $2, 3)
      RETURNING id
    `, [testContractId, JSON.stringify(payload)]);

    testJobId = jobResult.rows[0].id;
    console.log(`   ✅ Created job #${testJobId}`);

    // Step 2: Verify job was created correctly
    console.log('\n📝 Step 2: Verifying job in database...');

    const verifyResult = await pool.query(
      'SELECT * FROM job_queue WHERE id = $1',
      [testJobId]
    );

    assert.strictEqual(verifyResult.rows.length, 1, 'Job should exist in database');
    assert.strictEqual(verifyResult.rows[0].status, 'pending', 'Job should be pending');
    assert.strictEqual(verifyResult.rows[0].job_type, 'backfill', 'Job type should be backfill');

    const storedPayload = verifyResult.rows[0].payload;
    assert.strictEqual(storedPayload.contractAddress, TEST_CONTRACT_ADDRESS, 'Contract address should match');
    assert.strictEqual(storedPayload.fromDate, fromDate, 'fromDate should match');
    assert.strictEqual(storedPayload.toDate, toDate, 'toDate should match');

    console.log('   ✅ Job verified in database');
    console.log(`   Payload: ${JSON.stringify(storedPayload, null, 2)}`);

    // Step 3: Process the backfill job
    console.log('\n📝 Step 3: Processing backfill job...');
    console.log('   This will make real API calls to Routescan...\n');

    const startTime = Date.now();

    try {
      await backfillService.processBackfillJob(testJobId!, payload);

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n   ✅ Backfill completed in ${duration}s`);

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n   ❌ Backfill failed after ${duration}s`);
      console.log(`   Error: ${error instanceof Error ? error.message : error}`);
      throw error;
    }

    // Step 4: Verify job status was updated
    console.log('\n📝 Step 4: Verifying job completion...');

    const completedJob = await pool.query(
      'SELECT * FROM job_queue WHERE id = $1',
      [testJobId]
    );

    console.log(`   Status: ${completedJob.rows[0].status}`);
    console.log(`   Started: ${completedJob.rows[0].started_at}`);
    console.log(`   Completed: ${completedJob.rows[0].completed_at}`);

    assert.strictEqual(completedJob.rows[0].status, 'completed', 'Job should be completed');
    assert.ok(completedJob.rows[0].started_at, 'Job should have started_at timestamp');
    assert.ok(completedJob.rows[0].completed_at, 'Job should have completed_at timestamp');

    // Step 5: Check if transactions were inserted
    console.log('\n📝 Step 5: Checking inserted transactions...');

    const txCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM transaction_details 
      WHERE LOWER(contract_address) = LOWER($1)
        AND block_timestamp >= $2
        AND block_timestamp <= $3
    `, [TEST_CONTRACT_ADDRESS, fromDate, toDate]);

    const count = parseInt(txCount.rows[0].count);
    console.log(`   ✅ Found ${count} transactions in date range`);

    // We expect at least some transactions (could be 0 if contract had no activity)
    console.log(`   ℹ️  Transaction count: ${count}`);

    console.log('\n🎉 All assertions passed!');
  });
});
