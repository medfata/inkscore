import { Router, Request, Response } from 'express';
import { getAuthToken, getCryptoClashMetrics } from '../services/cryptoclash-service';

const router = Router();

// Sprint 2: thin shell — computation (and the responseCache choreography,
// incl. the never-cache-zero-fallback rule) lives in
// services/cryptoclash-service.ts. Verbatim extraction.

interface CryptoClashAuthRequest {
  userId: string;
  signature: string;
  message: string;
  timestamp: number;
}

// POST /api/cryptoclash/auth - Authenticate and cache token
router.post('/auth', async (req: Request, res: Response) => {
  try {
    const { userId, signature, message, timestamp } = req.body as CryptoClashAuthRequest;

    if (!userId || !signature || !message || !timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const token = await getAuthToken(userId, signature, message, timestamp);

    if (!token) {
      return res.status(401).json({ error: 'Authentication failed' });
    }

    return res.json({ success: true, token });
  } catch (error) {
    console.error('[CryptoClash] Auth endpoint error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /api/cryptoclash/:wallet - Get CryptoClash player metrics
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;

    // Validate wallet address format
    const isValid = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet);

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const walletAddress = wallet.toLowerCase();
    return res.json(await getCryptoClashMetrics(walletAddress));
  } catch (error) {
    console.error('[CryptoClash] Failed to fetch metrics:', error);
    // Verbatim: the old GET handler caught everything and returned the
    // zero metrics with HTTP 200 (never a 500).
    return res.json({
      clashTickets: 0,
      lpTickets: 0,
      points: 0,
      totalBattles: 0,
      isPatron: false,
    });
  }
});

export default router;
