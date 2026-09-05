import { responseCache } from '../cache';

// Sprint 2: verbatim extraction of the GET /api/cryptoclash/:wallet handler
// from routes/cryptoclash.ts (the POST /auth route stays in the route file
// and calls getAuthToken here). The responseCache choreography stays INSIDE
// this service on purpose: the zero/requiresAuth fallback responses are
// deliberately NOT cached — only a successful upstream fetch is. Splitting
// that across shell/service would change what gets cached. No logic changed.

export interface CryptoClashPlayerResponse {
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

// Helper function to get or refresh authentication token
export async function getAuthToken(walletAddress: string, signature?: string, message?: string, timestamp?: number): Promise<string | null> {
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

const ZERO_METRICS = {
  clashTickets: 0,
  lpTickets: 0,
  points: 0,
  totalBattles: 0,
  isPatron: false,
};

/**
 * Get CryptoClash player metrics. Returns the exact same objects the HTTP
 * endpoint returned: a zero/`requiresAuth` fallback when no valid token
 * exists (NOT cached), or the metrics from a successful upstream fetch
 * (cached). Never throws — the old GET handler caught everything and
 * returned the zero metrics.
 */
export async function getCryptoClashMetrics(walletAddress: string): Promise<CryptoClashMetrics & { requiresAuth?: boolean }> {
  // Check cache first for performance
  const cacheKey = `cryptoclash:${walletAddress}`;
  const cached = responseCache.get<CryptoClashMetrics>(cacheKey);
  if (cached) {
    return cached;
  }

  // Get authentication token (from cache only, no signature required for GET)
  const token = await getAuthToken(walletAddress);

  if (!token) {
    // Return requiresAuth flag if not authenticated
    return {
      ...ZERO_METRICS,
      requiresAuth: true,
    };
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
      return {
        ...ZERO_METRICS,
        requiresAuth: true,
      };
    }

    // For other errors, return empty metrics
    return { ...ZERO_METRICS };
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

  return metrics;
}
