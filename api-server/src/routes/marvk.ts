import { Router, Request, Response } from 'express';
import { query } from '../db';
import { responseCache } from '../cache';

const router = Router();

const MARVK_CONTRACT = '0x9496ff7a7be0a91f582baa96ac12a0a36300750c';

interface MarvkMetrics {
  lockTokenCount: number;
  vestTokenCount: number;
  totalTransactions: number;
}

// GET /api/marvk/:wallet - Get Marvk transaction metrics for a wallet
router.get('/:wallet', async (req: Request, res: Response) => {
  try {
    const { wallet } = req.params;
    const walletAddress = wallet.toLowerCase();

    // Validate wallet address
    if (!walletAddress || !/^0x[a-f0-9]{40}$/i.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Check cache
    const cacheKey = `marvk:${walletAddress}`;
    const cached = responseCache.get<MarvkMetrics>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get total transactions for the Marvk contract
    const totalResult = await query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM transaction_details
      WHERE contract_address = LOWER($1)
        AND wallet_address = LOWER($2)
        AND status = 1
    `, [MARVK_CONTRACT, walletAddress]);

    const totalTransactions = parseInt(totalResult[0]?.count || '0');

    // Get transactions by function name to differentiate Lock vs Vest
    const functionResult = await query<{ function_name: string; count: string }>(`
      SELECT 
        COALESCE(function_name, 'unknown') as function_name,
        COUNT(*) as count
      FROM transaction_details
      WHERE contract_address = LOWER($1)
        AND wallet_address = LOWER($2)
        AND status = 1
      GROUP BY function_name
    `, [MARVK_CONTRACT, walletAddress]);

    // Categorize functions into Lock Token and Vest Token
    let lockTokenCount = 0;
    let vestTokenCount = 0;

    functionResult.forEach(row => {
      const count = parseInt(row.count);
      const functionName = row.function_name?.toLowerCase() || '';
      
      // Categorize based on function name patterns
      if (functionName.includes('lock') || functionName.includes('deposit') || functionName.includes('stake')) {
        lockTokenCount += count;
      } else if (functionName.includes('vest') || functionName.includes('claim') || functionName.includes('withdraw')) {
        vestTokenCount += count;
      } else {
        // For unknown functions, split evenly between lock and vest
        const halfCount = Math.floor(count / 2);
        lockTokenCount += halfCount;
        vestTokenCount += (count - halfCount);
      }
    });

    const metrics: MarvkMetrics = {
      lockTokenCount,
      vestTokenCount,
      totalTransactions,
    };

    responseCache.set(cacheKey, metrics);
    return res.json(metrics);
  } catch (error) {
    console.error('Failed to fetch Marvk metrics:', error);
    return res.status(500).json({ error: 'Failed to fetch Marvk metrics' });
  }
});

export default router;
