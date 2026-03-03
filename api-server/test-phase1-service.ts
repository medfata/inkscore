import { phase1Service } from './src/services/phase1-service';

// Test the Phase 1 service
async function testPhase1Service() {
  console.log('Testing Phase 1 Service...\n');

  // Test wallet addresses from the CSV
  const testWallets = [
    '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5', // Should be Phase 1 with score 7060
    '0x27326Bd8E518183c5266B031Cf90734e17dc4800', // Should be Phase 1 with score 6975
    '0x0000000000000000000000000000000000000000', // Should NOT be Phase 1
  ];

  for (const wallet of testWallets) {
    console.log(`\nTesting wallet: ${wallet}`);
    
    const isPhase1 = phase1Service.isPhase1Wallet(wallet);
    console.log(`  Is Phase 1: ${isPhase1}`);
    
    const score = phase1Service.getWalletScore(wallet);
    console.log(`  Score: ${score !== null ? score : 'N/A'}`);
    
    const status = phase1Service.getPhase1Status(wallet);
    console.log(`  Full Status:`, status);
  }

  // Get all Phase 1 wallets
  const allWallets = phase1Service.getAllPhase1Wallets();
  console.log(`\n\nTotal Phase 1 wallets loaded: ${allWallets.length}`);
  console.log('Top 5 wallets by score:');
  allWallets
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .forEach((w, i) => {
      console.log(`  ${i + 1}. ${w.address} - Score: ${w.score}`);
    });
}

testPhase1Service().catch(console.error);
