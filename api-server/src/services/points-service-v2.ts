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
  getZenithNft,
  getZenithStaking,
  getInkBrokersMetrics,
} from './analytics-counts-service';
import { getGoneFishinData } from './gonefishin-service';
import { getSentryData } from './sentry-service';
import { getHypercallData } from './hypercall-service';
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
import { getNadoMetrics } from './nado-service';
import { getCopinkMetrics } from './copink-service';
import { getFreshScoreSnapshot, getStaleScoreSnapshot, saveScoreSnapshot } from './metrics-snapshot-service';
import { responseCache } from '../cache';

// TEMPORARY: wallets whose stored leaderboard score is known to be stale;
// skip the floor clamp for them and trust the realtime score.
const KNOWN_STALE_WALLETS = new Set([
  '0x4c50254dafd191bba2a6e0517c1742caf1426df5',
]);

// Sprint 2: the raw metric inputs the score consumes, hoisted verbatim from
// the old function-scoped interfaces (they were declared inside
// calculateWalletScore after the fetch batch). These define the shape of
// wallet_metrics_snapshots.inputs — the snapshot stores EXACTLY this object,
// and computeScoreFromInputs() consumes either the live gather or the
// deserialized snapshot with zero code differences.
export interface ScoreWalletStats {
  nftCollections?: Array<{ count?: number }>;
  tokenHoldings?: Array<{ address: string; symbol?: string; usdValue: number }>;
  balanceUsd?: number;
  ageDays?: number;
  totalTxns?: number;
}
export interface BridgeResponse { bridgedInUsd?: number; bridgedInCount?: number; bridgedOutUsd?: number; bridgedOutCount?: number; }
export interface SwapResponse { totalUsd?: number; txCount?: number; }
export interface TydroResponse { currentSupplyUsd?: number; currentBorrowUsd?: number; depositCount?: number; borrowCount?: number; }
export interface CountResponse { total_count?: number; total_value?: string; }
export interface ZnsResponse {
  total_count?: number;
  deploy_count?: number;
  say_gm_count?: number;
  register_domain_count?: number;
}
export interface Nft2meResponse { collectionsCreated?: number; nftsMinted?: number; totalTransactions?: number; }
export interface NadoResponse {
  totalDeposits?: number;
  totalTransactions?: number;
  nadoVolumeUSD?: number;
}
export interface CopinkResponse {
  totalVolume?: number;
  subaccountsFound?: number;
}
export interface TemplarsResponse {
  total_count?: number;
  value?: number;
}
export interface OpenSeaResponse {
  total_count?: number;
  value?: number;
}
export interface CowSwapResponse {
  total_count?: number;
  total_value?: string;
}
export interface SweepResponse {
  totalCollections?: number;
  sweepBadgeBalance?: number;
  totalStreak?: number;
}
export interface OpenSeaCounts {
  buys: number;
  sales: number;
  mints: number;
  buyTransactions: unknown[];
  saleTransactions: unknown[];
  mintTransactions: unknown[];
}
// InkScore Zenith ERC721 holdings (minimal shape the score needs; the full
// interface lives in analytics-counts-service).
export interface ZenithNftResponse { total_count?: number; }
// InkScore Zenith staking positions (blockchain reads via the staking contract).
export interface ZenithStakingResponse { total_count?: number; total_staked?: number; }
// Gone Fishin game purchases (buy txs to the game contract, rounds + packs).
export interface GoneFishinScoreResponse { gamesBought?: number; totalSpentUsd?: number; prizesWonCount?: number; prizesWonUsd?: number; }
// Sentry swaps through SentryInkRouterV4.
export interface SentryScoreResponse { swapCount?: number; volumeUsd?: number; }
// Hypercall Earn zaps + positions (USDG ≈ $1 exact USD volume).
export interface HypercallScoreResponse { swapCount?: number; usdgSpent?: number; }
// Ink Brokers desk activity + FloorRouterV2 swap volume.
export interface InkBrokersResponse { swap_count?: number; swap_volume_usd?: number; }

export interface ScoreInputs {
  walletStats: ScoreWalletStats | null;
  bridgeData: BridgeResponse | null;
  swapData: SwapResponse | null;
  tydroData: TydroResponse | null;
  gmData: CountResponse | null;
  inkyPumpCreated: CountResponse | null;
  inkyPumpBuy: CountResponse | null;
  inkyPumpSell: CountResponse | null;
  shelliesRaffles: CountResponse | null;
  shelliesPayToPlay: CountResponse | null;
  shelliesStaking: CountResponse | null;
  znsData: ZnsResponse | null;
  nft2meData: Nft2meResponse | null;
  nadoData: NadoResponse | null;
  copinkData: CopinkResponse | null;
  templarsData: TemplarsResponse | null;
  mintData: OpenSeaResponse | null;
  cowSwapData: CowSwapResponse | null;
  sweepData: SweepResponse | null;
  openSeaCounts: OpenSeaCounts;
  // InkScore Zenith NFT holdings + staking positions (blockchain reads).
  zenithNftData: ZenithNftResponse | null;
  zenithStakingData: ZenithStakingResponse | null;
  // Gone Fishin game purchases.
  gonefishinData: GoneFishinScoreResponse | null;
  // Swap-venue platforms scored on USD swap volume tiers.
  sentryData: SentryScoreResponse | null;
  hypercallData: HypercallScoreResponse | null;
  // Ink Brokers desk activity + FloorRouterV2 swap volume.
  inkBrokersData?: InkBrokersResponse | null;
}

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

// Admin-controlled signup bonus (app_settings.signup_bonus_points, managed at
// /admin/points). Short TTL so admin changes land within ~a minute without a
// DB hit per score computation.
let signupBonusCache: { points: number; timestamp: number } | null = null;
const SIGNUP_BONUS_CACHE_TTL = 60 * 1000;

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
        ORDER BY display_order NULLS LAST, min_points ASC
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

  /**
   * Admin-controlled signup bonus (app_settings.signup_bonus_points).
   * Added to every wallet's total as its own breakdown entry so the dashboard
   * bars keep reconciling with the headline number. 0 = disabled (default).
   * A DB failure degrades to 0 rather than breaking scoring.
   */
  private async getSignupBonusPoints(): Promise<number> {
    if (signupBonusCache && Date.now() - signupBonusCache.timestamp < SIGNUP_BONUS_CACHE_TTL) {
      return signupBonusCache.points;
    }

    try {
      const rows = await query<{ value: { points?: number } | null }>(
        `SELECT value FROM app_settings WHERE key = 'signup_bonus_points' LIMIT 1`
      );
      const raw = rows[0]?.value;
      const parsed = raw ? Number(raw.points) : NaN;
      const points = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
      signupBonusCache = { points, timestamp: Date.now() };
      return points;
    } catch (error) {
      console.error('[PointsServiceV2] Failed to read signup bonus setting:', error);
      return 0;
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

  private calculateZenithNftPoints(heldCount: number): number {
    // InkScore Zenith NFT holdings (Max: 5,000 points)
    if (heldCount > 8) return 5000;  // Tier 3: 9+ held
    if (heldCount >= 2) return 2500; // Tier 2: 2-8 held
    if (heldCount >= 1) return 1000; // Tier 1: 1 held
    return 0;
  }

  private calculateZenithStakingPoints(stakedCount: number): number {
    // InkScore Zenith staking positions (Max: 6,000 points)
    if (stakedCount > 8) return 6000;  // Tier 3: 9+ staked
    if (stakedCount >= 2) return 4000; // Tier 2: 2-8 staked
    if (stakedCount >= 1) return 2000; // Tier 1: 1 staked
    return 0;
  }

  private calculateSwapVenueTierPoints(swapVolumeUsd: number): number {
    // Shared USD swap-volume tier for Hypercall Earn, Sentry and Ink Brokers
    // (Max: 5,000 points each)
    if (swapVolumeUsd > 1000) return 5000; // Tier 3: > $1k volume
    if (swapVolumeUsd > 100) return 2500;  // Tier 2: $100 - $1k volume
    if (swapVolumeUsd >= 1) return 1000;   // Tier 1: $1 - $100 volume
    return 0;
  }

  private calculateGoneFishinPoints(gamesBought: number): number {
    // Gone Fishin game purchases (Max: 1,500 points — 500 per game, capped at 3)
    const games = Math.min(Math.floor(gamesBought) || 0, 3);
    return games * 500;
  }

  async calculateWalletScore(
    walletAddress: string,
    opts?: { skipSnapshot?: boolean }
  ): Promise<WalletScoreResponse> {
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

    // Sprint 2: the score is now a pure function of its metric inputs.
    // gatherScoreInputs() is the EXACT batch the score always fetched
    // (same services, budgets, fallbacks); computeScoreFromInputs() is the
    // EXACT point math, verbatim. A metrics snapshot can therefore never
    // alter a score — it can only source the same inputs the live gather
    // would produce, and only when fresher than SNAPSHOT_MAX_AGE_MS (the
    // responseCache TTL the score already served under).
    if (!opts?.skipSnapshot) {
      const snap = await getFreshScoreSnapshot(wallet).catch((err: unknown) => {
        console.warn(`[PointsServiceV2] Wallet ${wallet}: snapshot read failed, computing live:`, err);
        return null;
      });
      if (snap && !snap.partial) {
        console.log(`[PointsServiceV2] Wallet ${wallet.slice(0, 10)}: serving score from metrics snapshot (captured ${snap.capturedAt.toISOString()})`);
        return this.computeScoreFromInputs(wallet, snap.inputs);
      }

      // Stale-while-revalidate: no fresh snapshot, but a complete older one
      // exists — serve it INSTANTLY (the dashboard's score card otherwise
      // stares at a skeleton for the full 10-30s cold gather) and refresh
      // in the background. The background pass overwrites the responseCache
      // entry, so the next poll/load gets the fresh value.
      const stale = await getStaleScoreSnapshot(wallet).catch((err: unknown) => {
        console.warn(`[PointsServiceV2] Wallet ${wallet}: stale snapshot read failed, computing live:`, err);
        return null;
      });
      if (stale && !stale.partial) {
        const ageSec = Math.round((Date.now() - stale.capturedAt.getTime()) / 1000);
        console.log(`[PointsServiceV2] Wallet ${wallet.slice(0, 10)}: serving STALE score from snapshot (${ageSec}s old), refreshing in background`);
        void this.refreshScoreInBackground(wallet);
        return this.computeScoreFromInputs(wallet, stale.inputs);
      }
    }

    const inputs = await this.gatherScoreInputs(wallet);
    const result = await this.computeScoreFromInputs(wallet, inputs);

    // Persist the raw inputs for the next load / after a restart
    // (fire-and-forget: a snapshot failure must never affect the response).
    // Partials are stored for audit but marked so they are NEVER served —
    // the live path already clamps partials to a 30s cache and recomputes.
    void saveScoreSnapshot(wallet, inputs, inputs.walletStats === null).catch(
      (err: unknown) => {
        console.warn(`[PointsServiceV2] Wallet ${wallet.slice(0, 10)}: snapshot save failed:`, err);
      }
    );

    return result;
  }

  // One background refresh per wallet at a time — repeated stale serves while
  // a refresh is already running must not stampede the upstreams.
  private refreshingScores = new Set<string>();

  /**
   * Stale-while-revalidate refresh: live gather → recompute → persist the
   * snapshot → overwrite the responseCache entry the stale serve just
   * populated. Fire-and-forget by design; every failure is logged and
   * swallowed (the next stale serve retries).
   */
  private async refreshScoreInBackground(wallet: string): Promise<void> {
    if (this.refreshingScores.has(wallet)) return;
    this.refreshingScores.add(wallet);
    const start = Date.now();
    try {
      const inputs = await this.gatherScoreInputs(wallet);
      const result = await this.computeScoreFromInputs(wallet, inputs);
      await saveScoreSnapshot(wallet, inputs, inputs.walletStats === null);
      responseCache.set(`wallet:score:${wallet}`, result);
      console.log(
        `[PointsServiceV2] Wallet ${wallet.slice(0, 10)}: background refresh complete in ${Date.now() - start}ms → ${result.total_points} pts`
      );
    } catch (err) {
      console.warn(`[PointsServiceV2] Wallet ${wallet.slice(0, 10)}: background refresh failed:`, err);
    } finally {
      this.refreshingScores.delete(wallet);
    }
  }

  /**
   * Gather the raw metric inputs the score consumes. Verbatim move of the
   * old fetch batch: same services, same budgets, same null fallbacks.
   */
  async gatherScoreInputs(wallet: string): Promise<ScoreInputs> {

      // Sprint 2 note: the old per-endpoint 3.5s fetch/retry ladder
      // (fetchJson + RETRY_* + BRIDGE_FETCH_TIMEOUT) was removed here — the
      // score has zero loopback HTTP since the Sprint-1 direct-call wiring,
      // so nothing referenced it anymore. The two budgets still used by the
      // batch below are kept verbatim:
      // Copink proxies a third-party API measured at ~5s per call — a 3.5s
      // budget guarantees a timeout (and 0 copink points) on every cold load.
      const COPINK_FETCH_TIMEOUT = 10000;
      const SLOW_FETCH_TIMEOUT = 30000;

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
      const walletStatsPromise = withTimeout<ScoreWalletStats | null>(
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
        openSeaCounts,
        zenithNftData,
        zenithStakingData,
        gonefishinData,
        sentryData,
        hypercallData,
        inkBrokersData
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
        // self-fetches removed. gm/cowswap/sweep/opensea counts use a 20s
        // budget (matching the old 3.5s + retry ladder worst case); still
        // under the dashboard's 30s timeout.
        withTimeout(getGmCount(wallet).catch(() => null), 20000, null, 'gm'),
        withTimeout(getInkypumpCreatedTokens(wallet).catch(() => null), 20000, null, 'inkypump-created'),
        // Inkypump buy/sell: 30s budget, matching tydro — these do the same
        // class of work (tx-hash partitioning + a multi-hundred-tx pricing
        // pass). At 20s the score could zero inkypump under a cold ~24-request
        // dashboard burst even though the data existed (observed as a
        // 50-point flake in the parity harness; the 20s value was a holdover
        // from the loopback 3.5s+retry era).
        withTimeout(getInkypumpBuyVolume(wallet).catch(() => null), 30000, null, 'inkypump-buy'),
        withTimeout(getInkypumpSellVolume(wallet).catch(() => null), 30000, null, 'inkypump-sell'),
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
        // Sprint 1: direct service calls — the score's LAST loopback
        // self-fetches are gone. Budgets match the old fetch timeouts.
        withTimeout(getNadoMetrics(wallet).catch(() => null), SLOW_FETCH_TIMEOUT, null, 'nado'),
        withTimeout(getCopinkMetrics(wallet).catch(() => null), COPINK_FETCH_TIMEOUT, null, 'copink'),
        // Sprint 1: direct service call (viem balanceOf read).
        withTimeout(getTemplarsBalance(wallet).catch(() => null), 20000, null, 'templars'),
        withTimeout(getMintCount(wallet).catch(() => null), 20000, null, 'mints'),
        withTimeout(getCowswapSwaps(wallet).catch(() => null), 20000, null, 'cowswap'),
        // Sweep: the score reads the RAW shape (totalCollections/badges/streak)
        // — same sweepService both HTTP wrappers use.
        withTimeout(sweepService.getDeployedCollections(wallet).catch(() => null), 20000, null, 'sweep'),
        openSeaCountsPromise,
        // InkScore Zenith NFT holdings + staking positions (viem blockchain
        // reads with their own long caches; 20s budget like the other counts).
        withTimeout(getZenithNft(wallet).catch(() => null), 20000, null, 'zenith-nft'),
        withTimeout(getZenithStaking(wallet).catch(() => null), 20000, null, 'zenith-staking'),
        // Gone Fishin game purchases (Blockscout walk, own long cache).
        withTimeout(getGoneFishinData(wallet).catch(() => null), 20000, null, 'gonefishin'),
        // Swap-venue platforms (each service layers its own long cache).
        withTimeout(getSentryData(wallet).catch(() => null), 20000, null, 'sentry'),
        withTimeout(getHypercallData(wallet).catch(() => null), 20000, null, 'hypercall'),
        withTimeout(getInkBrokersMetrics(wallet).catch(() => null), 20000, null, 'ink-brokers'),
      ]);

      console.log(`[Score] ${wallet.slice(0, 10)} fetch batch completed in ${Date.now() - batchStart}ms`);

      return {
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
        openSeaCounts,
        zenithNftData,
        zenithStakingData,
        gonefishinData,
        sentryData,
        hypercallData,
        inkBrokersData,
      };
  }

  /**
   * Compute the score from gathered inputs — the exact point math, verbatim.
   * Pure with respect to its inputs: the only additional reads are scoring
   * reference data (ranks, leaderboard floor, top-10 set, meme-token list),
   * identical whether the inputs came from a live gather or a metrics
   * snapshot. This is the function Sprint 2's snapshot path reuses.
   */
  async computeScoreFromInputs(wallet: string, inputs: ScoreInputs): Promise<WalletScoreResponse> {
    const {
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
      openSeaCounts,
      zenithNftData,
      zenithStakingData,
      gonefishinData,
      sentryData,
      hypercallData,
      inkBrokersData
    } = inputs;

    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    // Total = the exact sum of the platform + native points below, plus the
    // admin-controlled signup bonus (0 = disabled, so usually a pure sum).
    // The dashboard's bars must always reconcile with the headline number.
    let totalPoints = 0;

    // Scoring reference data (DB reads, not wallet metrics): start them
    // immediately so they overlap with each other.
    const ranksPromise = this.getCachedRanks();

    try {

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

      // InkScore Zenith NFT holdings points
      const zenithNftCount = zenithNftData?.total_count || 0;
      const zenithNftPoints = this.calculateZenithNftPoints(zenithNftCount);
      breakdown.platforms['zenith_nft'] = { tx_count: zenithNftCount, usd_volume: 0, points: zenithNftPoints };
      totalPoints += zenithNftPoints;

      // InkScore Zenith staking points
      const zenithStakedCount = zenithStakingData?.total_count || 0;
      const zenithStakingPoints = this.calculateZenithStakingPoints(zenithStakedCount);
      breakdown.platforms['zenith_staking'] = { tx_count: zenithStakedCount, usd_volume: 0, points: zenithStakingPoints };
      totalPoints += zenithStakingPoints;

      // Hypercall Earn swap-volume points
      const hypercallVolumeUsd = hypercallData?.usdgSpent || 0;
      const hypercallPoints = this.calculateSwapVenueTierPoints(hypercallVolumeUsd);
      breakdown.platforms['hypercall'] = { tx_count: hypercallData?.swapCount || 0, usd_volume: hypercallVolumeUsd, points: hypercallPoints };
      totalPoints += hypercallPoints;

      // Sentry swap-volume points
      const sentryVolumeUsd = sentryData?.volumeUsd || 0;
      const sentryPoints = this.calculateSwapVenueTierPoints(sentryVolumeUsd);
      breakdown.platforms['sentry'] = { tx_count: sentryData?.swapCount || 0, usd_volume: sentryVolumeUsd, points: sentryPoints };
      totalPoints += sentryPoints;

      // Ink Brokers swap-volume points (FloorRouterV2 swaps)
      const inkBrokersVolumeUsd = inkBrokersData?.swap_volume_usd || 0;
      const inkBrokersPoints = this.calculateSwapVenueTierPoints(inkBrokersVolumeUsd);
      breakdown.platforms['ink_brokers'] = { tx_count: inkBrokersData?.swap_count || 0, usd_volume: inkBrokersVolumeUsd, points: inkBrokersPoints };
      totalPoints += inkBrokersPoints;

      // Gone Fishin game-purchase points (500 per game, max 3 games)
      const gonefishinGames = gonefishinData?.gamesBought || 0;
      const gonefishinPoints = this.calculateGoneFishinPoints(gonefishinGames);
      breakdown.platforms['gonefishin'] = { tx_count: gonefishinGames, usd_volume: 0, points: gonefishinPoints };
      totalPoints += gonefishinPoints;

      // Verification logs - check formula correctness


      // Admin-controlled signup bonus (managed at /admin/points, default 0).
      // Its own breakdown entry keeps the bars summing to the headline.
      const signupBonus = await this.getSignupBonusPoints();
      if (signupBonus > 0) {
        breakdown.platforms['bonus'] = { tx_count: 0, usd_volume: 0, points: signupBonus };
        totalPoints += signupBonus;
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
