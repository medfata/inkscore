import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// Test the NFT Staking points calculation logic
function calculateNftStakingPoints(shelliesCount: number, inkBunniesCount: number, boinkCount: number): number {
  // NFT Staking Points (Max: 500 points)
  // Tiered system based on staked NFT counts per collection
  
  // 1. Shellies (Max: 166 points)
  let shelliesPoints = 0;
  if (shelliesCount >= 6) {
    shelliesPoints = 166; // Tier 3: Gold (6+ NFTs)
  } else if (shelliesCount >= 2) {
    shelliesPoints = 100; // Tier 2: Silver (2-5 NFTs)
  } else if (shelliesCount >= 1) {
    shelliesPoints = 50; // Tier 1: Bronze (1 NFT)
  }
  
  // 2. INK Bunnies (Max: 167 points)
  let inkBunniesPoints = 0;
  if (inkBunniesCount >= 6) {
    inkBunniesPoints = 167; // Tier 3: Gold (6+ NFTs)
  } else if (inkBunniesCount >= 2) {
    inkBunniesPoints = 100; // Tier 2: Silver (2-5 NFTs)
  } else if (inkBunniesCount >= 1) {
    inkBunniesPoints = 50; // Tier 1: Bronze (1 NFT)
  }
  
  // 3. Boink (Max: 167 points)
  let boinkPoints = 0;
  if (boinkCount >= 6) {
    boinkPoints = 167; // Tier 3: Gold (6+ NFTs)
  } else if (boinkCount >= 2) {
    boinkPoints = 100; // Tier 2: Silver (2-5 NFTs)
  } else if (boinkCount >= 1) {
    boinkPoints = 50; // Tier 1: Bronze (1 NFT)
  }
  
  return shelliesPoints + inkBunniesPoints + boinkPoints;
}

console.log('NFT Staking Points Calculation Test');
console.log('='.repeat(60));

// Test cases based on the requirements
const testCases = [
  // Tier 1: Bronze (1 NFT each)
  { shellies: 1, inkBunnies: 1, boink: 1, expected: 50 + 50 + 50 },
  
  // Tier 2: Silver (2-5 NFTs each)
  { shellies: 2, inkBunnies: 2, boink: 2, expected: 100 + 100 + 100 },
  { shellies: 5, inkBunnies: 5, boink: 5, expected: 100 + 100 + 100 },
  
  // Tier 3: Gold (6+ NFTs each)
  { shellies: 6, inkBunnies: 6, boink: 6, expected: 166 + 167 + 167 },
  { shellies: 10, inkBunnies: 10, boink: 10, expected: 166 + 167 + 167 },
  
  // Mixed tiers
  { shellies: 1, inkBunnies: 3, boink: 7, expected: 50 + 100 + 167 },
  { shellies: 0, inkBunnies: 2, boink: 6, expected: 0 + 100 + 167 },
  
  // No NFTs staked
  { shellies: 0, inkBunnies: 0, boink: 0, expected: 0 },
  
  // Max points scenario
  { shellies: 6, inkBunnies: 6, boink: 6, expected: 500 },
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = calculateNftStakingPoints(testCase.shellies, testCase.inkBunnies, testCase.boink);
  const isPass = result === testCase.expected;
  
  if (isPass) {
    passed++;
    console.log(`✅ Test ${index + 1}: PASSED`);
  } else {
    failed++;
    console.log(`❌ Test ${index + 1}: FAILED`);
  }
  
  console.log(`   Shellies: ${testCase.shellies}, INK Bunnies: ${testCase.inkBunnies}, Boink: ${testCase.boink}`);
  console.log(`   Expected: ${testCase.expected} points, Got: ${result} points`);
  console.log('');
});

console.log('='.repeat(60));
console.log(`Total Tests: ${testCases.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed!');
  process.exit(1);
}
