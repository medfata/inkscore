import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';
import { analyticsService } from '../services/analytics-service';
import { query } from '../db';

const router = Router();

// Validate wallet address format
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

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

// NFT marketplace contract addresses
const NFT_CONTRACTS = [
  '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5', // Net Protocol
  '0xbd6a027b85fd5285b1623563bbef6fadbe396afb', // Mintiq
  '0x9ebf93fdba9f32accab3d6716322dccd617a78f3', // Squid Market
];

// ZNS tracking config
const ZNS_CONFIG = {
  deploy: { contract: '0x63c489d31a2c3de0638360931f47ff066282473f', functions: ['Deploy', 'deploy'] },
  sayGm: { contract: '0x3033d7ded400547d6442c55159da5c61f2721633', functions: ['SayGM', 'sayGM'] },
  register: { contract: '0xfb2cd41a8aec89efbb19575c6c48d872ce97a0a5', functions: ['RegisterDomains', 'registerDomains'] },
};

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

    // Special handling for gm_count - direct native query
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

      const rows = await query<{
        tx_hash: string;
        value: string;
        eth_price_usd: string;
        operations: string;
      }>(`
        SELECT 
          tx_hash,
          value,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations
        FROM transaction_enrichment
        WHERE LOWER(contract_address) = LOWER($1) 
          AND LOWER(wallet_address) = LOWER($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, buyMethodIds]);

      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {
        const ethPrice = parseFloat(row.eth_price_usd || '3500');
        if (row.value && row.value !== '0') {
          const ethValue = Number(BigInt(row.value)) / 1e18;
          totalVolume += ethValue * ethPrice;
        }
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

      const rows = await query<{
        tx_hash: string;
        eth_price_usd: string;
        operations: string;
        internal_eth_out: string;
      }>(`
        SELECT 
          tx_hash,
          COALESCE(eth_price_usd, 3500) as eth_price_usd,
          operations,
          COALESCE(internal_eth_out, 0) as internal_eth_out
        FROM transaction_enrichment
        WHERE LOWER(contract_address) = LOWER($1) 
          AND LOWER(wallet_address) = LOWER($2)
          AND method_id = ANY($3)
      `, [INKYSWAP_ROUTER_ADDRESS, wallet, sellMethodIds]);

      let totalVolume = 0;
      const count = rows.length;

      for (const row of rows) {
        const ethPrice = parseFloat(row.eth_price_usd || '3500');

        if (row.internal_eth_out && parseFloat(row.internal_eth_out) > 0) {
          totalVolume += parseFloat(row.internal_eth_out) * ethPrice;
          continue;
        }

        if (row.operations) {
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
                  totalVolume += ethValue * ethPrice;
                  break;
                }
              }
            }
          } catch (e) {
            console.error('Failed to parse operations for tx:', row.tx_hash, e);
          }
        }
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

    // Special handling for shellies_staking
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
