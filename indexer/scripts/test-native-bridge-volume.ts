/**
 * Test script to verify Native Bridge (USDT0) volume calculations
 * 
 * Tests the parsing logic for OFTSent and OFTReceived events
 * and queries the database for wallet 0x748D4af3BBCD2d89097dDfb237F91284608C7F67
 * 
 * Run with: npx tsx indexer/scripts/test-native-bridge-volume.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// OFT Adapter contract address for Native Bridge (USDT0)
const OFT_ADAPTER_ADDRESS = '0x1cb6de532588fca4a21b7209de7c456af8434a65';

// Event signatures (topic0)
const OFT_SENT_SIGNATURE = '0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a';
const OFT_RECEIVED_SIGNATURE = '0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c';

// USDT0 has 6 decimals
const USDT0_DECIMALS = 6;

// LayerZero Executor contract (receives bridge IN transactions)
const LZ_EXECUTOR_ADDRESS = '0xfebcf17b11376c724ab5a5229803c6e838b6eae5';

// Test wallet
const TEST_WALLET = '0x748D4af3BBCD2d89097dDfb237F91284608C7F67'.toLowerCase();

interface OftEventLog {
  index: number;
  address: { id: string };
  topics: string[];
  data: string;
  event?: string;
}

/**
 * Parse OFTSent event data to extract amountSentLD
 */
function parseOftSentAmount(data: string): bigint {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  const amountHex = cleanData.slice(64, 128);
  return BigInt('0x' + amountHex);
}

/**
 * Parse OFTReceived event data to extract amountReceivedLD
 */
function parseOftReceivedAmount(data: string): bigint {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  const amountHex = cleanData.slice(64, 128);
  return BigInt('0x' + amountHex);
}

/**
 * Extract wallet address from indexed topic
 */
function extractAddressFromTopic(topic: string): string {
  const cleanTopic = topic.startsWith('0x') ? topic.slice(2) : topic;
  return '0x' + cleanTopic.slice(-40).toLowerCase();
}

async function testParsingLogic() {
  console.log('='.repeat(60));
  console.log('TEST 1: Parsing Logic Verification');
  console.log('='.repeat(60));

  // Test OFTSent parsing (from sample transaction)
  const oftSentData = '0x000000000000000000000000000000000000000000000000000000000000759e00000000000000000000000000000000000000000000000000000000000186a000000000000000000000000000000000000000000000000000000000000186a0';
  const sentAmount = parseOftSentAmount(oftSentData);
  const sentUsd = Number(sentAmount) / Math.pow(10, USDT0_DECIMALS);
  
  console.log('\nOFTSent Event (Bridge OUT):');
  console.log(`  Data: ${oftSentData}`);
  console.log(`  Raw amount: ${sentAmount}`);
  console.log(`  USD value: $${sentUsd.toFixed(2)}`);
  console.log(`  Expected: $0.10 (100000 / 10^6)`);
  console.log(`  ✓ Match: ${sentUsd === 0.1 ? 'YES' : 'NO'}`);

  // Test OFTReceived parsing (from sample transaction)
  const oftReceivedData = '0x000000000000000000000000000000000000000000000000000000000000767000000000000000000000000000000000000000000000000000000000000f4240';
  const receivedAmount = parseOftReceivedAmount(oftReceivedData);
  const receivedUsd = Number(receivedAmount) / Math.pow(10, USDT0_DECIMALS);
  
  console.log('\nOFTReceived Event (Bridge IN):');
  console.log(`  Data: ${oftReceivedData}`);
  console.log(`  Raw amount: ${receivedAmount}`);
  console.log(`  USD value: $${receivedUsd.toFixed(2)}`);
  console.log(`  Expected: $1.00 (1000000 / 10^6)`);
  console.log(`  ✓ Match: ${receivedUsd === 1.0 ? 'YES' : 'NO'}`);

  // Test address extraction
  const topic2Sent = '0x000000000000000000000000748d4af3bbcd2d89097ddfb237f91284608c7f67';
  const extractedAddress = extractAddressFromTopic(topic2Sent);
  
  console.log('\nAddress Extraction:');
  console.log(`  Topic: ${topic2Sent}`);
  console.log(`  Extracted: ${extractedAddress}`);
  console.log(`  Expected: ${TEST_WALLET}`);
  console.log(`  ✓ Match: ${extractedAddress === TEST_WALLET ? 'YES' : 'NO'}`);
}

async function testDatabaseQuery() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Database Query for Wallet (Optimized)');
  console.log('='.repeat(60));
  console.log(`\nWallet: ${TEST_WALLET}`);

  let bridgedInUsd = 0;
  let bridgedInCount = 0;
  let bridgedOutUsd = 0;
  let bridgedOutCount = 0;

  try {
    // 2a. Bridge OUT - Query transactions where user called OFT Adapter
    console.log('\n--- Bridge OUT (OFT Adapter contract) ---');
    const bridgeOutResult = await pool.query(
      `SELECT tx_hash, logs
       FROM transaction_enrichment
       WHERE contract_address = $1
         AND wallet_address = $2
         AND logs IS NOT NULL`,
      [OFT_ADAPTER_ADDRESS, TEST_WALLET]
    );

    console.log(`Found ${bridgeOutResult.rows.length} transactions from OFT Adapter`);

    for (const row of bridgeOutResult.rows) {
      const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
      if (!Array.isArray(logs)) continue;

      for (const log of logs) {
        const logAddress = (log.address?.id || '').toLowerCase();
        const topic0 = log.topics?.[0]?.toLowerCase();
        const topic2 = log.topics?.[2];

        if (logAddress !== OFT_ADAPTER_ADDRESS) continue;
        if (topic0 !== OFT_SENT_SIGNATURE) continue;
        if (!topic2) continue;

        const eventWallet = extractAddressFromTopic(topic2);
        if (eventWallet !== TEST_WALLET) continue;

        const amountRaw = parseOftSentAmount(log.data);
        const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);
        bridgedOutUsd += amountUsd;
        bridgedOutCount++;
        console.log(`  📤 OFTSent: $${amountUsd.toFixed(2)} USDT (tx: ${row.tx_hash.slice(0, 18)}...)`);
      }
    }

    // 2b. Bridge IN - Query transactions from LayerZero Executor containing wallet
    console.log('\n--- Bridge IN (LayerZero Executor contract) ---');
    const bridgeInResult = await pool.query(
      `SELECT tx_hash, logs
       FROM transaction_enrichment
       WHERE contract_address = $1
         AND logs IS NOT NULL
         AND logs::text ILIKE $2`,
      [LZ_EXECUTOR_ADDRESS, `%${TEST_WALLET}%`]
    );

    console.log(`Found ${bridgeInResult.rows.length} transactions from LZ Executor containing wallet`);

    for (const row of bridgeInResult.rows) {
      const logs: OftEventLog[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
      if (!Array.isArray(logs)) continue;

      for (const log of logs) {
        const logAddress = (log.address?.id || '').toLowerCase();
        const topic0 = log.topics?.[0]?.toLowerCase();
        const topic2 = log.topics?.[2];

        if (logAddress !== OFT_ADAPTER_ADDRESS) continue;
        if (topic0 !== OFT_RECEIVED_SIGNATURE) continue;
        if (!topic2) continue;

        const eventWallet = extractAddressFromTopic(topic2);
        if (eventWallet !== TEST_WALLET) continue;

        const amountRaw = parseOftReceivedAmount(log.data);
        const amountUsd = Number(amountRaw) / Math.pow(10, USDT0_DECIMALS);
        bridgedInUsd += amountUsd;
        bridgedInCount++;
        console.log(`  📥 OFTReceived: $${amountUsd.toFixed(2)} USDT (tx: ${row.tx_hash.slice(0, 18)}...)`);
      }
    }

    console.log('\n' + '-'.repeat(40));
    console.log('RESULTS:');
    console.log('-'.repeat(40));
    console.log(`  Bridged IN (to Ink Chain):`);
    console.log(`    Total USD: $${bridgedInUsd.toFixed(2)}`);
    console.log(`    Tx Count: ${bridgedInCount}`);
    console.log(`  Bridged OUT (from Ink Chain):`);
    console.log(`    Total USD: $${bridgedOutUsd.toFixed(2)}`);
    console.log(`    Tx Count: ${bridgedOutCount}`);
    console.log(`  Combined Total: $${(bridgedInUsd + bridgedOutUsd).toFixed(2)}`);

  } catch (error) {
    console.error('Database error:', error);
  }
}

async function testApiEndpoint() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: API Endpoint Response');
  console.log('='.repeat(60));

  const apiUrl = `http://localhost:3000/api/wallet/${TEST_WALLET}/bridge`;
  console.log(`\nCalling: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.log(`  ❌ API returned ${response.status}: ${response.statusText}`);
      return;
    }

    const data = await response.json();
    console.log('\nAPI Response:');
    console.log(JSON.stringify(data, null, 2));

    // Check Native Bridge (USDT0) platform
    const nativeBridge = data.byPlatform?.find((p: any) => p.platform === 'Native Bridge (USDT0)');
    if (nativeBridge) {
      console.log('\n✓ Native Bridge (USDT0) found in response:');
      console.log(`  Bridged IN: $${nativeBridge.bridgedInUsd?.toFixed(2) || '0.00'} (${nativeBridge.bridgedInCount || 0} tx)`);
      console.log(`  Bridged OUT: $${nativeBridge.bridgedOutUsd?.toFixed(2) || '0.00'} (${nativeBridge.bridgedOutCount || 0} tx)`);
      console.log(`  Total: $${nativeBridge.usdValue?.toFixed(2) || '0.00'}`);
    } else {
      console.log('\n⚠ Native Bridge (USDT0) not found in response');
    }

  } catch (error) {
    console.log(`  ⚠ Could not reach API (is the server running?): ${error}`);
  }
}

async function main() {
  console.log('\n🔍 Native Bridge (USDT0) Volume Test');
  console.log('Testing wallet: ' + TEST_WALLET);
  console.log('');

  await testParsingLogic();
  await testDatabaseQuery();
  await testApiEndpoint();

  console.log('\n' + '='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(console.error);
