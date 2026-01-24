import 'dotenv/config';
import { pool } from '../db/index.js';

/**
 * Enrichment Gap Verification Script
 * 
 * Verifies the current state of transaction enrichment gaps.
 * Run this before and after the gap enrichment script to see progress.
 * 
 * Usage: npm run verify-gaps
 */

interface ContractStats {
  contract_name: string;
  contract_address: string;
  total_transactions: number;
  enriched_transactions: number;
  unenriched_transactions: number;
  enrichment_percentage: number;
}

async function main() {
  console.log('🔍 Transaction Enrichment Gap Analysis');
  console.log('═══════════════════════════════════════');
  console.log('');

  try {
    // Test database connection
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
    console.log('');

    // Get current enrichment status
    const result = await pool.query(`
      SELECT 
        c.name AS contract_name,
        c.address AS contract_address,
        td.total_transactions,
        te.enriched_transactions,
        (td.total_transactions - COALESCE(te.enriched_transactions, 0)) AS unenriched_transactions,
        ROUND(
          COALESCE(te.enriched_transactions, 0)::numeric / NULLIF(td.total_transactions, 0) * 100,
          2
        ) AS enrichment_percentage
      FROM contracts c
      LEFT JOIN (
        SELECT contract_address, COUNT(*) AS total_transactions
        FROM transaction_details
        GROUP BY contract_address
      ) td ON td.contract_address = c.address
      LEFT JOIN (
        SELECT contract_address, COUNT(*) AS enriched_transactions
        FROM transaction_enrichment
        GROUP BY contract_address
      ) te ON te.contract_address = c.address
      WHERE c.contract_type = 'volume'
        AND c.is_active = true
        AND td.total_transactions > 0
      ORDER BY (td.total_transactions - COALESCE(te.enriched_transactions, 0)) DESC
    `);

    const contracts: ContractStats[] = result.rows;

    if (contracts.length === 0) {
      console.log('✅ No volume contracts found or all are fully enriched!');
      return;
    }

    // Show detailed breakdown
    console.log('📊 Enrichment Status by Contract:');
    console.log('');

    let totalTransactions = 0;
    let totalEnriched = 0;
    let totalUnenriched = 0;
    let contractsWithGaps = 0;

    for (const contract of contracts) {
      const hasGap = contract.unenriched_transactions > 0;
      if (hasGap) contractsWithGaps++;

      const status = hasGap ? '❌' : '✅';
      const percentage = contract.enrichment_percentage.toFixed(2);

      console.log(`${status} ${contract.contract_name}`);
      console.log(`   Address: ${contract.contract_address}`);
      console.log(`   Progress: ${contract.enriched_transactions.toLocaleString()}/${contract.total_transactions.toLocaleString()} (${percentage}%)`);

      if (hasGap) {
        console.log(`   Missing: ${contract.unenriched_transactions.toLocaleString()} transactions`);
      }
      console.log('');

      totalTransactions += contract.total_transactions;
      totalEnriched += contract.enriched_transactions;
      totalUnenriched += contract.unenriched_transactions;
    }

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📈 Overall Summary:');
    console.log('');
    console.log(`   Total Contracts: ${contracts.length}`);
    console.log(`   Contracts with Gaps: ${contractsWithGaps}`);
    console.log(`   Total Transactions: ${totalTransactions.toLocaleString()}`);
    console.log(`   Enriched: ${totalEnriched.toLocaleString()}`);
    console.log(`   Missing: ${totalUnenriched.toLocaleString()}`);

    const overallPercentage = totalTransactions > 0 ? (totalEnriched / totalTransactions * 100).toFixed(2) : '0';
    console.log(`   Overall Progress: ${overallPercentage}%`);
    console.log('');

    if (totalUnenriched > 0) {
      console.log('🚀 To enrich missing transactions:');
      console.log('   npm run gap-enrich -- --dry-run    # Preview what will be processed');
      console.log('   npm run gap-enrich                  # Process all missing transactions');
      console.log('');

      // Estimate processing time
      const estimatedMinutes = Math.ceil(totalUnenriched / 10 / 60); // ~10 tx/s
      if (estimatedMinutes < 60) {
        console.log(`⏱️  Estimated processing time: ~${estimatedMinutes} minutes`);
      } else {
        const hours = Math.floor(estimatedMinutes / 60);
        const mins = estimatedMinutes % 60;
        console.log(`⏱️  Estimated processing time: ~${hours}h ${mins}m`);
      }
    } else {
      console.log('🎉 All transactions are enriched! No gaps found.');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});