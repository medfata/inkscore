import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// Test the INKDCA points calculation logic
function calculateInkDcaPoints(totalSpentUsd: number, totalRegisteredDcas: number): number {
  // INKDCA Points (Max: 500 points)
  // Tiered system based on total spent and registered DCAs
  
  // 1. Total Spent (Max: 400 points)
  let spentPoints = 0;
  if (totalSpentUsd >= 500) {
    spentPoints = 400; // Tier 3: Gold ($500+)
  } else if (totalSpentUsd >= 101) {
    spentPoints = 250; // Tier 2: Silver ($101-$500)
  } else if (totalSpentUsd >= 10) {
    spentPoints = 100; // Tier 1: Bronze ($10-$100)
  }
  
  // 2. Total Registered DCAs (Max: 100 points)
  let registeredPoints = 0;
  if (totalRegisteredDcas >= 6) {
    registeredPoints = 100; // Tier 3: Gold (6+ DCAs)
  } else if (totalRegisteredDcas >= 2) {
    registeredPoints = 50; // Tier 2: Silver (2-5 DCAs)
  } else if (totalRegisteredDcas >= 1) {
    registeredPoints = 25; // Tier 1: Bronze (1 DCA)
  }
  
  return spentPoints + registeredPoints;
}

console.log('INKDCA Points Calculation Test');
console.log('='.repeat(60));

// Test cases based on the requirements
const testCases = [
  // Tier 1: Bronze
  { spent: 10, dcas: 1, expected: 100 + 25, description: 'Bronze: $10 spent, 1 DCA' },
  { spent: 50, dcas: 1, expected: 100 + 25, description: 'Bronze: $50 spent, 1 DCA' },
  { spent: 100, dcas: 1, expected: 100 + 25, description: 'Bronze: $100 spent, 1 DCA' },
  
  // Tier 2: Silver
  { spent: 101, dcas: 2, expected: 250 + 50, description: 'Silver: $101 spent, 2 DCAs' },
  { spent: 250, dcas: 3, expected: 250 + 50, description: 'Silver: $250 spent, 3 DCAs' },
  { spent: 499, dcas: 5, expected: 250 + 50, description: 'Silver: $499 spent, 5 DCAs' },
  
  // Tier 3: Gold
  { spent: 500, dcas: 6, expected: 400 + 100, description: 'Gold: $500 spent, 6 DCAs (MAX)' },
  { spent: 1000, dcas: 10, expected: 400 + 100, description: 'Gold: $1000 spent, 10 DCAs (MAX)' },
  
  // Mixed tiers
  { spent: 10, dcas: 6, expected: 100 + 100, description: 'Mixed: Bronze spent, Gold DCAs' },
  { spent: 500, dcas: 1, expected: 400 + 25, description: 'Mixed: Gold spent, Bronze DCAs' },
  { spent: 101, dcas: 1, expected: 250 + 25, description: 'Mixed: Silver spent, Bronze DCAs' },
  { spent: 10, dcas: 3, expected: 100 + 50, description: 'Mixed: Bronze spent, Silver DCAs' },
  
  // Edge cases
  { spent: 0, dcas: 0, expected: 0, description: 'No activity' },
  { spent: 9.99, dcas: 0, expected: 0, description: 'Below threshold' },
  { spent: 100.99, dcas: 5, expected: 100 + 50, description: 'Edge: $100.99 (Bronze), 5 DCAs (Silver)' },
  { spent: 101, dcas: 6, expected: 250 + 100, description: 'Edge: $101 (Silver), 6 DCAs (Gold)' },
  
  // Only spent, no DCAs
  { spent: 500, dcas: 0, expected: 400 + 0, description: 'Only spent: $500, no DCAs' },
  
  // Only DCAs, no spent
  { spent: 0, dcas: 6, expected: 0 + 100, description: 'Only DCAs: 6 DCAs, no spent' },
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = calculateInkDcaPoints(testCase.spent, testCase.dcas);
  const isPass = result === testCase.expected;
  
  if (isPass) {
    passed++;
    console.log(`✅ Test ${index + 1}: PASSED`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: FAILED`);
  }
  
  console.log(`   ${testCase.description}`);
  console.log(`   Expected: ${testCase.expected} points, Got: ${result} points`);
  console.log('');
});

console.log('='.repeat(60));
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

// Summary of point structure
console.log('\n' + '='.repeat(60));
console.log('INKDCA Points Structure Summary:');
console.log('='.repeat(60));
console.log('Total Spent ($):');
console.log('  Bronze (Tier 1): $10-$100 = 100 points');
console.log('  Silver (Tier 2): $101-$500 = 250 points');
console.log('  Gold (Tier 3): $500+ = 400 points');
console.log('');
console.log('Total Registered DCAs:');
console.log('  Bronze (Tier 1): 1 DCA = 25 points');
console.log('  Silver (Tier 2): 2-5 DCAs = 50 points');
console.log('  Gold (Tier 3): 6+ DCAs = 100 points');
console.log('');
console.log('Maximum Total Points: 500 (400 + 100)');
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed!');
  process.exit(1);
}
