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

    // Call Copink API
    const copinkResponse = await fetch(`https://app.copink.xyz/api/volume/${walletAddress}`);
    
    if (!copinkResponse.ok) {
      if (copinkResponse.status === 400) {
        return res.status(400).json({ error: 'Invalid address format' });
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

    // Cache for 5 minutes
    responseCache.set(cacheKey, metrics);
    return res.json(metrics);
  } catch (error) {
    console.error('Failed to fetch Copink metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch volume data' });
  }
});

export default router;