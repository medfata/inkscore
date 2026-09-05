import { Router, Request, Response } from 'express';
import { responseCache, WALLET_CACHE_TTL_MS } from '../cache';
import { getDashboardCards } from '../services/dashboard-cards-service';
import { DashboardCardsResponse } from '../types';
import {
  gatherDashboardBundle,
  isValidBundleShape,
} from '../services/dashboard-bundle-service';
import {
  getFreshBundleSnapshot,
  saveBundleSnapshot,
} from '../services/metrics-snapshot-service';

const router = Router();

// GET /api/dashboard/config - Public runtime config (cache policy shown on
// the dashboard so the banner always matches the server's actual TTL).
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    walletCacheTtlMinutes: Math.round(WALLET_CACHE_TTL_MS / 60000),
  });
});

// GET /api/dashboard/bundle/:wallet - The whole dashboard in ONE response.
//
// Every entry in `metrics` is the exact payload the corresponding individual
// endpoint serves (same service functions; proven per-metric by
// scripts/check-bundle-parity.mjs). Serve order:
//   1. responseCache (wallet-key TTL, same as every dashboard endpoint)
//   2. fresh dashboard snapshot (never staler than the responseCache TTL)
//   3. live gather (and persist the snapshot, fire-and-forget)
// refresh=true bypasses BOTH caches: a refresh means refresh.
// Partial bundles (wallet stats timed out) are never served from a snapshot.
router.get('/bundle/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = `dashboard:bundle:${walletAddress}`;

    if (!forceRefresh) {
      const cached = responseCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }

      const snap = await getFreshBundleSnapshot(walletAddress).catch((err: unknown) => {
        console.warn(`[Bundle] ${walletAddress.slice(0, 10)}: snapshot read failed, computing live:`, err);
        return null;
      });
      if (snap && !snap.partial && isValidBundleShape(snap.bundle)) {
        console.log(`[Bundle] ${walletAddress.slice(0, 10)}: serving from dashboard snapshot (captured ${snap.capturedAt.toISOString()})`);
        return res.json({ ...snap.bundle, from_snapshot: true });
      }
    }

    const started = Date.now();
    const bundle = await gatherDashboardBundle(walletAddress);
    console.log(`[Bundle] ${walletAddress.slice(0, 10)}: live gather completed in ${Date.now() - started}ms (partial=${bundle.partial})`);

    // Cache ONLY complete bundles: an incomplete one (any null metric) must
    // be recomputed on the next load, exactly like the old per-endpoint
    // flow that never cached an errored metric.
    if (!bundle.partial) {
      responseCache.set(cacheKey, bundle);
    }

    // Fire-and-forget snapshot persist (failure never affects the response).
    void saveBundleSnapshot(walletAddress, bundle as unknown as Record<string, unknown>, bundle.partial).catch(
      (err: unknown) => {
        console.warn(`[Bundle] ${walletAddress.slice(0, 10)}: snapshot save failed:`, err);
      }
    );

    return res.json({ ...bundle, from_snapshot: false });
  } catch (error) {
    console.error('Failed to build dashboard bundle:', error);
    return res.status(500).json({ error: 'Failed to build dashboard bundle' });
  }
});

// GET /api/dashboard/cards/:wallet - Get dashboard cards with metric data for a wallet
// Sprint 2: thin shell — composition lives in
// services/dashboard-cards-service.ts. Verbatim extraction.
router.get('/cards/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `dashboard:cards:${walletAddress}`;
    const cached = responseCache.get<DashboardCardsResponse>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const response = await getDashboardCards(walletAddress);

    responseCache.set(cacheKey, response);
    return res.json(response);
  } catch (error) {
    console.error('Failed to fetch dashboard card data:', error);
    return res.status(500).json({ error: 'Failed to fetch dashboard card data' });
  }
});

export default router;
