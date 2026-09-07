import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, getTokenTransfersInto, partitionTxHashes } from './blockscout-service';

// Hypercall Earn (earn.hypercall.xyz) - covered-call yield for xStocks on Ink.
//
// User flow (verified live, Sep 2026 deployment):
//   SWAP: buys/sells of xStocks (wNVDAx/wAAPLx/wSPYx) through FloorRouterV2
//      (verified on the explorer) - the user-facing trade venue. Buy routes
//      ETH -> WETH -> USDG -> xStock; sell routes xStock -> USDG -> WETH.
//   WRITE: accept a firm RFQ and fund a covered call in one tx on the
//      Earn factory: xStock collateral -> isolated position vault, USDC
//      premium -> writer (upfront), writer + buyer ERC-721 receipts minted.
//   REWARDS: vQUOTRON campaign token mints to the wallet via the
//      rewards module.
//
// Tracking scope (per product decision 2026-09-07): swaps = FloorRouterV2
// buys + sells ONLY (count + USD volume). The venues tracked earlier the
// same day (QUOTRON zapper 0x215cead0, get-assets router 0x1b4d9191,
// get-assets zapper 0x117a7bc2) are frontend zaps, not the user-facing
// trade.
// - positions: txs FROM the wallet TO the earn factory with the funding
//              selector (the factory implementation is UNVERIFIED on the
//              explorer, so a contract upgrade could shift it - re-check on
//              protocol changes)
// - rewards:   ERC-20 inflows from the rewards module (vQUOTRON)
//
// Volume: exact USD via the USDG routing legs (USDG ~ $1, 6 decimals);
// premium is USDC. Position outcomes (exercise/recovery) are DEFERRED until
// those methods are observed on-chain.
//
// History is append-only: per-tx data is permanently cached and discovery
// refreshes incrementally via last_seen cursors. No backfill worker by design.

// FloorRouterV2 (verified on explorer) - THE Hypercall xStock trade venue:
// buy routes ETH -> WETH -> USDG -> xStock (wNVDAx/wAAPLx/wSPYx), sell
// routes xStock -> USDG -> WETH. USDG is the routing asset in every tx, so
// each trade prices at its max USDG leg. Product decision 2026-09-07: the
// card counts FloorRouterV2 buys+sells ONLY - the earlier venues (QUOTRON
// zapper 0x215cead0, get-assets router 0x1b4d9191, get-assets zapper
// 0x117a7bc2) are frontend zaps, not the user-facing trade.
const FLOOR_ROUTER_V2 = '0xb3e8165984a91cf4001057ca646ee2e3a547cdf8';
// buy / sell - selectors extracted from verified tx inputs.
const FLOOR_SELECTORS = ['0x646c4451', '0x64027ecd'];
const EARN_FACTORY = '0x86d82134d7ec5840ca0ed64131e9543b3dc1b51b';
const REWARDS_MODULE = '0xca2d699d8889925822d148d1fbaba45249bc1ccb';
const USDG = '0xe343167631d89b6ffc58b88d6b7fb0228795491d';
const USDC = '0x2d270e6886d130d724215a266106e6832161eaed';
const VQUOTRON = '0x6fed09c8f0906bf79a66a44831f47dd9775ac7fc';

// zapExactInput(address,uint256,uint256,address,uint256)
// zapExactInputToken((address,uint256,(address,address,address,int24)[],uint256,address,uint256,address,uint256))
// zapExactInputNative((...same tuple...)) — payable
// FloorRouterV2: buy = 0x646c4451, sell = 0x64027ecd (verified from live
// tx inputs — every tx routes its notional through USDG).
// Writer funding on the Earn factory (verified from the two live funding txs).
const FUND_SELECTOR = '0x91c7d858';

// Stablecoins never count as "collateral committed" (Earn collateral is an
// xStock wrapper; stables are the premium/settlement side).
const STABLE_TOKENS = new Set([USDG, USDC, '0x0200c29006150606b650577bbe7b6248f58470c1' /* USDT0 */]);

// Append-only counts (same rationale as the Tydro long cache).
const HYPERCALL_LONG_CACHE_TTL = 5 * 60 * 1000;
// Hard cap on txs priced in a single request window; partial converges via
// the incremental discovery on the next load (same model as swap-service).
const MAX_TXS_PRICED = 1000;

export interface HypercallCollateral {
  symbol: string;
  address: string;
  amount: number;
}

export interface HypercallResponse {
  swapCount: number;
  usdgSpent: number; // exact USD volume (USDG ≈ $1)
  positionsWritten: number;
  premiumEarnedUsdc: number;
  collateralCommitted: HypercallCollateral[];
  rewardsClaimed: number; // vQUOTRON
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  partial?: boolean;
}

export async function getHypercallData(walletAddress: string): Promise<HypercallResponse> {
  const lcKey = 'long:wallet:hypercall:' + walletAddress;
  const cached = getLongCache<HypercallResponse>(lcKey, HYPERCALL_LONG_CACHE_TTL);
  if (cached && !cached.partial) return cached;

  return withInflight<HypercallResponse>(lcKey, async () => {
    const wallet = walletAddress.toLowerCase();

    const [swaps, positions] = await Promise.all([
      getProtocolTxHashes(wallet, FLOOR_ROUTER_V2, FLOOR_SELECTORS).catch((err: unknown) => {
        console.warn('[Hypercall] FloorRouter swap discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
      getProtocolTxHashes(wallet, EARN_FACTORY, [FUND_SELECTOR]).catch((err: unknown) => {
        console.warn('[Hypercall] position discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
    ]);

    let swapCount = 0;
    let usdgSpent = 0;
    let positionsWritten = 0;
    let premiumEarnedUsdc = 0;
    let firstActivityAt: string | null = null;
    let lastActivityAt: string | null = null;
    let partial = !(swaps.complete && positions.complete);

    const collateral = new Map<string, HypercallCollateral>();

    const txHashes = [...swaps.hashes, ...positions.hashes];
    if (txHashes.length > 0) {
      const { cached: cachedHashes, uncached } = await partitionTxHashes(txHashes);
      const priced = [...cachedHashes, ...uncached.slice(0, MAX_TXS_PRICED)];
      if (cachedHashes.length + Math.min(uncached.length, MAX_TXS_PRICED) < txHashes.length) {
        partial = true;
      }
      const txData = await getTxData(priced);

      const swapSet = new Set(swaps.hashes);
      const positionSet = new Set(positions.hashes);
      for (const h of priced) {
        const d = txData.get(h);
        if (!d || d.meta.ok === false) continue;
        const isSwap = swapSet.has(h);
        const isPosition = positionSet.has(h);
        // FloorRouter txs route the whole notional through USDG inside the
        // router (the wallet only sees ETH in / xStock out, or the reverse),
        // so price each swap tx at its max single USDG leg.
        let swapTxUsdg = 0;

        for (const leg of d.legs) {
          const token = leg.tokenAddress.toLowerCase();
          const ts = d.meta.timestamp;
          if (ts && (!firstActivityAt || ts < firstActivityAt)) firstActivityAt = ts;
          if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;

          // Swap volume: max USDG routing leg in the tx.
          if (isSwap && token === USDG) {
            swapTxUsdg = Math.max(swapTxUsdg, leg.amount);
          }
          // Position: USDC entering the wallet is the upfront premium.
          if (isPosition && token === USDC && leg.toAddress === wallet) {
            premiumEarnedUsdc += leg.amount;
          }
          // Position: non-stable tokens leaving the wallet are collateral.
          if (isPosition && !STABLE_TOKENS.has(token) && leg.fromAddress === wallet) {
            const entry = collateral.get(token) || { symbol: leg.symbol, address: token, amount: 0 };
            entry.amount += leg.amount;
            if (!entry.symbol && leg.symbol) entry.symbol = leg.symbol;
            collateral.set(token, entry);
          }
        }
        if (isSwap) usdgSpent += swapTxUsdg;

        if (isSwap) swapCount++;
        if (isPosition) positionsWritten++;
      }
    }

    // --- rewards: vQUOTRON inflows from the rewards module -------------------
    let rewardsClaimed = 0;
    try {
      const rewards = await getTokenTransfersInto(wallet, REWARDS_MODULE);
      for (const t of rewards.transfers) {
        if (t.tokenAddress.toLowerCase() === VQUOTRON) rewardsClaimed += t.amount;
        const ts = t.timestamp;
        if (ts && (!firstActivityAt || ts < firstActivityAt)) firstActivityAt = ts;
        if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;
      }
      if (!rewards.complete) partial = true;
    } catch (err: unknown) {
      console.warn('[Hypercall] rewards scan failed:', err instanceof Error ? err.message : err);
      partial = true;
    }

    const response: HypercallResponse = {
      swapCount,
      usdgSpent: Math.round(usdgSpent * 100) / 100,
      positionsWritten,
      premiumEarnedUsdc: Math.round(premiumEarnedUsdc * 100) / 100,
      collateralCommitted: [...collateral.values()].sort((a, b) => b.amount - a.amount),
      rewardsClaimed: Math.round(rewardsClaimed * 100) / 100,
      firstActivityAt,
      lastActivityAt,
      ...(partial ? { partial: true } : {}),
    };

    if (!response.partial) {
      setLongCache(lcKey, response);
    }
    return response;
  });
}
