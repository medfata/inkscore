import 'dotenv/config';

/**
 * Integration test for Templars of the Storm NFT points
 * This test makes actual API calls to verify the end-to-end flow
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

interface TemplarsResponse {
  slug: string;
  name: string;
  description: string;
  icon: string;
  currency: string;
  aggregation_type: string;
  value: number;
  total_count: number;
}

interface WalletScoreResponse {
  wallet_address: string;
  total_points: number;
  rank: {
    name: string;
    color: string | null;
    logo_url: string | null;
  } | null;
  breakdown: {
    native: Record<string, any>;
    platforms: Record<string, {
      tx_count: number;
      usd_volume: number;
      points: number;
    }>;
  };
  last_updated: string;
}

async function testTemplarsIntegration() {
  console.log('='.repeat(80));
  console.log('TEMPLARS NFT POINTS - INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log();
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log();

  // Test wallet address - you can replace this with a wallet that actually holds Templars NFTs
  const testWallet = '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5';

  console.log(`Testing wallet: ${testWallet}`);
  console.log();

  // Step 1: Test the Templars NFT balance endpoint
  console.log('Step 1: Fetching Templars NFT balance...');
  console.log('-'.repeat(80));

  try {
    const templarsUrl = `${API_BASE_URL}/api/analytics/${testWallet}/templars_nft_balance`;
    console.log(`GET ${templarsUrl}`);
    
    const templarsResponse = await fetch(templarsUrl);
    
    if (!templarsResponse.ok) {
      throw new Error(`HTTP ${templarsResponse.status}: ${templarsResponse.statusText}`);
    }

    const templarsData: TemplarsResponse = await templarsResponse.json();
    
    console.log('✓ Response received:');
    console.log(`  Name: ${templarsData.name}`);
    console.log(`  NFT Balance: ${templarsData.value}`);
    console.log(`  Total Count: ${templarsData.total_count}`);
    console.log();

    const nftBalance = templarsData.value;

    // Calculate expected points
    let expectedPoints = 0;
    let tier = 'None';
    if (nftBalance >= 3) {
      expectedPoints = 2700;
      tier = 'Gold/Whale Tier';
    } else if (nftBalance >= 2) {
      expectedPoints = 2200;
      tier = 'Silver Tier';
    } else if (nftBalance >= 1) {
      expectedPoints = 1500;
      tier = 'Base Tier';
    }

    console.log(`Expected Points: ${expectedPoints} (${tier})`);
    console.log();

    // Step 2: Test the wallet score endpoint
    console.log('Step 2: Fetching wallet score with Templars points...');
    console.log('-'.repeat(80));

    const scoreUrl = `${API_BASE_URL}/api/wallet/${testWallet}/score`;
    console.log(`GET ${scoreUrl}`);

    const scoreResponse = await fetch(scoreUrl);

    if (!scoreResponse.ok) {
      throw new Error(`HTTP ${scoreResponse.status}: ${scoreResponse.statusText}`);
    }

    const scoreData: WalletScoreResponse = await scoreResponse.json();

    console.log('✓ Response received:');
    console.log(`  Total Points: ${scoreData.total_points}`);
    console.log(`  Rank: ${scoreData.rank?.name || 'No rank'}`);
    console.log();

    // Check if Templars data is in the breakdown
    const templarsBreakdown = scoreData.breakdown.platforms['templars'];

    if (templarsBreakdown) {
      console.log('✓ Templars data found in breakdown:');
      console.log(`  NFT Balance (tx_count): ${templarsBreakdown.tx_count}`);
      console.log(`  Points: ${templarsBreakdown.points}`);
      console.log(`  USD Volume: ${templarsBreakdown.usd_volume}`);
      console.log();

      // Verify the points calculation
      if (templarsBreakdown.points === expectedPoints) {
        console.log('✅ SUCCESS: Points calculation is correct!');
        console.log(`   ${nftBalance} NFT(s) → ${templarsBreakdown.points} points (${tier})`);
      } else {
        console.log('❌ FAILURE: Points calculation mismatch!');
        console.log(`   Expected: ${expectedPoints} points`);
        console.log(`   Actual: ${templarsBreakdown.points} points`);
      }
    } else {
      console.log('⚠️  WARNING: Templars data not found in breakdown');
      console.log('   This could mean:');
      console.log('   - The wallet has 0 Templars NFTs');
      console.log('   - The API endpoint failed');
      console.log('   - The points service is not including Templars data');
    }

    console.log();
    console.log('='.repeat(80));
    console.log('PLATFORM BREAKDOWN');
    console.log('='.repeat(80));
    console.log();

    // Display all platforms with points
    const platforms = Object.entries(scoreData.breakdown.platforms)
      .filter(([_, data]) => data.points > 0)
      .sort((a, b) => b[1].points - a[1].points);

    if (platforms.length > 0) {
      console.log('Platforms with points:');
      platforms.forEach(([platform, data]) => {
        console.log(`  • ${platform.padEnd(20)} ${data.points.toString().padStart(6)} points`);
      });
    } else {
      console.log('No platforms with points found.');
    }

    console.log();
    console.log('='.repeat(80));
    console.log('TEST COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));

  } catch (error) {
    console.error();
    console.error('❌ ERROR:', error);
    console.error();
    console.error('Make sure:');
    console.error('1. The API server is running');
    console.error('2. The DATABASE_URL is configured correctly');
    console.error('3. The wallet address is valid');
    process.exit(1);
  }
}

// Run the test
testTemplarsIntegration()
  .then(() => {
    console.log();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
