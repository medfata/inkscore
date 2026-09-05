import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';
import { getNadoMetrics, NadoMetrics } from '../services/nado-service';

const router = Router();

// Sprint 1: thin shell — computation lives in services/nado-service.ts
// (long cache + in-flight coordination included). Verbatim extraction.

// GET /api/nado/:wallet - Get Nado Finance metrics for a wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `nado:${walletAddress}`;
    const cached = responseCache.get<NadoMetrics>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const metrics = await getNadoMetrics(walletAddress);
    responseCache.set(cacheKey, metrics);
    return res.json(metrics);
  } catch (error) {
    console.error('Failed to fetch Nado metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch Nado metrics' });
  }
});

export default router;
