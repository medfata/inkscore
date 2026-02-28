import { Router, Request, Response } from 'express';
import { responseCache } from '../cache';

const router = Router();

// Token cache - stores JWT tokens per wallet address
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

// Cleanup expired tokens every hour to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [wallet, data] of tokenCache.entries()) {
    if (data.expiresAt <= now) {
      tokenCache.delete(wallet);
    }
  }
}, 60 * 60 * 1000); // Run every hour

interface CryptoClashPlayerResponse {
  userId: string;
  playerName: string;
  clashTickets: number;
  lpTickets: number;
  compBoxes: number;
  points: number;
  patronTickets: number;
  customCardTickets: number;
  heroNftDrawTickets: number;
  landNftDrawTickets: number;
  patronNftDrawTickets: number;
  clashDrawTickets: number;
  randomCards: number;
  commonPacks: number;
  uncommonPacks: number;
  rarePacks: number;
  epicPacks: number;
  legendaryPacks: number;
  lockBoxes: number;
  alienTech: number;
  medicalBoxes: number;
  redactedPlushies: number;
  miningEquipmentBoxes: number;
  ammoBoxes: number;
  craftingEquipmentBoxes: number;
  alienDNA: number;
  armorBoxes: number;
  blueprints: number;
  territoryClaims: number;
  craftingMaterials: number;
  weaponsBoxes: number;
  usdcOre: number;
  usdgOre: number;
  kbtcOre: number;
  shrooms: number;
  tetherShards: number;
  distilledPurple: number;
  catGenome: number;
  ethPlasma: number;
  hasSelectedHouse: boolean;
  dailySwaps: number;
  lastSwapReset: string;
  dailyPackUsed: boolean;
  lastDailyPackReset: string;
  totalBattles: number;
  hasClaimedStarterPack: boolean;
  badges: string[];
  musicEnabled: boolean;
  soundEffectsEnabled: boolean;
  musicVolume: number;
  soundEffectsVolume: number;
  ticketGnomeEvents: any[];
  isPatron: boolean;
  patronBalance: number;
  referralCode: string;
  referralCount: number;
  referredBy: string | null;
}

export interface CryptoClashMetrics {
  clashTickets: number;
  lpTickets: number;
  points: number;
  totalBattles: number;
  isPatron: boolean;
}

interface CryptoClashAuthRequest {
  userId: string;
  signature: string;
  message: string;
  timestamp: number;
}

interface CryptoClashAuthResponse {
  success: boolean;
  token: string;
  userId: string;
}

// Helper function to get or refresh authentication token
async function getAuthToken(walletAddress: string, signature?: string, message?: string, timestamp?: number): Promise<string | null> {
  const lowerWallet = walletAddress.toLowerCase();
  
  // Check if we have a valid cached token
  const cached = tokenCache.get(lowerWallet);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // If no signature provided, we can't authenticate
  if (!signature || !message || !timestamp) {
    return null;
  }

  // Authenticate with CryptoClash API
  try {
    const authPayload: CryptoClashAuthRequest = {
      userId: walletAddress,
      signature,
      message,
      timestamp,
    };

    const response = await fetch('https://www.cryptoclash.ink/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
      },
      body: JSON.stringify(authPayload),
    });

    if (!response.ok) {
      console.error(`[CryptoClash] Auth failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as CryptoClashAuthResponse;

    if (data.success && data.token) {
      // Cache the token (expires in ~23 hours to be safe)
      tokenCache.set(lowerWallet, {
        token: data.token,
        expiresAt: Date.now() + (23 * 60 * 60 * 1000),
      });
      return data.token;
    }

    return null;
  } catch (error) {
    console.error('[CryptoClash] Authentication error:', error);
    return null;
  }
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

    // Check cache first for performance
    const cacheKey = `cryptoclash:${walletAddress}`;
    const cached = responseCache.get<CryptoClashMetrics>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get authentication token (from cache only, no signature required for GET)
    const token = await getAuthToken(walletAddress);

    if (!token) {
      // Return requiresAuth flag if not authenticated
      return res.json({
        clashTickets: 0,
        lpTickets: 0,
        points: 0,
        totalBattles: 0,
        isPatron: false,
        requiresAuth: true,
      });
    }

    // Fetch from CryptoClash API with authentication
    const response = await fetch(
      `https://www.cryptoclash.ink/api/player?userId=${walletAddress}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': '*/*',
        },
      }
    );

    if (!response.ok) {
      // If unauthorized, clear cached token and return requiresAuth
      if (response.status === 401) {
        tokenCache.delete(walletAddress);
        return res.json({
          clashTickets: 0,
          lpTickets: 0,
          points: 0,
          totalBattles: 0,
          isPatron: false,
          requiresAuth: true,
        });
      }

      // For other errors, return empty metrics
      return res.json({
        clashTickets: 0,
        lpTickets: 0,
        points: 0,
        totalBattles: 0,
        isPatron: false,
      });
    }

    const data = await response.json() as CryptoClashPlayerResponse;

    const metrics: CryptoClashMetrics = {
      clashTickets: data.clashTickets || 0,
      lpTickets: data.lpTickets || 0,
      points: data.points || 0,
      totalBattles: data.totalBattles || 0,
      isPatron: data.isPatron || false,
    };

    // Cache the result for 5 minutes
    responseCache.set(cacheKey, metrics);

    return res.json(metrics);
  } catch (error) {
    console.error('[CryptoClash] Failed to fetch metrics:', error);
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
