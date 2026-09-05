import { query } from '../db';
import { assetsService } from './assets-service';
import { openSeaService } from './opensea-service';
import { walletStatsService } from './wallet-stats-service';
import {
  Rank,
  WalletPointsBreakdown,
  WalletScoreResponse,
} from '../types/platforms';
import { getBridgeVolume } from './bridge-service';
import { getSwapVolume } from './swap-service';
import { getTydroData } from './tydro-service';
import { getNft2meData } from './nft2me-service';
import {
  getZnsMetrics,
  getShelliesJoinedRaffles,
  getShelliesPayToPlay,
  getShelliesStaking,
  getTemplarsBalance,
} from './analytics-counts-service';
import {
  getGmCount,
  getInkypumpCreatedTokens,
  getInkypumpBuyVolume,
  getInkypumpSellVolume,
  getCowswapSwaps,
  getMintCount,
  getOpenseaBuyCount,
  getOpenseaSaleCount,
} from './analytics-metrics-service';
import { sweepService } from './sweep-service';

// TEMPORARY: wallets whose stored leaderboard score is known to be stale;
// skip the floor clamp for them and trust the realtime score.
const KNOWN_STALE_WALLETS = new Set([
  '0x4c50254dafd191bba2a6e0517c1742caf1426df5',
]);

// System/junk wallets excluded from scoring entirely (see calculateWalletScore
// and refresh-worker): walking them times out upstream and poisons the shared
// Blockscout budget. Extend as new system addresses are identified.
const JUNK_WALLETS = new Set([
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0001',
]);

// Cache for ranks (1 minute TTL)
interface RanksCache {
  ranks: Rank[];
  timestamp: number;
}
let ranksCache: RanksCache | null = null;
const RANKS_CACHE_TTL = 60 * 1000;

// Cache for meme token addresses (5 minute TTL)
interface MemeTokensCache {
  addresses: Set<string>;
  timestamp: number;
}
let memeTokensCache: MemeTokensCache | null = null;
const MEME_TOKENS_CACHE_TTL = 5 * 60 * 1000;

// TEMPORARY: leaderboard score floor cache (5 min TTL, per wallet)
// Used to prevent regressions when third-party platform data is degraded.
const leaderboardFloorCache = new Map<string, { score: number | null; timestamp: number }>();
const LEADERBOARD_SCORES_CACHE_TTL = 5 * 60 * 1000;

export class PointsServiceV2 {
  // Get meme token addresses from database
  private async getMemeTokenAddresses(): Promise<Set<string>> {
    if (memeTokensCache && Date.now() - memeTokensCache.timestamp < MEME_TOKENS_CACHE_TTL) {
      return memeTokensCache.addresses;
    }

    try {
      const memeCoins = await assetsService.getMemeCoins();
      const addresses = new Set(memeCoins.map(coin => coin.address.toLowerCase()));

      memeTokensCache = { addresses, timestamp: Date.now() };
      return addresses;
    } catch (error) {
      console.error('Failed to fetch meme token addresses:', error);
      // Fallback to hardcoded addresses if database fails
      return new Set([
        '0x0606fc632ee812ba970af72f8489baaa443c4b98', // ANITA
        '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', // CAT
        '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', // PURPLE
        '0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec', // ANDRU (AK47)
        '0x32bcb803f696c99eb263d60a05cafd8689026575', // KRAK (KRAKMASK)
        '0x62c99fac20b33b5423fdf9226179e973a8353e36', // BERT
        '0xd95b9a5fa7c2708fd4fe0e07e59bde1ef35b194a', // BEAST (Kraken Mascot)
      ]);
    }
  }

  private async isMemeToken(address: string): Promise<boolean> {
    const memeTokens = await this.getMemeTokenAddresses();
    return memeTokens.has(address.toLowerCase());
  }

  private async getCachedRanks(): Promise<Rank[]> {
    if (ranksCache && Date.now() - ranksCache.timestamp < RANKS_CACHE_TTL) {
      return ranksCache.ranks;
    }

    try {
      const rawRanks = await query<{
        id: number;
        name: string;
        min_points: string | number;
        max_points: string | number | null;
        logo_url: string | null;
        color: string | null;
        description: string | null;
        display_order: number;
        is_active: boolean;
      }>(`
        SELECT id, name, min_points, max_points, logo_url, color, description, display_order, is_active
        FROM ranks 
        WHERE is_active = true 
        ORDER BY min_points ASC
      `);

      // Parse numeric values (PostgreSQL may return them as strings)
      const ranks: Rank[] = rawRanks.map(r => ({
        ...r,
        min_points: typeof r.min_points === 'string' ? parseInt(r.min_points, 10) : r.min_points,
        max_points: r.max_points === null ? null : (typeof r.max_points === 'string' ? parseInt(r.max_points, 10) : r.max_points),
        created_at: new Date(),
        updated_at: new Date(),
      }));

      ranksCache = { ranks, timestamp: Date.now() };
      return ranks;
    } catch (error) {
      console.error('[Ranks] Failed to fetch ranks from database:', error);
      return [];
    }
  }

  // TEMPORARY: returns stored leaderboard score for a wallet, used as a floor
  // when realtime calculation regresses due to a degraded third-party source.
  // Extracts only the requested wallet's entry DB-side: shipping the whole
  // leaderboard_data blob over the wire took several seconds per cold call.
  private async getLeaderboardScoreFloor(wallet: string): Promise<number | null> {
    const key = wallet.toLowerCase();
    const cached = leaderboardFloorCache.get(key);
    if (cached && Date.now() - cached.timestamp < LEADERBOARD_SCORES_CACHE_TTL) {
      return cached.score;
    }

    try {
      const rows = await query<{ score: string | number | null }>(
        `SELECT entry->>'score' AS score
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1 AND LOWER(entry->>'wallet_address') = $1
          LIMIT 1`,
        [key]
      );
      const raw = rows[0]?.score;
      const parsed = raw === null || raw === undefined ? NaN : Number(raw);
      const score = Number.isFinite(parsed) ? parsed : null;
      leaderboardFloorCache.set(key, { score, timestamp: Date.now() });
      return score;
    } catch (error) {
      console.error('[PointsServiceV2] Failed to read leaderboard score floor:', error);
      return null;
    }
  }

  private async getTop10LeaderboardWallets(): Promise<Set<string>> {
    try {
      const rows = await query<{ wallet_address: string }>(
        `SELECT entry->>'wallet_address' AS wallet_address
           FROM cached_leaderboard, jsonb_array_elements(leaderboard_data) AS entry
          WHERE id = 1
          ORDER BY (entry->>'score')::numeric DESC
          LIMIT 10`
      );
      return new Set(rows.map(r => r.wallet_address.toLowerCase()));
    } catch (error) {
      console.error('[PointsServiceV2] Failed to fetch top 10 leaderboard wallets:', error);
      return new Set();
    }
  }

  private getRankForPoints(ranks: Rank[], totalPoints: number): Rank | null {
    // Find the rank where totalPoints falls within min_points and max_points range
    for (const rank of ranks) {
      const minOk = totalPoints >= rank.min_points;
      const maxOk = rank.max_points === null || totalPoints <= rank.max_points;
      if (minOk && maxOk) {
        return rank;
      }
    }
    return null;
  }

  // Manual points calculation methods
  private calculateNftCollectionsPoints(nftCount: number): number {
    // New tiered system for NFT Collections (Max: 400 points)
    if (nftCount >= 10) return 400; // Tier 4: Diamond Hand
    if (nftCount >= 5) return 250;  // Tier 3: Museum
    if (nftCount >= 3) return 150;  // Tier 2: Collector
    if (nftCount >= 1) return 50;   // Tier 1: Art Fan
    return 0;
  }

  private async calculateTokenHoldingsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    // New tiered system for Token Holdings (Max: 400 points)
    const memeTokens = await this.getMemeTokenAddresses();
    const totalUsd = tokenHoldings
      .filter(token => !memeTokens.has(token.address.toLowerCase()))
      .reduce((sum, token) => sum + (Number(token.usdValue) || 0), 0);
    if (isNaN(totalUsd)) return 0;
    
    if (totalUsd >= 10000) return 400; // Tier 4: Whale
    if (totalUsd >= 1000) return 300;  // Tier 3: Dolphin
    if (totalUsd >= 100) return 150;   // Tier 2: Crab
    if (totalUsd >= 1) return 50;      // Tier 1: Shrimp
    return 0;
  }

  private async calculateMemeCoinsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    // New tiered system for Meme Coins (Max: 300 points)
    const memeTokens = await this.getMemeTokenAddresses();
    const totalUsd = tokenHoldings
      .filter(token => memeTokens.has(token.address.toLowerCase()))
      .reduce((sum, token) => sum + (Number(token.usdValue) || 0), 0);
    if (isNaN(totalUsd)) return 0;
    
    if (totalUsd >= 1000) return 300; // Tier 4: Meme Whale
    if (totalUsd >= 500) return 200;  // Tier 3: Shark
    if (totalUsd >= 100) return 100;  // Tier 2: Dolphin
    if (totalUsd >= 1) return 50;     // Tier 1: Shrimp
    return 0;
  }


  private calculateWalletAgePoints(ageDays: number): number {
    if (ageDays <= 0) return 0;
    if (ageDays <= 30) return 100;
    if (ageDays <= 90) return 200;
    if (ageDays <= 180) return 300;
    if (ageDays <= 365) return 400;
    if (ageDays <= 730) return 500;
    return 600;
  }

  private calculateTotalTxPoints(txCount: number): number {
    if (txCount <= 0) return 0;
    if (txCount <= 100) return 100;
    if (txCount <= 200) return 200;
    if (txCount <= 400) return 300;
    if (txCount <= 700) return 400;
    if (txCount <= 900) return 500;
    return 600;
  }

  private calculateBridgeInPoints(bridgeInVolumeUsd: number): number {
    return this.getBridgeVolumeTierPoints(bridgeInVolumeUsd);
  }

  private calculateBridgeOutPoints(bridgeOutVolumeUsd: number): number {
    return this.getBridgeVolumeTierPoints(bridgeOutVolumeUsd);
  }

  private getBridgeVolumeTierPoints(volumeUsd: number): number {
    // New tiered system for Bridge Volume (Max: 500 points)
    if (volumeUsd >= 10000) return 500; // Tier 5: Bridge Whale
    if (volumeUsd >= 5000) return 400;  // Tier 4: Connector
    if (volumeUsd >= 1000) return 250;  // Tier 3: Settler
    if (volumeUsd >= 100) return 100;   // Tier 2: Explorer
    if (volumeUsd >= 1) return 25;      // Tier 1: Tourist
    return 0;
  }

  private getBridgeTierName(volumeUsd: number): string {
    if (volumeUsd >= 10000) return '5 (Bridge Whale)';
    if (volumeUsd >= 5000) return '4 (Connector)';
    if (volumeUsd >= 1000) return '3 (Settler)';
    if (volumeUsd >= 100) return '2 (Explorer)';
    if (volumeUsd >= 1) return '1 (Tourist)';
    return '0 (None)';
  }

  private calculateGmPoints(gmCount: number): number {
    // New tiered system for GM (Max: 400 points)
    if (gmCount >= 150) return 400; // Tier 4: GM Machine
    if (gmCount >= 50) return 250;  // Tier 3: Routine
    if (gmCount >= 10) return 150;  // Tier 2: Coffee Time
    if (gmCount >= 1) return 50;    // Tier 1: Waking Up
    return 0;
  }

  private calculateInkyPumpPoints(createdCount: number, buyVolumeUsd: number, sellVolumeUsd: number): number {
    // New tiered system for InkyPump (Max: 400 points)
    // 1. Create Tokens (Max: 50 points)
    const createPoints = createdCount >= 3 ? 50 : createdCount >= 1 ? 25 : 0;
    
    // 2. Trading Volume (Max: 350 points)
    const totalVolume = buyVolumeUsd + sellVolumeUsd;
    let volumePoints = 0;
    if (totalVolume >= 10000) volumePoints = 350;
    else if (totalVolume >= 1000) volumePoints = 250;
    else if (totalVolume >= 100) volumePoints = 150;
    else if (totalVolume >= 1) volumePoints = 50;
    
    return createPoints + volumePoints;
  }

  private calculateTydroPoints(supplyUsd: number, borrowUsd: number): number {
    // New tiered system for Tydro
    const supplyPoints = this.getTydroSupplyTierPoints(supplyUsd);
    const borrowPoints = this.getTydroBorrowTierPoints(borrowUsd);
    return supplyPoints + borrowPoints; // Max: 2,500 points
  }

  private getTydroSupplyTierPoints(supplyUsd: number): number {
    // Max: 1,250 points
    if (supplyUsd >= 50000) return 1250; // Tier 5: Whale
    if (supplyUsd >= 10000) return 1000; // Tier 4: Shark
    if (supplyUsd >= 1000) return 600;   // Tier 3: Liquidity Provider
    if (supplyUsd >= 100) return 250;    // Tier 2: Supplier
    if (supplyUsd >= 1) return 50;       // Tier 1: Saver
    return 0;
  }

  private getTydroBorrowTierPoints(borrowUsd: number): number {
    // Max: 1,250 points
    if (borrowUsd >= 25000) return 1250; // Tier 5: Degen
    if (borrowUsd >= 5000) return 1000;  // Tier 4: Pro Borrower
    if (borrowUsd >= 500) return 600;    // Tier 3: Active User
    if (borrowUsd >= 50) return 250;     // Tier 2: Borrower
    if (borrowUsd >= 1) return 50;       // Tier 1: Tester
    return 0;
  }

  private calculateSwapVolumePoints(swapAmountUsd: number): number {
    // New tiered system for Swap Volume (Max: 500 points)
    if (swapAmountUsd >= 25000) return 500; // Tier 5: DEX Master
    if (swapAmountUsd >= 10000) return 400; // Tier 4: Swap Whale
    if (swapAmountUsd >= 5000) return 250;  // Tier 3: Active Trader
    if (swapAmountUsd >= 1000) return 100;  // Tier 2: Flipper
    if (swapAmountUsd >= 1) return 25;      // Tier 1: Shopper
    return 0;
  }

  private calculateShelliesPoints(playedGameCount: number, stakedNftCount: number, joinedRaffleCount: number): number {
    // New tiered system for Shellies (Max: 400 points)
    // 1. Pay to Play (Max: 150 points)
    let playPoints = 0;
    if (playedGameCount >= 50) playPoints = 150;
    else if (playedGameCount >= 10) playPoints = 75;
    else if (playedGameCount >= 1) playPoints = 25;
    
    // 2. Staked NFTs (Max: 150 points)
    let stakePoints = 0;
    if (stakedNftCount >= 5) stakePoints = 150;
    else if (stakedNftCount >= 3) stakePoints = 100;
    else if (stakedNftCount >= 1) stakePoints = 50;
    
    // 3. Joined Raffles (Max: 100 points)
    let rafflePoints = 0;
    if (joinedRaffleCount >= 10) rafflePoints = 100;
    else if (joinedRaffleCount >= 5) rafflePoints = 50;
    else if (joinedRaffleCount >= 1) rafflePoints = 25;
    
    return playPoints + stakePoints + rafflePoints;
  }

  private calculateZnsPoints(deployCount: number, saidGmCount: number, registerCount: number): number {
    // New tiered system for ZNS (Max: 300 points)
    // 1. Register Domain (Max: 200 points)
    const registerPoints = registerCount >= 3 ? 200 : registerCount >= 1 ? 100 : 0;
    
    // 2. Deploy Contract (Max: 50 points)
    const deployPoints = deployCount >= 3 ? 50 : deployCount >= 1 ? 20 : 0;
    
    // 3. GM Activity (Max: 50 points)
    const gmPoints = saidGmCount >= 10 ? 50 : saidGmCount >= 1 ? 20 : 0;
    
    return registerPoints + deployPoints + gmPoints;
  }

  private calculateNadoPoints(totalDeposits: number, totalVolume: number): number {
    // New tiered system for Nado (Max: 2,500 points)
    // 1. Deposits (Max: 1,250 points)
    let depositPoints = 0;
    if (totalDeposits >= 50000) depositPoints = 1250; // Tier 5: Whale
    else if (totalDeposits >= 10000) depositPoints = 1000; // Tier 4: Shark
    else if (totalDeposits >= 1000) depositPoints = 600; // Tier 3: Dolphin
    else if (totalDeposits >= 100) depositPoints = 250; // Tier 2: Shrimp
    else if (totalDeposits >= 1) depositPoints = 50; // Tier 1: Beginner
    
    // 2. Volume (Max: 1,250 points)
    let volumePoints = 0;
    if (totalVolume >= 25000000) volumePoints = 1250; // Tier 6: Legend
    else if (totalVolume >= 10000000) volumePoints = 1150; // Tier 5: Market Maker
    else if (totalVolume >= 5000000) volumePoints = 1000; // Tier 4: Big Shark
    else if (totalVolume >= 1000000) volumePoints = 800; // Tier 3: Ape
    else if (totalVolume >= 500000) volumePoints = 550; // Tier 2: Active Trader
    else if (totalVolume >= 100000) volumePoints = 300; // Tier 1: Standard
    else if (totalVolume >= 0) volumePoints = 50; // Tier 0: Testing
    
    return depositPoints + volumePoints;
  }

  private calculateCopinkPoints(subaccountsFound: number, totalVolume: number): number {
    // New tiered system for Copink (Max: 400 points)
    // 1. Volume (Max: 300 points)
    let volumePoints = 0;
    if (totalVolume >= 10000) volumePoints = 300;
    else if (totalVolume >= 5000) volumePoints = 250;
    else if (totalVolume >= 1000) volumePoints = 150;
    else if (totalVolume >= 1) volumePoints = 50;
    
    // 2. Subaccounts (Max: 100 points)
    const subaccountPoints = subaccountsFound >= 3 ? 100 : subaccountsFound >= 1 ? 50 : 0;
    
    return volumePoints + subaccountPoints;
  }

  private calculateTemplarsPoints(nftBalance: number): number {
    // Templars of the Storm NFT Holding Points (Max: 2,700 points)
    // 1 NFT: 1,500 pts (Base Tier - Unlocks core holder multiplier for Phase 2)
    // 2 NFTs: 2,200 pts (Silver Tier - +700 loyalty bonus)
    // 3+ NFTs: 2,700 pts (Gold/Whale Tier - Maximum points)
    if (nftBalance >= 3) return 2700; // Gold/Whale Tier
    if (nftBalance >= 2) return 2200; // Silver Tier
    if (nftBalance >= 1) return 1500; // Base Tier
    return 0;
  }

  private calculateOpenSeaPoints(buyCount: number, sellCount: number, mintCount: number): number {
    // OpenSea NFT Activity Points (Max: 2,500 points)
    // Tiered system based on total NFT transaction count
    
    const totalNftTxs = buyCount + sellCount + mintCount;
    
    // Determine tier based on total NFT transactions
    let tier: 'bronze' | 'silver' | 'gold';
    if (totalNftTxs >= 6) {
      tier = 'gold';   // Tier 3: Gold (6+ NFTs)
    } else if (totalNftTxs >= 2) {
      tier = 'silver'; // Tier 2: Silver (2-5 NFTs)
    } else if (totalNftTxs >= 1) {
      tier = 'bronze'; // Tier 1: Bronze (1 NFT)
    } else {
      return 0; // No activity
    }
    
    // Calculate points for each action type based on tier
    let buyPoints = 0;
    if (buyCount > 0) {
      if (tier === 'gold') buyPoints = 1200;
      else if (tier === 'silver') buyPoints = 800;
      else buyPoints = 300; // bronze
    }
    
    let sellPoints = 0;
    if (sellCount > 0) {
      if (tier === 'gold') sellPoints = 800;
      else if (tier === 'silver') sellPoints = 500;
      else sellPoints = 200; // bronze
    }
    
    let mintPoints = 0;
    if (mintCount > 0) {
      if (tier === 'gold') mintPoints = 500;
      else if (tier === 'silver') mintPoints = 300;
      else mintPoints = 100; // bronze
    }
    
    return buyPoints + sellPoints + mintPoints;
  }

  private calculateCowSwapPoints(totalSwapAmountUsd: number): number {
    // Cow Swap Volume Points (Max: 2,000 points)
    // Tiered system based on total swap volume in USD
    if (totalSwapAmountUsd > 1000) return 2000;  // Tier 3: Whale (Liquidity Provider)
    if (totalSwapAmountUsd >= 101) return 1200;  // Tier 2: Trader (Active Participant)
    if (totalSwapAmountUsd >= 10) return 400;    // Tier 1: Starter (Basic DeFi User)
    return 0; // No activity
  }

  private calculateSweepPoints(collectionsCreated: number, badgesMinted: number, dailyStreak: number): number {
    // Sweep Platform Points (Max: 800 points)
    // Tiered system based on activity counts
    
    // 1. Create Collection (Max: 350 points)
    let collectionPoints = 0;
    if (collectionsCreated >= 6) {
      collectionPoints = 350; // Tier 3: Gold (6+ collections)
    } else if (collectionsCreated >= 2) {
      collectionPoints = 250; // Tier 2: Silver (2-5 collections)
    } else if (collectionsCreated >= 1) {
      collectionPoints = 100; // Tier 1: Bronze (1 collection)
    }
    
    // 2. Mint Badge (Max: 250 points)
    let badgePoints = 0;
    if (badgesMinted >= 3) {
      badgePoints = 250; // Tier 3: Gold (3+ badges)
    } else if (badgesMinted >= 2) {
      badgePoints = 150; // Tier 2: Silver (2 badges)
    } else if (badgesMinted >= 1) {
      badgePoints = 100; // Tier 1: Bronze (1 badge)
    }
    
    // 3. Daily Streak (Max: 200 points)
    let streakPoints = 0;
    if (dailyStreak >= 6) {
      streakPoints = 200; // Tier 3: Gold (6+ days)
    } else if (dailyStreak >= 2) {
      streakPoints = 100; // Tier 2: Silver (2-5 days)
    } else if (dailyStreak >= 1) {
      streakPoints = 50; // Tier 1: Bronze (1 day)
    }
    
    return collectionPoints + badgePoints + streakPoints;
  }

  private calculateNft2mePoints(collectionCreatedCount: number, nftMintedCount: number): number {
    // New tiered system for NFT2Me (Max: 300 points)
    // 1. Create Collection (Max: 100 points)
    const collectionPoints = collectionCreatedCount >= 3 ? 100 : collectionCreatedCount >= 1 ? 50 : 0;
    
    // 2. Mint NFTs (Max: 200 points)
    let mintPoints = 0;
    if (nftMintedCount >= 100) mintPoints = 200;
    else if (nftMintedCount >= 10) mintPoints = 100;
    else if (nftMintedCount >= 1) mintPoints = 50;
    
    return collectionPoints + mintPoints;
  }

  async calculateWalletScore(walletAddress: string): Promise<WalletScoreResponse> {
    const wallet = walletAddress.toLowerCase();

    // System/junk wallets (burn address etc.): every upstream walk times out
    // and poisons the shared Blockscout budget for real users. Return a
    // neutral score immediately — the response has no `partial` flag, so the
    // 1h wallet cache serves repeat hits for free instead of re-running the
    // disaster every 30s.
    if (JUNK_WALLETS.has(wallet)) {
      console.log(`[PointsServiceV2] Wallet ${wallet}: junk/system wallet — returning neutral score without upstream scans`);
      return {
        wallet_address: wallet,
        total_points: 0,
        rank: null,
        breakdown: { native: {}, platforms: {} },
        last_updated: new Date(),
      };
    }

    const adminOverride = await query<{ score: number; rank: string }>(
      'SELECT score, rank FROM admin_score_overrides WHERE wallet_address = $1',
      [wallet]
    );

    if (adminOverride.length > 0) {
      const ranks = await this.getCachedRanks();
      const overrideScore = Number(adminOverride[0].score);
      const overrideRank = adminOverride[0].rank;
      const rank = ranks.find(r => r.name === overrideRank) || this.getRankForPoints(ranks, overrideScore);

      console.log(`[PointsServiceV2] Wallet ${wallet}: using admin override score=${overrideScore}, rank=${overrideRank}`);

      return {
        wallet_address: wallet,
        total_points: overrideScore,
        rank: rank ? { name: rank.name, color: rank.color, logo_url: rank.logo_url } : null,
        breakdown: { native: {}, platforms: {} },
        last_updated: new Date(),
      };
    }

    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    let totalPoints = 900;

    try {
      // Use the same endpoints as the dashboard
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

      // Aggressive per-endpoint timeout (3.5 s) so no single slow upstream
      // can delay the whole score beyond the ~4 s budget. The body is parsed
      // inside the same timeout window — parsing after Promise.all would let
      // the abort signal kill bodies whose headers arrived in time.
      // Tydro + Nado are allowed up to 30 s: their first-load fills walk
      // hundreds of txs, then serve from cache in milliseconds.
      // Bridge is in the same category: cold loads walk 3 Blockscout
      // histories + price unlisted tokens via DeFi Llama, easily >3.5 s.
      const FETCH_TIMEOUT = 3500;
      const BRIDGE_FETCH_TIMEOUT = 15000;
      // Copink proxies a third-party API measured at ~5s per call — a 3.5s
      // budget guarantees a timeout (and 0 copink points) on every cold load.
      const COPINK_FETCH_TIMEOUT = 10000;
      const SLOW_FETCH_TIMEOUT = 30000;
      // Cold-start retry: on a fresh server the score's self-fetch races the
      // dashboard's own ~27-request burst for the same endpoints. Aborting our
      // fetch does NOT cancel the route handler — it keeps computing and
      // populates responseCache/longCache when it finishes (bridge/volume also
      // share the dashboard's in-flight computation). So one backed-off retry
      // usually lands on a warm cache and returns real data instead of
      // scoring the metric 0 (the "works only after refresh" bug). Worst case
      // 3.5s + 2s + 15s ≈ 20.5s (bridge: 15s + 2s + 10s = 27s), still under
      // the dashboard's 30s score timeout. Endpoints already on 30s budgets
      // (tydro/nado) skip the retry to stay inside that budget.
      const RETRY_DELAY_MS = 2000;
      const RETRY_TIMEOUT_MS = 15000;
      // Retry timeout for endpoints that already burn ≥15s on attempt 1 —
      // cap it so attempt1 + delay + attempt2 stays under 30s.
      const LONG_RETRY_TIMEOUT_MS = 10000;
      const NO_RETRY_TIMEOUT_MS = SLOW_FETCH_TIMEOUT;
      const fetchJson = async <T>(url: string, timeout = FETCH_TIMEOUT): Promise<T | null> => {
        for (let attempt = 1; attempt <= 2; attempt++) {
          const isRetry = attempt === 2;
          if (isRetry && timeout >= NO_RETRY_TIMEOUT_MS) return null;
          const attemptTimeout = isRetry
            ? (timeout >= BRIDGE_FETCH_TIMEOUT ? LONG_RETRY_TIMEOUT_MS : RETRY_TIMEOUT_MS)
            : timeout;
          try {
            const response = await fetch(url, {
              signal: AbortSignal.timeout(attemptTimeout),
            });
            if (!response.ok) {
              // A handler that completed with an error won't fix itself —
              // only timeouts are worth retrying (the handler is still
              // computing and will cache its result).
              console.warn(`[Score] ${url} returned HTTP ${response.status}; treating as missing`);
              return null;
            }
            return await response.json() as T;
          } catch (err) {
            if (!isRetry && timeout < NO_RETRY_TIMEOUT_MS) {
              console.warn(`[Score] ${url} timed out after ${timeout}ms; retrying once in ${RETRY_DELAY_MS}ms (first attempt warms the route cache)`);
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
              continue;
            }
            console.warn(`[Score] fetch timed out/failed for ${url}:`, err);
            return null;
          }
        }
        return null;
      };

      // Resolve with a fallback if the promise is still pending after ms. The
      // original promise keeps running in the background, so service-level
      // caches (wallet stats, OpenSea counts) still get filled for next time.
      const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> => {
        let timer: NodeJS.Timeout | undefined;
        return Promise.race([
          promise.finally(() => clearTimeout(timer)),
          new Promise<T>((resolve) => {
            timer = setTimeout(() => {
              console.warn(`[Score] ${label} exceeded ${ms}ms, continuing with fallback`);
              resolve(fallback);
            }, ms);
          }),
        ]);
      };

      // Wallet stats come straight from the service (no HTTP self-fetch):
      // one hop less, and getAllStats has its own in-memory cache.
      // 15s budget: under a cold 27-request dashboard burst the shared
      // Blockscout throttle can delay even cheap calls — and residential-proxy
      // egress roughly doubles per-request RTT (discovery 1.3s → 2.5s) — so
      // cold first loads needed more than the old 10s. On a miss the score
      // still returns (partial, cache-clamped) instead of 500ing.
      const walletStatsPromise = withTimeout<WalletStatsResponse | null>(
        walletStatsService.getAllStats(wallet),
        15000,
        null,
        'wallet stats',
      );

      // Fetch OpenSea counts directly from the service (bypasses HTTP + responseCache).
      // The service layers memory (1h) + Postgres (24h) caches over the official
      // v2 REST API, so warm wallets resolve instantly. Cold wallets need a real
      // v2 fetch (~0.5s per 50-event page; the service's own budget caps it at
      // 20s), so this cap is deliberately higher than the 3.5s batch cap —
      // otherwise active wallets (e.g. 448 events ≈ 4.5s) lose their OpenSea
      // points on the first-ever request. Still bounded well under the 30s
      // upstream score timeout.
      const OPENSEA_SCORE_CAP_MS = 15000;
      const EMPTY_OPENSEA_COUNTS = { buys: 0, sales: 0, mints: 0, buyTransactions: [], saleTransactions: [], mintTransactions: [] };
      const openSeaCountsPromise = withTimeout(
        openSeaService.getAllCounts(wallet).catch((err: unknown) => {
          console.warn('[Score] OpenSea counts failed, treating as 0:', err);
          return EMPTY_OPENSEA_COUNTS;
        }),
        OPENSEA_SCORE_CAP_MS,
        EMPTY_OPENSEA_COUNTS,
        'OpenSea counts',
      );

      // Start the cheap DB lookups now so they overlap with the fetch batch
      // instead of running serially after it.
      const ranksPromise = this.getCachedRanks();
      const leaderboardFloorPromise = KNOWN_STALE_WALLETS.has(wallet)
        ? Promise.resolve(null)
        : this.getLeaderboardScoreFloor(wallet);

      // Every entry below is individually capped at 3.5 s, so the whole
      // batch resolves within the budget; missing endpoints score 0 points.
      const batchStart = Date.now();
      const [
        walletStats,
        bridgeData,
        swapData,
        tydroData,
        gmData,
        inkyPumpCreated,
        inkyPumpBuy,
        inkyPumpSell,
        shelliesRaffles,
        shelliesPayToPlay,
        shelliesStaking,
        znsData,
        nft2meData,
        nadoData,
        copinkData,
        templarsData,
        mintData,
        cowSwapData,
        sweepData,
        openSeaCounts
      ] = await Promise.all([
        walletStatsPromise,
        // Sprint 1: direct service call — no loopback HTTP. The service
        // shares the dashboard's in-flight computation and 5-min long cache.
        // 25s budget: cold bridge discovery measured ~22s; still under the
        // dashboard's 30s score timeout.
        withTimeout(
          getBridgeVolume(wallet).catch(() => null),
          25000,
          null,
          'bridge'
        ),
        // Sprint 1: direct service call — no loopback HTTP. The service
        // shares the dashboard's in-flight computation and 5-min long cache.
        // 20s budget (matches the old 3.5s + retry ladder worst case); still
        // under the dashboard's 30s score timeout.
        withTimeout(
          getSwapVolume(wallet).catch(() => null),
          20000,
          null,
          'swap'
        ),
        // Sprint 1: direct service call — no loopback HTTP. The service
        // shares the dashboard's in-flight computation and 5-min long cache.
        // 30s budget (matches the old SLOW_FETCH_TIMEOUT; multi-hundred-tx
        // pricing passes need it).
        withTimeout(
          getTydroData(wallet).catch(() => null),
          30000,
          null,
          'tydro'
        ),
        // Sprint 1: direct service calls — the score's last loopback
        // self-fetches removed. gm/inkypump/cowswap/sweep/opensea counts now
        // call their services directly (20s budget, matching the old 3.5s +
        // retry ladder worst case; still under the dashboard's 30s timeout).
        withTimeout(getGmCount(wallet).catch(() => null), 20000, null, 'gm'),
        withTimeout(getInkypumpCreatedTokens(wallet).catch(() => null), 20000, null, 'inkypump-created'),
        withTimeout(getInkypumpBuyVolume(wallet).catch(() => null), 20000, null, 'inkypump-buy'),
        withTimeout(getInkypumpSellVolume(wallet).catch(() => null), 20000, null, 'inkypump-sell'),
        withTimeout(getShelliesJoinedRaffles(wallet).catch(() => null), 20000, null, 'shellies-raffles'),
        withTimeout(getShelliesPayToPlay(wallet).catch(() => null), 20000, null, 'shellies-pay'),
        withTimeout(getShelliesStaking(wallet).catch(() => null), 20000, null, 'shellies-staking'),
        withTimeout(getZnsMetrics(wallet).catch(() => null), 20000, null, 'zns'),
        // Sprint 1: direct service call (counts via getProtocolCount, deduped
        // inside the count service itself). 20s budget like the old 3.5s +
        // retry ladder worst case.
        withTimeout(
          getNft2meData(wallet).catch(() => null),
          20000,
          null,
          'nft2me'
        ),
        fetchJson<NadoResponse>(`${baseUrl}/api/nado/${wallet}`, SLOW_FETCH_TIMEOUT),
        fetchJson<CopinkResponse>(`${baseUrl}/api/copink/${wallet}`, COPINK_FETCH_TIMEOUT),
        // Sprint 1: direct service call (viem balanceOf read).
        withTimeout(getTemplarsBalance(wallet).catch(() => null), 20000, null, 'templars'),
        withTimeout(getMintCount(wallet).catch(() => null), 20000, null, 'mints'),
        withTimeout(getCowswapSwaps(wallet).catch(() => null), 20000, null, 'cowswap'),
        // Sweep: the score reads the RAW shape (totalCollections/badges/streak)
        // — same sweepService both HTTP wrappers use.
        withTimeout(sweepService.getDeployedCollections(wallet).catch(() => null), 20000, null, 'sweep'),
        openSeaCountsPromise,
      ]);      console.log(`[Score] ${wallet.slice(0, 10)} fetch batch completed in ${Date.now() - batchStart}ms`);

      // Type definitions for API responses
      interface WalletStatsResponse {
        nftCollections?: Array<{ count?: number }>;
        tokenHoldings?: Array<{ address: string; symbol?: string; usdValue: number }>;
        balanceUsd?: number;
        ageDays?: number;
        totalTxns?: number;
      }
      interface BridgeResponse { bridgedInUsd?: number; bridgedInCount?: number; bridgedOutUsd?: number; bridgedOutCount?: number; }
      interface SwapResponse { totalUsd?: number; txCount?: number; }
      interface TydroResponse { currentSupplyUsd?: number; currentBorrowUsd?: number; depositCount?: number; borrowCount?: number; }
      interface CountResponse { total_count?: number; total_value?: string; }
      interface ZnsResponse {
        total_count?: number;
        deploy_count?: number;
        say_gm_count?: number;
        register_domain_count?: number;
      }
      interface Nft2meResponse { collectionsCreated?: number; nftsMinted?: number; totalTransactions?: number; }
      interface NadoResponse {
        totalDeposits?: number;
        totalTransactions?: number;
        nadoVolumeUSD?: number;
      }
      interface CopinkResponse {
        totalVolume?: number;
        subaccountsFound?: number;
      }
      interface TemplarsResponse {
        total_count?: number;
        value?: number;
      }
      interface OpenSeaResponse {
        total_count?: number;
        value?: number;
      }
      interface CowSwapResponse {
        total_count?: number;
        total_value?: string;
      }
      interface SweepResponse {
        totalCollections?: number;
        sweepBadgeBalance?: number;
        totalStreak?: number;
      }

      // Wallet stats walked Blockscout and missed the budget (cold burst +
      // proxy RTT). DON'T throw — all stats fields are already null-safe, so
      // compute the score with empty native metrics and flag it partial.
      // The stats walk keeps running in the background (withTimeout only
      // races it) and its service cache fills, so the NEXT load recomputes a
      // complete score: partial responses are cache-clamped to 30s.
      let statsPartial = false;
      if (!walletStats) {
        statsPartial = true;
        console.warn(`[Score] ${wallet.slice(0, 10)}: wallet stats unavailable after budget — scoring with empty native metrics (partial)`);
      }
      const stats = walletStats ?? {};

      // Calculate points using dashboard data
      const supportedNftCount = (stats.nftCollections || []).reduce((sum: number, col: { count?: number }) => sum + (col.count || 0), 0);
      const nftPoints = this.calculateNftCollectionsPoints(supportedNftCount);
      breakdown.native['nft_collections'] = { value: supportedNftCount, points: nftPoints };
      totalPoints += nftPoints;

      const tokenHoldings = stats.tokenHoldings || [];
      const nativeEthUsd = Number(stats.balanceUsd) || 0;

      const allHoldings = [
        ...tokenHoldings,
        { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', usdValue: nativeEthUsd }
      ];

      const tokenPoints = await this.calculateTokenHoldingsPoints(allHoldings);
      const totalTokenValue = allHoldings.reduce((sum: number, t: { usdValue?: number }) => sum + (Number(t.usdValue) || 0), 0);
      breakdown.native['erc20_tokens'] = { value: totalTokenValue, points: tokenPoints };
      totalPoints += tokenPoints;

      const memePoints = await this.calculateMemeCoinsPoints(tokenHoldings);
      const memeTokens = await this.getMemeTokenAddresses();
      const memeTokenCount = tokenHoldings.filter((t: { address: string }) => memeTokens.has(t.address.toLowerCase())).length;
      breakdown.native['meme_coins'] = { value: memeTokenCount, points: memePoints };
      totalPoints += memePoints;

      const agePoints = this.calculateWalletAgePoints(stats.ageDays || 0);
      breakdown.native['wallet_age'] = { value: stats.ageDays || 0, points: agePoints };
      totalPoints += agePoints;

      const txPoints = this.calculateTotalTxPoints(stats.totalTxns || 0);
      breakdown.native['total_tx'] = { value: stats.totalTxns || 0, points: txPoints };
      totalPoints += txPoints;

      const bridgeInUsd = bridgeData?.bridgedInUsd || 0;
      const bridgeOutUsd = bridgeData?.bridgedOutUsd || 0;
      const bridgeInPoints = this.calculateBridgeInPoints(bridgeInUsd);
      const bridgeOutPoints = this.calculateBridgeOutPoints(bridgeOutUsd);
      breakdown.platforms['bridge_in'] = { tx_count: bridgeData?.bridgedInCount || 0, usd_volume: bridgeInUsd, points: bridgeInPoints };
      breakdown.platforms['bridge_out'] = { tx_count: bridgeData?.bridgedOutCount || 0, usd_volume: bridgeOutUsd, points: bridgeOutPoints };
      totalPoints += bridgeInPoints + bridgeOutPoints;

      const gmCount = gmData?.total_count || 0;
      const gmPoints = this.calculateGmPoints(gmCount);
      breakdown.platforms['gm'] = { tx_count: gmCount, usd_volume: 0, points: gmPoints };
      totalPoints += gmPoints;

      const inkyPumpCreatedCount = inkyPumpCreated?.total_count || 0;
      const inkyPumpBuyUsd = parseFloat(inkyPumpBuy?.total_value || '0');
      const inkyPumpSellUsd = parseFloat(inkyPumpSell?.total_value || '0');
      const inkyPumpPoints = this.calculateInkyPumpPoints(inkyPumpCreatedCount, inkyPumpBuyUsd, inkyPumpSellUsd);
      const inkyPumpTotalUsd = inkyPumpBuyUsd + inkyPumpSellUsd;
      breakdown.platforms['inkypump'] = { tx_count: inkyPumpCreatedCount + (inkyPumpBuy?.total_count || 0) + (inkyPumpSell?.total_count || 0), usd_volume: inkyPumpTotalUsd, points: inkyPumpPoints };
      totalPoints += inkyPumpPoints;

      const tydroSupplyUsd = tydroData?.currentSupplyUsd || 0;
      const tydroBorrowUsd = tydroData?.currentBorrowUsd || 0;
      const tydroPoints = this.calculateTydroPoints(tydroSupplyUsd, tydroBorrowUsd);
      breakdown.platforms['tydro'] = { tx_count: (tydroData?.depositCount || 0) + (tydroData?.borrowCount || 0), usd_volume: tydroSupplyUsd + tydroBorrowUsd, points: tydroPoints };
      totalPoints += tydroPoints;

      const swapUsd = swapData?.totalUsd || 0;
      const swapPoints = this.calculateSwapVolumePoints(swapUsd);
      breakdown.platforms['swap'] = { tx_count: swapData?.txCount || 0, usd_volume: swapUsd, points: swapPoints };
      totalPoints += swapPoints;

      const shelliesPlayedCount = shelliesPayToPlay?.total_count || 0;
      const shelliesStakedCount = shelliesStaking?.total_count || 0;
      const shelliesRafflesCount = shelliesRaffles?.total_count || 0;
      const shelliesPoints = this.calculateShelliesPoints(shelliesPlayedCount, shelliesStakedCount, shelliesRafflesCount);
      breakdown.platforms['shellies'] = { tx_count: shelliesPlayedCount + shelliesStakedCount + shelliesRafflesCount, usd_volume: 0, points: shelliesPoints };
      totalPoints += shelliesPoints;

      const znsDeployCount = znsData?.deploy_count || 0;
      const znsSaidGmCount = znsData?.say_gm_count || 0;
      const znsRegisterCount = znsData?.register_domain_count || 0;
      const znsPoints = this.calculateZnsPoints(znsDeployCount, znsSaidGmCount, znsRegisterCount);
      breakdown.platforms['zns'] = { tx_count: znsData?.total_count || 0, usd_volume: 0, points: znsPoints };
      totalPoints += znsPoints;

      const nft2meCollectionsCount = nft2meData?.collectionsCreated || 0;
      const nft2meMintedCount = nft2meData?.nftsMinted || 0;
      const nft2mePoints = this.calculateNft2mePoints(nft2meCollectionsCount, nft2meMintedCount);
      breakdown.platforms['nft2me'] = { tx_count: nft2meData?.totalTransactions || 0, usd_volume: 0, points: nft2mePoints };
      totalPoints += nft2mePoints;

      // Nado points
      const nadoTotalDeposits = nadoData?.totalDeposits || 0;
      const nadoTotalVolume = nadoData?.nadoVolumeUSD || 0;
      const nadoPoints = this.calculateNadoPoints(nadoTotalDeposits, nadoTotalVolume);
      breakdown.platforms['nado'] = { tx_count: nadoData?.totalTransactions || 0, usd_volume: nadoTotalVolume, points: nadoPoints };
      totalPoints += nadoPoints;

      // Copink points
      const copinkSubaccounts = copinkData?.subaccountsFound || 0;
      const copinkVolume = copinkData?.totalVolume || 0;
      const copinkPoints = this.calculateCopinkPoints(copinkSubaccounts, copinkVolume);
      breakdown.platforms['copink'] = { tx_count: copinkSubaccounts, usd_volume: copinkVolume, points: copinkPoints };
      totalPoints += copinkPoints;

      // Templars of the Storm NFT points
      const templarsBalance = templarsData?.value || 0;
      const templarsPoints = this.calculateTemplarsPoints(templarsBalance);
      breakdown.platforms['templars'] = { tx_count: templarsBalance, usd_volume: 0, points: templarsPoints };
      totalPoints += templarsPoints;

      // OpenSea NFT Activity points (buys/sales from direct service call, mints from DB)
      const openseaBuyCount = openSeaCounts.buys;
      const openseaSellCount = openSeaCounts.sales;
      const mintCount = mintData?.total_count || 0;
      const openSeaPoints = this.calculateOpenSeaPoints(openseaBuyCount, openseaSellCount, mintCount);
      const totalOpenSeaTxs = openseaBuyCount + openseaSellCount + mintCount;
      breakdown.platforms['opensea'] = { tx_count: totalOpenSeaTxs, usd_volume: 0, points: openSeaPoints };
      totalPoints += openSeaPoints;
      console.log(`[Score] ${wallet.slice(0, 10)} OpenSea: buys=${openseaBuyCount} sales=${openseaSellCount} mints=${mintCount} → ${openSeaPoints}pts`);

      // Cow Swap points
      const cowSwapVolumeUsd = parseFloat(cowSwapData?.total_value || '0');
      const cowSwapCount = cowSwapData?.total_count || 0;
      const cowSwapPoints = this.calculateCowSwapPoints(cowSwapVolumeUsd);
      breakdown.platforms['cowswap'] = { tx_count: cowSwapCount, usd_volume: cowSwapVolumeUsd, points: cowSwapPoints };
      totalPoints += cowSwapPoints;

      // Sweep Platform points
      const sweepCollections = sweepData?.totalCollections || 0;
      const sweepBadges = sweepData?.sweepBadgeBalance || 0;
      const sweepStreak = sweepData?.totalStreak || 0;
      const sweepPoints = this.calculateSweepPoints(sweepCollections, sweepBadges, sweepStreak);
      const totalSweepActivity = sweepCollections + sweepBadges + sweepStreak;
      breakdown.platforms['sweep'] = { tx_count: totalSweepActivity, usd_volume: 0, points: sweepPoints };
      totalPoints += sweepPoints;

      // Verification logs - check formula correctness


      // ADDITIONAL 1000-POINT BONUS — excluded from the top 10 leaderboard wallets
      const top10 = await this.getTop10LeaderboardWallets();
      if (!top10.has(wallet)) {
        totalPoints += 2000;
        breakdown.platforms['bonus_1000'] = { tx_count: 0, usd_volume: 0, points: 2000 };
      }

      // TEMPORARY: floor total_points to the wallet's stored leaderboard score
      // when the realtime computation comes back lower. Some third-party
      // platforms are reporting degraded data and pushing scores down; remove
      // this clamp once the upstream source is fixed.
      if (!KNOWN_STALE_WALLETS.has(wallet)) {
        const leaderboardFloor = await leaderboardFloorPromise;
        if (leaderboardFloor !== null && totalPoints < leaderboardFloor) {
          console.log(
            `[PointsServiceV2] Wallet ${wallet}: clamped ${totalPoints} -> ${leaderboardFloor} (leaderboard floor)`
          );
          totalPoints = leaderboardFloor;
        }
      } else {
        console.log(
          `[PointsServiceV2] Wallet ${wallet}: skipped stale leaderboard floor clamp, using real-time score ${totalPoints}`
        );
      }

      const ranks = await ranksPromise;
      const rank = this.getRankForPoints(ranks, totalPoints);

      return {
        wallet_address: wallet,
        total_points: totalPoints,
        rank: rank ? { name: rank.name, color: rank.color, logo_url: rank.logo_url } : null,
        breakdown,
        last_updated: new Date(),
        ...(statsPartial ? { partial: true } : {}),
      };
    } catch (error) {
      console.error('Error calculating wallet score:', error);
      throw error;
    }
  }
}

export const pointsServiceV2 = new PointsServiceV2();
