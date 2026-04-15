import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';
import { analyticsService, sweepService, inkDcaService, openSeaService } from '../services';
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

// OpenSea contract address (Seaport on Ink)
const OPENSEA_CONTRACT_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';
const OPENSEA_BUY_FUNCTION = 'fulfillBasicOrder_efficient_6GL6yc';

// Mint contract address and methods
const MINT_CONTRACT_ADDRESS = '0x00005ea00ac477b1030ce78506496e8c2de24bf5';
const MINT_FUNCTIONS = ['mintPublic', '0x161ac21f'];

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

// InkDCA contract address and method
const INKDCA_CONTRACT_ADDRESS = '0x4286643d9612515F487c2F3272845bc53Ca80705';
const INKDCA_RUN_FUNCTION = 'runDCA';

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
// ============================================

// Token info interface from DeFi Llama API
interface TokenInfo {
  decimals: number;
  symbol: string;
  price: number;
  timestamp: number;
  confidence: number;
}

// Cache for token info (price, decimals, symbol, etc.)
const tokenInfoCache: Record<string, { data: TokenInfo; cachedAt: number }> = {};
const TOKEN_INFO_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Fallback token info when API doesn't have the token
const FALLBACK_TOKEN_INFO: TokenInfo = {
  decimals: 18,
  symbol: 'UNKNOWN',
  price: 0.00001,
  timestamp: 0,
  confidence: 0
};

/**
 * Get token info (price, decimals, symbol) from DeFi Llama API
 * Uses 2-hour cache per token
 * Fallback: 18 decimals, $0.00001 price
 */
async function getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
  const cacheKey = tokenAddress.toLowerCase();

  // Check cache first
  const cached = tokenInfoCache[cacheKey];
  if (cached && Date.now() - cached.cachedAt < TOKEN_INFO_CACHE_TTL) {
    return cached.data;
  }

  try {
    // Use DeFi Llama API for Ink Chain
    const llamaUrl = `https://coins.llama.fi/prices/current/ink:${tokenAddress}`;
    const response = await fetch(llamaUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });

    if (response.ok) {
      const data: any = await response.json();
      const coinKey = `ink:${tokenAddress}`;
      if (data && data.coins && data.coins[coinKey]) {
        const coin = data.coins[coinKey];
        const tokenInfo: TokenInfo = {
          decimals: coin.decimals ?? 18,
          symbol: coin.symbol ?? 'UNKNOWN',
          price: coin.price ?? 0.00001,
          timestamp: coin.timestamp ?? 0,
          confidence: coin.confidence ?? 0
        };
        tokenInfoCache[cacheKey] = { data: tokenInfo, cachedAt: Date.now() };
        return tokenInfo;
      }
    }

    // Token not found in API - use fallback
    tokenInfoCache[cacheKey] = { data: FALLBACK_TOKEN_INFO, cachedAt: Date.now() };
    return FALLBACK_TOKEN_INFO;
  } catch (error) {
    console.error(`[Token Info] Error fetching info for ${tokenAddress}:`, error);
  }

  // Fallback on error
  return FALLBACK_TOKEN_INFO;
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

    // Single query with CASE statements to count all metrics at once
    const rows = await query<{
      deploy_count: string;
      say_gm_count: string;
      register_count: string;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE contract_address = $1 AND function_name = ANY($2)) as deploy_count,
        COUNT(*) FILTER (WHERE contract_address = $3 AND function_name = ANY($4)) as say_gm_count,
        COUNT(*) FILTER (WHERE contract_address = $5 AND function_name = ANY($6)) as register_count
      FROM transaction_details
      WHERE wallet_address = $7
        AND status = 1
        AND (
          (contract_address = $1 AND function_name = ANY($2)) OR
          (contract_address = $3 AND function_name = ANY($4)) OR
          (contract_address = $5 AND function_name = ANY($6))
        )
    `, [
      ZNS_CONFIG.deploy.contract, ZNS_CONFIG.deploy.functions,
      ZNS_CONFIG.sayGm.contract, ZNS_CONFIG.sayGm.functions,
      ZNS_CONFIG.register.contract, ZNS_CONFIG.register.functions,
      walletLower
    ]);

    const deployCount = parseInt(rows[0]?.deploy_count || '0', 10);
    const sayGmCount = parseInt(rows[0]?.say_gm_count || '0', 10);
    const registerCount = parseInt(rows[0]?.register_count || '0', 10);

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
// POST /api/analytics/:wallet/opensea-cache - Receive OpenSea counts from Vercel
// ============================================
router.post('/:wallet/opensea-cache', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    if (!isValidAddress(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    const { buys, sales, mints } = req.body;
    if (typeof buys !== 'number' || typeof sales !== 'number' || typeof mints !== 'number') {
      return res.status(400).json({ error: 'buys, sales, and mints must be numbers' });
    }

    const walletLower = wallet.toLowerCase();
    openSeaService.setCachedCounts(walletLower, buys, sales, mints);

    // Invalidate stale responseCache entries so the next score calculation
    // reads the fresh counts from openSeaService rather than a cached 0
    responseCache.delete(`analytics:opensea_buy_count:${walletLower}`);
    responseCache.delete(`analytics:opensea_sale_count:${walletLower}`);
    responseCache.delete(`wallet:score:${walletLower}`);

    res.json({ ok: true });
  } catch (error) {
    console.error('Error setting OpenSea cache:', error);
    res.status(500).json({ error: 'Failed to set OpenSea cache' });
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
    // External GM API (https://gm.inkonchain.com)
    // Disabled due to external endpoint instability. Kept for reference.
    // ============================================================
    // if (metric === 'gm_count') {
    //   const walletLower = wallet.toLowerCase();
    //   const externalApiUrl = `https://gm.inkonchain.com/api/gm-data?address=${walletLower}`;
    //
    //   const response = await fetch(externalApiUrl);
    //   if (!response.ok) {
    //     return res.status(502).json({ error: 'Failed to fetch GM data from external API' });
    //   }
    //
    //   const data = await response.json() as {
    //     totalGms: number;
    //     userGms: Record<string, number>;
    //     receivedGms: Record<string, number>;
    //   };
    //
    //   const count = data.userGms[walletLower] || 0;
    //
    //   const result = {
    //     slug: 'gm_count',
    //     name: 'GM Count',
    //     icon: '👋',
    //     currency: 'COUNT',
    //     total_count: count,
    //     total_value: count.toString(),
    //     sub_aggregates: [],
    //     last_updated: new Date(),
    //   };
    //
    //   responseCache.set(cacheKey, result);
    //   return res.json(result);
    // }

    // GM count from indexed transaction_details table
    if (metric === 'gm_count') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count
        FROM transaction_details
        WHERE contract_address = $1
          AND wallet_address = lower($2)
      `, [GM_CONTRACT_ADDRESS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

      const result = {
        slug: 'gm_count',
        name: 'GM Count',
        icon: '👋',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
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

    // Special handling for opensea_buy_count (uses OpenSea GraphQL API)
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

    // Special handling for mint_count
    if (metric === 'mint_count') {
      // First, get all mint transaction hashes
      const txRows = await query<{ tx_hash: string }>(`
        SELECT tx_hash
        FROM transaction_details 
        WHERE contract_address = lower($1)
          AND wallet_address = lower($2)
          AND lower(function_name) = ANY($3::text[])
          AND status = 1
      `, [MINT_CONTRACT_ADDRESS, wallet, MINT_FUNCTIONS.map(f => f.toLowerCase())]);

      let totalMinted = 0;

      // For each transaction, fetch details from Routescan and extract quantity
      for (const row of txRows) {
        try {
          const response = await fetch(`https://cdn.routescan.io/api/evm/57073/transactions/${row.tx_hash}`);
          if (response.ok) {
            const txData = await response.json() as { input?: string };
            
            // Extract quantity from input data
            // Input format: 0x + 8 chars (function selector) + 4 parameters (64 chars each)
            // mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity)
            if (txData.input && txData.input.startsWith('0x') && txData.input.length >= 266) {
              // Remove 0x prefix
              const inputData = txData.input.slice(2);
              
              // Remove function selector (first 8 hex chars = 4 bytes)
              const paramsData = inputData.slice(8);
              
              // Split into 64-char chunks (32 bytes each)
              const chunk0 = paramsData.slice(0, 64);   // nftContract address
              const chunk1 = paramsData.slice(64, 128); // feeRecipient address
              const chunk2 = paramsData.slice(128, 192); // minterIfNotPayer address
              const chunk3 = paramsData.slice(192, 256); // quantity (uint256)
              
              // Convert quantity from hex to decimal
              const quantity = parseInt(chunk3, 16);
              
              if (!isNaN(quantity) && quantity > 0) {
                totalMinted += quantity;
              } else {
                // Fallback: count as 1 mint if quantity is invalid
                totalMinted += 1;
              }
            } else {
              // Fallback: count as 1 mint if we can't parse
              totalMinted += 1;
            }
          } else {
            // Fallback: count as 1 mint if API fails
            totalMinted += 1;
          }
        } catch (error) {
          console.error(`Error fetching tx details for ${row.tx_hash}:`, error);
          // Fallback: count as 1 mint if error occurs
          totalMinted += 1;
        }
      }

      const result = {
        slug: 'mint_count',
        name: 'Mints',
        icon: '🎨',
        currency: 'COUNT',
        total_count: totalMinted,
        total_value: totalMinted.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for opensea_sale_count (uses OpenSea GraphQL API)
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

    // Special handling for inkypump_created_tokens
    if (metric === 'inkypump_created_tokens') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count 
        FROM transaction_details 
        WHERE contract_address = $1 
          AND wallet_address = lower($2)
          AND function_name = $3
      `, [INKYPUMP_CONTRACT_ADDRESS, wallet, INKYPUMP_CREATE_TOKEN_FUNCTION]);

      const count = parseInt(rows[0]?.count || '0', 10);

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

    // Special handling for inkypump_buy_volume
    if (metric === 'inkypump_buy_volume') {
      const buyMethodIds = ['0x7ff36ab5', '0xfb3bdb41'];
      const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

      const rows = await query<{
        tx_hash: string;
        value: string;
        eth_price_usd: string;
        operations: string;
        logs: string;
        method_id: string;
      }>(`
        SELECT 
          tx_hash,
          value,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations,
          logs,
          method_id
        FROM transaction_enrichment
        WHERE LOWER(contract_address) = LOWER($1) 
          AND LOWER(wallet_address) = LOWER($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, buyMethodIds]);

      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {
        const ethPrice = parseFloat(row.eth_price_usd || '3500');
        let txUsdValue = 0;

        // Parse logs to find the InkyPump token being bought (not WETH)
        if (row.logs) {
          try {
            const logs = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
            if (Array.isArray(logs)) {
              // Find the token transfer that's NOT WETH (that's the token being bought)
              for (const log of logs) {
                if (log.event?.startsWith('Transfer(') && log.address?.id) {
                  const tokenAddress = log.address.id.toLowerCase();

                  // Skip WETH transfers (that's what user is spending)
                  if (tokenAddress === WETH_ADDRESS.toLowerCase()) {
                    continue;
                  }

                  // Parse amount from Transfer event
                  if (log.data) {
                    const amountHex = log.data.startsWith('0x') ? log.data.slice(2, 66) : log.data.slice(0, 64);
                    const amountRaw = BigInt('0x' + amountHex);

                    // Get token info from DeFi Llama
                    const tokenInfo = await getTokenInfo(tokenAddress);

                    const tokenAmount = Number(amountRaw) / Math.pow(10, tokenInfo.decimals);
                    txUsdValue = tokenAmount * tokenInfo.price;

                    // Found the token, break
                    break;
                  }
                }
              }
            }
          } catch (e) {
            // Silent error handling
          }
        }

        // Fallback: Use ETH value if token parsing failed
        if (txUsdValue === 0 && row.value && row.value !== '0') {
          const ethValue = Number(BigInt(row.value)) / 1e18;
          txUsdValue = ethValue * ethPrice;
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
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for inkypump_sell_volume
    if (metric === 'inkypump_sell_volume') {
      const sellMethodIds = ['0x18cbafe5', '0x4a25d94a', '0x791ac947'];
      const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

      const rows = await query<{
        tx_hash: string;
        eth_price_usd: string;
        operations: string;
        internal_eth_out: string;
        logs: string;
        method_id: string;
      }>(`
        SELECT 
          tx_hash,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations,
          COALESCE(internal_eth_out, 0) as internal_eth_out,
          logs,
          method_id
        FROM transaction_enrichment
        WHERE LOWER(contract_address) = LOWER($1) 
          AND LOWER(wallet_address) = LOWER($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, sellMethodIds]);


      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {

        const ethPrice = parseFloat(row.eth_price_usd || '3500');

        let txUsdValue = 0;

        // Parse logs to find the InkyPump token being sold (not WETH)
        if (row.logs) {
          try {
            const logs = typeof row.logs === 'string' ? JSON.parse(row.logs) : row.logs;
            if (Array.isArray(logs)) {
              // Find the token transfer that's NOT WETH (that's the token being sold)
              for (const log of logs) {
                if (log.event?.startsWith('Transfer(') && log.address?.id && log.topics?.length >= 3) {
                  const tokenAddress = log.address.id.toLowerCase();

                  // Skip WETH transfers (that's what user is receiving)
                  if (tokenAddress === WETH_ADDRESS.toLowerCase()) {
                    continue;
                  }

                  // Check if this transfer is FROM the wallet (selling)
                  const fromAddress = log.topics[1] ? '0x' + log.topics[1].slice(-40).toLowerCase() : '';
                  if (fromAddress !== walletLower) {
                    continue;
                  }


                  // Parse amount from Transfer event
                  if (log.data) {
                    const amountHex = log.data.startsWith('0x') ? log.data.slice(2, 66) : log.data.slice(0, 64);
                    const amountRaw = BigInt('0x' + amountHex);

                    // Get token info from DeFi Llama
                    const tokenInfo = await getTokenInfo(tokenAddress);

                    const tokenAmount = Number(amountRaw) / Math.pow(10, tokenInfo.decimals);
                    txUsdValue = tokenAmount * tokenInfo.price;


                    // Found the token, break
                    break;
                  }
                }
              }
            }
          } catch (e) {
          }
        }

        // Fallback 1: Use internal_eth_out
        if (txUsdValue === 0 && row.internal_eth_out && parseFloat(row.internal_eth_out) > 0) {
          const ethValue = parseFloat(row.internal_eth_out);
          txUsdValue = ethValue * ethPrice;
        }

        // Fallback 2: Parse operations
        if (txUsdValue === 0 && row.operations) {
          try {
            const operations = typeof row.operations === 'string'
              ? JSON.parse(row.operations)
              : row.operations;

            if (Array.isArray(operations)) {
              for (const op of operations) {
                const toAddress = (op.to?.id || '').toLowerCase();
                const fromAddress = (op.from?.id || '').toLowerCase();
                const value = op.value;

                if (toAddress === walletLower &&
                  fromAddress !== walletLower &&
                  value && value !== '0') {
                  const ethValue = Number(BigInt(value)) / 1e18;
                  txUsdValue = ethValue * ethPrice;
                  break;
                }
              }
            }
          } catch (e) {
          }
        }

        if (txUsdValue === 0) {
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

    // Special handling for shellies_joined_raffles
    if (metric === 'shellies_joined_raffles') {
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = ANY($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('JoinRaffle', 'joinRaffle')
          AND status = 1
      `, [SHELLIES_RAFFLE_CONTRACTS, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

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

    // Special handling for shellies_pay_to_play
    if (metric === 'shellies_pay_to_play') {
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('PayToPlay', 'payToPlay')
          AND status = 1
      `, [SHELLIES_PAY_TO_PLAY_CONTRACT, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

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

    // Special handling for shellies_staking (kept for backward compatibility)
    if (metric === 'shellies_staking') {
      // Fallback to transaction count (contract read not available in Express server)
      const rows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name IN ('StakeBatch', 'stakeBatch', '0x1e332260')
          AND status = 1
      `, [SHELLIES_STAKING_CONTRACT, wallet]);

      const count = parseInt(rows[0]?.count || '0', 10);

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

    // Special handling for inkdca_run_dca
    if (metric === 'inkdca_run_dca') {
      // Count runDCA executions from database
      const runDcaRows = await query<{ count: string }>(`
        SELECT COUNT(*) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1) 
          AND wallet_address = lower($2)
          AND function_name = $3
          AND status = 1
      `, [INKDCA_CONTRACT_ADDRESS, wallet, INKDCA_RUN_FUNCTION]);

      const runDcaCount = parseInt(runDcaRows[0]?.count || '0', 10);

      // Get metrics from InkDCA API (registered DCAs and total spent)
      const inkDcaMetrics = await inkDcaService.getMetrics(wallet, runDcaCount);

      const result = {
        slug: 'inkdca_run_dca',
        name: 'Registered DCAs',
        icon: 'https://inkdca.com/ink_dca_logo.png',
        currency: 'COUNT',
        total_count: inkDcaMetrics.totalRegisteredDCAs,
        total_value: inkDcaMetrics.totalRegisteredDCAs.toString(),
        sub_aggregates: [
          { label: 'Total Spent', value: `$${inkDcaMetrics.totalSpentUSD.toFixed(2)}` }
        ],
        last_updated: new Date(),
      };

      responseCache.set(cacheKey, result);
      return res.json(result);
    }

    // Special handling for cowswap_swaps
    if (metric === 'cowswap_swaps') {
      try {
        let allOrders: any[] = [];
        let offset = 0;
        let hasMorePages = true;

        // Paginate through all orders
        while (hasMorePages) {
          const ordersUrl = `${COW_SWAP_CONFIG.apiBaseUrl}/account/${walletLower}/orders?offset=${offset}&limit=${COW_SWAP_CONFIG.pageSize}`;
          
          try {
            const response = await fetch(ordersUrl);
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
            const priceResponse = await fetch(priceUrl, { 
              method: 'GET', 
              headers: { 'Accept': 'application/json' } 
            });
            
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
        return res.json(result);
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
        return res.json(result);
      }
    }

    // Special handling for templars_nft_balance - blockchain read operation
    if (metric === 'templars_nft_balance') {
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
        return res.json(result);
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
        return res.json(result);
      }
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
