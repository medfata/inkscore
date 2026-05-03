/**
 * Unit test for OpenSea NFT Activity points calculation logic
 * Tests the tiered calculation method directly without making API calls
 */

// Simulate the calculation method
function calculateOpenSeaPoints(buyCount: number, sellCount: number, mintCount: number): number {
  // OpenSea NFT Activity Points (Max: 2,500 points)
  // Tiered system based on total NFT transaction count
  
  const totalNftTxs = buyCount + sellCount + mintCount;
  
  // Determine tier based on total NFT transactions
  let tier: 'bronze' | 'silver' | 'gold';
  if (totalNftTxs >= 6) {
    tier = 'gold';   // Tier 3: Gold (6+ NFTs)
  } else if (totalNftTxs >= 2) {
    tier = 'silver'; // Tier 2: Silver (2-5 NFTs)
  } else if (totalNftTxs >= 1) {
    tier = 'bronze'; // Tier 1: Bronze (1 NFT)
  } else {
    return 0; // No activity
  }
  
  // Calculate points for each action type based on tier
  let buyPoints = 0;
  if (buyCount > 0) {
    if (tier === 'gold') buyPoints = 1200;
    else if (tier === 'silver') buyPoints = 800;
    else buyPoints = 300; // bronze
  }
  
  let sellPoints = 0;
  if (sellCount > 0) {
    if (tier === 'gold') sellPoints = 800;
    else if (tier === 'silver') sellPoints = 500;
    else sellPoints = 200; // bronze
  }
  
  let mintPoints = 0;
  if (mintCount > 0) {
    if (tier === 'gold') mintPoints = 500;
    else if (tier === 'silver') mintPoints = 300;
    else mintPoints = 100; // bronze
  }
  
  return buyPoints + sellPoints + mintPoints;
}

console.log('='.repeat(80));
console.log('OPENSEA NFT ACTIVITY POINTS - UNIT TEST');
console.log('='.repeat(80));
console.log();

const testCases = [
  // No activity
  { buy: 0, sell: 0, mint: 0, expectedPoints: 0, tier: 'None', description: 'No activity' },
  
  // Bronze Tier (1 NFT total)
  { buy: 1, sell: 0, mint: 0, expectedPoints: 300, tier: 'Bronze', description: '1 Buy only' },
  { buy: 0, sell: 1, mint: 0, expectedPoints: 200, tier: 'Bronze', description: '1 Sell only' },
  { buy: 0, sell: 0, mint: 1, expectedPoints: 100, tier: 'Bronze', description: '1 Mint only' },
  
  // Silver Tier (2-5 NFTs total)
  { buy: 1, sell: 1, mint: 0, expectedPoints: 1300, tier: 'Silver', description: '1 Buy + 1 Sell' },
  { buy: 1, sell: 0, mint: 1, expectedPoints: 1100, tier: 'Silver', description: '1 Buy + 1 Mint' },
  { buy: 0, sell: 1, mint: 1, expectedPoints: 800, tier: 'Silver', description: '1 Sell + 1 Mint' },
  { buy: 2, sell: 1, mint: 0, expectedPoints: 1300, tier: 'Silver', description: '2 Buys + 1 Sell' },
  { buy: 1, sell: 1, mint: 1, expectedPoints: 1600, tier: 'Silver', description: '1 Buy + 1 Sell + 1 Mint' },
  { buy: 2, sell: 2, mint: 1, expectedPoints: 1600, tier: 'Silver', description: '2 Buys + 2 Sells + 1 Mint (5 total)' },
  
  // Gold Tier (6+ NFTs total)
  { buy: 3, sell: 2, mint: 1, expectedPoints: 2500, tier: 'Gold', description: '3 Buys + 2 Sells + 1 Mint (6 total)' },
  { buy: 5, sell: 3, mint: 2, expectedPoints: 2500, tier: 'Gold', description: '5 Buys + 3 Sells + 2 Mints (10 total)' },
  { buy: 10, sell: 0, mint: 0, expectedPoints: 1200, tier: 'Gold', description: '10 Buys only' },
  { buy: 0, sell: 10, mint: 0, expectedPoints: 800, tier: 'Gold', description: '10 Sells only' },
  { buy: 0, sell: 0, mint: 10, expectedPoints: 500, tier: 'Gold', description: '10 Mints only' },
  { buy: 10, sell: 10, mint: 10, expectedPoints: 2500, tier: 'Gold', description: 'Max activity (30 total)' },
];

let passCount = 0;
let failCount = 0;

console.log('Testing OpenSea points calculation for different activity levels:\n');

testCases.forEach((testCase) => {
  const actualPoints = calculateOpenSeaPoints(testCase.buy, testCase.sell, testCase.mint);
  const passed = actualPoints === testCase.expectedPoints;
  const totalTxs = testCase.buy + testCase.sell + testCase.mint;

  if (passed) {
    passCount++;
    console.log(`✅ PASS: ${testCase.description}`);
    console.log(`   Buy: ${testCase.buy}, Sell: ${testCase.sell}, Mint: ${testCase.mint} (${totalTxs} total) → ${actualPoints} pts (${testCase.tier})`);
  } else {
    failCount++;
    console.log(`❌ FAIL: ${testCase.description}`);
    console.log(`   Buy: ${testCase.buy}, Sell: ${testCase.sell}, Mint: ${testCase.mint} (${totalTxs} total)`);
    console.log(`   Expected: ${testCase.expectedPoints} pts, Got: ${actualPoints} pts`);
  }
  console.log();
});

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
  console.log('Points Breakdown by Tier:');
  console.log();
  console.log('┌─────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┐');
  console.log('│ Tier        │ NFT Count    │ Buy Pts  │ Sell Pts │ Mint Pts │ Max Pts  │');
  console.log('├─────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┤');
  console.log('│ Bronze      │ 1 NFT        │ 300      │ 200      │ 100      │ 600      │');
  console.log('│ Silver      │ 2-5 NFTs     │ 800      │ 500      │ 300      │ 1,600    │');
  console.log('│ Gold        │ 6+ NFTs      │ 1,200    │ 800      │ 500      │ 2,500    │');
  console.log('└─────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┘');
  console.log();
  console.log('Note: Points are awarded based on the tier determined by TOTAL NFT transactions.');
  console.log('      If you have activity in multiple categories, you get points for each.');
  console.log();
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the calculation logic.');
  process.exit(1);
}
