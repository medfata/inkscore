import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem';

// Define Ink Chain for viem (Mainnet)
const inkChain = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Routescan', url: 'https://explorer.inkonchain.com' },
  },
});

// Create viem public client for Ink Chain
const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(),
});

const INK_BUNNIES_STAKING_CONTRACT = '0x058413de8D9c4B76df94CCefC6617ACc5BFE7C57';
const INK_BUNNIES_STAKING_METHOD = '0x6f8d80f5';
const BOINK_STAKING_CONTRACT = '0x95a4c625e970D4BC07703F056e0599F45b50b8c9';
const BOINK_STAKING_METHOD = '0x90be1863'; // getStakedCounts

async function testInkBunniesStaking(walletAddress: string) {
  console.log(`\nTesting INK Bunnies Staking for wallet: ${walletAddress}`);
  console.log('='.repeat(60));

  try {
    // Construct the call data: method selector + padded wallet address
    const callData = `${INK_BUNNIES_STAKING_METHOD}${walletAddress.slice(2).padStart(64, '0')}` as `0x${string}`;
    
    console.log(`Contract: ${INK_BUNNIES_STAKING_CONTRACT}`);
    console.log(`Method: ${INK_BUNNIES_STAKING_METHOD}`);
    console.log(`Call Data: ${callData}`);

    const data = await publicClient.call({
      to: INK_BUNNIES_STAKING_CONTRACT as `0x${string}`,
      data: callData,
    });

    console.log(`\nRaw Response: ${data.data}`);

    if (data && data.data) {
      const stakedCount = parseInt(data.data, 16);
      console.log(`Staked NFTs: ${stakedCount}`);
      return stakedCount;
    } else {
      console.log('No data returned from contract');
      return 0;
    }
  } catch (error) {
    console.error('Error calling contract:', error);
    return 0;
  }
}

async function testBoinkStaking(walletAddress: string) {
  console.log(`\nTesting Boink Staking for wallet: ${walletAddress}`);
  console.log('='.repeat(60));

  try {
    // Construct the call data: method selector + padded wallet address
    const callData = `${BOINK_STAKING_METHOD}${walletAddress.slice(2).padStart(64, '0')}` as `0x${string}`;
    
    console.log(`Contract: ${BOINK_STAKING_CONTRACT}`);
    console.log(`Method: ${BOINK_STAKING_METHOD} (getStakedCounts)`);
    console.log(`Call Data: ${callData}`);

    const data = await publicClient.call({
      to: BOINK_STAKING_CONTRACT as `0x${string}`,
      data: callData,
    });

    console.log(`\nRaw Response: ${data.data}`);

    if (data && data.data) {
      const stakedCount = parseInt(data.data, 16);
      console.log(`Staked NFTs: ${stakedCount}`);
      return stakedCount;
    } else {
      console.log('No data returned from contract');
      return 0;
    }
  } catch (error) {
    console.error('Error calling contract:', error);
    return 0;
  }
}

// Test with the example wallet from the user's request
const testWallet = '0xb39a48d294e1530a271e712b7a19243679d320d0';

Promise.all([
  testInkBunniesStaking(testWallet),
  testBoinkStaking(testWallet)
])
  .then(([inkBunniesCount, boinkCount]) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ All tests completed`);
    console.log(`INK Bunnies Staked: ${inkBunniesCount}`);
    console.log(`Boink Staked: ${boinkCount}`);
    console.log(`Total: ${inkBunniesCount + boinkCount}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
