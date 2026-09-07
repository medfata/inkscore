import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';
import { walletStatsService } from '../services/wallet-stats-service';
import { pointsServiceV2 } from '../services/points-service-v2';
import { getBridgeVolume } from '../services/bridge-service';
import type { BridgeVolumeResponse } from '../services/bridge-service';
import { getSwapVolume } from '../services/swap-service';
import type { SwapVolumeResponse } from '../services/swap-service';
import { getTotalVolumeData } from '../services/volume-service';
import type { TotalVolumeResponse } from '../services/volume-service';
import { getNft2meData } from '../services/nft2me-service';
import type { Nft2MeResponse } from '../services/nft2me-service';
import { getTydroData } from '../services/tydro-service';
import type { TydroResponse } from '../services/tydro-service';
import { getGoneFishinData } from '../services/gonefishin-service';
import type { GoneFishinResponse } from '../services/gonefishin-service';
import { getSentryData } from '../services/sentry-service';
import type { SentryResponse } from '../services/sentry-service';
import { getHypercallData } from '../services/hypercall-service';
import type { HypercallResponse } from '../services/hypercall-service';

const router = Router();

// Validate wallet address format
function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// GET /api/wallet/:address/stats
router.get('/:address/stats', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const cacheKey = `wallet:stats:${address.toLowerCase()}`;
        const cached = responseCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const stats = await walletStatsService.getAllStats(address);
        responseCache.set(cacheKey, stats);
        res.json(stats);
    } catch (error) {
        console.error('Error fetching wallet stats:', error);
        res.status(500).json({ error: 'Failed to fetch wallet stats' });
    }
});

// All metric computations live in services/*-service.ts (Sprint 1). Routes are
// thin shells: validate -> responseCache get -> service call -> responseCache
// set -> respond. Cache keys are identical to the pre-extraction routes.

// ============================================
// Bridge Volume Route (logic: services/bridge-service.ts)
// ============================================

router.get('/:address/bridge', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:bridge:${walletAddress}`;
        const cached = responseCache.get<BridgeVolumeResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getBridgeVolume(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching bridge volume:', error);
        res.status(500).json({ error: 'Failed to fetch bridge volume' });
    }
});

// ============================================
// Swap Volume Route (logic: services/swap-service.ts)
// ============================================

router.get('/:address/swap', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:swap:${walletAddress}`;
        const cached = responseCache.get<SwapVolumeResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getSwapVolume(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching swap volume:', error);
        res.status(500).json({ error: 'Failed to fetch swap volume' });
    }
});

// ============================================
// Total Volume Route (logic: services/volume-service.ts)
// ============================================

router.get('/:address/volume', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:volume:${walletAddress}`;
        const cached = responseCache.get<TotalVolumeResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getTotalVolumeData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching total volume:', error);

        // Preserved from the pre-extraction route: upstream failure returns a
        // zeroed response instead of a 500 (this is pre-existing behavior —
        // note the zeroed response carries NO partial flag, exactly as before).
        const emptyResponse: TotalVolumeResponse = {
            totalEth: 0,
            totalUsd: 0,
            txCount: 0,
            incoming: { eth: 0, usd: 0, count: 0 },
            outgoing: { eth: 0, usd: 0, count: 0 },
        };

        return res.json(emptyResponse);
    }
});

// ============================================
// Wallet Score Route
// ============================================

// GET /api/wallet/:address/score
router.get('/:address/score', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const forceRefresh = req.query.refresh === 'true';

        const cacheKey = `wallet:score:${walletAddress}`;

        if (!forceRefresh) {
            const cached = responseCache.get(cacheKey);
            if (cached) {
                return res.json(cached);
            }
        }

        // refresh=true must mean REFRESH: skip the responseCache (above) AND
        // the metrics snapshot — always a live gather + recompute.
        const score = await pointsServiceV2.calculateWalletScore(address, { skipSnapshot: forceRefresh });
        responseCache.set(cacheKey, score);

        return res.json(score);
    } catch (error) {
        console.error('Failed to calculate wallet score:', error);

        return res.status(500).json({ error: 'Failed to calculate wallet score' });
    }
});

// ============================================
// NFT2Me Route (logic: services/nft2me-service.ts)
// ============================================

router.get('/:address/nft2me', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:nft2me:${walletAddress}`;
        const cached = responseCache.get<Nft2MeResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getNft2meData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching NFT2Me data:', error);
        res.status(500).json({ error: 'Failed to fetch NFT2Me data' });
    }
});

// ============================================
// Tydro Route (logic: services/tydro-service.ts)
// ============================================

router.get('/:address/tydro', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:tydro:${walletAddress}`;
        const cached = responseCache.get<TydroResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getTydroData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching Tydro data:', error);
        res.status(500).json({ error: 'Failed to fetch Tydro data' });
    }
});

// ============================================
// Gone Fishin Route (logic: services/gonefishin-service.ts)
// ============================================

router.get('/:address/gonefishin', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:gonefishin:${walletAddress}`;
        const cached = responseCache.get<GoneFishinResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getGoneFishinData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching Gone Fishin data:', error);
        res.status(500).json({ error: 'Failed to fetch Gone Fishin data' });
    }
});

// ============================================
// Sentry Route (logic: services/sentry-service.ts)
// ============================================

router.get('/:address/sentry', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:sentry:${walletAddress}`;
        const cached = responseCache.get<SentryResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getSentryData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching Sentry data:', error);
        res.status(500).json({ error: 'Failed to fetch Sentry data' });
    }
});

// ============================================
// Hypercall Route (logic: services/hypercall-service.ts)
// ============================================

router.get('/:address/hypercall', async (req: Request, res: Response) => {
    try {
        const { address } = req.params;

        if (!isValidAddress(address)) {
            return res.status(400).json({ error: 'Invalid wallet address format' });
        }

        const walletAddress = address.toLowerCase();
        const cacheKey = `wallet:hypercall:${walletAddress}`;
        const cached = responseCache.get<HypercallResponse>(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await getHypercallData(walletAddress);
        responseCache.set(cacheKey, response);
        return res.json(response);
    } catch (error) {
        console.error('Error fetching Hypercall data:', error);
        res.status(500).json({ error: 'Failed to fetch Hypercall data' });
    }
});

export default router;
