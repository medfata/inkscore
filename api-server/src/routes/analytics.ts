import { Router, Request, Response } from 'express';
import { responseCache, getLongCache, setLongCache, getInflight, withInflight } from '../cache';
import { analyticsService, sweepService, openSeaService, priceService } from '../services';
import {
  getProtocolCount,
  getProtocolTxHashes,
  getTxData,
  isBlockscoutEnabled,
  partitionTxHashes,
} from '../services/blockscout-service';
import { getTokenInfo } from '../services/token-info-service';
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

// InkyPump contract address and methods
const INKYPUMP_CONTRACT_ADDRESS = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
const INKYPUMP_CREATE_TOKEN_FUNCTION = '0xa07849e6';

// InkySwap router contract for InkyPump trading
const INKYSWAP_ROUTER_ADDRESS = '0xa8c1c38ff57428e5c3a34e0899be5cb385476507';

// Shellies contract addresses and methods
const SHELLIES_RAFFLE_CONTRACTS = [
  '0x47a27a42525fff2b7264b342f74216e37a831332',
  '0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de'
];
const SHELLIES_PAY_TO_PLAY_CONTRACT = '0x57d287dc46cb0782c4bce1e4e964cc52083bb358';
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

// Templars of the Storm NFT contract address
const TEMPLARS_NFT_CONTRACT_ADDRESS = '0x46625E7de9894D83fca49E79cB53B5C25550cE99';

// Cow Swap configuration
const COW_SWAP_CONFIG = {
  apiBaseUrl: 'https://api.cow.fi/ink/api/v1',
  pageSize: 100,
  // Token metadata from CoinGecko (hardcoded for performance)
  tokens: {
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18, name: 'Ink Bridged WETH (Ink)' },
    '0xd642b49d10cc6e1bc1c6945725667c35e0875f22': { symbol: 'PURPLE', decimals: 18, name: 'Purple' },
    '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5': { symbol: 'CAT', decimals: 18, name: 'Cat Call Agent' },
    '0xca5f2ccbd9c40b32657df57c716de44237f80f05': { symbol: 'KRAKEN', decimals: 18, name: 'Kraken' },
    '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT0', decimals: 6, name: 'USDT0' },
    '0x53eb0098d09b8d1008f382bbd2a5d4f649111710': { symbol: 'WATCH', decimals: 18, name: 'WATCHDOGS' },
    '0x0606fc632ee812ba970af72f8489baaa443c4b98': { symbol: 'ANITA', decimals: 18, name: 'ANITA' },
    '0x0c5e2d1c98cd265c751e02f8f3293bc5764f9111': { symbol: 'SHROOMY', decimals: 18, name: 'Shroomy' },
    '0x62c99fac20b33b5423fdf9226179e973a8353e36': { symbol: 'BERT', decimals: 18, name: 'Bert' },
    '0xa802bccd14f7e78e48ffe0c9cf9ad0273c77d4b0': { symbol: 'INKEDUSDT', decimals: 6, name: 'Ink USDT Veda Vault' },
    '0xc845b2894dbddd03858fd2d643b4ef725fe0849d': { symbol: 'NVDAX', decimals: 18, name: 'NVIDIA xStock' },
    '0x53ad50d3b6fcacb8965d3a49cb722917c7dae1f3': { symbol: 'ACRED', decimals: 6, name: 'Apollo Diversified Credit Securitize Fund' },
    '0xc99f5c922dae05b6e2ff83463ce705ef7c91f077': { symbol: 'XSOLVBTC', decimals: 18, name: 'Solv Protocol Staked BTC' },
    '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'EZETH', decimals: 18, name: 'Renzo Restaked ETH' },
    '0xc3eacf0612346366db554c991d7858716db09f58': { symbol: 'RSETH', decimals: 18, name: 'Kelp DAO Restaked ETH' },
    '0xf50258d3c1dd88946c567920b986a12e65b50dac': { symbol: 'XAUT0', decimals: 6, name: 'Tether Gold Tokens' },
    '0x2d270e6886d130d724215a266106e6832161eaed': { symbol: 'USDC', decimals: 6, name: 'USDC' },
    '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { symbol: 'USDG', decimals: 6, name: 'Global Dollar' },
    '0x17906b1cd88aa8efaefc5e82891b52a22219bd45': { symbol: 'SUPR', decimals: 18, name: 'Superseed' },
    '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': { symbol: 'KBTC', decimals: 8, name: 'Kraken Wrapped BTC' },
    '0xae4efbc7736f963982aacb17efa37fcbab924cb3': { symbol: 'SOLVBTC', decimals: 18, name: 'Solv Protocol BTC' },
    '0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189': { symbol: 'OUSDT', decimals: 6, name: 'OpenUSDT' },
    '0xa3d68b74bf0528fdd07263c60d6488749044914b': { symbol: 'WEETH', decimals: 18, name: 'Wrapped eETH' },
    '0xf1815bd50389c46847f0bda824ec8da914045d14': { symbol: 'USDC.E', decimals: 6, name: 'Stargate Bridged USDC' },
    '0x71052bae71c25c78e37fd12e5ff1101a71d9018f': { symbol: 'LINK', decimals: 18, name: 'Chainlink' },
    '0x64445f0aecc51e94ad52d8ac56b7190e764e561a': { symbol: 'WFRAX', decimals: 18, name: 'Wrapped FRAX' },
    '0xfc421ad3c883bf9e7c4f42de845c4e4405799e73': { symbol: 'GHO', decimals: 18, name: 'GHO' },
    '0x80eede496655fb9047dd39d9f418d5483ed600df': { symbol: 'FRXUSD', decimals: 18, name: 'Frax USD' },
    '0x3d63825b0d8669307366e6c8202f656b9e91d368': { symbol: 'WGC', decimals: 6, name: 'Wild Goat Coin' },
    '0xa161132371c94299d215915d4cbc3b629e2059be': { symbol: 'BRBTC', decimals: 8, name: 'Bedrock BTC' },
    '0x5bcf6b008bf80b9296238546bace1797657b05d6': { symbol: 'REUSD', decimals: 18, name: 'Re Protocol reUSD' },
    '0xe8245188db1efc91aef32e7aa4cf346b9a5830cf': { symbol: 'LCAP', decimals: 18, name: 'CF Large Cap Index' },
    '0xd3c8da379d71a33bfee8875f87ac2748beb1d58d': { symbol: 'UNIBTC', decimals: 8, name: 'Universal BTC' },
  }
};

// ZNS tracking config
const ZNS_CONFIG = {
  deploy: { contract: '0x63c489d31a2c3de0638360931f47ff066282473f', functions: ['Deploy', 'deploy'] },
  sayGm: { contract: '0x3033d7ded400547d6442c55159da5c61f2721633', functions: ['SayGM', 'sayGM'] },
  register: { contract: '0xfb2cd41a8aec89efbb19575c6c48d872ce97a0a5', functions: ['RegisterDomains', 'registerDomains'] },
};

// ============================================
// Token Info Helper (for InkyPump volume calculation)
// Sprint 1 dedup: the DeFi Llama token-info cache lives in ONE place now —
// services/token-info-service.ts (shared with bridge + swap). The previous
// local copy here kept a second 2h cache and double-fetched the same tokens.
// ============================================

// Batch-fetch DeFi Llama prices for legs lacking a Blockscout exchange_rate.
// One bounded parallel pass instead of a sequential await per leg.
async function batchLegPrices(
  legs: Array<{ tokenAddress: string }>
): Promise<Map<string, number>> {
  const tokens = [...new Set(legs.map((l) => l.tokenAddress.toLowerCase()))];
  const prices = new Map<string, number>();
  if (tokens.length === 0) return prices;
  const CONC = 10;
  const results: number[] = new Array(tokens.length);
  let next = 0;
  await Promise.all(
    new Array(Math.min(CONC, tokens.length)).fill(0).map(async () => {
      while (next < tokens.length) {
        const idx = next++;
        try {
          results[idx] = (await getTokenInfo(tokens[idx])).price || 0;
        } catch {
          results[idx] = 0;
        }
      }
    })
  );
  tokens.forEach((t, i) => prices.set(t, results[i]));
  return prices;
}

// Slow-moving third-party data: cache well beyond the 30s responseCache so
// dashboard polls don't re-hit gm.ink / Cow / RPC on every load.
const GM_LONG_CACHE_TTL = 10 * 60 * 1000;
const COWSWAP_LONG_CACHE_TTL = 10 * 60 * 1000;
const TEMPLARS_LONG_CACHE_TTL = 5 * 60 * 1000;

interface GmCountResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_value: string;
  sub_aggregates: unknown[];
  source: string;
  last_updated: Date;
}

interface CowSwapResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_value: string;
  sub_aggregates: Array<{ token: string; usd_value: string; count: number }>;
  last_updated: Date;
}

interface TemplarsResult {
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

// InkScore Zenith NFT collection contract address
const ZENITH_NFT_CONTRACT_ADDRESS = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';
// InkScore Zenith staking contract address
const ZENITH_STAKING_CONTRACT_ADDRESS = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6';
const ZENITH_LONG_CACHE_TTL = 5 * 60 * 1000;
// Hard cap on per-token stakeInfo reads for the staking breakdown
const ZENITH_MAX_STAKED_TOKENS = 100;

// InkScore Zenith staking view functions
const ZENITH_STAKING_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'stakedTokensOf',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'stakeInfo',
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'stakedAt', type: 'uint256' },
      { name: 'unlockTimestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface ZenithNftBalanceResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_value: string;
  sub_aggregates: unknown[];
  last_updated: Date;
}

interface ZenithStakingResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_staked: number;
  one_month_count: number;
  one_week_count: number;
  one_day_count: number;
  sub_aggregates: Array<{ label: string; value: string }>;
  last_updated: Date;
}

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
    const [deployRes, sayGmRes, registerRes] = await Promise.all([
      getProtocolCount(walletLower, 'zns-deploy', ZNS_CONFIG.deploy.contract, null, ZNS_CONFIG.deploy.functions),
      getProtocolCount(walletLower, 'zns-saygm', ZNS_CONFIG.sayGm.contract, null, ZNS_CONFIG.sayGm.functions),
      getProtocolCount(walletLower, 'zns-register', ZNS_CONFIG.register.contract, null, ZNS_CONFIG.register.functions),
    ]);

    const deployCount = deployRes.count;
    const sayGmCount = sayGmRes.count;
    const registerCount = registerRes.count;

    const result = {
      slug: 'zns',
      name: 'ZNS Connect',
      currency: 'COUNT',
      total_count: deployCount + sayGmCount + registerCount,
      deploy_count: deployCount,
      say_gm_count: sayGmCount,
      register_domain_count: registerCount,
      last_updated: new Date(),
    };

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
    // GM count — combined sources with failover:
    //   1. gm.ink API (primary): full history incl. live updates,
    //      but intermittently unstable → 2 attempts with timeout
    //   2. Goldsky DailyGM subgraph (fallback): reliable, but only
    //      indexes recent GMs (missing history before its start block)
    // NOTE: do NOT sum the two sources — the subgraph count is a
    // subset of gm.ink's (verified 2026-09-02: 120⊇17, 311⊇93).
    // ============================================================
    if (metric === 'gm_count') {
      const GM_INK_API = 'https://www.gm.ink/api/gm-data';
      const GOLDSKY_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cmo0uv9q6okpf01zk5gmoaeao/subgraphs/DailyGM/1.1.1/gn';

      // gm.ink takes ~3.5s per call and GM history is append-only: share one
      // in-flight fetch across concurrent requests and cache 10 minutes.
      const gmLcKey = `long:${cacheKey}`;
      const gmLc = getLongCache<GmCountResult>(gmLcKey, GM_LONG_CACHE_TTL);
      if (gmLc) {
        responseCache.set(cacheKey, gmLc);
        return res.json(gmLc);
      }

      let fetchedGm: { count: number; source: string };
      try {
        fetchedGm = await withInflight(gmLcKey, async () => {
          let innerCount: number | null = null;
          let innerSource = '';

          // 1. Primary: gm.ink API (2 attempts, 5s timeout each)
          for (let attempt = 1; attempt <= 2 && innerCount === null; attempt++) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);
              const response = await fetch(`${GM_INK_API}?address=${walletLower}`, { signal: controller.signal });
              clearTimeout(timeoutId);
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }
              const data = await response.json() as { userGms?: Record<string, number> };
              innerCount = data.userGms?.[walletLower] || 0;
              innerSource = 'gm.ink';
            } catch (err: any) {
              console.warn(`[GM] gm.ink attempt ${attempt} failed for ${walletLower.slice(0, 10)}: ${err.message || err}`);
            }
          }

          // 2. Fallback: Goldsky DailyGM subgraph (single request, count returned directly)
          if (innerCount === null) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000);
              const response = await fetch(GOLDSKY_SUBGRAPH, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  query: `query($user: ID!) {
                user(id: $user) {
                  id
                  gmsSentCount
                }
              }`,
                  variables: { user: walletLower },
                }),
                signal: controller.signal,
              });
              clearTimeout(timeoutId);
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
              }
              const data = await response.json() as {
                data?: {
                  user?: { gmsSentCount?: string } | null;
                };
                errors?: Array<{ message: string }>;
              };
              if (data.errors) {
                console.error('Goldsky GM subgraph errors:', JSON.stringify(data.errors));
              }
              // user is null for wallets that never sent a GM
              innerCount = parseInt(data.data?.user?.gmsSentCount || '0', 10) || 0;
              innerSource = 'goldsky-subgraph';
            } catch (err: any) {
              console.warn(`[GM] Goldsky subgraph failed for ${walletLower.slice(0, 10)}: ${err.message || err}`);
            }
          }

          if (innerCount === null) {
            throw new Error('Failed to fetch GM data from all sources');
          }
          return { count: innerCount, source: innerSource };
        });
      } catch {
        return res.status(502).json({ error: 'Failed to fetch GM data from all sources' });
      }

      const count = fetchedGm.count;
      const source = fetchedGm.source;

      console.log(`[GM] ${walletLower.slice(0, 10)} gm_count=${count} (source: ${source})`);

      const result: GmCountResult = {
        slug: 'gm_count',
        name: 'GM Count',
        icon: '👋',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        source,
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      setLongCache(`long:${cacheKey}`, result);
      return res.json(result);
    }

    // Special handling for sweep
    if (metric === 'sweep') {
      console.log(`[SWEEP] Fetching metrics for wallet: ${walletLower}`);
      const sweepMetrics = await sweepService.getDeployedCollections(walletLower) as { totalCollections?: number; sweepBadgeBalance?: number; totalStreak?: number };
      console.log(`[SWEEP] Raw metrics:`, JSON.stringify(sweepMetrics));
      
      const totalCollections = sweepMetrics.totalCollections ?? 0;
      const sweepBadgeBalance = sweepMetrics.sweepBadgeBalance ?? 0;
      const totalStreak = sweepMetrics.totalStreak ?? 0;
      console.log(`[SWEEP] totalCollections: ${totalCollections}, sweepBadgeBalance: ${sweepBadgeBalance}, totalStreak: ${totalStreak}`);
      
      const result = {
        slug: 'sweep',
        name: 'Sweep',
        icon: 'https://sweep.haus/sweep.png',
        currency: 'COUNT',
        total_count: totalCollections,
        total_value: totalCollections.toString(),
        sub_aggregates: [
          { label: 'Sweep Badges', value: sweepBadgeBalance.toString() },
          { label: 'Total Streak', value: totalStreak.toString() }
        ],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for opensea_buy_count (uses OpenSea v2 REST API)
    if (metric === 'opensea_buy_count') {
      const counts = await openSeaService.getAllCounts(wallet);

      const result = {
        slug: 'opensea_buy_count',
        name: 'OpenSea Buys',
        icon: 'https://opensea.io/favicon.ico',
        currency: 'COUNT',
        total_count: counts.buys,
        total_value: counts.buys.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Mints from OpenSea v2 events (unique mint transactions to the wallet).
    // Previously this only counted mintPublic calls to OpenSea's shared Seadrop
    // minter contract, which wildly undercounted mints made via other contracts.
    if (metric === 'mint_count') {
      const counts = await openSeaService.getAllCounts(wallet);

      const result = {
        slug: 'mint_count',
        name: 'Mints',
        icon: '🎨',
        currency: 'COUNT',
        total_count: counts.mints,
        total_value: counts.mints.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for opensea_sale_count (uses OpenSea v2 REST API)
    if (metric === 'opensea_sale_count') {
      const counts = await openSeaService.getAllCounts(wallet);

      const result = {
        slug: 'opensea_sale_count',
        name: 'OpenSea Sales',
        icon: 'https://opensea.io/favicon.ico',
        currency: 'COUNT',
        total_count: counts.sales,
        total_value: counts.sales.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_created_tokens (counts via Blockscout)
    if (metric === 'inkypump_created_tokens') {
      const pc = await getProtocolCount(
        walletLower, 'inkypump-created', INKYPUMP_CONTRACT_ADDRESS, [INKYPUMP_CREATE_TOKEN_FUNCTION]
      );
      const count = pc.count;

      const result = {
        slug: 'inkypump_created_tokens',
        name: 'InkyPump Created Tokens',
        icon: '🚀',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_buy_volume (legs via Blockscout)
    if (metric === 'inkypump_buy_volume') {
      const buyMethodIds = ['0x7ff36ab5', '0xfb3bdb41'];
      const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

      const { hashes } = await getProtocolTxHashes(walletLower, INKYSWAP_ROUTER_ADDRESS, buyMethodIds);
      // Price ALL cached + a capped slice of uncached so USD converges over loads.
      const { cached, uncached } = await partitionTxHashes(hashes);
      const priced = [...cached, ...uncached.slice(0, 300)];
      const partial = cached.length + Math.min(uncached.length, 100) < hashes.length;
      const txData = await getTxData(priced);
      const ethPrice = await priceService.getCurrentPrice().catch(() => 3500);

      // Batch unlisted-token price lookups (was: sequential await per leg,
      // each an unbounded DeFi Llama call — the ~1.6s on this endpoint).
      const buyPrices = await batchLegPrices(
        priced.flatMap((h) => txData.get(h)?.legs || []).filter((leg) => leg.tokenAddress !== WETH_ADDRESS.toLowerCase() && !(leg.exchangeRate > 0))
      );

      let totalVolume = 0;
      const count = hashes.length;

      for (const h of priced) {
        const legs = txData.get(h)?.legs || [];
        let txUsdValue = 0;

        // Find the token transfer that's NOT WETH (that's the token being bought).
        // Priced via Blockscout exchange_rate first (instant), DeFi Llama
        // fallback when unlisted (same source as before).
        for (const leg of legs) {
          if (leg.tokenAddress === WETH_ADDRESS.toLowerCase()) {
            continue;
          }
          const price = leg.exchangeRate || buyPrices.get(leg.tokenAddress.toLowerCase()) || 0;
          txUsdValue = leg.amount * price;
          break;
        }

        // Fallback: Use ETH value if token parsing failed
        if (txUsdValue === 0) {
          const meta = txData.get(h)?.meta;
          if (meta && meta.value && meta.value !== '0') {
            txUsdValue = (Number(BigInt(meta.value)) / 1e18) * ethPrice;
          }
        }

        totalVolume += txUsdValue;
      }

      const result = {
        slug: 'inkypump_buy_volume',
        name: 'InkyPump Buy Volume',
        icon: '📈',
        currency: 'USD',
        total_count: count,
        total_value: totalVolume.toFixed(2),
        sub_aggregates: [],
        partial,
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_sell_volume (legs via Blockscout)
    if (metric === 'inkypump_sell_volume') {
      const sellMethodIds = ['0x18cbafe5', '0x4a25d94a', '0x791ac947'];
      const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

      const { hashes } = await getProtocolTxHashes(walletLower, INKYSWAP_ROUTER_ADDRESS, sellMethodIds);
      // Price ALL cached + a capped slice of uncached so USD converges over loads.
      const { cached, uncached } = await partitionTxHashes(hashes);
      const priced = [...cached, ...uncached.slice(0, 300)];
      const partial = cached.length + Math.min(uncached.length, 100) < hashes.length;
      const txData = await getTxData(priced);
      const ethPrice = await priceService.getCurrentPrice().catch(() => 3500);

      // Batch unlisted-token price lookups (same fix as buy volume).
      const sellPrices = await batchLegPrices(
        priced.flatMap((h) => txData.get(h)?.legs || []).filter((leg) => leg.tokenAddress !== WETH_ADDRESS.toLowerCase() && leg.fromAddress === walletLower && !(leg.exchangeRate > 0))
      );


      let totalVolume = 0;
      const count = hashes.length;

      for (const h of priced) {
        const legs = txData.get(h)?.legs || [];

        let txUsdValue = 0;

        // Find the token transfer that's NOT WETH, FROM the wallet (selling).
        // Priced via Blockscout exchange_rate first (instant), DeFi Llama
        // fallback when unlisted (same source as before).
        for (const leg of legs) {
          if (leg.tokenAddress === WETH_ADDRESS.toLowerCase()) {
            continue;
          }
          if (leg.fromAddress !== walletLower) {
            continue;
          }
          const price = leg.exchangeRate || sellPrices.get(leg.tokenAddress.toLowerCase()) || 0;
          txUsdValue = leg.amount * price;
          break;
        }

        // Fallback: WETH received (approximates internal_eth_out/operations)
        if (txUsdValue === 0) {
          const wethIn = legs
            .filter((l) => l.tokenAddress === WETH_ADDRESS.toLowerCase() && l.toAddress === walletLower)
            .reduce((s, l) => s + l.amount, 0);
          if (wethIn > 0) {
            txUsdValue = wethIn * ethPrice;
          }
        }

        totalVolume += txUsdValue;
      }


      const result = {
        slug: 'inkypump_sell_volume',
        name: 'InkyPump Sell Volume',
        icon: '📉',
        currency: 'USD',
        total_count: count,
        total_value: totalVolume.toFixed(2),
        sub_aggregates: [],
        partial,
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for nft_traded
    if (metric === 'nft_traded') {
      const totalRows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND status = 1
      `, [NFT_CONTRACTS, wallet]);

      const totalCount = parseInt(totalRows[0]?.count || '0', 10);

      const contractRows = await query<{
        contract_address: string;
        count: string;
      }>(`
        SELECT 
          contract_address,
          COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND status = 1
        GROUP BY contract_address
      `, [NFT_CONTRACTS, wallet]);

      const byContract = contractRows.map(row => ({
        contract_address: row.contract_address.toLowerCase(),
        count: parseInt(row.count, 10),
      }));

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
      const [r1, r2] = await Promise.all([
        getProtocolCount(walletLower, 'shellies-raffle-1', SHELLIES_RAFFLE_CONTRACTS[0], null, ['JoinRaffle', 'joinRaffle']),
        getProtocolCount(walletLower, 'shellies-raffle-2', SHELLIES_RAFFLE_CONTRACTS[1], null, ['JoinRaffle', 'joinRaffle']),
      ]);
      const count = r1.count + r2.count;

      const result = {
        slug: 'shellies_joined_raffles',
        name: 'Joined Raffles',
        icon: '🎟️',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for shellies_pay_to_play (counts via Blockscout)
    if (metric === 'shellies_pay_to_play') {
      const pc = await getProtocolCount(walletLower, 'shellies-pay', SHELLIES_PAY_TO_PLAY_CONTRACT, null, ['PayToPlay', 'payToPlay']);
      const count = pc.count;

      const result = {
        slug: 'shellies_pay_to_play',
        name: 'Pay to Play',
        icon: '🎮',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for nft_staking (Shellies + INK Bunnies + Boink)
    if (metric === 'nft_staking') {
      // Get Shellies staked count from transactions
      const shelliesRows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('StakeBatch', 'stakeBatch', '0x1e332260')
          AND status = 1
      `, [SHELLIES_STAKING_CONTRACT, wallet]);

      const shelliesCount = parseInt(shelliesRows[0]?.count || '0', 10);

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
      // Fallback to transaction count (contract read not available in Express server)
      const pc = await getProtocolCount(walletLower, 'shellies-staking', SHELLIES_STAKING_CONTRACT, ['0x1e332260'], ['StakeBatch', 'stakeBatch']);
      const count = pc.count;

      const result = {
        slug: 'shellies_staking',
        name: 'Staking',
        icon: '🔒',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for cowswap_swaps
    if (metric === 'cowswap_swaps') {
      // External Cow + Llama APIs with their own deadlines (~2s): share one
      // in-flight computation and cache 10 min (trade history is append-only).
      const cowLcKey = `long:${cacheKey}`;
      const cowLc = getLongCache<CowSwapResult>(cowLcKey, COWSWAP_LONG_CACHE_TTL);
      if (cowLc) {
        responseCache.set(cacheKey, cowLc);
        return res.json(cowLc);
      }
      return res.json(await withInflight<CowSwapResult>(cowLcKey, async (): Promise<CowSwapResult> => {
      try {
        let allOrders: any[] = [];
        let offset = 0;
        let hasMorePages = true;
        const cowSwapDeadline = Date.now() + 3000; // 3s max

        // Paginate through all orders (with 3s global deadline)
        while (hasMorePages && Date.now() < cowSwapDeadline) {
          const ordersUrl = `${COW_SWAP_CONFIG.apiBaseUrl}/account/${walletLower}/orders?offset=${offset}&limit=${COW_SWAP_CONFIG.pageSize}`;
          
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const response = await fetch(ordersUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) {
              console.error(`Cow Swap API error: ${response.status}`);
              break;
            }

            const orders = await response.json();
            
            if (!Array.isArray(orders) || orders.length === 0) {
              hasMorePages = false;
              break;
            }

            allOrders = allOrders.concat(orders);

            // Check if we got a full page (indicating there might be more)
            if (orders.length < COW_SWAP_CONFIG.pageSize) {
              hasMorePages = false;
            } else {
              offset += COW_SWAP_CONFIG.pageSize;
            }
          } catch (fetchError) {
            console.error('Error fetching Cow Swap orders:', fetchError);
            hasMorePages = false;
          }
        }

        // Filter for valid swaps: status === "fulfilled" AND invalidated === false
        const validSwaps = allOrders.filter(order => 
          order.status === 'fulfilled' && order.invalidated === false
        );

        // Collect unique token addresses for price lookup
        const uniqueTokenAddresses = new Set<string>();
        for (const order of validSwaps) {
          const sellToken = order.sellToken?.toLowerCase();
          const buyToken = order.buyToken?.toLowerCase();
          if (sellToken) uniqueTokenAddresses.add(sellToken);
          if (buyToken) uniqueTokenAddresses.add(buyToken);
        }

        // Fetch current prices from DeFi Llama (supports batch queries)
        const tokenPrices: Record<string, number> = {};
        if (uniqueTokenAddresses.size > 0) {
          try {
            // Build comma-separated list with "ink:" prefix for each address
            const addressList = Array.from(uniqueTokenAddresses)
              .map(addr => `ink:${addr}`)
              .join(',');
            
            const priceUrl = `https://coins.llama.fi/prices/current/${addressList}`;
            const priceController = new AbortController();
            const priceTimeoutId = setTimeout(() => priceController.abort(), 2000);
            const priceResponse = await fetch(priceUrl, { 
              method: 'GET', 
              headers: { 'Accept': 'application/json' },
              signal: priceController.signal,
            });
            clearTimeout(priceTimeoutId);
            
            if (priceResponse.ok) {
              const priceData = await priceResponse.json() as { 
                coins?: Record<string, { price?: number }> 
              };
              
              // Map prices to lowercase addresses (remove "ink:" prefix)
              if (priceData.coins) {
                for (const [key, data] of Object.entries(priceData.coins)) {
                  if (data && typeof data.price === 'number') {
                    // Extract address from "ink:0x..." format
                    const address = key.replace('ink:', '').toLowerCase();
                    tokenPrices[address] = data.price;
                  }
                }
              }
            } else {
              console.warn('DeFi Llama price API returned non-OK status:', priceResponse.status);
            }
          } catch (priceError) {
            console.error('Error fetching token prices from DeFi Llama:', priceError);
          }
        }

        // Calculate total USD value with decimal normalization
        let totalUsdValue = 0;
        const tokenBreakdown: Record<string, { symbol: string; usdValue: number; count: number }> = {};

        for (const order of validSwaps) {
          // Determine which token to use for calculation
          // Priority: sellToken (what user is selling)
          const sellToken = order.sellToken?.toLowerCase() as string | undefined;
          const buyToken = order.buyToken?.toLowerCase() as string | undefined;
          
          // Get token metadata
          const sellTokenMeta = sellToken ? COW_SWAP_CONFIG.tokens[sellToken as keyof typeof COW_SWAP_CONFIG.tokens] : null;
          const buyTokenMeta = buyToken ? COW_SWAP_CONFIG.tokens[buyToken as keyof typeof COW_SWAP_CONFIG.tokens] : null;

          let orderUsdValue = 0;
          let tokenSymbol = 'UNKNOWN';

          // Use sell token if available
          if (sellToken && sellTokenMeta && order.executedSellAmount) {
            const rawAmount = BigInt(order.executedSellAmount);
            const normalizedAmount = Number(rawAmount) / Math.pow(10, sellTokenMeta.decimals);
            const tokenPrice = tokenPrices[sellToken] || 0;
            orderUsdValue = normalizedAmount * tokenPrice;
            tokenSymbol = sellTokenMeta.symbol;
          }
          // Fallback to buy token
          else if (buyToken && buyTokenMeta && order.executedBuyAmount) {
            const rawAmount = BigInt(order.executedBuyAmount);
            const normalizedAmount = Number(rawAmount) / Math.pow(10, buyTokenMeta.decimals);
            const tokenPrice = tokenPrices[buyToken] || 0;
            orderUsdValue = normalizedAmount * tokenPrice;
            tokenSymbol = buyTokenMeta.symbol;
          }

          totalUsdValue += orderUsdValue;

          // Track by token
          if (tokenSymbol !== 'UNKNOWN') {
            if (!tokenBreakdown[tokenSymbol]) {
              tokenBreakdown[tokenSymbol] = { symbol: tokenSymbol, usdValue: 0, count: 0 };
            }
            tokenBreakdown[tokenSymbol].usdValue += orderUsdValue;
            tokenBreakdown[tokenSymbol].count += 1;
          }
        }

        // Convert breakdown to array and sort by USD value
        const breakdownArray = Object.values(tokenBreakdown)
          .sort((a, b) => b.usdValue - a.usdValue)
          .map(item => ({
            token: item.symbol,
            usd_value: item.usdValue.toFixed(2),
            count: item.count,
          }));

        const result = {
          slug: 'cowswap_swaps',
          name: 'Cow Swap',
          icon: 'https://swap.cow.fi/favicon-dark-mode.png',
          currency: 'USD',
          total_count: validSwaps.length,
          total_value: totalUsdValue.toFixed(2),
          sub_aggregates: breakdownArray,
          last_updated: new Date(),
        };

        responseCache.set(cacheKey, result);
        setLongCache(cowLcKey, result);
        return result;
      } catch (error) {
        console.error('Error fetching Cow Swap data:', error);
        // Return empty result on error
        const result = {
          slug: 'cowswap_swaps',
          name: 'Cow Swap',
          icon: 'https://swap.cow.fi/favicon-dark-mode.png',
          currency: 'USD',
          total_count: 0,
          total_value: '0.00',
          sub_aggregates: [],
          last_updated: new Date(),
        };
        responseCache.set(cacheKey, result);
        return result;
      }
      }));
    }

    // Special handling for templars_nft_balance - blockchain read operation
    if (metric === 'templars_nft_balance') {
      // Single RPC call (~0.9s) and a slow-moving balance: dedup + 5-min cache.
      const templarsLcKey = `long:${cacheKey}`;
      const templarsLc = getLongCache<TemplarsResult>(templarsLcKey, TEMPLARS_LONG_CACHE_TTL);
      if (templarsLc) {
        responseCache.set(cacheKey, templarsLc);
        return res.json(templarsLc);
      }
      return res.json(await withInflight<TemplarsResult>(templarsLcKey, async (): Promise<TemplarsResult> => {
      try {
        // First, try ERC721 balanceOf
        let balance: bigint;
        try {
          balance = await publicClient.readContract({
            address: TEMPLARS_NFT_CONTRACT_ADDRESS as `0x${string}`,
            abi: ERC721_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [walletLower as `0x${string}`],
          });
        } catch (erc721Error) {
          // If ERC721 fails, try ERC1155 balanceOf (requires token ID)
          // For now, we'll just return 0 and log the error
          console.error('Error reading ERC721 balanceOf for Templars NFT:', erc721Error);
          
          // Check if contract exists by trying to get code
          const code = await publicClient.getBytecode({
            address: TEMPLARS_NFT_CONTRACT_ADDRESS as `0x${string}`,
          });
          
          if (!code || code === '0x') {
            console.error(`Contract does not exist at ${TEMPLARS_NFT_CONTRACT_ADDRESS} on Ink mainnet`);
          }
          
          // Return 0 balance
          balance = BigInt(0);
        }

        const count = Number(balance);

        const result = {
          slug: 'templars_nft_balance',
          name: 'Templars of the Storm',
          icon: '⚔️',
          currency: 'COUNT',
          value: count,
          total_count: count,
          total_value: count.toString(),
          sub_aggregates: [],
          last_updated: new Date(),
        };

        responseCache.set(cacheKey, result);
        setLongCache(templarsLcKey, result);
        return result;
      } catch (error) {
        console.error('Error fetching Templars NFT balance:', error);
        // Return 0 balance on error instead of failing
        const result = {
          slug: 'templars_nft_balance',
          name: 'Templars of the Storm',
          icon: '⚔️',
          currency: 'COUNT',
          value: 0,
          total_count: 0,
          total_value: '0',
          sub_aggregates: [],
          last_updated: new Date(),
        };
        responseCache.set(cacheKey, result);
        return result;
      }
      }));
    }

    // Special handling for zenith_nft_balance - blockchain read operation
    // (InkScore Zenith ERC721 holdings for the wallet). No points for now.
    if (metric === 'zenith_nft_balance') {
      const zenithLcKey = `long:${cacheKey}`;
      const zenithLc = getLongCache<ZenithNftBalanceResult>(zenithLcKey, ZENITH_LONG_CACHE_TTL);
      if (zenithLc) {
        responseCache.set(cacheKey, zenithLc);
        return res.json(zenithLc);
      }
      return res.json(await withInflight<ZenithNftBalanceResult>(zenithLcKey, async (): Promise<ZenithNftBalanceResult> => {
        try {
          const balance = await publicClient.readContract({
            address: ZENITH_NFT_CONTRACT_ADDRESS as `0x${string}`,
            abi: ERC721_BALANCE_OF_ABI,
            functionName: 'balanceOf',
            args: [walletLower as `0x${string}`],
          });

          const count = Number(balance);

          const result: ZenithNftBalanceResult = {
            slug: 'zenith_nft_balance',
            name: 'InkScore Zenith',
            icon: 'https://i2c.seadn.io/collection/inkscore-zenith/image_type_logo/831152ff66038d827191d68d3d66b9/2f831152ff66038d827191d68d3d66b9.png?h=250&w=250',
            currency: 'COUNT',
            total_count: count,
            total_value: count.toString(),
            sub_aggregates: [],
            last_updated: new Date(),
          };

          responseCache.set(cacheKey, result);
          setLongCache(zenithLcKey, result);
          return result;
        } catch (error) {
          console.error('Error fetching InkScore Zenith NFT balance:', error);
          const result: ZenithNftBalanceResult = {
            slug: 'zenith_nft_balance',
            name: 'InkScore Zenith',
            icon: 'https://i2c.seadn.io/collection/inkscore-zenith/image_type_logo/831152ff66038d827191d68d3d66b9/2f831152ff66038d827191d68d3d66b9.png?h=250&w=250',
            currency: 'COUNT',
            total_count: 0,
            total_value: '0',
            sub_aggregates: [],
            last_updated: new Date(),
          };
          responseCache.set(cacheKey, result);
          return result;
        }
      }));
    }

    // Special handling for zenith_staking - blockchain read operation
    // (InkScore Zenith NFTs staked in the InkScoreStaking contract, broken
    //  down by lock period: 1 month / 1 week / 1 day). No points for now.
    if (metric === 'zenith_staking') {
      const zenithStakingLcKey = `long:${cacheKey}`;
      const zenithStakingLc = getLongCache<ZenithStakingResult>(zenithStakingLcKey, ZENITH_LONG_CACHE_TTL);
      if (zenithStakingLc) {
        responseCache.set(cacheKey, zenithStakingLc);
        return res.json(zenithStakingLc);
      }
      return res.json(await withInflight<ZenithStakingResult>(zenithStakingLcKey, async (): Promise<ZenithStakingResult> => {
        const emptyResult = (): ZenithStakingResult => ({
          slug: 'zenith_staking',
          name: 'InkScore Zenith Staking',
          icon: '/inkscore_logo.png',
          currency: 'COUNT',
          total_count: 0,
          total_staked: 0,
          one_month_count: 0,
          one_week_count: 0,
          one_day_count: 0,
          sub_aggregates: [
            { label: '1 Month Lock', value: '0' },
            { label: '1 Week Lock', value: '0' },
            { label: '1 Day Lock', value: '0' },
          ],
          last_updated: new Date(),
        });

        try {
          const tokenIds = await publicClient.readContract({
            address: ZENITH_STAKING_CONTRACT_ADDRESS as `0x${string}`,
            abi: ZENITH_STAKING_ABI,
            functionName: 'stakedTokensOf',
            args: [walletLower as `0x${string}`],
          });

          const totalStaked = tokenIds.length;          if (totalStaked === 0) {
            const result = emptyResult();
            responseCache.set(cacheKey, result);
            setLongCache(zenithStakingLcKey, result);
            return result;
          }

          // Read each staked token's stake info to classify by lock period.
          // LockPeriod durations: Day = 1 day (86400s), Week = 7 days
          // (604800s), Month = 30 days (2592000s).
          const cappedTokenIds = tokenIds.slice(0, ZENITH_MAX_STAKED_TOKENS);
          const stakeInfos = await Promise.all(
            cappedTokenIds.map((tokenId) =>
              publicClient.readContract({
                address: ZENITH_STAKING_CONTRACT_ADDRESS as `0x${string}`,
                abi: ZENITH_STAKING_ABI,
                functionName: 'stakeInfo',
                args: [tokenId],
              })
            )
          );

          let oneMonthCount = 0;
          let oneWeekCount = 0;
          let oneDayCount = 0;
          for (const [, stakedAt, unlockTimestamp] of stakeInfos) {
            const lockDuration = Number(unlockTimestamp) - Number(stakedAt);
            if (lockDuration >= 2592000) oneMonthCount++;
            else if (lockDuration >= 604800) oneWeekCount++;
            else oneDayCount++;
          }

          const result: ZenithStakingResult = {
            slug: 'zenith_staking',
            name: 'InkScore Zenith Staking',
            icon: '/inkscore_logo.png',
            currency: 'COUNT',
            total_count: totalStaked,
            total_staked: totalStaked,
            one_month_count: oneMonthCount,
            one_week_count: oneWeekCount,
            one_day_count: oneDayCount,
            sub_aggregates: [
              { label: '1 Month Lock', value: oneMonthCount.toString() },
              { label: '1 Week Lock', value: oneWeekCount.toString() },
              { label: '1 Day Lock', value: oneDayCount.toString() },
            ],
            last_updated: new Date(),
          };

          responseCache.set(cacheKey, result);
          setLongCache(zenithStakingLcKey, result);
          return result;
        } catch (error) {
          console.error('Error fetching InkScore Zenith staking metrics:', error);
          const result = emptyResult();
          responseCache.set(cacheKey, result);
          return result;
        }
      }));
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

