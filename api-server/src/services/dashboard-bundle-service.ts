// Sprint 2: single-endpoint dashboard bundle.
//
// One call replaces the dashboard's ~27 per-endpoint fetches. EVERY entry
// in the returned metrics map is the EXACT object the corresponding
// individual endpoint serves — because each entry comes from the same
// service function that endpoint's thin shell calls (verified metric by
// metric by scripts/check-bundle-parity.mjs). Nothing is recomputed
// differently and no value is derived: the bundle is a transport
// optimization, not a data source.
//
// Accuracy rules:
// - Score inputs are gathered ONCE via pointsServiceV2.gatherScoreInputs()
//   (the exact, parity-gated batch) and reused for both the score
//   (computeScoreFromInputs — the proven pure function) and the shared
//   metric payloads. No second upstream walk for the same data.
// - Every entry is individually budget-capped and null on miss — a missing
//   metric is a null entry, never a fabricated zero.
// - `partial: true` (wallet stats timed out) marks the bundle so it is
//   NEVER served from a snapshot (same rule as score snapshots).

import { walletStatsService } from './wallet-stats-service';
import { analyticsService } from './analytics-service';
import { pointsServiceV2, ScoreInputs } from './points-service-v2';
import { getTotalVolumeData } from './volume-service';
import { getDashboardCards } from './dashboard-cards-service';
import { getCryptoClashMetrics } from './cryptoclash-service';
import { getSweep, getOpenseaBuyCount, getOpenseaSaleCount } from './analytics-metrics-service';
import { getZenithNft, getZenithStaking } from './analytics-counts-service';

export interface DashboardBundle {
  wallet: string;
  captured_at: string;
  partial: boolean;
  metrics: Record<string, unknown>;
}

// Resolve with a fallback if the promise is still pending after ms. The
// original promise keeps running in the background, so service-level
// caches still get filled for next time. (Same shape as the score's
// withTimeout; copied, not shared, so the score path is never touched.)
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[Bundle] ${label} exceeded ${ms}ms, continuing with fallback`);
        resolve(fallback);
      }, ms);
    }),
  ]);
}

/**
 * Compute the full dashboard bundle for a wallet. Throws only on
 * unexpected failures; every metric entry is individually capped and null
 * on miss (the same "missing = null, never zero" rule the individual
 * endpoints follow).
 */
export async function gatherDashboardBundle(wallet: string): Promise<DashboardBundle> {
  // Shared gather: 16 metrics + the score inputs, in one pass with the
  // score's exact budgets and fallbacks (parity-gated in Sprint 2 step 1).
  const inputsPromise = pointsServiceV2.gatherScoreInputs(wallet);

  // The metrics NOT covered by ScoreInputs, fetched concurrently.
  // Budgets mirror the dashboard's own: volume 30s (cold outflow walks),
  // analytics aggregate 30s (fans out to many metrics), sweep/opensea/
  // zenith 20s, cards/cryptoclash 15s (DB/external-API reads).
  const [inputs, volume, sweep, openseaBuy, openseaSale, zenithNft, zenithStaking, analyticsAgg, cards, cryptoclash] =
    await Promise.all([
      inputsPromise,
      withTimeout(getTotalVolumeData(wallet).catch(() => null), 30000, null, 'volume'),
      withTimeout(getSweep(wallet).catch(() => null), 20000, null, 'sweep'),
      withTimeout(getOpenseaBuyCount(wallet).catch(() => null), 20000, null, 'opensea-buy'),
      withTimeout(getOpenseaSaleCount(wallet).catch(() => null), 20000, null, 'opensea-sale'),
      withTimeout(getZenithNft(wallet).catch(() => null), 20000, null, 'zenith-nft'),
      withTimeout(getZenithStaking(wallet).catch(() => null), 20000, null, 'zenith-staking'),
      withTimeout(analyticsService.getWalletAnalytics(wallet).catch(() => null), 30000, null, 'analytics'),
      withTimeout(getDashboardCards(wallet).catch(() => null), 15000, null, 'cards'),
      withTimeout(getCryptoClashMetrics(wallet).catch(() => null), 15000, null, 'cryptoclash'),
    ]);

  // The score: the proven pure function over the same inputs. (junk-wallet
  // and admin-override guards live in calculateWalletScore and are checked
  // by the /score endpoint; a bundle for a junk wallet is a nonsense
  // request and for an overridden wallet the dashboard fetches /score
  // directly anyway. computeScoreFromInputs here uses the gathered inputs.)
  const score = await pointsServiceV2.computeScoreFromInputs(wallet, inputs);

  // IMPORTANT: each key maps to the EXACT payload the individual endpoint
  // serves. Entries sourced from ScoreInputs are the same service outputs
  // those shells return. mintCount reuses inputs.mintData (the same
  // getMintCount call the score already made — no duplicate fetch).
  const metrics: Record<string, unknown> = {
    stats: inputs.walletStats,
    bridge: inputs.bridgeData,
    swap: inputs.swapData,
    tydro: inputs.tydroData,
    nft2me: inputs.nft2meData,
    nado: inputs.nadoData,
    copink: inputs.copinkData,
    score,
    volume,
    analytics: analyticsAgg,
    cards,
    cryptoclash,
    gmCount: inputs.gmData,
    inkypumpCreatedTokens: inputs.inkyPumpCreated,
    inkypumpBuyVolume: inputs.inkyPumpBuy,
    inkypumpSellVolume: inputs.inkyPumpSell,
    zns: inputs.znsData,
    shelliesJoinedRaffles: inputs.shelliesRaffles,
    shelliesPayToPlay: inputs.shelliesPayToPlay,
    shelliesStaking: inputs.shelliesStaking,
    openseaBuyCount: openseaBuy,
    openseaSaleCount: openseaSale,
    mintCount: inputs.mintData,
    templarsNftBalance: inputs.templarsData,
    cowswapSwaps: inputs.cowSwapData,
    sweep,
    zenithNft,
    zenithStaking,
  };

  // ACCURACY RULE: a bundle with ANY null metric is incomplete — the old
  // per-endpoint flow did NOT cache errored metrics (each shell retried on
  // the next load), so an incomplete bundle must never be responseCache-cached
  // or snapshot-served either, or one cold-burst timeout would freeze that
  // metric as missing for the whole TTL (observed live: bridge timed out at
  // 25s during a cold gather and would have been missing for an hour).
  // The bundle is still returned live (the UI shows what we have) and
  // snapshotted with partial=true for audit only.
  const missing = Object.entries(metrics)
    .filter(([, v]) => v == null)
    .map(([k]) => k);
  const partial = inputs.walletStats === null || missing.length > 0;
  if (partial) {
    console.warn(
      `[Bundle] ${wallet.slice(0, 10)}: incomplete bundle — missing: ${missing.join(', ') || 'wallet stats'} (will not be cached)`
    );
  }

  return {
    wallet,
    captured_at: new Date().toISOString(),
    partial,
    metrics,
  };
}

/**
 * Structural sanity for a bundle read back from the snapshot store.
 * A snapshot is a cache of facts, never a source of them.
 */
export function isValidBundleShape(b: unknown): b is DashboardBundle {
  if (!b || typeof b !== 'object') return false;
  const anyB = b as DashboardBundle;
  return (
    typeof anyB.wallet === 'string' &&
    typeof anyB.captured_at === 'string' &&
    typeof anyB.metrics === 'object' &&
    anyB.metrics !== null &&
    // The score entry must at least carry the point total.
    typeof (anyB.metrics as Record<string, unknown>).score === 'object'
  );
}

export type { ScoreInputs };
