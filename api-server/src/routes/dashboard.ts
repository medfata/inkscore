import { Router, Request, Response } from 'express';
import { responseCache, WALLET_CACHE_TTL_MS } from '../cache';
import { getDashboardCards } from '../services/dashboard-cards-service';
import { DashboardCardsResponse } from '../types';

const router = Router();

// GET /api/dashboard/config - Public runtime config (cache policy shown on
// the dashboard so the banner always matches the server's actual TTL).
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    walletCacheTtlMinutes: Math.round(WALLET_CACHE_TTL_MS / 60000),
  });
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
