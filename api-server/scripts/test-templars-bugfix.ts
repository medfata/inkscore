import 'dotenv/config';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';

interface TemplarsResponse {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  value: number;
  total_count: number;
  total_value: string;
  sub_aggregates: unknown[];
  last_updated: Date;
}

async function testTemplarsBugFix() {
  console.log('='.repeat(60));
  console.log('TEMPLARS OF THE STORM BUG FIX TEST');
  console.log('='.repeat(60));
  console.log();

  const testWallet = '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5';
  console.log(`Testing wallet: ${testWallet}`);
  console.log();

  // Step 1: Test the analytics API directly
  console.log('STEP 1: Testing analytics API endpoint');
  console.log('-'.repeat(40));

  const templarsUrl = `${API_BASE_URL}/api/analytics/${testWallet}/templars_nft_balance`;
  console.log(`GET ${templarsUrl}`);

  const templarsRes = await fetch(templarsUrl);

  if (!templarsRes.ok) {
    console.error(`❌ API request failed: HTTP ${templarsRes.status}`);
    process.exit(1);
  }

  const templarsData = (await templarsRes.json()) as TemplarsResponse;

  console.log(`✓ Response received:`);
  console.log(`  - value: ${templarsData.value} (should be 2)`);
  console.log(`  - total_count: ${templarsData.total_count}`);
  console.log(`  - total_value: ${templarsData.total_value}`);
  console.log();

  // Verify the fix: value should exist and be non-zero
  if (!templarsData.value || templarsData.value === 0) {
    console.error('❌ FAIL: value property is missing or zero!');
    console.error('   The analytics API should return value property with NFT count');
    process.exit(1);
  }

  console.log('✅ PASS: analytics API returns value property');
  console.log();

  // Step 2: Test points calculation
  console.log('STEP 2: Testing points calculation');
  console.log('-'.repeat(40));

  // Calculate expected points based on NFT balance
  const nftBalance = templarsData.value;
  let expectedPoints = 0;
  let tier = '';

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

  console.log(`  NFT Balance: ${nftBalance}`);
  console.log(`  Expected Points: ${expectedPoints} (${tier})`);
  console.log();

  // Step 3: Test full wallet score endpoint
  console.log('STEP 3: Testing full wallet score endpoint');
  console.log('-'.repeat(40));

  const scoreUrl = `${API_BASE_URL}/api/wallet/${testWallet}/score`;
  console.log(`GET ${scoreUrl}`);

  const scoreRes = await fetch(scoreUrl);

  if (!scoreRes.ok) {
    console.error(`❌ Score API request failed: HTTP ${scoreRes.status}`);
    process.exit(1);
  }

  const score = (await scoreRes.json()) as {
    breakdown?: {
      platforms?: {
        templars?: { tx_count: number; points: number };
      };
    };
  };

  const templarsBreakdown = score.breakdown?.platforms?.['templars'];

  if (!templarsBreakdown) {
    console.error('❌ FAIL: No templars entry in breakdown');
    process.exit(1);
  }

  const actualPoints = templarsBreakdown.points;

  console.log(`✓ Templars breakdown:`);
  console.log(`  - tx_count: ${templarsBreakdown.tx_count}`);
  console.log(`  - points: ${actualPoints}`);
  console.log();

  // Verify points match expected
  if (actualPoints === expectedPoints) {
    console.log(`✅ PASS: Points calculation is correct!`);
    console.log(`   ${nftBalance} NFTs → ${actualPoints} points (${tier})`);
  } else {
    console.error(`❌ FAIL: Expected ${expectedPoints} points but got ${actualPoints}`);
    process.exit(1);
  }

  console.log();
  console.log('='.repeat(60));
  console.log('TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Wallet: ${testWallet}`);
  console.log(`  NFT Balance: ${nftBalance}`);
  console.log(`  Points: ${actualPoints}`);
  console.log(`  Tier: ${tier}`);
  console.log(`  Status: ✅ BUG FIX VERIFIED`);
  console.log('='.repeat(60));
}

testTemplarsBugFix()
  .then(() => {
    console.log('\n✅ Test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });