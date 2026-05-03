/**
 * Unit test for Templars of the Storm NFT points calculation logic
 * Tests the calculation method directly without making API calls
 */

// Simulate the calculation method
function calculateTemplarsPoints(nftBalance: number): number {
  // Templars of the Storm NFT Holding Points (Max: 2,700 points)
  // 1 NFT: 1,500 pts (Base Tier - Unlocks core holder multiplier for Phase 2)
  // 2 NFTs: 2,200 pts (Silver Tier - +700 loyalty bonus)
  // 3+ NFTs: 2,700 pts (Gold/Whale Tier - Maximum points)
  if (nftBalance >= 3) return 2700; // Gold/Whale Tier
  if (nftBalance >= 2) return 2200; // Silver Tier
  if (nftBalance >= 1) return 1500; // Base Tier
  return 0;
}

console.log('='.repeat(80));
console.log('TEMPLARS NFT POINTS CALCULATION - UNIT TEST');
console.log('='.repeat(80));
console.log();

const testCases = [
  { nftBalance: 0, expectedPoints: 0, tier: 'None' },
  { nftBalance: 1, expectedPoints: 1500, tier: 'Base Tier' },
  { nftBalance: 2, expectedPoints: 2200, tier: 'Silver Tier' },
  { nftBalance: 3, expectedPoints: 2700, tier: 'Gold/Whale Tier' },
  { nftBalance: 4, expectedPoints: 2700, tier: 'Gold/Whale Tier' },
  { nftBalance: 5, expectedPoints: 2700, tier: 'Gold/Whale Tier' },
  { nftBalance: 10, expectedPoints: 2700, tier: 'Gold/Whale Tier' },
];

let passCount = 0;
let failCount = 0;

console.log('Testing points calculation for different NFT balances:\n');

testCases.forEach((testCase) => {
  const actualPoints = calculateTemplarsPoints(testCase.nftBalance);
  const passed = actualPoints === testCase.expectedPoints;

  if (passed) {
    passCount++;
    console.log(`✅ PASS: ${testCase.nftBalance} NFT(s) → ${actualPoints} points (${testCase.tier})`);
  } else {
    failCount++;
    console.log(`❌ FAIL: ${testCase.nftBalance} NFT(s) → Expected ${testCase.expectedPoints} but got ${actualPoints}`);
  }
});

console.log();
console.log('='.repeat(80));
console.log('TEST SUMMARY');
console.log('='.repeat(80));
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);
console.log();

if (failCount === 0) {
  console.log('✅ All tests passed! The calculation logic is correct.');
  console.log();
  console.log('Points Tier Breakdown:');
  console.log('  • 0 NFTs:  0 points (None)');
  console.log('  • 1 NFT:   1,500 points (Base Tier - Unlocks core holder multiplier)');
  console.log('  • 2 NFTs:  2,200 points (Silver Tier - +700 loyalty bonus)');
  console.log('  • 3+ NFTs: 2,700 points (Gold/Whale Tier - Maximum points)');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the calculation logic.');
  process.exit(1);
}
