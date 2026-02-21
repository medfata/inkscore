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

    // Special handling for opensea_buy_count
    if (metric === 'opensea_buy_count') {
      const rows = await query<{ count: string }>(`
        SELECT count(tx_hash) as count 
        FROM transaction_details 
        WHERE contract_address = lower($1)
          AND wallet_address = lower($2)
          AND lower(function_name) = lower($3)
          AND status = 1
      `, [OPENSEA_CONTRACT_ADDRESS, wallet, OPENSEA_BUY_FUNCTION]);

      const count = parseInt(rows[0]?.count || '0', 10);

      const result = {
        slug: 'opensea_buy_count',
        name: 'OpenSea Buys',
        icon: 'https://opensea.io/favicon.ico',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
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

    // Special handling for opensea_sale_count
    if (metric === 'opensea_sale_count') {
      const queryStartTime = Date.now();
      console.log(`[OPENSEA_SALE] Starting query for wallet: ${wallet}`);
      
      // Query transaction_enrichment for sales where wallet is the seller (from address in Transfer event)
      // The wallet address in topics[1] is padded to 64 hex chars (32 bytes)
      const paddedWallet = '0x' + wallet.slice(2).toLowerCase().padStart(64, '0');
      console.log(`[OPENSEA_SALE] Padded wallet: ${paddedWallet}`);
      
      const dbQueryStart = Date.now();
      const rows = await query<{ count: string }>(`
        SELECT COUNT(DISTINCT te.tx_hash) as count
        FROM transaction_enrichment te
        WHERE te.contract_address = lower($1)
          AND te.logs IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(te.logs) AS log
            WHERE log->>'event' = 'Transfer(address indexed from, address indexed to, uint256 value)'
              AND jsonb_array_length(log->'topics') >= 2
              AND lower(log->'topics'->>1) = lower($2)
          )
      `, [OPENSEA_CONTRACT_ADDRESS, paddedWallet]);
      const dbQueryTime = Date.now() - dbQueryStart;
      console.log(`[OPENSEA_SALE] DB query completed in ${dbQueryTime}ms`);

      const count = parseInt(rows[0]?.count || '0', 10);
      console.log(`[OPENSEA_SALE] Found ${count} sales`);

      const result = {
        slug: 'opensea_sale_count',
        name: 'OpenSea Sales',
        icon: 'https://opensea.io/favicon.ico',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      const totalTime = Date.now() - queryStartTime;
      console.log(`[OPENSEA_SALE] Total processing time: ${totalTime}ms`);

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
