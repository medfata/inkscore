import { RealtimeService } from '../RealtimeService.js';
import { pool } from '../../db/index.js';
import 'dotenv/config';

/**
 * LIVE Integration Test for RealtimeService Adaptive Polling
 * 
 * Run with: npx tsx src/services/__tests__/RealtimeService.live.test.ts
 */

async function runLiveTest() {
  console.log('🧪 LIVE TEST: RealtimeService Adaptive Polling\n');
  console.log('='.repeat(70));
  
  const service = new RealtimeService();
  const config = service.getConfig();
  
  console.log('\n⚙️  Configuration:');
  console.log(`   Base interval: ${config.baseIntervalMs / 1000}s`);
  console.log(`   Max interval: ${config.maxIntervalMs / 1000}s`);
  console.log(`   Backoff multiplier: ${config.backoffMultiplier}x`);
  
  // Get contracts from database
  console.log('\n📋 Fetching contracts from database...');
  const contractsResult = await pool.query(`
    SELECT id, address, name
    FROM contracts 
    WHERE is_active = true 
      AND indexing_enabled = true
      AND indexing_status = 'complete'
    ORDER BY created_at ASC
    LIMIT 5
  `);
  
  const contracts = contractsResult.rows;
  
  if (contracts.length === 0) {
    console.log('❌ No contracts found with indexing_status = complete');
    await pool.end();
    return;
  }
  
  console.log(`\n📊 Found ${contracts.length} contracts to test:\n`);
  for (const c of contracts) {
    console.log(`   ${c.id}. ${c.name} (${c.address.slice(0, 10)}...)`);
  }
  
  // Run polling cycles
  const POLL_CYCLES = 3;
  
  console.log('\n' + '='.repeat(70));
  console.log(`\n🔄 Running ${POLL_CYCLES} polling cycles...\n`);
  console.log('   Adaptive behavior:');
  console.log('   - New tx inserted → interval stays at 15s');
  console.log('   - No new tx → interval doubles (up to 10 min)\n');
  console.log('='.repeat(70));
  
  for (let cycle = 1; cycle <= POLL_CYCLES; cycle++) {
    console.log(`\n📍 CYCLE ${cycle}/${POLL_CYCLES}`);
    console.log('-'.repeat(50));
    
    for (const contract of contracts) {
      const stateBefore = service.getPollingState(contract.id);
      
      console.log(`\n   🔍 ${contract.name}`);
      console.log(`      Interval before: ${(stateBefore.intervalMs / 1000).toFixed(0)}s`);
      
      try {
        // Fetch from API
        const transactions = await service.fetchLatestTransactions(contract.address);
        console.log(`      API returned: ${transactions.length} tx`);
        
        if (transactions.length === 0) {
          service.updatePollingState(contract.id, 0, false);
        } else {
          // Insert all - DB handles duplicates
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            
            const values: any[] = [];
            const placeholders: string[] = [];
            let paramIndex = 1;
            
            for (const tx of transactions) {
              const txHash = tx.txHash || tx.id;
              if (!txHash) continue;

              placeholders.push(
                `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, ` +
                `$${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, ` +
                `$${paramIndex + 8}, $${paramIndex + 9})`
              );
              values.push(
                txHash,                                      // tx_hash
                tx.from?.toLowerCase() || null,              // wallet_address
                contract.address.toLowerCase(),              // contract_address
                tx.method?.split('(')[0] || null,            // function_name
                tx.value,                                    // eth_value
                tx.blockNumber,                              // block_number
                new Date(tx.timestamp),                      // block_timestamp
                tx.status ? 1 : 0,                           // status
                parseInt(tx.chainId),                        // chain_id
                tx.to?.toLowerCase() || null                 // to_address
              );
              paramIndex += 10;
            }
            
            const result = await client.query(`
              INSERT INTO transaction_details (
                tx_hash, wallet_address, contract_address, function_name,
                eth_value, block_number, block_timestamp, status, chain_id, to_address
              ) VALUES ${placeholders.join(', ')}
              ON CONFLICT (tx_hash) DO NOTHING
            `, values);
            
            await client.query('COMMIT');
            
            const insertedCount = result.rowCount || 0;
            console.log(`      Inserted: ${insertedCount} new (${transactions.length - insertedCount} duplicates skipped)`);
            
            service.updatePollingState(contract.id, insertedCount, false);
            
          } catch (err) {
            await client.query('ROLLBACK');
            throw err;
          } finally {
            client.release();
          }
        }
        
        const stateAfter = service.getPollingState(contract.id);
        const change = stateAfter.intervalMs > stateBefore.intervalMs ? '⬆️' : 
                       stateAfter.intervalMs < stateBefore.intervalMs ? '⬇️' : '➡️';
        console.log(`      Interval after: ${(stateAfter.intervalMs / 1000).toFixed(0)}s ${change}`);
        
      } catch (error: any) {
        console.log(`      ❌ Error: ${error.message}`);
        service.updatePollingState(contract.id, 0, true);
      }
      
      await new Promise(r => setTimeout(r, 300));
    }
    
    // Summary
    console.log('\n   📊 Current intervals:');
    const stats = service.getPollingStats();
    for (const stat of stats) {
      const c = contracts.find(x => x.id === stat.contractId);
      console.log(`      ${c?.name}: ${(stat.intervalMs / 1000).toFixed(0)}s (${stat.consecutiveEmptyPolls} empty polls)`);
    }
    
    if (cycle < POLL_CYCLES) {
      console.log('\n   ⏳ Waiting 2s...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('\n✅ Test complete!\n');
  
  await pool.end();
}

runLiveTest().catch(err => {
  console.error('Test failed:', err);
  pool.end();
  process.exit(1);
});
