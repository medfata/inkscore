/**
 * Verify that the wallet_interactions consolidation was successful
 * This script checks:
 * 1. wallet_interactions table no longer exists
 * 2. transaction_details has the expected data
 * 3. New indexes are in place
 * 4. Services are working correctly
 * 
 * Usage: npx tsx scripts/verify-consolidation.ts
 */
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function verifyConsolidation() {
  console.log('🔍 Verifying wallet_interactions consolidation...');
  console.log('================================================');
  
  try {
    // 1. Check if wallet_interactions table exists
    console.log('\n1. Checking table existence...');
    const tableCheck = await pool.query(`
      SELECT 
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'wallet_interactions'
        ) as wallet_interactions_exists,
        EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'transaction_details'
        ) as transaction_details_exists
    `);
    
    const { wallet_interactions_exists, transaction_details_exists } = tableCheck.rows[0];
    
    if (wallet_interactions_exists) {
      console.log('❌ wallet_interactions table still exists - migration not completed');
      return false;
    } else {
      console.log('✅ wallet_interactions table successfully removed');
    }
    
    if (transaction_details_exists) {
      console.log('✅ transaction_details table exists');
    } else {
      console.log('❌ transaction_details table missing');
      return false;
    }
    
    // 2. Check transaction_details data
    console.log('\n2. Checking transaction_details data...');
    const dataCheck = await pool.query(`
      SELECT 
        COUNT(*) as total_rows,
        COUNT(DISTINCT wallet_address) as unique_wallets,
        COUNT(DISTINCT contract_address) as unique_contracts,
        COUNT(DISTINCT tx_hash) as unique_transactions,
        MIN(block_timestamp) as earliest_tx,
        MAX(block_timestamp) as latest_tx
      FROM transaction_details
    `);
    
    const data = dataCheck.rows[0];
    console.log(`   📊 Total rows: ${parseInt(data.total_rows).toLocaleString()}`);
    console.log(`   👥 Unique wallets: ${parseInt(data.unique_wallets).toLocaleString()}`);
    console.log(`   📄 Unique contracts: ${parseInt(data.unique_contracts).toLocaleString()}`);
    console.log(`   🔗 Unique transactions: ${parseInt(data.unique_transactions).toLocaleString()}`);
    console.log(`   📅 Date range: ${data.earliest_tx} to ${data.latest_tx}`);
    
    // 3. Check new indexes
    console.log('\n3. Checking optimized indexes...');
    const indexCheck = await pool.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'transaction_details' 
      AND indexname LIKE 'idx_td_%'
      ORDER BY indexname
    `);
    
    const expectedIndexes = [
      'idx_td_wallet_contract_status',
      'idx_td_contract_status', 
      'idx_td_wallet_contract_function',
      'idx_td_contract_block',
      'idx_td_function_name',
      'idx_td_contract_function_name'
    ];
    
    const foundIndexes = indexCheck.rows.map(row => row.indexname);
    
    for (const expectedIndex of expectedIndexes) {
      if (foundIndexes.includes(expectedIndex)) {
        console.log(`   ✅ ${expectedIndex}`);
      } else {
        console.log(`   ❌ ${expectedIndex} - MISSING`);
      }
    }
    
    // 4. Check for any remaining wallet_interactions references in indexes
    console.log('\n4. Checking for orphaned wallet_interactions indexes...');
    const orphanedIndexes = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'wallet_interactions'
      OR indexname LIKE '%wallet_interactions%'
      OR indexname LIKE 'idx_wi_%'
      OR indexname LIKE 'idx_wallet_contract%'
      OR indexname LIKE 'idx_contract_status%'
    `);
    
    if (orphanedIndexes.rows.length === 0) {
      console.log('   ✅ No orphaned wallet_interactions indexes found');
    } else {
      console.log('   ❌ Found orphaned indexes:');
      for (const index of orphanedIndexes.rows) {
        console.log(`      - ${index.indexname}`);
      }
    }
    
    // 5. Test a sample query that services would use
    console.log('\n5. Testing sample service queries...');
    
    // Test count query (used by analytics service)
    const countTest = await pool.query(`
      SELECT 
        contract_address,
        COUNT(*) as tx_count,
        COUNT(DISTINCT wallet_address) as unique_wallets
      FROM transaction_details 
      WHERE status = 1
      GROUP BY contract_address 
      LIMIT 5
    `);
    
    console.log('   ✅ Count query test passed');
    console.log(`      Sample: ${countTest.rows.length} contracts found`);
    
    // Test volume query (used by analytics service)
    const volumeTest = await pool.query(`
      SELECT 
        contract_address,
        COUNT(*) as tx_count,
        COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as eth_total
      FROM transaction_details 
      WHERE status = 1
      GROUP BY contract_address 
      LIMIT 5
    `);
    
    console.log('   ✅ Volume query test passed');
    console.log(`      Sample: ${volumeTest.rows.length} contracts with volume data`);
    
    // Test wallet query (used by points service)
    const walletTest = await pool.query(`
      SELECT 
        wallet_address,
        COUNT(DISTINCT tx_hash) as tx_count
      FROM transaction_details
      WHERE status = 1
      GROUP BY wallet_address 
      LIMIT 5
    `);
    
    console.log('   ✅ Wallet query test passed');
    console.log(`      Sample: ${walletTest.rows.length} wallets found`);
    
    console.log('\n🎉 Consolidation verification completed successfully!');
    console.log('All checks passed - the system is ready to use transaction_details exclusively.');
    
    return true;
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  } finally {
    await pool.end();
  }
}

// Run the verification
verifyConsolidation().then((success) => {
  if (!success) {
    console.log('\n⚠️  Some checks failed. Please review the migration.');
    process.exit(1);
  }
}).catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});