import { responseCache } from '../cache';

// Sprint 1: verbatim extraction of the /api/copink/:wallet handler from
// routes/copink.ts. Unlike the other extractions, the responseCache
// choreography stays INSIDE this service on purpose: the stale-serve path
// caches the un-flagged metrics while returning a `{stale: true}` copy —
// splitting that across shell/service would change what gets cached.
// No logic changed.

export interface CopinkApiResponse {
  success: boolean;
  address: string;
  totalVolume: number;
  subaccountsFound: number;
}

export interface CopinkMetrics {
  totalVolume: number;
  subaccountsFound: number;
}

// The upstream Copink API takes ~5s per call (measured), well over the
// score's per-endpoint fetch budget. Without mitigation every cold score
// computation times out on copink and scores 0. Mitigations:
// - In-flight dedup: concurrent requests for the same wallet (frontend +
//   score self-fetch) share one upstream call.
// - Long cache: volume changes slowly; 10 min is safe (the shared
//   responseCache TTL is only 30s).
// - Serve-stale: on upstream error/timeout return last-known-good metrics
//   instead of 500, so a degraded upstream doesn't zero copink points.
//   (Extra fields are ignored by score consumers.)
const copinkInflight = new Map<string, Promise<CopinkMetrics & { stale?: boolean }>>();
const copinkLongCache = new Map<string, { data: CopinkMetrics; timestamp: number }>();
const COPINK_LONG_CACHE_TTL = 10 * 60 * 1000;
const COPINK_UPSTREAM_TIMEOUT = 8000;

/**
 * Get Copink trading volume for a wallet.
 * Throws the `{status: 400}` error for an invalid upstream address response
 * (the route shell maps it to HTTP 400); other errors propagate so the
 * shell can return 500.
 */
export async function getCopinkMetrics(walletAddress: string): Promise<CopinkMetrics & { stale?: boolean }> {
  // Check cache
  const cacheKey = `copink:${walletAddress}`;
  const cached = responseCache.get<CopinkMetrics>(cacheKey);
  if (cached) {
    return cached;
  }
  const longCached = copinkLongCache.get(walletAddress);
  if (longCached && Date.now() - longCached.timestamp < COPINK_LONG_CACHE_TTL) {
    responseCache.set(cacheKey, longCached.data);
    return longCached.data;
  }
  const inflight = copinkInflight.get(walletAddress);
  if (inflight) {
    try {
      return await inflight;
    } catch {
      // Fall through and fetch fresh if the shared run failed.
    }
  }

  const compute = (async (): Promise<CopinkMetrics & { stale?: boolean }> => {
    // Call Copink API (bounded: never hang a score request forever)
    const copinkResponse = await fetch(`https://app.copink.xyz/api/volume/${walletAddress}`, {
      signal: AbortSignal.timeout(COPINK_UPSTREAM_TIMEOUT),
    });

    if (!copinkResponse.ok) {
      if (copinkResponse.status === 400) {
        throw Object.assign(new Error('Invalid address format'), { status: 400 });
      }
      throw new Error(`Copink API returned ${copinkResponse.status}`);
    }

    const copinkData = await copinkResponse.json() as CopinkApiResponse;

    if (!copinkData.success) {
      throw new Error('Copink API returned unsuccessful response');
    }

    const metrics: CopinkMetrics = {
      totalVolume: copinkData.totalVolume || 0,
      subaccountsFound: copinkData.subaccountsFound || 0,
    };

    responseCache.set(cacheKey, metrics);
    copinkLongCache.set(walletAddress, { data: metrics, timestamp: Date.now() });
    return metrics;
  })();

  copinkInflight.set(walletAddress, compute);
  try {
    return await compute;
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 400) {
      throw Object.assign(new Error('Invalid address format'), { status: 400 });
    }
    // Serve stale on upstream failure so scoring degrades gracefully
    // instead of zeroing copink points.
    const stale = copinkLongCache.get(walletAddress);
    if (stale) {
      console.warn(`[Copink] upstream failed for ${walletAddress.slice(0, 10)}, serving stale metrics`);
      responseCache.set(cacheKey, stale.data);
      return { ...stale.data, stale: true };
    }
    throw error;
  } finally {
    if (copinkInflight.get(walletAddress) === compute) {
      copinkInflight.delete(walletAddress);
    }
  }
}
