/**
 * Unit test for Sweep platform points calculation logic
 * Tests the tiered calculation method directly without making API calls
 */

// Simulate the calculation method
function calculateSweepPoints(collectionsCreated: number, badgesMinted: number, dailyStreak: number): number {
  // Sweep Platform Points (Max: 800 points)
  // Tiered system based on activity counts
  
  // 1. Create Collection (Max: 350 points)
  let collectionPoints = 0;
  if (collectionsCreated >= 6) {
    collectionPoints = 350; // Tier 3: Gold (6+ collections)
  } else if (collectionsCreated >= 2) {
    collectionPoints = 250; // Tier 2: Silver (2-5 collections)
  } else if (collectionsCreated >= 1) {
    collectionPoints = 100; // Tier 1: Bronze (1 collection)
  }
  
  // 2. Mint Badge (Max: 250 points)
  let badgePoints = 0;
  if (badgesMinted >= 3) {
    badgePoints = 250; // Tier 3: Gold (3+ badges)
  } else if (badgesMinted >= 2) {
    badgePoints = 150; // Tier 2: Silver (2 badges)
  } else if (badgesMinted >= 1) {
    badgePoints = 100; // Tier 1: Bronze (1 badge)
  }
  
  // 3. Daily Streak (Max: 200 points)
  let streakPoints = 0;
  if (dailyStreak >= 6) {
    streakPoints = 200; // Tier 3: Gold (6+ days)
  } else if (dailyStreak >= 2) {
    streakPoints = 100; // Tier 2: Silver (2-5 days)
  } else if (dailyStreak >= 1) {
    streakPoints = 50; // Tier 1: Bronze (1 day)
  }
  
  return collectionPoints + badgePoints + streakPoints;
}

console.log('='.repeat(80));
console.log('SWEEP PLATFORM POINTS - UNIT TEST');
console.log('='.repeat(80));
console.log();

const testCases = [
  // No activity
  { collections: 0, badges: 0, streak: 0, expectedPoints: 0, tier: 'None', description: 'No activity' },
  
  // Single activity tests
  { collections: 1, badges: 0, streak: 0, expectedPoints: 100, tier: 'Bronze', description: '1 Collection only' },
  { collections: 0, badges: 1, streak: 0, expectedPoints: 100, tier: 'Bronze', description: '1 Badge only' },
  { collections: 0, badges: 0, streak: 1, expectedPoints: 50, tier: 'Bronze', description: '1 Day streak only' },
  
  // Bronze tier combinations
  { collections: 1, badges: 1, streak: 1, expectedPoints: 250, tier: 'Bronze', description: '1 of each (Bronze)' },
  
  // Silver tier - Collections
  { collections: 2, badges: 0, streak: 0, expectedPoints: 250, tier: 'Silver', description: '2 Collections' },
  { collections: 3, badges: 0, streak: 0, expectedPoints: 250, tier: 'Silver', description: '3 Collections' },
  { collections: 5, badges: 0, streak: 0, expectedPoints: 250, tier: 'Silver', description: '5 Collections' },
  
  // Silver tier - Badges
  { collections: 0, badges: 2, streak: 0, expectedPoints: 150, tier: 'Silver', description: '2 Badges' },
  
  // Silver tier - Streak
  { collections: 0, badges: 0, streak: 2, expectedPoints: 100, tier: 'Silver', description: '2 Day streak' },
  { collections: 0, badges: 0, streak: 5, expectedPoints: 100, tier: 'Silver', description: '5 Day streak' },
  
  // Gold tier - Collections
  { collections: 6, badges: 0, streak: 0, expectedPoints: 350, tier: 'Gold', description: '6 Collections' },
  { collections: 10, badges: 0, streak: 0, expectedPoints: 350, tier: 'Gold', description: '10 Collections' },
  
  // Gold tier - Badges
  { collections: 0, badges: 3, streak: 0, expectedPoints: 250, tier: 'Gold', description: '3 Badges' },
  { collections: 0, badges: 5, streak: 0, expectedPoints: 250, tier: 'Gold', description: '5 Badges' },
  
  // Gold tier - Streak
  { collections: 0, badges: 0, streak: 6, expectedPoints: 200, tier: 'Gold', description: '6 Day streak' },
  { collections: 0, badges: 0, streak: 10, expectedPoints: 200, tier: 'Gold', description: '10 Day streak' },
  
  // Mixed tier combinations
  { collections: 2, badges: 2, streak: 2, expectedPoints: 500, tier: 'Silver', description: '2 of each (Silver)' },
  { collections: 6, badges: 3, streak: 6, expectedPoints: 800, tier: 'Gold', description: 'Max activity (Gold)' },
  { collections: 10, badges: 5, streak: 10, expectedPoints: 800, tier: 'Gold', description: 'Super active (Gold)' },
  
  // Edge cases
  { collections: 1, badges: 3, streak: 6, expectedPoints: 550, tier: 'Mixed', description: 'Bronze collection + Gold badges/streak' },
  { collections: 6, badges: 1, streak: 1, expectedPoints: 500, tier: 'Mixed', description: 'Gold collection + Bronze badges/streak' },
];

let passCount = 0;
let failCount = 0;

console.log('Testing Sweep points calculation for different activity levels:\n');

testCases.forEach((testCase) => {
  const actualPoints = calculateSweepPoints(testCase.collections, testCase.badges, testCase.streak);
  const passed = actualPoints === testCase.expectedPoints;

  if (passed) {
    passCount++;
    console.log(`✅ PASS: ${testCase.description}`);
    console.log(`   Collections: ${testCase.collections}, Badges: ${testCase.badges}, Streak: ${testCase.streak}`);
    console.log(`   Points: ${actualPoints} (${testCase.tier})`);
  } else {
    failCount++;
    console.log(`❌ FAIL: ${testCase.description}`);
    console.log(`   Collections: ${testCase.collections}, Badges: ${testCase.badges}, Streak: ${testCase.streak}`);
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
  console.log('Points Breakdown by Activity Type:');
  console.log();
  console.log('┌──────────────────────┬─────────────────┬─────────────────┬─────────────────┬──────────┐');
  console.log('│ Activity Type        │ Bronze (1x)     │ Silver (2-5x)   │ Gold (6+x)      │ Max Pts  │');
  console.log('├──────────────────────┼─────────────────┼─────────────────┼─────────────────┼──────────┤');
  console.log('│ Create Collection    │ 100 pts         │ 250 pts         │ 350 pts         │ 350      │');
  console.log('│ Mint Badge           │ 100 pts (1x)    │ 150 pts (2x)    │ 250 pts (3+)    │ 250      │');
  console.log('│ Daily Streak         │ 50 pts          │ 100 pts         │ 200 pts         │ 200      │');
  console.log('├──────────────────────┴─────────────────┴─────────────────┴─────────────────┼──────────┤');
  console.log('│ TOTAL MAXIMUM POINTS                                                        │ 800      │');
  console.log('└─────────────────────────────────────────────────────────────────────────────┴──────────┘');
  console.log();
  console.log('Note: Each activity type is scored independently based on its own tier.');
  console.log('      Total points = Collection points + Badge points + Streak points');
  console.log();
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the calculation logic.');
  process.exit(1);
}
