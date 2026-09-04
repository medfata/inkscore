import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';

const router = Router();

interface CopinkApiResponse {
  success: boolean;
  address: string;
  totalVolume: number;
  subaccountsFound: number;
}

interface CopinkMetrics {
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

// GET /api/copink/:wallet - Get Copink trading volume for a wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `copink:${walletAddress}`;
    const cached = responseCache.get<CopinkMetrics>(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    const longCached = copinkLongCache.get(walletAddress);
    if (longCached && Date.now() - longCached.timestamp < COPINK_LONG_CACHE_TTL) {
      responseCache.set(cacheKey, longCached.data);
      return res.json(longCached.data);
    }
    const inflight = copinkInflight.get(walletAddress);
    if (inflight) {
      try {
        return res.json(await inflight);
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
      return res.json(await compute);
    } catch (error: unknown) {
      const status = (error as { status?: number })?.status;
      if (status === 400) {
        return res.status(400).json({ error: 'Invalid address format' });
      }
      // Serve stale on upstream failure so scoring degrades gracefully
      // instead of zeroing copink points.
      const stale = copinkLongCache.get(walletAddress);
      if (stale) {
        console.warn(`[Copink] upstream failed for ${walletAddress.slice(0, 10)}, serving stale metrics`);
        responseCache.set(cacheKey, stale.data);
        return res.json({ ...stale.data, stale: true });
      }
      throw error;
    } finally {
      if (copinkInflight.get(walletAddress) === compute) {
        copinkInflight.delete(walletAddress);
      }
    }
  } catch (error) {
    console.error('Failed to fetch Copink metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch volume data' });
  }
});

export default router;