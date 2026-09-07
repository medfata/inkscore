import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, partitionTxHashes } from './blockscout-service';
import { getTokenInfo } from './token-info-service';
import { priceService } from './price-service';
import { safeWeiToEth, mapWithConcurrency } from './metrics-utils';

// Sentry (sentry.trading) - launchpad + concentrated-liquidity DEX on Ink.
//
// The frontend shares the Tsunami V3 stack with nami.ink (same SwapRouter02),
// AND runs its own SentryInkRouterV4 for its launched tokens. Activity is
// attributed across both venues:
// - launches: txs FROM the wallet TO the Sentry launch factory (V4 proxy +
//   legacy proxy) with one of the four launch selectors. The factory seeds
//   the token's LP from inside the launch tx, so one launch = one tx.
// - swaps: txs FROM the wallet TO TsunamiSwapRouter02 (multicall-wrapped
//   exactInput/exactOutput variants + the V2-compat swap methods) OR TO
//   SentryInkRouterV4 (buyExactEthForTokens / sellExactTokensForEth). Volume
//   per tx = max transfer-leg USD (the same pricing ladder as
//   swap-service): Blockscout exchange_rate first, token-info fallback,
//   native-ETH tx value last.
//
// NOTE: the team's public Goldsky subgraph (with per-EOA User aggregates)
// 404s at every version — Blockscout discovery is the only live source.
//
// History is append-only: per-tx data is permanently cached (bs_tx_legs)
// and getProtocolTxHashes refreshes incrementally via last_seen cursors, so
// the first visit scans once and later visits only pay for new activity.
// No backfill worker is wired for this metric by design.

// Sentry launch factories (ERC1967 proxies, verified on explorer.inkonchain.com).
const SENTRY_FACTORY_V4 = '0xdc37e11b68052d1539fa23386ee58ac444bf5be1';
const SENTRY_FACTORY_LEGACY = '0x733733e8eabb94832847abf0e0eed6031c3eb2e4';
// TWO trading venues:
// - TsunamiSwapRouter02: the shared Tsunami V3 stack (nami.ink + sentry.trading).
// - SentryInkRouterV4: Sentry's own V4 router (verified on explorer). Missed
//   until 2026-09-07 — a wallet swapping through it showed 0 swaps/$0 volume
//   because only the Tsunami router was tracked.
const TSUNAMI_SWAP_ROUTER = '0x4415f2360bfd9b1bf55500cb28fa41df95cb2d2b';
const SENTRY_ROUTER_V4 = '0x5275de614e06dba10546171c1e6d2a30a87844b7';

// launch / launchAgent / launchGoPumpMe / launchKrakenVerified — verified
// live against explorer.inkonchain.com user txs.
const LAUNCH_SELECTORS = ['0x229b79e5', '0x0068927a', '0x212a8af2', '0x37f93c6a'];

// Tsunami router: multicall(bytes[]) / multicall(uint256,bytes[]) / multicall(bytes32,bytes[])
// + exactInputSingle / exactInput / exactOutputSingle / exactOutput
// + swapExactTokensForTokens / swapTokensForExactTokens. The router's
// multicall selectors are generic names, but the query is scoped to txs TO
// the router, so no cross-contract collision.
const SWAP_SELECTORS = [
  '0xac9650d8', '0x5ae401dc', '0x1f0464d1',
  '0x10c29d98', '0xc04b8d59', '0x5d7ef810', '0xcf8cc93f',
  '0x472b43f3', '0x42712a67',
];
// SentryInkRouterV4: buyExactEthForTokens / sellExactTokensForEth —
// selectors extracted from verified tx inputs on explorer.inkonchain.com.
const V4_SWAP_SELECTORS = ['0xc8529cbc', '0xc61b004b'];

// Append-only counts/volumes (same rationale as the Tydro long cache).
const SENTRY_LONG_CACHE_TTL = 5 * 60 * 1000;
// Hard cap on txs priced in a single request window (partial converges via
// the incremental discovery on the next load; same model as swap-service).
const MAX_TXS_PRICED = 1000;

export interface SentryResponse {
  tokensLaunched: number;
  swapCount: number;
  volumeEth: number;
  volumeUsd: number;
  firstSwapAt: string | null;
  lastSwapAt: string | null;
  partial?: boolean;
}

function emptyResponse(): SentryResponse {
  return {
    tokensLaunched: 0,
    swapCount: 0,
    volumeEth: 0,
    volumeUsd: 0,
    firstSwapAt: null,
    lastSwapAt: null,
  };
}

export async function getSentryData(walletAddress: string): Promise<SentryResponse> {
  const lcKey = 'long:wallet:sentry:' + walletAddress;
  const cached = getLongCache<SentryResponse>(lcKey, SENTRY_LONG_CACHE_TTL);
  if (cached && !cached.partial) return cached;

  return withInflight<SentryResponse>(lcKey, async () => {
    const wallet = walletAddress.toLowerCase();

    // --- launches: wallet -> launch factories -------------------------------
    const [launchesV4, launchesLegacy] = await Promise.all([
      getProtocolTxHashes(wallet, SENTRY_FACTORY_V4, LAUNCH_SELECTORS).catch((err: unknown) => {
        console.warn('[Sentry] V4 launch discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
      getProtocolTxHashes(wallet, SENTRY_FACTORY_LEGACY, LAUNCH_SELECTORS).catch((err: unknown) => {
        console.warn('[Sentry] legacy launch discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
    ]);
    const tokensLaunched = launchesV4.hashes.length + launchesLegacy.hashes.length;

    // --- swaps: wallet -> TsunamiSwapRouter02 + SentryInkRouterV4 -----------
    const [tsunamiSwaps, v4Swaps] = await Promise.all([
      getProtocolTxHashes(wallet, TSUNAMI_SWAP_ROUTER, SWAP_SELECTORS).catch(
        (err: unknown) => {
          console.warn('[Sentry] swap discovery failed:', err instanceof Error ? err.message : err);
          return { hashes: [] as string[], complete: false };
        }
      ),
      getProtocolTxHashes(wallet, SENTRY_ROUTER_V4, V4_SWAP_SELECTORS).catch(
        (err: unknown) => {
          console.warn('[Sentry] V4 swap discovery failed:', err instanceof Error ? err.message : err);
          return { hashes: [] as string[], complete: false };
        }
      ),
    ]);
    // A tx can only ever hit one router, but de-dupe anyway — cheap insurance.
    const swapHashes = [...new Set([...tsunamiSwaps.hashes, ...v4Swaps.hashes])];
    const swaps = {
      hashes: swapHashes,
      complete: tsunamiSwaps.complete && v4Swaps.complete,
    };

    let volumeEth = 0;
    let volumeUsd = 0;
    let firstSwapAt: string | null = null;
    let lastSwapAt: string | null = null;
    let partial = !(launchesV4.complete && launchesLegacy.complete && swaps.complete);

    if (swaps.hashes.length > 0) {
      const { cached: cachedHashes, uncached } = await partitionTxHashes(swaps.hashes);
      const priced = [...cachedHashes, ...uncached.slice(0, MAX_TXS_PRICED)];
      if (cachedHashes.length + Math.min(uncached.length, MAX_TXS_PRICED) < swaps.hashes.length) {
        partial = true;
      }
      const txData = await getTxData(priced);
      const ethPrice = await priceService.getCurrentPrice().catch(() => 3500);

      // Batch missing-token price lookups (same pattern as swap-service).
      const missingTokens = [...new Set(
        priced.flatMap((h) => txData.get(h)?.legs || [])
          .filter((leg) => !(leg.exchangeRate > 0))
          .map((leg) => leg.tokenAddress.toLowerCase())
      )];
      const legPrices = new Map<string, number>();
      if (missingTokens.length > 0) {
        const fetched = await mapWithConcurrency(missingTokens, 10, (t) =>
          getTokenInfo(t).then((info) => (info.price > 0.00002 ? info.price : 0)).catch(() => 0)
        );
        missingTokens.forEach((t, i) => legPrices.set(t, fetched[i]));
      }

      for (const h of priced) {
        const d = txData.get(h);
        if (!d || d.meta.ok === false) continue; // failed swaps are not trades
        let txUsd = 0;
        for (const leg of d.legs) {
          const price = leg.exchangeRate || legPrices.get(leg.tokenAddress.toLowerCase()) || 0;
          const v = leg.amount * price;
          if (v > txUsd) txUsd = v;
        }
        if (txUsd === 0) {
          txUsd = safeWeiToEth(d.meta.value) * ethPrice;
        }
        volumeUsd += txUsd;
        volumeEth += safeWeiToEth(d.meta.value);
        const ts = d.meta.timestamp;
        if (ts && (!firstSwapAt || ts < firstSwapAt)) firstSwapAt = ts;
        if (ts && (!lastSwapAt || ts > lastSwapAt)) lastSwapAt = ts;
      }
    }

    const response: SentryResponse = {
      tokensLaunched,
      swapCount: swaps.hashes.length,
      volumeEth: Math.round(volumeEth * 1e6) / 1e6,
      volumeUsd: Math.round(volumeUsd * 100) / 100,
      firstSwapAt,
      lastSwapAt,
      ...(partial ? { partial: true } : {}),
    };

    if (!response.partial) {
      setLongCache(lcKey, response);
    }
    return response;
  });
}
