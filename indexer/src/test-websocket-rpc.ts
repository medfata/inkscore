/**
 * Test script to explore WebSocket RPC data for contract transactions
 * 
 * This script connects to wss://rpc-qnd.inkonchain.com and tests:
 * 1. Subscribing to new blocks (newHeads)
 * 2. Getting transactions from blocks
 * 3. Filtering transactions for specific contracts
 * 4. What data we get vs what we need for transaction_details table
 */

import { createPublicClient, webSocket, http, formatEther } from 'viem';

// Ink Chain config
const INK_CHAIN_ID = 57073;
const WS_RPC_URL = 'wss://rpc-qnd.inkonchain.com';
const HTTP_RPC_URL = 'https://rpc-qnd.inkonchain.com';

// Test contracts from the database (sample)
const TEST_CONTRACTS = [
  '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F', // DailyGM
  '0x551134e92e537cEAa217c2ef63210Af3CE96a065', // UniversalRouter (InkySwap)
  '0x1D74317d760f2c72A94386f50E8D10f2C902b899', // ERC1967Proxy (InkyPump)
].map(addr => addr.toLowerCase());

// Create clients
const wsClient = createPublicClient({
  transport: webSocket(WS_RPC_URL),
});

const httpClient = createPublicClient({
  transport: http(HTTP_RPC_URL),
});

console.log('='.repeat(60));
console.log('WebSocket RPC Test Script for Ink Chain');
console.log('='.repeat(60));
console.log(`WebSocket URL: ${WS_RPC_URL}`);
console.log(`HTTP URL: ${HTTP_RPC_URL}`);
console.log(`Chain ID: ${INK_CHAIN_ID}`);
console.log(`Watching contracts: ${TEST_CONTRACTS.length}`);
console.log('='.repeat(60));

/**
 * Test 1: Watch new blocks via WebSocket
 */
async function testWatchBlocks() {
  console.log('\n[TEST 1] Watching new blocks via WebSocket...');
  
  let blockCount = 0;
  const maxBlocks = 3; // Watch 3 blocks then stop
  
  return new Promise<void>((resolve) => {
    const unwatch = wsClient.watchBlocks({
      onBlock: async (block) => {
        blockCount++;
        console.log(`\n📦 New Block #${block.number}`);
        console.log(`   Hash: ${block.hash}`);
        console.log(`   Timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
        console.log(`   Transactions: ${block.transactions.length}`);
        console.log(`   Gas Used: ${block.gasUsed}`);
        
        if (blockCount >= maxBlocks) {
          unwatch();
          resolve();
        }
      },
      onError: (error) => {
        console.error('Block watch error:', error);
      },
    });
  });
}

/**
 * Test 2: Get full block with transactions
 */
async function testGetBlockWithTransactions() {
  console.log('\n[TEST 2] Getting latest block with full transaction data...');
  
  const block = await httpClient.getBlock({
    blockTag: 'latest',
    includeTransactions: true,
  });
  
  console.log(`\n📦 Block #${block.number}`);
  console.log(`   Transactions in block: ${block.transactions.length}`);
  
  if (block.transactions.length > 0 && typeof block.transactions[0] !== 'string') {
    const tx = block.transactions[0];
    console.log('\n   Sample transaction data available:');
    console.log(`   - hash: ${tx.hash}`);
    console.log(`   - from: ${tx.from}`);
    console.log(`   - to: ${tx.to}`);
    console.log(`   - value: ${formatEther(tx.value)} ETH`);
    console.log(`   - gas: ${tx.gas}`);
    console.log(`   - gasPrice: ${tx.gasPrice}`);
    console.log(`   - maxFeePerGas: ${tx.maxFeePerGas}`);
    console.log(`   - maxPriorityFeePerGas: ${tx.maxPriorityFeePerGas}`);
    console.log(`   - nonce: ${tx.nonce}`);
    console.log(`   - input: ${tx.input?.slice(0, 20)}... (${tx.input?.length} chars)`);
    console.log(`   - blockNumber: ${tx.blockNumber}`);
    console.log(`   - blockHash: ${tx.blockHash}`);
    console.log(`   - transactionIndex: ${tx.transactionIndex}`);
    console.log(`   - type: ${tx.type}`);
    console.log(`   - chainId: ${tx.chainId}`);
  }
  
  return block;
}

/**
 * Test 3: Get transaction receipt (for gas used, status, logs)
 */
async function testGetTransactionReceipt(txHash: string) {
  console.log(`\n[TEST 3] Getting transaction receipt for ${txHash.slice(0, 20)}...`);
  
  const receipt = await httpClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
  
  console.log('\n   Receipt data available:');
  console.log(`   - status: ${receipt.status}`);
  console.log(`   - gasUsed: ${receipt.gasUsed}`);
  console.log(`   - effectiveGasPrice: ${receipt.effectiveGasPrice}`);
  console.log(`   - cumulativeGasUsed: ${receipt.cumulativeGasUsed}`);
  console.log(`   - logs: ${receipt.logs.length} events`);
  console.log(`   - contractAddress: ${receipt.contractAddress}`);
  console.log(`   - blockNumber: ${receipt.blockNumber}`);
  console.log(`   - transactionIndex: ${receipt.transactionIndex}`);
  
  // Check for L1 fee data (Optimism/Ink specific)
  const anyReceipt = receipt as any;
  if (anyReceipt.l1Fee) {
    console.log(`   - l1Fee: ${anyReceipt.l1Fee}`);
    console.log(`   - l1GasPrice: ${anyReceipt.l1GasPrice}`);
    console.log(`   - l1GasUsed: ${anyReceipt.l1GasUsed}`);
  }
  
  return receipt;
}

/**
 * Test 4: Filter transactions for our contracts
 */
async function testFilterContractTransactions() {
  console.log('\n[TEST 4] Looking for transactions to our tracked contracts...');
  
  // Get last 10 blocks
  const latestBlock = await httpClient.getBlockNumber();
  let foundTxs = 0;
  
  for (let i = 0; i < 50 && foundTxs < 3; i++) {
    const blockNum = latestBlock - BigInt(i);
    const block = await httpClient.getBlock({
      blockNumber: blockNum,
      includeTransactions: true,
    });
    
    if (typeof block.transactions[0] === 'string') continue;
    
    for (const tx of block.transactions) {
      if (typeof tx === 'string') continue;
      
      const toAddr = tx.to?.toLowerCase();
      if (toAddr && TEST_CONTRACTS.includes(toAddr)) {
        foundTxs++;
        console.log(`\n   ✅ Found contract tx in block ${blockNum}:`);
        console.log(`      Contract: ${toAddr}`);
        console.log(`      From: ${tx.from}`);
        console.log(`      Hash: ${tx.hash}`);
        console.log(`      Value: ${formatEther(tx.value)} ETH`);
        console.log(`      Input (method): ${tx.input?.slice(0, 10)}`);
        
        // Get receipt for this tx
        const receipt = await httpClient.getTransactionReceipt({ hash: tx.hash });
        console.log(`      Status: ${receipt.status}`);
        console.log(`      Gas Used: ${receipt.gasUsed}`);
        
        if (foundTxs >= 3) break;
      }
    }
  }
  
  if (foundTxs === 0) {
    console.log('   No transactions found for tracked contracts in last 50 blocks');
  }
}

/**
 * Test 5: Watch for pending transactions (if supported)
 */
async function testWatchPendingTransactions() {
  console.log('\n[TEST 5] Testing pending transaction subscription...');
  
  let txCount = 0;
  const maxTxs = 5;
  
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.log('   Timeout - pending tx subscription may not be supported');
      resolve();
    }, 10000);
    
    try {
      const unwatch = wsClient.watchPendingTransactions({
        onTransactions: (hashes) => {
          txCount += hashes.length;
          console.log(`   Received ${hashes.length} pending tx hashes (total: ${txCount})`);
          
          if (txCount >= maxTxs) {
            clearTimeout(timeout);
            unwatch();
            resolve();
          }
        },
        onError: (error) => {
          console.log('   Pending tx watch not supported:', error.message);
          clearTimeout(timeout);
          resolve();
        },
      });
    } catch (err) {
      console.log('   Pending tx subscription not available');
      clearTimeout(timeout);
      resolve();
    }
  });
}

/**
 * Test 6: Compare data available vs transaction_details table needs
 */
function printDataComparison() {
  console.log('\n[TEST 6] Data Comparison: Available vs Required');
  console.log('='.repeat(60));
  
  const fields = [
    { name: 'tx_hash', source: 'tx.hash', available: '✅' },
    { name: 'wallet_address', source: 'tx.from', available: '✅' },
    { name: 'contract_address', source: 'tx.to', available: '✅' },
    { name: 'to_address', source: 'tx.to', available: '✅' },
    { name: 'function_selector', source: 'tx.input.slice(0,10)', available: '✅' },
    { name: 'function_name', source: 'Need ABI decode', available: '⚠️' },
    { name: 'input_data', source: 'tx.input', available: '✅' },
    { name: 'eth_value', source: 'tx.value', available: '✅' },
    { name: 'gas_limit', source: 'tx.gas', available: '✅' },
    { name: 'gas_used', source: 'receipt.gasUsed', available: '✅' },
    { name: 'gas_price', source: 'tx.gasPrice', available: '✅' },
    { name: 'effective_gas_price', source: 'receipt.effectiveGasPrice', available: '✅' },
    { name: 'max_fee_per_gas', source: 'tx.maxFeePerGas', available: '✅' },
    { name: 'max_priority_fee_per_gas', source: 'tx.maxPriorityFeePerGas', available: '✅' },
    { name: 'tx_fee_wei', source: 'gasUsed * effectiveGasPrice', available: '✅' },
    { name: 'burned_fees', source: 'Not in standard RPC', available: '❌' },
    { name: 'block_number', source: 'tx.blockNumber', available: '✅' },
    { name: 'block_hash', source: 'tx.blockHash', available: '✅' },
    { name: 'block_timestamp', source: 'block.timestamp', available: '✅' },
    { name: 'transaction_index', source: 'tx.transactionIndex', available: '✅' },
    { name: 'nonce', source: 'tx.nonce', available: '✅' },
    { name: 'tx_type', source: 'tx.type', available: '✅' },
    { name: 'status', source: 'receipt.status', available: '✅' },
    { name: 'chain_id', source: 'tx.chainId', available: '✅' },
    { name: 'l1_gas_price', source: 'receipt.l1GasPrice (L2)', available: '⚠️' },
    { name: 'l1_gas_used', source: 'receipt.l1GasUsed (L2)', available: '⚠️' },
    { name: 'l1_fee', source: 'receipt.l1Fee (L2)', available: '⚠️' },
  ];
  
  console.log('Field                    | Source                          | Available');
  console.log('-'.repeat(75));
  fields.forEach(f => {
    console.log(`${f.name.padEnd(24)} | ${f.source.padEnd(32)} | ${f.available}`);
  });
  
  console.log('\nLegend:');
  console.log('✅ = Available from standard RPC');
  console.log('⚠️ = May need special handling or not always available');
  console.log('❌ = Not available from RPC, need alternative source');
}

/**
 * Main test runner
 */
async function main() {
  try {
    // Test 1: Watch blocks
    await testWatchBlocks();
    
    // Test 2: Get block with transactions
    const block = await testGetBlockWithTransactions();
    
    // Test 3: Get transaction receipt
    if (block.transactions.length > 0) {
      const txHash = typeof block.transactions[0] === 'string' 
        ? block.transactions[0] 
        : block.transactions[0].hash;
      await testGetTransactionReceipt(txHash);
    }
    
    // Test 4: Filter for our contracts
    await testFilterContractTransactions();
    
    // Test 5: Watch pending transactions
    await testWatchPendingTransactions();
    
    // Test 6: Data comparison
    printDataComparison();
    
    console.log('\n' + '='.repeat(60));
    console.log('Test complete!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Test error:', error);
  }
  
  process.exit(0);
}

main();
