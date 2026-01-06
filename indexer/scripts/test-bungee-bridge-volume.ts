/**
 * Test script to verify Bungee Bridge volume calculations
 * 
 * Tests the parsing logic for SocketBridge and SocketSwapTokens events
 * and queries the database for the test wallet from the JSON examples
 * 
 * Run with: npx tsx indexer/scripts/test-bungee-bridge-volume.ts
 */

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test wallet from the JSON examples
const TEST_WALLET = '0xd0c0ade59c0c277d078216d57860486f5b4402a9';

// Bungee Socket Gateway contract address
const BUNGEE_SOCKET_GATEWAY = '0x3a23f943181408eac424116af7b7790c94cb97a5';

// Event signatures
const SOCKET_BRIDGE_SIGNATURE = '0x74594da9e31ee4068e17809037db37db496702bf7d8d63afe6f97949277d1609';
const SOCKET_SWAP_TOKENS_SIGNATURE = '0xb346a959ba6c0f1c7ba5426b10fd84fe4064e392a0dfcf6609e9640a0dd260d3';

interface LogEvent {
  index: number;
  address: { id: string };
  topics: string[];
  data: string;
  event?: string;
}

/**
 * Parse SocketBridge event data to extract amount and token
 */
function parseSocketBridgeEvent(data: string): { amount: bigint; token: string; toChainId: bigint } {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  
  // amount is first 32 bytes
  const amountHex = cleanData.slice(0, 64);
  const amount = BigInt('0x' + amountHex);
  
  // token is second 32 bytes (address padded to 32 bytes)
  const tokenHex = cleanData.slice(64, 128);
  const token = '0x' + tokenHex.slice(-40).toLowerCase();
  
  // toChainId is third 32 bytes
  const chainIdHex = cleanData.slice(128, 192);
  const toChainId = BigInt('0x' + chainIdHex);
  
  return { amount, token, toChainId };
}

/**
 * Parse SocketSwapTokens event data to extract buy/sell amounts
 */
function parseSocketSwapTokensEvent(data: string): { fromToken: string; toToken: string; buyAmount: bigint; sellAmount: bigint } {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  
  // fromToken is first 32 bytes (address padded)
  const fromTokenHex = cleanData.slice(0, 64);
  const fromToken = '0x' + fromTokenHex.slice(-40).toLowerCase();
  
  // toToken is second 32 bytes (address padded)
  const toTokenHex = cleanData.slice(64, 128);
  const toToken = '0x' + toTokenHex.slice(-40).toLowerCase();
  
  // buyAmount is third 32 bytes
  const buyAmountHex = cleanData.slice(128, 192);
  const buyAmount = BigInt('0x' + buyAmountHex);
  
  // sellAmount is fourth 32 bytes
  const sellAmountHex = cleanData.slice(192, 256);
  const sellAmount = BigInt('0x' + sellAmountHex);
  
  return { fromToken, toToken, buyAmount, sellAmount };
}

// Test the parsing functions with known data from the JSON examples
function testParsing() {
  console.log('🧪 Testing Event Parsing Functions\n');

  // Test data from bungee_bridge_in_ink_tx2.json (SocketBridge event)
  const socketBridgeData = '0x0000000000000000000000000000000000000000000000000000a3b5840f4000000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000000000000002105709f58818bedd58450336213e1f2f6ff7405a2b1e594f64270a17b7e2249419c000000000000000000000000d0c0ade59c0c277d078216d57860486f5b4402a9000000000000000000000000d0c0ade59c0c277d078216d57860486f5b4402a90000000000000000000000000000000000000000000000000000000000002710';
  
  try {
    const bridgeResult = parseSocketBridgeEvent(socketBridgeData);
    console.log('✅ SocketBridge Event Parsed:');
    console.log(`   Amount: ${bridgeResult.amount} wei (${Number(bridgeResult.amount) / Math.pow(10, 18)} ETH)`);
    console.log(`   Token: ${bridgeResult.token}`);
    console.log(`   To Chain ID: ${bridgeResult.toChainId}`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to parse SocketBridge event:', error);
  }

  // Test data from bungee_bridge_in_ink.json (SocketSwapTokens event)
  const socketSwapData = '0x00000000000000000000000020c69c12abf2b6f8d8ca33604dd25c700c7e70a5000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000061c966a71c8d000000000000000000000000000000000000000000000008b03bd0ab87f3f123d5ade32bc0364d90a2d977abebbc954d3e7173e4b8ccbb82398a1a91a032dc13000000000000000000000000d0c0ade59c0c277d078216d57860486f5b4402a90000000000000000000000000000000000000000000000000000000000002710';
  
  try {
    const swapResult = parseSocketSwapTokensEvent(socketSwapData);
    console.log('✅ SocketSwapTokens Event Parsed:');
    console.log(`   From Token: ${swapResult.fromToken}`);
    console.log(`   To Token: ${swapResult.toToken}`);
    console.log(`   Buy Amount: ${swapResult.buyAmount} wei (${Number(swapResult.buyAmount) / Math.pow(10, 18)} ETH)`);
    console.log(`   Sell Amount: ${swapResult.sellAmount} wei (${Number(swapResult.sellAmount) / Math.pow(10, 18)} tokens)`);
    console.log('');
  } catch (error) {
    console.error('❌ Failed to parse SocketSwapTokens event:', error);
  }
}

async function testDatabaseQuery() {
  console.log('🔍 Testing Database Query for Bungee Transactions\n');
  console.log(`Testing wallet: ${TEST_WALLET}`);
  console.log(`Bungee contract: ${BUNGEE_SOCKET_GATEWAY}`);
  console.log('');

  try {
    const result = await pool.query(
      `SELECT 
         tx_hash,
         logs,
         eth_value_decimal,
         total_usd_volume,
         value,
         method_id
       FROM transaction_enrichment
       WHERE contract_address = $1
         AND wallet_address = $2
         AND logs IS NOT NULL
       ORDER BY created_at DESC`,
      [BUNGEE_SOCKET_GATEWAY, TEST_WALLET]
    );

    console.log(`📊 Found ${result.rows.length} Bungee transactions for test wallet`);
    
    if (result.rows.length === 0) {
      console.log('ℹ️  No transactions found. This could mean:');
      console.log('   - The transactions haven\'t been indexed yet');
      console.log('   - The wallet address format doesn\'t match');
      console.log('   - The contract address is different');
      return;
    }

    let totalUsdVolume = 0;
    let bridgeCount = 0;
    let swapCount = 0;

    for (const row of result.rows) {
      console.log(`\n📝 Transaction: ${row.tx_hash}`);
      console.log(`   Method ID: ${row.method_id}`);
      console.log(`   ETH Value: ${row.eth_value_decimal || '0'}`);
      console.log(`   USD Volume: ${row.total_usd_volume || '0'}`);
      console.log(`   Raw Value: ${row.value || '0'}`);

      const logs: LogEvent[] = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
      if (!Array.isArray(logs)) continue;

      let hasBridgeEvent = false;
      let hasSwapEvent = false;

      for (const log of logs) {
        const logAddress = (log.address?.id || '').toLowerCase();
        const topic0 = log.topics?.[0]?.toLowerCase();

        if (logAddress !== BUNGEE_SOCKET_GATEWAY) continue;

        if (topic0 === SOCKET_BRIDGE_SIGNATURE) {
          hasBridgeEvent = true;
          console.log('   🌉 Contains SocketBridge event');
          
          try {
            const bridgeData = parseSocketBridgeEvent(log.data);
            console.log(`      Amount: ${Number(bridgeData.amount) / Math.pow(10, 18)} ETH`);
            console.log(`      To Chain: ${bridgeData.toChainId}`);
          } catch (error) {
            console.log('      ❌ Failed to parse bridge event');
          }
        } else if (topic0 === SOCKET_SWAP_TOKENS_SIGNATURE) {
          hasSwapEvent = true;
          console.log('   🔄 Contains SocketSwapTokens event');
          
          try {
            const swapData = parseSocketSwapTokensEvent(log.data);
            console.log(`      Buy Amount: ${Number(swapData.buyAmount) / Math.pow(10, 18)} ETH`);
            console.log(`      Sell Amount: ${Number(swapData.sellAmount) / Math.pow(10, 18)} tokens`);
          } catch (error) {
            console.log('      ❌ Failed to parse swap event');
          }
        }
      }

      if (hasBridgeEvent) bridgeCount++;
      if (hasSwapEvent) swapCount++;

      // Calculate USD value for this transaction
      let txUsdValue = 0;
      if (row.total_usd_volume && parseFloat(row.total_usd_volume) > 0) {
        txUsdValue = parseFloat(row.total_usd_volume);
      } else if (row.eth_value_decimal && parseFloat(row.eth_value_decimal) > 0) {
        txUsdValue = parseFloat(row.eth_value_decimal) * 3500; // Assume $3500 ETH price
      }

      totalUsdVolume += txUsdValue;
      console.log(`   💰 Transaction USD Value: $${txUsdValue.toFixed(2)}`);
    }

    console.log('\n📈 Summary:');
    console.log(`   Total USD Volume: $${totalUsdVolume.toFixed(2)}`);
    console.log(`   Bridge Transactions: ${bridgeCount}`);
    console.log(`   Swap Transactions: ${swapCount}`);
    console.log(`   Total Transactions: ${result.rows.length}`);

  } catch (error) {
    console.error('❌ Database query failed:', error);
  }
}

async function testApiEndpoint() {
  console.log('🌐 Testing Bridge API Endpoint\n');
  console.log(`Testing wallet: ${TEST_WALLET}`);
  console.log('Endpoint: http://localhost:3000/api/wallet/[address]/bridge');
  console.log('');

  try {
    const response = await fetch(`http://localhost:3000/api/wallet/${TEST_WALLET}/bridge`);
    
    if (!response.ok) {
      console.error(`❌ API request failed: ${response.status} ${response.statusText}`);
      return;
    }

    const data = await response.json();
    
    console.log('✅ API Response received:');
    console.log(`   Total USD: $${data.totalUsd?.toFixed(2) || '0.00'}`);
    console.log(`   Total ETH: ${data.totalEth?.toFixed(6) || '0.000000'}`);
    console.log(`   Total Transactions: ${data.txCount || 0}`);
    console.log(`   Bridged In USD: $${data.bridgedInUsd?.toFixed(2) || '0.00'}`);
    console.log(`   Bridged Out USD: $${data.bridgedOutUsd?.toFixed(2) || '0.00'}`);
    console.log('');

    if (data.byPlatform && Array.isArray(data.byPlatform)) {
      console.log('📊 By Platform Breakdown:');
      
      let bungeeFound = false;
      for (const platform of data.byPlatform) {
        console.log(`   ${platform.platform}${platform.subPlatform ? ` (${platform.subPlatform})` : ''}:`);
        console.log(`      USD Value: $${platform.usdValue?.toFixed(2) || '0.00'}`);
        console.log(`      ETH Value: ${platform.ethValue?.toFixed(6) || '0.000000'}`);
        console.log(`      Transactions: ${platform.txCount || 0}`);
        
        if (platform.bridgedInUsd !== undefined || platform.bridgedOutUsd !== undefined) {
          console.log(`      Bridged In: $${platform.bridgedInUsd?.toFixed(2) || '0.00'}`);
          console.log(`      Bridged Out: $${platform.bridgedOutUsd?.toFixed(2) || '0.00'}`);
        }
        
        if (platform.platform === 'Bungee') {
          bungeeFound = true;
          console.log('      ✅ Bungee platform detected!');
        }
        console.log('');
      }
      
      if (!bungeeFound) {
        console.log('⚠️  Bungee platform not found in response');
        console.log('   This could mean:');
        console.log('   - No Bungee transactions for this wallet');
        console.log('   - Transactions not yet indexed');
        console.log('   - Implementation issue');
      } else {
        console.log('🎉 Bungee integration working correctly!');
      }
    } else {
      console.log('⚠️  No byPlatform data in response');
    }

    // Log full response for debugging
    console.log('\n🔍 Full API Response:');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('❌ API endpoint test failed:', error);
    console.log('');
    console.log('💡 Make sure:');
    console.log('   - Next.js app is running on port 3000');
    console.log('   - Database is accessible');
    console.log('   - Environment variables are set');
  }
}

async function main() {
  console.log('\n🔍 Bungee Bridge Volume Test');
  console.log('================================\n');

  // Test parsing functions first
  testParsing();

  // Then test database query
  await testDatabaseQuery();

  // Finally test the API endpoint
  await testApiEndpoint();

  await pool.end();
}

main().catch(console.error);