import { Router, Request, Response } from 'express';
import { phase1Service } from '../services';
import { responseCache } from '../cache';

const router = Router();

// GET /api/phase1/check/:wallet - Check if wallet is in Phase 1
router.get('/check/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache (Phase 1 data doesn't change, so we can cache for longer)
    const cacheKey = `phase1:check:${walletAddress}`;
    const cached = responseCache.get<ReturnType<typeof phase1Service.getPhase1Status>>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const status = phase1Service.getPhase1Status(walletAddress);
    
    // Cache the result (uses default TTL)
    responseCache.set(cacheKey, status);
    
    return res.json(status);
  } catch (error) {
    console.error('Failed to check Phase 1 status:', error);
    return res.status(500).json({ error: 'Failed to check Phase 1 status' });
  }
});

// GET /api/phase1/wallets - Get all Phase 1 wallets (admin only)
router.get('/wallets', async (_req: Request, res: Response) => {
  try {
    const wallets = phase1Service.getAllPhase1Wallets();
    return res.json({
      total: wallets.length,
      wallets: wallets.sort((a, b) => b.score - a.score), // Sort by score descending
    });
  } catch (error) {
    console.error('Failed to fetch Phase 1 wallets:', error);
    return res.status(500).json({ error: 'Failed to fetch Phase 1 wallets' });
  }
});

export default router;
