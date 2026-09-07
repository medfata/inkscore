import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolTxHashes, getTxData, getTokenTransfersInto, partitionTxHashes } from './blockscout-service';

// Hypercall Earn (earn.hypercall.xyz) - covered-call yield for xStocks on Ink.
//
// User flow (verified live, Sep 2026 deployment):
//   1. GET ASSETS:  swap USDG -> wAAPLx/wNVDAx/wSPYx through the QUOTRONS
//      zapper (0.3% swap fee) OR through the dedicated get-assets router
//      (ETH / memecoin -> USDG -> xStock, and the sells back). Non-USDG
//      input routes through Velodrome CL pools -> USDG first - all from one
//      entry tx on whichever router the frontend used.
//   2. WRITE: accept a firm RFQ and fund a covered call in one tx on the
//      Earn factory: xStock collateral -> isolated position vault, USDC
//      premium -> writer (upfront), writer + buyer ERC-721 receipts minted.
//   3. REWARDS: vQUOTRON campaign token mints to the wallet via the
//      rewards module.
//
// Tracking scope (user activity only - maker/ops txs excluded by method):
// - swaps:     txs FROM the wallet TO the zapper with zapExactInput* selectors
//              OR TO the get-assets router with its buy/sell selectors
// - positions: txs FROM the wallet TO the earn factory with the funding
//              selector (pinned from the two observed funding txs; the
//              factory implementation is UNVERIFIED on the explorer, so a
//              contract upgrade could shift it - re-check on protocol changes)
// - rewards:   ERC-20 inflows from the rewards module (vQUOTRON)
//
// Volume is exact USD with no price lookups: USDG ≈ $1 (the swap input) and
// premium is USDC. Position outcomes (exercise/recovery) are DEFERRED until
// those methods are observed on-chain.
//
// History is append-only: per-tx data is permanently cached and discovery
// refreshes incrementally via last_seen cursors. No backfill worker by design.

const QUOTRON_ZAPPER = '0x215cead02e0b9e0e494dd179585c18a772048a43';
const EARN_FACTORY = '0x86d82134d7ec5840ca0ed64131e9543b3dc1b51b';
const REWARDS_MODULE = '0xca2d699d8889925822d148d1fbaba45249bc1ccb';
// Get-Assets router (earn.hypercall.xyz/get-assets/): ETH-or-memecoin ->
// USDG -> xStock (wNVDAx/wAAPLx/wSPYx) zaps and the sells back. Missed until
// 2026-09-07 — wallets swapping through it showed 0 swaps/$0 volume because
// only the QUOTRON zapper was tracked. Contract is UNVERIFIED on the
// explorer; selectors were pinned from live user txs (same caveat as the
// factory: re-check on protocol changes).
// 0x117a7bc2 is the SECOND get-assets zapper (same USDG->xStock flow, zap
// selectors shared with the QUOTRON zapper) — found the same day via a
// wallet whose top activity (9 zaps) went through it untracked.
const GET_ASSETS_ROUTER = '0x1b4d919149912c9781b086c8242729ee317631c8';
const GET_ASSETS_ZAPPER = '0x117a7bc2cbf0feb6e5ae5b457ddc1490a84db286';
const USDG = '0xe343167631d89b6ffc58b88d6b7fb0228795491d';
const USDC = '0x2d270e6886d130d724215a266106e6832161eaed';
const VQUOTRON = '0x6fed09c8f0906bf79a66a44831f47dd9775ac7fc';

// zapExactInput(address,uint256,uint256,address,uint256)
// zapExactInputToken((address,uint256,(address,address,address,int24)[],uint256,address,uint256,address,uint256))
// zapExactInputNative((...same tuple...)) — payable
const ZAP_SELECTORS = ['0xc75d2360', '0xd0b4708f', '0xb32c8a23'];
// Get-Assets router: 0x11abcf9e = buy xStock with ETH + optional memecoin
// sell-in; 0x6fd0b140 = sell xStock back. Both verified from live txs —
// every tx through the router routes its notional through USDG.
const GET_ASSETS_SELECTORS = ['0x11abcf9e', '0x6fd0b140'];
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

    const [zapperSwaps, getAssetsSwaps, getAssetsZapperSwaps, positions] = await Promise.all([
      getProtocolTxHashes(wallet, QUOTRON_ZAPPER, ZAP_SELECTORS).catch((err: unknown) => {
        console.warn('[Hypercall] swap discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
      getProtocolTxHashes(wallet, GET_ASSETS_ROUTER, GET_ASSETS_SELECTORS).catch((err: unknown) => {
        console.warn('[Hypercall] get-assets swap discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
      getProtocolTxHashes(wallet, GET_ASSETS_ZAPPER, ZAP_SELECTORS).catch((err: unknown) => {
        console.warn('[Hypercall] get-assets zapper discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
      getProtocolTxHashes(wallet, EARN_FACTORY, [FUND_SELECTOR]).catch((err: unknown) => {
        console.warn('[Hypercall] position discovery failed:', err instanceof Error ? err.message : err);
        return { hashes: [] as string[], complete: false };
      }),
    ]);
    const swaps = {
      hashes: [...new Set([...zapperSwaps.hashes, ...getAssetsSwaps.hashes, ...getAssetsZapperSwaps.hashes])],
      complete: zapperSwaps.complete && getAssetsSwaps.complete && getAssetsZapperSwaps.complete,
    };
    const getAssetsSet = new Set([...getAssetsSwaps.hashes, ...getAssetsZapperSwaps.hashes]);

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
        const isGetAssets = getAssetsSet.has(h);
        // Get-Assets txs route the whole notional through USDG inside the
        // router (the wallet only sees ETH/memecoin in and xStock out, or the
        // reverse), so "USDG leaving the wallet" never fires for them —
        // price each tx at its max single USDG leg instead.
        let getAssetsTxUsdg = 0;

        for (const leg of d.legs) {
          const token = leg.tokenAddress.toLowerCase();
          const ts = d.meta.timestamp;
          if (ts && (!firstActivityAt || ts < firstActivityAt)) firstActivityAt = ts;
          if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;

          // Swap: USDG leaving the wallet is the input spend (= USD volume).
          if (isSwap && token === USDG && leg.fromAddress === wallet) {
            usdgSpent += leg.amount;
          }
          // Get-Assets swap: notional = max USDG routing leg in the tx.
          if (isGetAssets && token === USDG) {
            getAssetsTxUsdg = Math.max(getAssetsTxUsdg, leg.amount);
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
        if (isGetAssets) usdgSpent += getAssetsTxUsdg;

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
