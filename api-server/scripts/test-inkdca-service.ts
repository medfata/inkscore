// Test script for InkDCA service
import { inkDcaService } from '../src/services/inkdca-service';

const testWallet = '0xf0246C84bB2dCB2C68A17047480a669D59E2F41C';

async function testInkDcaService() {
  console.log('Testing InkDCA service...');
  console.log(`Wallet: ${testWallet}\n`);

  try {
    // Mock DCA executions count (would come from database)
    const dcaExecutions = 2;

    const metrics = await inkDcaService.getMetrics(testWallet, dcaExecutions);
    
    console.log('Results:');
    console.log('- Total Registered DCAs:', metrics.totalRegisteredDCAs);
    console.log('- DCA Executions:', metrics.dcaExecutions);
    console.log('- Total Spent (USD):', `$${metrics.totalSpentUSD.toFixed(2)}`);
    
    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testInkDcaService();
