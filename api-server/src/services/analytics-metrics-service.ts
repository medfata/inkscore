// ============================================
// analytics-metrics-service
// Metric computations moved verbatim from
// routes/analytics.ts (/:wallet/:metric handler branches).
// Each function returns the exact result object the
// route used to build; response caching stays in the route.
// ============================================
import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolCount, getProtocolTxHashes, getTxData, partitionTxHashes } from './blockscout-service';
import { getTokenInfo } from './token-info-service';
import { sweepService } from './sweep-service';
import { openSeaService } from './opensea-service';
import { priceService } from './price-service';

// ============================================
// Contract addresses and constants
// (moved verbatim from routes/analytics.ts)
// ============================================

// InkyPump contract address and methods
const INKYPUMP_CONTRACT_ADDRESS = '0x1d74317d760f2c72a94386f50e8d10f2c902b899';
const INKYPUMP_CREATE_TOKEN_FUNCTION = '0xa07849e6';

// InkySwap router contract for InkyPump trading
const INKYSWAP_ROUTER_ADDRESS = '0xa8c1c38ff57428e5c3a34e0899be5cb385476507';

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
// dashboard polls don't re-hit gm.ink / RPC on every load.
const GM_LONG_CACHE_TTL = 10 * 60 * 1000;

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

// ============================================================
// GM count — combined sources with failover:
//   1. gm.ink API (primary): full history incl. live updates,
//      but intermittently unstable → 2 attempts with timeout
//   2. Goldsky DailyGM subgraph (fallback): reliable, but only
//      indexes recent GMs (missing history before its start block)
// NOTE: do NOT sum the two sources — the subgraph count is a
// subset of gm.ink's (verified 2026-09-02: 120⊇17, 311⊇93).
// ============================================================
export async function getGmCount(walletLower: string): Promise<GmCountResult> {
  const GM_INK_API = 'https://www.gm.ink/api/gm-data';
  const GOLDSKY_SUBGRAPH = 'https://api.goldsky.com/api/public/project_cmo0uv9q6okpf01zk5gmoaeao/subgraphs/DailyGM/1.1.1/gn';

  // gm.ink takes ~3.5s per call and GM history is append-only: share one
  // in-flight fetch across concurrent requests and cache 10 minutes.
  const gmLcKey = `long:analytics:gm_count:${walletLower}`;
  const gmLc = getLongCache<GmCountResult>(gmLcKey, GM_LONG_CACHE_TTL);
  if (gmLc) {
    return gmLc;
  }

  const fetchedGm = await withInflight(gmLcKey, async () => {
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

  setLongCache(gmLcKey, result);
  return result;
}

// Special handling for sweep
export async function getSweep(walletLower: string) {
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

  return result;
}

// Special handling for opensea_buy_count (uses OpenSea v2 REST API)
export async function getOpenseaBuyCount(wallet: string) {
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
    ...(counts.partial ? { partial: true } : {}),
  };

  return result;
}

// Mints from OpenSea v2 events (unique mint transactions to the wallet).
// Previously this only counted mintPublic calls to OpenSea's shared Seadrop
// minter contract, which wildly undercounted mints made via other contracts.
export async function getMintCount(wallet: string) {
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
    ...(counts.partial ? { partial: true } : {}),
  };

  return result;
}

// Special handling for opensea_sale_count (uses OpenSea v2 REST API)
export async function getOpenseaSaleCount(wallet: string) {
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
    ...(counts.partial ? { partial: true } : {}),
  };

  return result;
}

// Special handling for inkypump_created_tokens (counts via Blockscout)
export async function getInkypumpCreatedTokens(walletLower: string) {
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

  return result;
}

// Special handling for inkypump_buy_volume (legs via Blockscout)
export async function getInkypumpBuyVolume(walletLower: string) {
  const buyMethodIds = ['0x7ff36ab5', '0xfb3bdb41'];
  const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

  const { hashes, complete } = await getProtocolTxHashes(walletLower, INKYSWAP_ROUTER_ADDRESS, buyMethodIds);
  // Price ALL cached + a capped slice of uncached so USD converges over loads.
  const { cached, uncached } = await partitionTxHashes(hashes);
  const priced = [...cached, ...uncached.slice(0, 300)];
  const partial = !complete || cached.length + Math.min(uncached.length, 100) < hashes.length;
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

  return result;
}

// Special handling for inkypump_sell_volume (legs via Blockscout)
export async function getInkypumpSellVolume(walletLower: string) {
  const sellMethodIds = ['0x18cbafe5', '0x4a25d94a', '0x791ac947'];
  const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

  const { hashes, complete } = await getProtocolTxHashes(walletLower, INKYSWAP_ROUTER_ADDRESS, sellMethodIds);
  // Price ALL cached + a capped slice of uncached so USD converges over loads.
  const { cached, uncached } = await partitionTxHashes(hashes);
  const priced = [...cached, ...uncached.slice(0, 300)];
  const partial = !complete || cached.length + Math.min(uncached.length, 100) < hashes.length;
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

  return result;
}
