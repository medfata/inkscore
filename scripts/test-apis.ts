/**
 * Quick test script for the new Platform & Points APIs
 * Run with: npx tsx scripts/test-apis.ts
 */

const BASE_URL = 'http://localhost:3000';

async function testAPI(name: string, url: string) {
  console.log(`\n=== Testing: ${name} ===`);
  console.log(`URL: ${url}`);
  
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log('Response:', JSON.stringify(data, null, 2).slice(0, 500));
    if (JSON.stringify(data).length > 500) console.log('... (truncated)');
    return data;
  } catch (err) {
    console.error('Error:', err);
    return null;
  }
}

async function main() {
  console.log('Testing Platform & Points System APIs\n');
  console.log('Make sure Next.js dev server is running on port 3000\n');

  // Test admin APIs
  await testAPI('Platforms List', `${BASE_URL}/api/admin/platforms`);
  await testAPI('Native Metrics', `${BASE_URL}/api/admin/points/native-metrics`);
  await testAPI('Ranks', `${BASE_URL}/api/admin/points/ranks`);
  await testAPI('Points Rules', `${BASE_URL}/api/admin/points/rules`);

  // Test wallet score (use a known wallet from your data)
  const testWallet = '0xD0C0AdE59C0c277D078216d57860486f5B4402A9';
  await testAPI('Wallet Score', `${BASE_URL}/api/wallet/${testWallet}/score`);

  console.log('\n=== All tests complete ===');
}

main().catch(console.error);
