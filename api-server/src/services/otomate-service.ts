import { responseCache } from '../cache';

// Sprint 1: verbatim extraction of the /api/otomate/:wallet handler from
// routes/otomate.ts (renamed from Copink → Otomate). Unlike the other
// extractions, the responseCache choreography stays INSIDE this service on
// purpose: the stale-serve path caches the un-flagged metrics while
// returning a `{stale: true}` copy — splitting that across shell/service
// would change what gets cached.
// No logic changed.

export interface OtomateApiResponse {
  success: boolean;
  address: string;
  totalVolume: number;
  subaccountsFound: number;
}

export interface OtomateMetrics {
  totalVolume: number;
  subaccountsFound: number;
}

// The upstream Otomate API takes ~5s per call (measured), well over the
// score's per-endpoint fetch budget. Without mitigation every cold score
// computation times out on otomate and scores 0. Mitigations:
// - In-flight dedup: concurrent requests for the same wallet (frontend +
//   score self-fetch) share one upstream call.
// - Long cache: volume changes slowly; 10 min is safe (the shared
//   responseCache TTL is only 30s).
// - Serve-stale: on upstream error/timeout return last-known-good metrics
//   instead of 500, so a degraded upstream doesn't zero otomate points.
//   (Extra fields are ignored by score consumers.)
const otomateInflight = new Map<string, Promise<OtomateMetrics & { stale?: boolean }>>();
const otomateLongCache = new Map<string, { data: OtomateMetrics; timestamp: number }>();
const OTOMATE_LONG_CACHE_TTL = 10 * 60 * 1000;
const OTOMATE_UPSTREAM_TIMEOUT = 8000;

/**
 * Get Otomate trading volume for a wallet.
 * Throws the `{status: 400}` error for an invalid upstream address response
 * (the route shell maps it to HTTP 400); other errors propagate so the
 * shell can return 500.
 */
export async function getOtomateMetrics(walletAddress: string): Promise<OtomateMetrics & { stale?: boolean }> {
  // Check cache
  const cacheKey = `otomate:${walletAddress}`;
  const cached = responseCache.get<OtomateMetrics>(cacheKey);
  if (cached) {
    return cached;
  }
  const longCached = otomateLongCache.get(walletAddress);
  if (longCached && Date.now() - longCached.timestamp < OTOMATE_LONG_CACHE_TTL) {
    responseCache.set(cacheKey, longCached.data);
    return longCached.data;
  }
  const inflight = otomateInflight.get(walletAddress);
  if (inflight) {
    try {
      return await inflight;
    } catch {
      // Fall through and fetch fresh if the shared run failed.
    }
  }

  const compute = (async (): Promise<OtomateMetrics & { stale?: boolean }> => {
    // Call Otomate API (bounded: never hang a score request forever)
    const otomateResponse = await fetch(`https://app.copink.xyz/api/volume/${walletAddress}`, {
      signal: AbortSignal.timeout(OTOMATE_UPSTREAM_TIMEOUT),
    });

    if (!otomateResponse.ok) {
      if (otomateResponse.status === 400) {
        throw Object.assign(new Error('Invalid address format'), { status: 400 });
      }
      throw new Error(`Otomate API returned ${otomateResponse.status}`);
    }

    const otomateData = await otomateResponse.json() as OtomateApiResponse;

    if (!otomateData.success) {
      throw new Error('Otomate API returned unsuccessful response');
    }

    const metrics: OtomateMetrics = {
      totalVolume: otomateData.totalVolume || 0,
      subaccountsFound: otomateData.subaccountsFound || 0,
    };

    responseCache.set(cacheKey, metrics);
    otomateLongCache.set(walletAddress, { data: metrics, timestamp: Date.now() });
    return metrics;
  })();

  otomateInflight.set(walletAddress, compute);
  try {
    return await compute;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 400) {
      throw Object.assign(new Error('Invalid address format'), { status: 400 });
    }
    // Serve stale on upstream failure so scoring degrades gracefully
    // instead of zeroing otomate points.
    const stale = otomateLongCache.get(walletAddress);
    if (stale) {
      console.warn(`[Otomate] upstream failed for ${walletAddress.slice(0, 10)}, serving stale metrics`);
      responseCache.set(cacheKey, stale.data);
      return { ...stale.data, stale: true };
    }
    throw error;
  } finally {
    if (otomateInflight.get(walletAddress) === compute) {
      otomateInflight.delete(walletAddress);
    }
  }
}

// Backward-compat alias (deprecated): prefer getOtomateMetrics.
export const getCopinkMetrics = getOtomateMetrics;
