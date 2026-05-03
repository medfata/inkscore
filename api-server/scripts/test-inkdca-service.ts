// Test script for InkDCA service
import { inkDcaService } from '../src/services/inkdca-service';

const TEST_WALLET = '0x1b2ee83fb043a482f6012997c1192985749f5e31';
const EXPECTED_REGISTERED_DCAS = 32;
const EXPECTED_TOTAL_SPENT = 1318.88;

async function testInkDcaService() {
  console.log('Testing InkDCA service...');
  console.log(`Wallet: ${TEST_WALLET}\n`);

  try {
    const dcaExecutions = 0;
    const metrics = await inkDcaService.getMetrics(TEST_WALLET, dcaExecutions);
    
    console.log('Results:');
    console.log('- Total Registered DCAs:', metrics.totalRegisteredDCAs);
    console.log('- DCA Executions:', metrics.dcaExecutions);
    console.log('- Total Spent (USD):', `$${metrics.totalSpentUSD.toFixed(2)}`);

    console.log('\nExpected:');
    console.log('- Total Registered DCAs:', EXPECTED_REGISTERED_DCAS);
    console.log('- Total Spent:', `$${EXPECTED_TOTAL_SPENT}`);

    const dcaPass = metrics.totalRegisteredDCAs === EXPECTED_REGISTERED_DCAS;
    const spentPass = Math.abs(metrics.totalSpentUSD - EXPECTED_TOTAL_SPENT) < 1;

    if (dcaPass && spentPass) {
      console.log('\n✅ All tests passed!');
    } else {
      console.log('\n❌ Tests failed:');
      if (!dcaPass) console.log(`  - Registered DCAs: got ${metrics.totalRegisteredDCAs}, expected ${EXPECTED_REGISTERED_DCAS}`);
      if (!spentPass) console.log(`  - Total Spent: got $${metrics.totalSpentUSD.toFixed(2)}, expected $${EXPECTED_TOTAL_SPENT}`);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testInkDcaService();
