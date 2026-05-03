// Test script for Sweep streak metric
import { sweepService } from '../src/services/sweep-service';

const testWallet = '0xf0246C84bB2dCB2C68A17047480a669D59E2F41C';

async function testSweepStreak() {
  console.log('Testing Sweep metrics with streak...');
  console.log(`Wallet: ${testWallet}\n`);

  try {
    const metrics = await sweepService.getDeployedCollections(testWallet);
    
    console.log('Results:');
    console.log('- NFT Collections Deployed:', metrics.totalCollections);
    console.log('- Sweep Badges Owned:', metrics.sweepBadgeBalance);
    console.log('- Current Streak:', metrics.currentStreak);
    
    console.log('\n✅ Test completed successfully!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testSweepStreak();
