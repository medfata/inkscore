// Simple test script for RealtimeService
import { RealtimeService } from './dist/services/RealtimeService.js';

async function testRealtimeService() {
  console.log('🧪 Testing RealtimeService...');
  
  const realtimeService = new RealtimeService();
  
  try {
    // Get contracts that need realtime sync
    const contracts = await realtimeService.getContractsNeedingRealtimeSync();
    console.log(`📊 Found ${contracts.length} active contracts`);
    
    if (contracts.length > 0) {
      const testContract = contracts[0];
      console.log(`🔄 Testing realtime sync for: ${testContract.name} (${testContract.address})`);
      
      // Test realtime sync for first contract
      await realtimeService.realtimeContract(testContract.id);
      
      console.log('✅ Realtime service test completed successfully!');
    } else {
      console.log('⚠️ No active contracts found for testing');
    }
    
  } catch (error) {
    console.error('❌ Realtime service test failed:', error);
  }
  
  process.exit(0);
}

testRealtimeService();