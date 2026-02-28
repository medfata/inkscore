import { Router } from 'express';
import { sweepService } from '../services';

const router = Router();

// GET /api/sweep/:wallet - Get Sweep NFT collection deployment metrics
router.get('/:wallet', async (req, res) => {
  try {
    const { wallet } = req.params;

    // Validate wallet address
    if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const metrics = await sweepService.getDeployedCollections(wallet.toLowerCase());

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching Sweep metrics:', error);
    res.status(500).json({ error: 'Failed to fetch Sweep metrics' });
  }
});

export default router;
