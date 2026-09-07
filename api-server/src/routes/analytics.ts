import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';
import { analyticsService } from '../services';
import {
  getGmCount,
  getSweep,
  getOpenseaBuyCount,
  getMintCount,
  getOpenseaSaleCount,
  getInkypumpCreatedTokens,
  getInkypumpBuyVolume,
  getInkypumpSellVolume,
  getCowswapSwaps,
} from '../services/analytics-metrics-service';
import {
  getZnsMetrics,
  getShelliesJoinedRaffles,
  getShelliesPayToPlay,
  getShelliesStaking,
  getTemplarsBalance,
  getZenithNft,
  getZenithStaking,
  getInkBrokersMetrics,
} from '../services/analytics-counts-service';
import { getProtocolCount } from '../services/blockscout-service';
import { query } from '../db';
import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem';

const router = Router();

// Validate wallet address format
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

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

// ERC721 balanceOf ABI
const ERC721_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ============================================
// Contract addresses and constants
// ============================================

// GM contract address
const GM_CONTRACT_ADDRESS = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';

// Shellies contract addresses and methods
const SHELLIES_STAKING_CONTRACT = '0xb39a48d294e1530a271e712b7a19243679d320d0';
const INK_BUNNIES_STAKING_CONTRACT = '0x058413de8D9c4B76df94CCefC6617ACc5BFE7C57';
const INK_BUNNIES_STAKING_METHOD = '0x6f8d80f5';
const BOINK_STAKING_CONTRACT = '0x95a4c625e970D4BC07703F056e0599F45b50b8c9';
const BOINK_STAKING_METHOD = '0x90be1863'; // getStakedCounts

// NFT marketplace contract addresses
const NFT_CONTRACTS = [
  '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5', // Net Protocol
  '0xbd6a027b85fd5285b1623563bbef6fadbe396afb', // Mintiq
  '0x9ebf93fdba9f32accab3d6716322dccd617a78f3', // Squid Market
];

// ============================================
// GET /api/analytics/:wallet - Get all analytics for a wallet
// ============================================
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;

    if (!isValidAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const cacheKey = `analytics:${wallet.toLowerCase()}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const analytics = await analyticsService.getWalletAnalytics(wallet);
    responseCache.set(cacheKey, analytics);
    res.json(analytics);
  } catch (error) {
    console.error('Error fetching wallet analytics:', error);
    res.status(500).json({ error: 'Failed to fetch wallet analytics' });
  }
});


// ============================================
// GET /api/analytics/:wallet/zns - Get ZNS metrics for a wallet
// (Defined before :metric to avoid route conflict)
// ============================================
router.get('/:wallet/zns', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;

    if (!isValidAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const walletLower = wallet.toLowerCase();
    const cacheKey = `analytics:zns:${walletLower}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Counts via Blockscout (single batched query per action, no method
    // selectors needed — resolved by decoded method name).
    const result = await getZnsMetrics(walletLower);

    responseCache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching ZNS metrics:', error);
    res.status(500).json({ error: 'Failed to fetch ZNS metrics' });
  }
});

// ============================================
// GET /api/analytics/:wallet/:metric - Get specific metric for a wallet
// ============================================
router.get('/:wallet/:metric', async (req: Request, res: Response) => {
  try {
    const { wallet, metric } = req.params;

    if (!isValidAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const walletLower = wallet.toLowerCase();
    const cacheKey = `analytics:${metric}:${walletLower}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // ============================================================
    // GM count — computation lives in
    // services/analytics-metrics-service.ts (getGmCount)
    // ============================================================
    if (metric === 'gm_count') {
      try {
        const result = await getGmCount(walletLower);

        responseCache.set(cacheKey, result);
        return res.json(result);
      } catch {
        return res.status(502).json({ error: 'Failed to fetch GM data from all sources' });
      }
    }

    // Special handling for sweep (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'sweep') {
      const result = await getSweep(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for opensea_buy_count (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'opensea_buy_count') {
      const result = await getOpenseaBuyCount(wallet);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Mints from OpenSea v2 events (computation in
    // services/analytics-metrics-service.ts).
    if (metric === 'mint_count') {
      const result = await getMintCount(wallet);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for opensea_sale_count (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'opensea_sale_count') {
      const result = await getOpenseaSaleCount(wallet);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_created_tokens (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'inkypump_created_tokens') {
      const result = await getInkypumpCreatedTokens(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_buy_volume (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'inkypump_buy_volume') {
      const result = await getInkypumpBuyVolume(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_sell_volume (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'inkypump_sell_volume') {
      const result = await getInkypumpSellVolume(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for nft_traded
    // Sprint 3: Blockscout-backed (cursored) counts instead of the frozen
    // indexer table — same three marketplaces, live values.
    if (metric === 'nft_traded') {
      const [net, mintiq, squid] = await Promise.all([
        getProtocolCount(walletLower, 'nft-traded-net', NFT_CONTRACTS[0], null),
        getProtocolCount(walletLower, 'nft-traded-mintiq', NFT_CONTRACTS[1], null),
        getProtocolCount(walletLower, 'nft-traded-squid', NFT_CONTRACTS[2], null),
      ]);

      const totalCount = (net.count || 0) + (mintiq.count || 0) + (squid.count || 0);

      const byContract = [
        { contract_address: NFT_CONTRACTS[0], count: net.count || 0 },
        { contract_address: NFT_CONTRACTS[1], count: mintiq.count || 0 },
        { contract_address: NFT_CONTRACTS[2], count: squid.count || 0 },
      ].filter((c) => c.count > 0);

      const result = {
        slug: 'nft_traded',
        name: 'NFT Trading',
        icon: '🖼️',
        currency: 'COUNT',
        total_count: totalCount,
        total_value: totalCount.toString(),
        by_contract: byContract,
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for shellies_joined_raffles (counts via Blockscout)
    if (metric === 'shellies_joined_raffles') {
      const result = await getShelliesJoinedRaffles(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for shellies_pay_to_play (counts via Blockscout)
    if (metric === 'shellies_pay_to_play') {
      const result = await getShelliesPayToPlay(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for ink_brokers (desk activity counts via Blockscout
    // cursors + on-chain seat reads). See services/analytics-counts-service.ts.
    if (metric === 'ink_brokers') {
      const result = await getInkBrokersMetrics(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for nft_staking (Shellies + INK Bunnies + Boink)
    // Sprint 3: Shellies count is Blockscout-backed now (cursored counts
    // service — getShelliesStaking) instead of the frozen indexer table.
    if (metric === 'nft_staking') {
      // Get Shellies staked count via Blockscout (live, incremental).
      const shelliesStaking = await getShelliesStaking(walletLower);
      const shelliesCount = shelliesStaking.total_count ?? 0;

      // Get INK Bunnies staked count via contract call
      let inkBunniesCount = 0;
      try {
        const data = await publicClient.call({
          to: INK_BUNNIES_STAKING_CONTRACT as `0x${string}`,
          data: `${INK_BUNNIES_STAKING_METHOD}${wallet.slice(2).padStart(64, '0')}` as `0x${string}`,
        });
        
        if (data && data.data) {
          inkBunniesCount = parseInt(data.data, 16);
        }
      } catch (error) {
        console.error('Error fetching INK Bunnies staking:', error);
      }

      // Get Boink staked count via contract call
      let boinkCount = 0;
      try {
        const data = await publicClient.call({
          to: BOINK_STAKING_CONTRACT as `0x${string}`,
          data: `${BOINK_STAKING_METHOD}${wallet.slice(2).padStart(64, '0')}` as `0x${string}`,
        });
        
        if (data && data.data) {
          boinkCount = parseInt(data.data, 16);
        }
      } catch (error) {
        console.error('Error fetching Boink staking:', error);
      }

      const totalCount = shelliesCount + inkBunniesCount + boinkCount;

      const result = {
        slug: 'nft_staking',
        name: 'NFT Staking',
        icon: '🔒',
        currency: 'COUNT',
        total_count: totalCount,
        total_value: totalCount.toString(),
        sub_aggregates: [
          { label: 'Shellies Staked', value: shelliesCount.toString() },
          { label: 'INK Bunnies Staked', value: inkBunniesCount.toString() },
          { label: 'Boink Staked', value: boinkCount.toString() }
        ],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for shellies_staking (counts via Blockscout; the
    // legacy 0x1e332260 selector resolves to its decoded name on-chain)
    if (metric === 'shellies_staking') {
      const result = await getShelliesStaking(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for cowswap_swaps (computation in
    // services/analytics-metrics-service.ts)
    if (metric === 'cowswap_swaps') {
      const result = await getCowswapSwaps(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for templars_nft_balance - blockchain read operation
    if (metric === 'templars_nft_balance') {
      const result = await getTemplarsBalance(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for zenith_nft_balance - blockchain read operation
    // (InkScore Zenith ERC721 holdings for the wallet). No points for now.
    if (metric === 'zenith_nft_balance') {
      const result = await getZenithNft(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for zenith_staking - blockchain read operation
    // (InkScore Zenith NFTs staked in the InkScoreStaking contract, broken
    //  down by lock period: 1 month / 1 week / 1 day). No points for now.
    if (metric === 'zenith_staking') {
      const result = await getZenithStaking(walletLower);

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // For other metrics, use the existing analytics service
    const result = await analyticsService.getWalletMetric(wallet, metric);

    if (!result) {
      return res.status(404).json({ error: 'Metric not found' });
    }

    responseCache.set(cacheKey, result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching wallet metric:', error);
    res.status(500).json({ error: 'Failed to fetch wallet metric' });
  }
});

export default router;

