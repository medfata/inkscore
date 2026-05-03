import 'dotenv/config';

/**
 * Integration test for OpenSea NFT Activity points
 * This test makes actual API calls to verify the end-to-end flow
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

interface OpenSeaResponse {
  slug: string;
  name: string;
  description?: string;
  icon: string;
  currency: string;
  aggregation_type: string;
  value?: number;
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

async function testOpenSeaIntegration() {
  console.log('='.repeat(80));
  console.log('OPENSEA NFT ACTIVITY POINTS - INTEGRATION TEST');
  console.log('='.repeat(80));
  console.log();
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log();

  // Test wallet address - replace with a wallet that has OpenSea activity
  const testWallet = '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5';

  console.log(`Testing wallet: ${testWallet}`);
  console.log();

  // Step 1: Fetch OpenSea Buy Count
  console.log('Step 1: Fetching OpenSea Buy Count...');
  console.log('-'.repeat(80));

  try {
    const buyUrl = `${API_BASE_URL}/api/analytics/${testWallet}/opensea_buy_count`;
    console.log(`GET ${buyUrl}`);
    
    const buyResponse = await fetch(buyUrl);
    
    if (!buyResponse.ok) {
      throw new Error(`HTTP ${buyResponse.status}: ${buyResponse.statusText}`);
    }

    const buyData: OpenSeaResponse = await buyResponse.json();
    const buyCount = buyData.total_count;
    
    console.log('✓ Buy Response received:');
    console.log(`  Name: ${buyData.name}`);
    console.log(`  Buy Count: ${buyCount}`);
    console.log();

    // Step 2: Fetch OpenSea Sell Count
    console.log('Step 2: Fetching OpenSea Sell Count...');
    console.log('-'.repeat(80));

    const sellUrl = `${API_BASE_URL}/api/analytics/${testWallet}/opensea_sale_count`;
    console.log(`GET ${sellUrl}`);
    
    const sellResponse = await fetch(sellUrl);
    
    if (!sellResponse.ok) {
      throw new Error(`HTTP ${sellResponse.status}: ${sellResponse.statusText}`);
    }

    const sellData: OpenSeaResponse = await sellResponse.json();
    const sellCount = sellData.total_count;
    
    console.log('✓ Sell Response received:');
    console.log(`  Name: ${sellData.name}`);
    console.log(`  Sell Count: ${sellCount}`);
    console.log();

    // Step 3: Fetch Mint Count
    console.log('Step 3: Fetching Mint Count...');
    console.log('-'.repeat(80));

    const mintUrl = `${API_BASE_URL}/api/analytics/${testWallet}/mint_count`;
    console.log(`GET ${mintUrl}`);
    
    const mintResponse = await fetch(mintUrl);
    
    if (!mintResponse.ok) {
      throw new Error(`HTTP ${mintResponse.status}: ${mintResponse.statusText}`);
    }

    const mintData: OpenSeaResponse = await mintResponse.json();
    const mintCount = mintData.total_count;
    
    console.log('✓ Mint Response received:');
    console.log(`  Name: ${mintData.name}`);
    console.log(`  Mint Count: ${mintCount}`);
    console.log();

    // Calculate expected points
    const totalNftTxs = buyCount + sellCount + mintCount;
    let tier: string;
    let expectedPoints = 0;

    if (totalNftTxs === 0) {
      tier = 'None';
      expectedPoints = 0;
    } else if (totalNftTxs >= 6) {
      tier = 'Gold';
      if (buyCount > 0) expectedPoints += 1200;
      if (sellCount > 0) expectedPoints += 800;
      if (mintCount > 0) expectedPoints += 500;
    } else if (totalNftTxs >= 2) {
      tier = 'Silver';
      if (buyCount > 0) expectedPoints += 800;
      if (sellCount > 0) expectedPoints += 500;
      if (mintCount > 0) expectedPoints += 300;
    } else {
      tier = 'Bronze';
      if (buyCount > 0) expectedPoints += 300;
      if (sellCount > 0) expectedPoints += 200;
      if (mintCount > 0) expectedPoints += 100;
    }

    console.log('Activity Summary:');
    console.log(`  Total NFT Transactions: ${totalNftTxs}`);
    console.log(`  Tier: ${tier}`);
    console.log(`  Expected Points: ${expectedPoints}`);
    console.log();

    // Step 4: Test the wallet score endpoint
    console.log('Step 4: Fetching wallet score with OpenSea points...');
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

    // Check if OpenSea data is in the breakdown
    const openSeaBreakdown = scoreData.breakdown.platforms['opensea'];

    if (openSeaBreakdown) {
      console.log('✓ OpenSea data found in breakdown:');
      console.log(`  Total Transactions: ${openSeaBreakdown.tx_count}`);
      console.log(`  Points: ${openSeaBreakdown.points}`);
      console.log(`  USD Volume: ${openSeaBreakdown.usd_volume}`);
      console.log();

      // Verify the points calculation
      if (openSeaBreakdown.points === expectedPoints) {
        console.log('✅ SUCCESS: Points calculation is correct!');
        console.log(`   ${totalNftTxs} NFT transaction(s) → ${openSeaBreakdown.points} points (${tier})`);
        console.log();
        console.log('   Breakdown:');
        if (buyCount > 0) console.log(`   - ${buyCount} Buy(s)`);
        if (sellCount > 0) console.log(`   - ${sellCount} Sell(s)`);
        if (mintCount > 0) console.log(`   - ${mintCount} Mint(s)`);
      } else {
        console.log('❌ FAILURE: Points calculation mismatch!');
        console.log(`   Expected: ${expectedPoints} points`);
        console.log(`   Actual: ${openSeaBreakdown.points} points`);
      }
    } else {
      console.log('⚠️  WARNING: OpenSea data not found in breakdown');
      console.log('   This could mean:');
      console.log('   - The wallet has no OpenSea activity');
      console.log('   - The API endpoints failed');
      console.log('   - The points service is not including OpenSea data');
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
    console.log('TIER REFERENCE');
    console.log('='.repeat(80));
    console.log();
    console.log('┌─────────────┬──────────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('│ Tier        │ NFT Count    │ Buy Pts  │ Sell Pts │ Mint Pts │ Max Pts  │');
    console.log('├─────────────┼──────────────┼──────────┼──────────┼──────────┼──────────┤');
    console.log('│ Bronze      │ 1 NFT        │ 300      │ 200      │ 100      │ 600      │');
    console.log('│ Silver      │ 2-5 NFTs     │ 800      │ 500      │ 300      │ 1,600    │');
    console.log('│ Gold        │ 6+ NFTs      │ 1,200    │ 800      │ 500      │ 2,500    │');
    console.log('└─────────────┴──────────────┴──────────┴──────────┴──────────┴──────────┘');
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
testOpenSeaIntegration()
  .then(() => {
    console.log();
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
