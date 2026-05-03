import { pointsServiceV2 } from '../src/services/points-service-v2';

/**
 * Test script for Templars of the Storm NFT points calculation
 * 
 * This script tests the points allocation for Templars NFT holders:
 * - 1 NFT: 1,500 pts (Base Tier)
 * - 2 NFTs: 2,200 pts (Silver Tier)
 * - 3+ NFTs: 2,700 pts (Gold/Whale Tier)
 */

async function testTemplarsPoints() {
  console.log('='.repeat(80));
  console.log('TEMPLARS OF THE STORM NFT POINTS TEST');
  console.log('='.repeat(80));
  console.log();

  // Test wallets - replace with actual wallet addresses that hold Templars NFTs
  const testWallets = [
    {
      address: '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5', // Replace with wallet that has 1 NFT
      expectedNFTs: 1,
      expectedPoints: 1500,
      tier: 'Base Tier'
    },
    {
      address: '0x27326Bd8E518183c5266B031Cf90734e17dc4800', // Replace with wallet that has 2 NFTs
      expectedNFTs: 2,
      expectedPoints: 2200,
      tier: 'Silver Tier'
    },
    {
      address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb', // Replace with wallet that has 3+ NFTs
      expectedNFTs: 3,
      expectedPoints: 2700,
      tier: 'Gold/Whale Tier'
    }
  ];

  console.log('Testing Templars NFT Points Calculation...\n');

  for (const testCase of testWallets) {
    console.log('-'.repeat(80));
    console.log(`Wallet: ${testCase.address}`);
    console.log(`Expected: ${testCase.expectedNFTs} NFT(s) → ${testCase.expectedPoints} points (${testCase.tier})`);
    console.log();

    try {
      // Fetch wallet score
      const score = await pointsServiceV2.calculateWalletScore(testCase.address);

      // Extract Templars data from breakdown
      const templarsData = score.breakdown.platforms['templars'];

      if (templarsData) {
        const nftBalance = templarsData.tx_count; // We use tx_count to store NFT balance
        const points = templarsData.points;

        console.log(`✓ Actual NFT Balance: ${nftBalance}`);
        console.log(`✓ Actual Points: ${points}`);
        console.log();

        // Verify points calculation
        let expectedPoints = 0;
        if (nftBalance >= 3) {
          expectedPoints = 2700;
          console.log(`✓ Tier: Gold/Whale (3+ NFTs)`);
        } else if (nftBalance >= 2) {
          expectedPoints = 2200;
          console.log(`✓ Tier: Silver (2 NFTs)`);
        } else if (nftBalance >= 1) {
          expectedPoints = 1500;
          console.log(`✓ Tier: Base (1 NFT)`);
        } else {
          expectedPoints = 0;
          console.log(`✓ Tier: None (0 NFTs)`);
        }

        if (points === expectedPoints) {
          console.log(`✅ PASS: Points calculation is correct!`);
        } else {
          console.log(`❌ FAIL: Expected ${expectedPoints} points but got ${points}`);
        }
      } else {
        console.log(`⚠️  No Templars data found in breakdown`);
        console.log(`   This could mean the wallet has 0 NFTs or the API failed`);
      }

      console.log();
      console.log(`Total Wallet Score: ${score.total_points} points`);
      console.log(`Rank: ${score.rank?.name || 'No rank'}`);

    } catch (error) {
      console.error(`❌ Error testing wallet ${testCase.address}:`, error);
    }

    console.log();
  }

  console.log('='.repeat(80));
  console.log('POINTS TIER BREAKDOWN');
  console.log('='.repeat(80));
  console.log();
  console.log('| NFT Balance | Points | Tier              | Description                           |');
  console.log('|-------------|--------|-------------------|---------------------------------------|');
  console.log('| 0 NFTs      | 0      | None              | No Templars NFTs held                 |');
  console.log('| 1 NFT       | 1,500  | Base Tier         | Unlocks core holder multiplier        |');
  console.log('| 2 NFTs      | 2,200  | Silver Tier       | +700 loyalty bonus                    |');
  console.log('| 3+ NFTs     | 2,700  | Gold/Whale Tier   | Maximum points for holding category   |');
  console.log();
  console.log('='.repeat(80));
}

// Run the test
testTemplarsPoints()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
