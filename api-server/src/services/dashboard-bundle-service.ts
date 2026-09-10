// Sprint 2: single-endpoint dashboard bundle.
//
// One call replaces the dashboard's ~27 per-endpoint fetches. EVERY entry
// in the returned metrics map is the EXACT object the corresponding
// individual endpoint serves — because each entry comes from the same
// service function that endpoint's thin shell calls, THROUGH THE SAME
// responseCache keys the shells use (verified metric by metric by
// scripts/check-bundle-parity.mjs). Nothing is recomputed differently and
// no value is derived: the bundle is a transport optimization, not a data
// source.
//
// ACCURACY RULES:
// - Per-metric cache read-through with shell-identical keys: a metric that
//   succeeded once sticks for the wallet TTL (1h) even when OTHER metrics
//   in the same load time out. The old per-endpoint flow had exactly this
//   behavior; the bundle preserves it (its first version bypassed the
//   per-metric cache and re-gathered everything on every incomplete load —
//   observed as heavy wallets getting SLOWER after Sprint 2).
// - null metric = not cached (retry on next load) — never a fabricated zero.
// - Partial results (truncated walks) are clamped to 30s automatically by
//   responseCache.set.
// - A bundle with ANY null metric is incomplete: `partial: true` — never
//   cached as a WHOLE and never served from a snapshot.
// - The score entry is the proven pure computeScoreFromInputs over the same
//   per-metric inputs, cached under the /score shell's own key.

import { responseCache } from '../cache';
import { walletStatsService } from './wallet-stats-service';
import { analyticsService } from './analytics-service';
import { pointsServiceV2, ScoreInputs } from './points-service-v2';
import { saveScoreSnapshot } from './metrics-snapshot-service';
import { getTotalVolumeData } from './volume-service';
import { getDashboardCards } from './dashboard-cards-service';
import { getCryptoClashMetrics } from './cryptoclash-service';
import { getOtomateMetrics } from './otomate-service';
import {
  getSweep,
  getOpenseaBuyCount,
  getOpenseaSaleCount,
  getGmCount,
  getInkypumpCreatedTokens,
  getInkypumpBuyVolume,
  getInkypumpSellVolume,
  getMintCount,
} from './analytics-metrics-service';
import {
  getZnsMetrics,
  getShelliesJoinedRaffles,
  getShelliesPayToPlay,
  getShelliesStaking,
  getTemplarsBalance,
  getZenithNft,
  getZenithStaking,
  getInkBrokersMetrics,
} from './analytics-counts-service';
import { openSeaService } from './opensea-service';
import { sweepService } from './sweep-service';
import { getBridgeVolume } from './bridge-service';
import { getSwapVolume } from './swap-service';
import { getTydroData } from './tydro-service';
import { getNft2meData } from './nft2me-service';
import { getGoneFishinData } from './gonefishin-service';
import { getSentryData } from './sentry-service';
import { getHypercallData } from './hypercall-service';
import { getNadoMetrics } from './nado-service';
import type { OtomateResponse } from './points-service-v2';

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

// Per-metric cache read-through with the SAME key the individual endpoint
// shell uses, so the bundle and the legacy fan-out share one cache layer.
// A null result is NOT cached (the old shells never cached an errored
// endpoint — the next load retries it). With `fresh` (refresh=true), the
// read is skipped but the result is still written — refresh recomputes AND
// re-caches, exactly like the old shells.
async function viaCache<T>(
  key: string,
  label: string,
  timeoutMs: number,
  compute: () => Promise<T | null>,
  fresh = false
): Promise<T | null> {
  if (!fresh) {
    const cached = responseCache.get<T>(key);
    if (cached) return cached;
  }
  const result = await withTimeout(compute().catch(() => null), timeoutMs, null, label);
  if (result != null) responseCache.set(key, result);
  return result;
}

// Score-input fallback when OpenSea counts miss their budget (same shape
// and semantics as the score's own EMPTY_OPENSEA_COUNTS).
const EMPTY_OPENSEA_COUNTS = { buys: 0, sales: 0, mints: 0, buyTransactions: [], saleTransactions: [], mintTransactions: [] };

/**
 * Compute the full dashboard bundle for a wallet. Throws only on
 * unexpected failures; every metric entry is individually capped and null
 * on miss (the same "missing = null, never zero" rule the individual
 * endpoints follow).
 */
export async function gatherDashboardBundle(
  wallet: string,
  opts?: { fresh?: boolean }
): Promise<DashboardBundle> {
  const fresh = opts?.fresh === true;
  // Bound read-through helper: threads the refresh flag into every metric.
  const vc = <T>(key: string, label: string, timeoutMs: number, compute: () => Promise<T | null>) =>
    viaCache(key, label, timeoutMs, compute, fresh);
  // Raw OpenSea counts for the score input (the service layers its own
  // memory + Postgres caches; no endpoint shell wraps this shape).
  const openSeaCounts = await withTimeout(
    openSeaService.getAllCounts(wallet).catch((err: unknown) => {
      console.warn('[Bundle] OpenSea counts failed, treating as 0:', err);
      return EMPTY_OPENSEA_COUNTS;
    }),
    15000,
    EMPTY_OPENSEA_COUNTS,
    'OpenSea counts'
  );

  // Per-metric cached gather — same keys, TTLs and partial-clamp behavior
  // as the individual endpoint shells. Budgets mirror the dashboard's own.
  const [
    stats,
    bridge,
    swap,
    tydro,
    nft2me,
    gonefishin,
    sentry,
    hypercall,
    nado,
    volume,
    gmData,
    inkyPumpCreated,
    inkyPumpBuy,
    inkyPumpSell,
    zns,
    shelliesRaffles,
    shelliesPayToPlay,
    shelliesStaking,
    templars,
    mintData,
    sweepAnalytics,
    zenithNft,
    zenithStaking,
    inkBrokers,
    analyticsAgg,
    cards,
    otomate,
    openseaBuy,
    openseaSale,
  ] = await Promise.all([
    vc(`wallet:stats:${wallet}`, 'stats', 15000, () => walletStatsService.getAllStats(wallet)),
    vc(`wallet:bridge:${wallet}`, 'bridge', 30000, () => getBridgeVolume(wallet)),
    vc(`wallet:swap:${wallet}`, 'swap', 20000, () => getSwapVolume(wallet)),
    vc(`wallet:tydro:${wallet}`, 'tydro', 30000, () => getTydroData(wallet)),
    vc(`wallet:nft2me:${wallet}`, 'nft2me', 20000, () => getNft2meData(wallet)),
    vc(`wallet:gonefishin:${wallet}`, 'gonefishin', 20000, () => getGoneFishinData(wallet)),
    vc(`wallet:sentry:${wallet}`, 'sentry', 20000, () => getSentryData(wallet)),
    vc(`wallet:hypercall:${wallet}`, 'hypercall', 20000, () => getHypercallData(wallet)),
    vc(`nado:${wallet}`, 'nado', 30000, () => getNadoMetrics(wallet)),
    vc(`wallet:volume:${wallet}`, 'volume', 30000, () => getTotalVolumeData(wallet)),
    vc(`analytics:gm_count:${wallet}`, 'gm', 20000, () => getGmCount(wallet)),
    vc(`analytics:inkypump_created_tokens:${wallet}`, 'inkypump-created', 30000, () => getInkypumpCreatedTokens(wallet)),
    vc(`analytics:inkypump_buy_volume:${wallet}`, 'inkypump-buy', 30000, () => getInkypumpBuyVolume(wallet)),
    vc(`analytics:inkypump_sell_volume:${wallet}`, 'inkypump-sell', 30000, () => getInkypumpSellVolume(wallet)),
    vc(`analytics:zns:${wallet}`, 'zns', 20000, () => getZnsMetrics(wallet)),
    vc(`analytics:shellies_joined_raffles:${wallet}`, 'shellies-raffles', 20000, () => getShelliesJoinedRaffles(wallet)),
    vc(`analytics:shellies_pay_to_play:${wallet}`, 'shellies-pay', 20000, () => getShelliesPayToPlay(wallet)),
    vc(`analytics:shellies_staking:${wallet}`, 'shellies-staking', 20000, () => getShelliesStaking(wallet)),
    vc(`analytics:templars_nft_balance:${wallet}`, 'templars', 20000, () => getTemplarsBalance(wallet)),
    vc(`analytics:mint_count:${wallet}`, 'mint', 20000, () => getMintCount(wallet)),
    vc(`analytics:sweep:${wallet}`, 'sweep', 20000, () => getSweep(wallet)),
    vc(`analytics:zenith_nft_balance:${wallet}`, 'zenith-nft', 20000, () => getZenithNft(wallet)),
    vc(`analytics:zenith_staking:${wallet}`, 'zenith-staking', 20000, () => getZenithStaking(wallet)),
    vc(`analytics:ink_brokers:${wallet}`, 'ink-brokers', 20000, () => getInkBrokersMetrics(wallet)),
    vc(`analytics:${wallet}`, 'analytics', 30000, () => analyticsService.getWalletAnalytics(wallet)),
    vc(`dashboard:cards:${wallet}`, 'cards', 15000, () => getDashboardCards(wallet)),
    // Otomate manages its own responseCache + stale-serve internally.
    getOtomateSafe(wallet),
    vc(`analytics:opensea_buy_count:${wallet}`, 'opensea-buy', 20000, () => getOpenseaBuyCount(wallet)),
    vc(`analytics:opensea_sale_count:${wallet}`, 'opensea-sale', 20000, () => getOpenseaSaleCount(wallet)),
  ]);

  // Raw sweep shape for the score input (the score reads
  // totalCollections/sweepBadgeBalance/totalStreak; the analytics-shaped
  // `sweep` entry above is what the dashboard card consumes).
  const sweepRaw = await withTimeout(
    sweepService.getDeployedCollections(wallet).catch(() => null),
    20000,
    null,
    'sweep-raw'
  );

  const inputs: ScoreInputs = {
    walletStats: stats,
    bridgeData: bridge,
    swapData: swap,
    tydroData: tydro,
    gmData,
    inkyPumpCreated,
    inkyPumpBuy,
    inkyPumpSell,
    shelliesRaffles,
    shelliesPayToPlay,
    shelliesStaking,
    znsData: zns,
    nft2meData: nft2me,
    nadoData: nado,
    otomateData: otomate,
    templarsData: templars,
    mintData,
    sweepData: sweepRaw,
    openSeaCounts,
    zenithNftData: zenithNft,
    zenithStakingData: zenithStaking,
    gonefishinData: gonefishin,
    sentryData: sentry,
    hypercallData: hypercall,
    inkBrokersData: inkBrokers,
  };

  // The score: the proven pure function over the same per-metric inputs,
  // cached under the /score shell's own key (so /score and the bundle agree
  // and share one computation).
  const score = await vc(`wallet:score:${wallet}`, 'score', 35000, () =>
    pointsServiceV2.computeScoreFromInputs(wallet, inputs)
  );

  // Persist the score snapshot from the SAME inputs the score just consumed.
  // Without this, bundle passes (the backfill's workhorse and every warm
  // dashboard load) never materialize the instant-serve layer — only /score
  // endpoint hits did. Partiality follows the score path's rule (stats null
  // = partial); the store's downgrade guard protects existing completes.
  void saveScoreSnapshot(wallet, inputs, stats === null || stats === undefined).catch((err: unknown) => {
    console.warn(`[Bundle] ${wallet.slice(0, 10)}: score snapshot save failed:`, err);
  });

  const metrics: Record<string, unknown> = {
    stats,
    bridge,
    swap,
    tydro,
    nft2me,
    gonefishin,
    sentry,
    hypercall,
    nado,
    otomate,
    score,
    volume,
    analytics: analyticsAgg,
    cards,
    cryptoclash: await getCryptoClashSafe(wallet),
    gmCount: gmData,
    inkypumpCreatedTokens: inkyPumpCreated,
    inkypumpBuyVolume: inkyPumpBuy,
    inkypumpSellVolume: inkyPumpSell,
    zns,
    shelliesJoinedRaffles: shelliesRaffles,
    shelliesPayToPlay,
    shelliesStaking,
    openseaBuyCount: openseaBuy,
    openseaSaleCount: openseaSale,
    mintCount: mintData,
    templarsNftBalance: templars,
    sweep: sweepAnalytics,
    zenithNft,
    zenithStaking,
    inkBrokers,
  };

  // ACCURACY RULE: a bundle with ANY null metric is incomplete — the old
  // per-endpoint flow did NOT cache errored metrics (each shell retried on
  // the next load), so an incomplete bundle must never be responseCache-cached
  // or snapshot-served either, or one cold-burst timeout would freeze that
  // metric as missing for the whole TTL. The bundle is still returned live
  // (the UI shows what we have) and snapshotted with partial=true for audit.
  //
  // PARTIAL RULE: a metric that returns a NON-NULL subset (discovery page cap,
  // pricing cap) is just as incomplete for accuracy — it under-reports vs
  // reality. Those payloads carry `partial: true` and must also keep the
  // bundle out of the caches and hand the wallet to the background completion
  // loop (route enqueues a 'bundle' refill job), otherwise a whale's first
  // truncated load would stay truncated until the next unrelated visit.
  const missing = Object.entries(metrics)
    .filter(([, v]) => v == null)
    .map(([k]) => k);
  const metricIsPartial = (v: unknown): boolean =>
    !!v && typeof v === 'object' && (v as { partial?: unknown }).partial === true;
  const partialMetrics = Object.entries(metrics)
    .filter(([, v]) => metricIsPartial(v))
    .map(([k]) => k);
  const partial = inputs.walletStats === null || missing.length > 0 || partialMetrics.length > 0;
  if (partial) {
    console.warn(
      `[Bundle] ${wallet.slice(0, 10)}: incomplete bundle — missing: ${missing.join(', ') || 'wallet stats'}` +
        `${partialMetrics.length ? ` — partial: ${partialMetrics.join(', ')}` : ''} (will not be cached)`
    );
  }

  return {
    wallet,
    captured_at: new Date().toISOString(),
    partial,
    metrics,
  };
}

// Otomate never throws (stale-serve built in); a null here means even the
// stale path failed — same "missing, not zero" treatment as every metric.
async function getOtomateSafe(wallet: string): Promise<OtomateResponse | null> {
  try {
    return await getOtomateMetrics(wallet);
  } catch (err) {
    console.warn(`[Bundle] otomate failed for ${wallet.slice(0, 10)}:`, err);
    return null;
  }
}

// CryptoClash never throws (zero/requiresAuth fallbacks built in).
async function getCryptoClashSafe(wallet: string): Promise<unknown> {
  try {
    return await getCryptoClashMetrics(wallet);
  } catch (err) {
    console.warn(`[Bundle] cryptoclash failed for ${wallet.slice(0, 10)}:`, err);
    return null;
  }
}

/**
 * Structural sanity for a bundle read back from the snapshot store.
 * A snapshot is a cache of facts, never a source of them.
 */
export function isValidBundleShape(b: unknown): b is DashboardBundle {
  if (!b || typeof b !== 'object') return false;
  const anyB = b as DashboardBundle;
  const m = (anyB.metrics ?? null) as Record<string, unknown> | null;
  return (
    typeof anyB.wallet === 'string' &&
    typeof anyB.captured_at === 'string' &&
    m !== null &&
    typeof m === 'object' &&
    // The score entry must at least carry the point total.
    typeof m.score === 'object' &&
    // SCHEMA GUARD: snapshots captured before a metric joined the bundle
    // lack its entry — serving one would show that metric as missing for a
    // full TTL window while skipping the live gather entirely (observed:
    // sentry/hypercall cards never rendered because a pre-deploy snapshot
    // kept passing the old shape check). A COMPLETE bundle always contains
    // every metric (services never return null for complete gathers), so
    // requiring the newest keys only ever rejects stale-shape snapshots —
    // they fall through to a live gather, which re-snapshots the full
    // shape. Bump this list whenever a metric is added to the bundle.
    m.gonefishin != null &&
    m.sentry != null &&
    m.hypercall != null
  );
}

export type { ScoreInputs };
