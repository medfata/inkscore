import { getLongCache, setLongCache, getInflight, withInflight } from '../cache';
import {
  getProtocolCount,
  getProtocolTxHashes,
  partitionTxHashes,
  getTxData,
} from './blockscout-service';

// Sprint 1: verbatim extraction of the /api/nado/:wallet handler from
// routes/nado.ts. The route is now a thin shell; long-cache + in-flight
// coordination live here. No logic changed.

// Nado Finance contract address
const NADO_CONTRACT = '0x05ec92d78ed421f3d3ada77ffde167106565974e';

export interface NadoMetrics {
  totalDeposits: number;
  totalTransactions: number;
  nadoVolumeUSD: number; // Calculated volume from Nado API - this is the main volume to display
  dbTotalVolume?: number; // Legacy field, always 0 (kept for shape compatibility)
  partial?: boolean;
  tokenBreakdown?: Array<{
    tokenAddress: string;
    symbol: string;
    name: string;
    depositAmount: number;
    rawAmount: number;
  }>;
}

/**
 * Generate Nado subaccounts for a wallet address.
 * Nado subaccount format: wallet_address (20 bytes) + subaccount name
 * (e.g. "default", "default_1") + zero padding to 32 bytes.
 * Wallets can trade on several subaccounts, so we probe "default" plus
 * "default_1".."default_5" and aggregate volume across all of them.
 */
function generateNadoSubaccounts(walletAddress: string): string[] {
  // Remove 0x prefix if present
  const cleanAddress = walletAddress.replace(/^0x/, '');

  // "default" in hex: 64656661756c74
  const base = cleanAddress + '64656661756c74';

  const subs = [base + '0000000000']; // "default"
  for (let i = 1; i <= 5; i++) {
    // "_1".."5" in hex: 5f31..5f35, then zero padding to 32 bytes
    subs.push(`${base}5f3${i}000000`);
  }

  return subs;
}

/**
 * Live ETH/BTC spot prices (CoinGecko) with a short in-memory cache.
 * Falls back to the previous hardcoded values if the fetch fails so the
 * endpoint never breaks when CoinGecko is unreachable/rate-limited.
 */
let priceCache: { ts: number; eth: number; btc: number } | null = null;
let priceInflight: Promise<{ eth: number; btc: number }> | null = null;
const PRICE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_PRICES = { eth: 3500, btc: 95000 };

async function getLivePrices(): Promise<{ eth: number; btc: number }> {
  if (priceCache && Date.now() - priceCache.ts < PRICE_TTL_MS) {
    return priceCache;
  }
  if (priceInflight) {
    return priceInflight;
  }
  priceInflight = (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd',
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json() as { ethereum?: { usd?: number }; bitcoin?: { usd?: number } };
      const eth = Number(data.ethereum?.usd) || FALLBACK_PRICES.eth;
      const btc = Number(data.bitcoin?.usd) || FALLBACK_PRICES.btc;
      priceCache = { ts: Date.now(), eth, btc };
      return priceCache;
    } catch (error: any) {
      console.warn('[Nado] live price fetch failed, using fallback prices:', error.message || error);
      return FALLBACK_PRICES;
    } finally {
      priceInflight = null;
    }
  })();
  return priceInflight;
}

/**
 * Fetch wallet volume from Nado API for all of the wallet's subaccounts.
 * Sums the per-product `quote_volume_cumulative` counters (each entry is the
 * latest action per product and carries that product's cumulative traded
 * quote volume since the beginning of time).
 */
async function getWalletVolume(subaccounts: string[]) {
  const doFetch = async (subs: string[]) => {
    const response = await fetch("https://archive.prod.nado.xyz/v1", {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        account_snapshots: {
          subaccounts: subs,
          timestamps: [Math.floor(Date.now() / 1000)]
        }
      }),
      // Bound the call: the multi-subaccount query can stall server-side.
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`[Nado API] HTTP error! status: ${response.status}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json() as Promise<any>;
  };

  try {
    let data: any;
    try {
      data = await doFetch(subaccounts);
    } catch (multiErr) {
      // Fall back to the default subaccount only (old behavior, lightest query).
      console.warn('[Nado API] multi-subaccount fetch failed, retrying default only:', (multiErr as Error).message || multiErr);
      data = await doFetch(subaccounts.slice(0, 1));
    }

    // Extract volumes from all snapshots, across every subaccount
    let totalVolume = 0;

    if (data.snapshots) {
      for (const subaccount of subaccounts) {
        // The API returns subaccounts with 0x prefix, but we generate without it
        const subaccountWithPrefix = `0x${subaccount}`;
        if (!data.snapshots[subaccountWithPrefix]) {
          continue;
        }
        const timestamp = Object.keys(data.snapshots[subaccountWithPrefix])[0];
        const events = data.snapshots[subaccountWithPrefix][timestamp];

        if (Array.isArray(events)) {
          events.forEach((event: any) => {
            const volumeCumulative = parseFloat(event.quote_volume_cumulative || 0);
            totalVolume += volumeCumulative;
          });
        }
      }
    }

    const volumeInDollars = totalVolume / 1e18;

    return {
      totalVolumeRaw: totalVolume,
      totalVolumeUSD: parseFloat(volumeInDollars.toFixed(2)),
      rawData: data
    };
  } catch (error) {
    console.error("Error fetching wallet volume from Nado API:", error);
    return {
      totalVolumeRaw: 0,
      totalVolumeUSD: 0,
      rawData: null
    };
  }
}

/**
 * Get Nado volume for a wallet address (all of its subaccounts)
 */
async function getNadoVolumeForWallet(walletAddress: string) {
  const subaccounts = generateNadoSubaccounts(walletAddress);
  return await getWalletVolume(subaccounts);
}

// Nado aggregates move slowly: share in-flight work and cache beyond the
// 30s responseCache so dashboard polls don't redo the Blockscout walks +
// Nado archive API call on every load.
const NADO_LONG_CACHE_TTL = 10 * 60 * 1000;

// Helper to calculate USD value for a token.
// Volatile collateral (WETH/kBTC) uses live prices; stablecoins are $1.
// Unknown tokens are explicitly skipped ($0) with a warning so missing
// prices are visible in logs instead of silently dropping deposits.
// (Was declared inside the route handler — function declarations hoist, so
// this module-level placement is behavior-identical.)
function calculateTokenUsdValue(
  tokenAddress: string,
  decimalAmount: number,
  prices: { eth: number; btc: number }
): number {
  const addr = tokenAddress.toLowerCase();

  // Known token prices
  const knownPrices: Record<string, number> = {
    // Stablecoins
    '0x0200c29006150606b650577bbe7b6248f58470c1': 1.0, // USDT0
    '0x2d270e6886d130d724215a266106e6832161eaed': 1.0, // USDC
    '0xeb466342c4d449bc9f53a865d5cb90586f405215': 1.0, // axlUSDC
    '0xe343167631d89b6ffc58b88d6b7fb0228795491d': 1.0, // USDGLO
    // WETH - live ETH price (fallback: approximate)
    '0x4200000000000000000000000000000000000006': prices.eth, // WETH
    // KBtc - live BTC price (fallback: approximate)
    '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': prices.btc, // KBtc
  };

  const price = knownPrices[addr];
  if (price === undefined) {
    console.warn(`[Nado] unknown deposit token ${addr}, amount ${decimalAmount} — priced at $0`);
    return 0;
  }
  return decimalAmount * price;
}

export async function getNadoMetrics(walletAddress: string): Promise<NadoMetrics> {
  const nadoLcKey = `long:nado:${walletAddress}`;
  const nadoLc = getLongCache<NadoMetrics>(nadoLcKey, NADO_LONG_CACHE_TTL);
  if (nadoLc && !nadoLc.partial) {
    return nadoLc;
  }
  const nadoInf = getInflight<NadoMetrics>(nadoLcKey);
  if (nadoInf) {
    // Fall through and compute fresh if the shared run failed.
    try {
      return await nadoInf;
    } catch {
      /* fall through */
    }
  }

  return withInflight<NadoMetrics>(nadoLcKey, async (): Promise<NadoMetrics> => {
    // Total Nado interactions + deposit txs via Blockscout (replaces the
    // dead Routescan/enrichment reads; also picks up deposits the indexer
    // never captured). The Nado archive API call and live prices are
    // independent of the Blockscout walks — run all three concurrently
    // instead of serially (was: walks → prices → 15s-timeout API).
    const nadoVolumePromise = getNadoVolumeForWallet(walletAddress);
    const livePricesPromise = getLivePrices();
    const [allTx, depositHashes] = await Promise.all([
      getProtocolCount(walletAddress, 'nado-all', NADO_CONTRACT, null),
      getProtocolTxHashes(walletAddress, NADO_CONTRACT, ['0x8e5d588c']),
    ]);
    const totalTransactions = allTx.count;
    // Count truncation (capped build not yet fully walked) and deposit
    // discovery truncation both mean "less than reality until completed" —
    // surface as partial so the background loop converges them.
    const discoveryPartial = !allTx.complete || !depositHashes.complete;

    // Deposit USD from transfer legs (first wallet->Nado leg per tx, as before).
    // Live volatile-asset prices (single fetch per request, cached 5 minutes).
    const [livePrices, { cached: cachedHashes, uncached: uncachedHashes }] = await Promise.all([
      livePricesPromise,
      partitionTxHashes(depositHashes.hashes),
    ]);
    const priced = [...cachedHashes, ...uncachedHashes.slice(0, 300)];
    const partial = discoveryPartial || cachedHashes.length + Math.min(uncachedHashes.length, 100) < depositHashes.hashes.length;
    const txData = await getTxData(priced);

    let totalDeposits = 0;
    const tokenDeposits = new Map<string, { amount: number; symbol: string; name: string; rawAmount: number }>();

    for (const h of priced) {
      const legs = txData.get(h)?.legs || [];
      for (const leg of legs) {
        // First non-receipt transfer FROM the wallet per tx. Destination is
        // deliberately unconstrained: router flows may pass through
        // intermediate contracts (proven on Tydro gateway flows).
        if (leg.fromAddress !== walletAddress) {
          continue;
        }
        if (/^(aInk|variableDebt|stableDebt)/i.test(leg.symbol || '')) {
          continue;
        }
        if (leg.amount <= 0) continue;

        const tokenAddress = leg.tokenAddress;
        const usdValue = calculateTokenUsdValue(tokenAddress, leg.amount, livePrices);
        totalDeposits += usdValue;

        if (!tokenDeposits.has(tokenAddress)) {
          tokenDeposits.set(tokenAddress, { amount: 0, symbol: leg.symbol || 'Unknown', name: leg.symbol || 'Unknown', rawAmount: 0 });
        }
        const existing = tokenDeposits.get(tokenAddress)!;
        existing.amount += usdValue;
        existing.rawAmount += leg.amount;
        break; // Only count once per transaction
      }
    }

    const finalTotalDeposits = totalDeposits;

    // Get calculated volume from Nado API (started alongside the
    // Blockscout walks above, awaited here).
    const nadoVolumeData = await nadoVolumePromise;

    // Convert token deposits map to array
    const tokenBreakdown = Array.from(tokenDeposits.entries()).map(([address, data]) => ({
      tokenAddress: address,
      symbol: data.symbol,
      name: data.name,
      depositAmount: Math.round(data.amount * 100) / 100,
      rawAmount: data.rawAmount,
    }));

    const metrics: NadoMetrics = {
      totalDeposits: Math.round(finalTotalDeposits * 100) / 100,
      totalTransactions,
      nadoVolumeUSD: nadoVolumeData.totalVolumeUSD, // Main volume from Nado API
      dbTotalVolume: 0, // Legacy field (enrichment volume never populated)
      partial,
      tokenBreakdown: tokenBreakdown.length > 0 ? tokenBreakdown : undefined,
    };

    if (!partial) {
      setLongCache(nadoLcKey, metrics);
    }
    return metrics;
  });
}
