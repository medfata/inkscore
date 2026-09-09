import { Router, Request, Response } from 'express';
import { getOtomateMetrics } from '../services/otomate-service';

const router = Router();

// Sprint 1: thin shell — computation AND the responseCache choreography
// live in services/otomate-service.ts (the stale-serve path caches the
// un-flagged metrics while responding with `stale: true`; keeping that in
// the shell would change what gets cached). Verbatim extraction (renamed
// from Copink → Otomate).

// GET /api/otomate/:wallet - Get Otomate trading volume for a wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  const { wallet } = req.params;
  const walletAddress = wallet.toLowerCase();

  // Validate wallet address
  if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    return res.json(await getOtomateMetrics(walletAddress));
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 400) {
      return res.status(400).json({ error: 'Invalid address format' });
    }
    console.error('Failed to fetch Otomate metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch volume data' });
  }
});

export default router;
