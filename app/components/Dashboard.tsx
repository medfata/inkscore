"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip
} from 'recharts';
import { Sparkles, ShieldCheck, Activity, Wallet, Award, Clock, Image, ExternalLink, Coins, Sun, Landmark, Zap, ArrowLeftRight, RefreshCw, TrendingUp } from './Icons';
import { ScoreData, WalletStats, ScoreTier, AiAnalysisResult, NftHolding, TokenHolding } from '../types';
import { Logo } from './Logo';
import { HoldingsSection } from './HoldingsSection';
import { WalletScoreResponse } from '../../lib/types/platforms';
import { DashboardCardData } from '../../lib/types/dashboard';
import { DynamicCardsCarouselRow3, DynamicCardsCarouselRow4 } from './DynamicDashboardCards';
import { MintScoreNFT } from './MintScoreNFT';
import { getProxiedImageUrl } from '@/lib/utils/imageProxy';
import { useStreamingDashboard } from '../hooks/useStreamingDashboard';
import { useCryptoClashAuth } from '../hooks/useCryptoClashAuth';
import { StreamingDebugPanel } from './StreamingDebugPanel';

// Bridge platform logos and URLs
const BRIDGE_PLATFORMS: Record<string, { logo: string; url: string }> = {
  'Native Bridge (USDT0)': {
    logo: 'https://pbs.twimg.com/profile_images/2013321478834409473/eD-oLIDE_400x400.jpg',
    url: 'https://usdt0.to',
  },
  'Ink Official': {
    logo: 'https://inkonchain.com/favicon.ico',
    url: 'https://inkonchain.com/bridge',
  },
  'Relay': {
    logo: 'https://relay.link/favicon.ico',
    url: 'https://relay.link',
  },
  'Bungee': {
    logo: 'https://www.bungee.exchange/favicon.ico',
    url: 'https://www.bungee.exchange',
  },
};

// DEX platform logos and info (keyed by lowercase contract address)
const DEX_PLATFORMS: Record<string, { name: string; logo: string; url: string }> = {
  '0x9b17690de96fcfa80a3acaefe11d936629cd7a77': {
    name: 'DyorSwap',
    logo: 'https://dyorswap.finance/favicon.ico',
    url: 'https://dyorswap.finance',
  },
  '0x551134e92e537ceaa217c2ef63210af3ce96a065': {
    name: 'InkySwap',
    logo: 'https://inkyswap.com/logo-mobile.svg',
    url: 'https://inkyswap.com',
  },
  '0x01d40099fcd87c018969b0e8d4ab1633fb34763c': {
    name: 'Velodrome',
    logo: 'https://velodrome.finance/images/VELO/favicon.ico',
    url: 'https://velodrome.finance',
  },
  '0xd7e72f3615aa65b92a4dbdc211e296a35512988b': {
    name: 'Curve',
    logo: 'https://cdn.jsdelivr.net/gh/curvefi/curve-assets/branding/logo.png',
    url: 'https://curve.fi',
  },
};

// DEX name overrides and platform URLs
const DEX_NAME_OVERRIDES: Record<string, string> = {
  'Unknown DEX': 'Curve',
  'Velodrome UniversalRouter': 'Velodrome',
  'DyorRouterV2': 'DyorSwap',
};

// Platform URLs for single-logo cards
const PLATFORM_URLS: Record<string, string> = {
  'tydro': 'https://app.tydro.com',
  'nado': 'https://app.nado.xyz',
  'gm': 'https://gm.inkonchain.com',
  'inkypump': 'https://www.inkypump.com',
  'zns': 'https://zns.bio',
  'otomate': 'https://www.otomate.trade/',
  'cryptoclash': 'https://www.cryptoclash.ink/',
  'nft2me': 'https://nft2me.com',
  'shellies': 'https://shellies.xyz',
  'opensea': 'https://opensea.io',
  'templars': 'https://opensea.io/collection/templars-of-the-storm',
  'cowswap': 'https://swap.cow.fi',
  'sweep': 'https://sweep.haus',
  'zenithNft': 'https://explorer.inkonchain.com/token/0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78',
  'zenithOpensea': 'https://opensea.io/collection/inkscore-zenith',
  'zenithStaking': 'https://inkscore.xyz/staking',
};

// Bridge volume response type
interface BridgeVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  bridgedInUsd?: number;
  bridgedInCount?: number;
  bridgedOutUsd?: number;
  bridgedOutCount?: number;
  byPlatform: Array<{
    platform: string;
    subPlatform?: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
    logo?: string;
    url?: string;
    bridgedInUsd?: number;
    bridgedInCount?: number;
    bridgedOutUsd?: number;
    bridgedOutCount?: number;
  }>;
}

// InkySwap volume response type
interface InkySwapVolumeData {
  totalValue: number;
  totalCount: number;
}

// Swap volume response type (for DyorSwap and other DEXes)
interface SwapVolumeResponse {
  totalUsd: number;
  txCount: number;
  byPlatform: Array<{
    platform: string;
    contractAddress: string;
    usdValue: number;
    txCount: number;
  }>;
}

// Total Volume response type
interface TotalVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  incoming: {
    eth: number;
    usd: number;
    count: number;
  };
  outgoing: {
    eth: number;
    usd: number;
    count: number;
  };
}

// ZNS metrics response type
interface ZnsMetricsResponse {
  total_count: number;
  deploy_count: number;
  say_gm_count: number;
  register_domain_count: number;
}

// NFT2Me metrics response type
interface Nft2MeResponse {
  collectionsCreated: number;
  nftsMinted: number;
  totalTransactions: number;
}

// Copink metrics response type
interface CopinkMetrics {
  totalVolume: number;
  subaccountsFound: number;
}

interface CryptoClashMetrics {
  clashTickets: number;
  lpTickets: number;
  points: number;
  totalBattles: number;
  isPatron: boolean;
  requiresAuth?: boolean;
}

// Nado metrics response type
interface NadoMetrics {
  totalDeposits: number;
  totalTransactions: number;
  nadoVolumeUSD: number; // Calculated volume from Nado API - this is the main volume to display
  dbTotalVolume?: number; // Database volume (kept for reference/fallback)
  tokenBreakdown?: Array<{
    tokenAddress: string;
    symbol: string;
    name: string;
    depositAmount: number;
    rawAmount: number;
  }>;
}

// Sweep metrics response type
interface SweepMetrics {
  totalCollections?: number;
  sweepBadgeBalance?: number;
  totalStreak?: number;
  total_count?: number;
  sub_aggregates?: Array<{ label: string; value: string }>;
}

// InkScore Zenith metrics response types
interface ZenithNftMetrics {
  total_count: number;
}

interface ZenithStakingMetrics {
  total_staked: number;
  one_month_count: number;
  one_week_count: number;
  one_day_count: number;
}

interface DashboardProps {
  walletAddress: string;
  isDemo?: boolean;
  isAdmin?: boolean;
}

const SUPPORTED_COLLECTIONS = [
  { name: 'Shellies', address: '0x1c9838cdc00fa39d953a54c755b95605ed5ea49c', points: 100, twitterHandle: 'ShelliesNFT' },
  { name: 'InkySquad', address: '0xE4e5D5170Ba5cae36D1876893D4b218E8Ed19C91', points: 100, twitterHandle: 'InkySquad' },
  { name: 'INK Bunnies', address: '0x4443970B315d3c08C2f962fe00770c52396AFDb7', points: 100, twitterHandle: 'InkBunnies' },
];

const SUPPORTED_TOKENS = [
  { name: 'Global Dollar', symbol: 'USDT0', address: '0x0200C29006150606B650577BBE7B6248F58470c1' },
  { name: 'USD Coin', symbol: 'USDC', address: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D' },
  { name: 'Ethereum', symbol: 'ETH', address: '0x4200000000000000000000000000000000000006' },
  { name: 'ANITA', symbol: 'ANITA', address: '0x0606FC632ee812bA970af72F8489baAa443C4B98' },
  { name: 'Cat on Ink', symbol: 'CAT', address: '0x20C69C12abf2B6F8D8ca33604DD25C700c7e70A5' },
];

const GM_CONTRACT_ADDRESS = '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F';

const calculateTokenPoints = (usdValue: number): number => {
  if (usdValue >= 500) return 500;
  if (usdValue >= 100) return 250;
  if (usdValue >= 1) return 100;
  return 0;
};

const generateMockData = (address: string): { stats: WalletStats, score: ScoreData } => {
  const seed = address.length + address.charCodeAt(address.length - 1);

  const nftHoldings: NftHolding[] = SUPPORTED_COLLECTIONS.map((col, index) => {
    const count = (seed + index) % 4;
    return {
      name: col.name,
      contractAddress: col.address,
      pointsPerItem: col.points,
      count: count,
      totalPoints: count * col.points,
      twitterHandle: col.twitterHandle
    };
  });

  const nftTotalScore = nftHoldings.reduce((acc, curr) => acc + curr.totalPoints, 0);
  const totalNftCount = nftHoldings.reduce((acc, curr) => acc + curr.count, 0) + (seed % 5);

  const tokenHoldings: TokenHolding[] = SUPPORTED_TOKENS.map((token, index) => {
    const baseValue = (seed * (index + 1) * 123) % 1000;
    const isZero = baseValue < 100 && index > 2;
    const usdValue = isZero ? 0 : baseValue;
    const price = token.symbol === 'ETH' ? 2500 : (token.symbol.includes('USD') ? 1 : 0.5);
    const balance = usdValue / price;

    return {
      name: token.name,
      symbol: token.symbol,
      contractAddress: token.address,
      balance: balance,
      usdValue: usdValue,
      points: calculateTokenPoints(usdValue)
    };
  });

  const tokenTotalScore = tokenHoldings.reduce((acc, curr) => acc + curr.points, 0);
  const tokenHoldingsUsd = tokenHoldings.reduce((acc, curr) => acc + curr.usdValue, 0);

  const gmInteractionCount = (seed * 7) % 150;
  const gmScore = gmInteractionCount * 2;

  const tydroSupplyCount = (seed * 4) % 20;
  const tydroBorrowCount = (seed * 2) % 10;

  const supplyPoints = tydroSupplyCount * 10;
  const borrowPoints = tydroBorrowCount * 20;
  const bonusPoints = (tydroSupplyCount > 0 && tydroBorrowCount > 0) ? 50 : 0;
  const tydroScore = supplyPoints + borrowPoints + bonusPoints;

  const baseScore = 300;
  const variableScore = (seed * 10) % 150;

  const calculatedScore = baseScore
    + variableScore
    + (nftTotalScore * 0.2)
    + (tokenTotalScore * 0.15)
    + gmScore
    + (tydroScore * 0.5);

  const totalScore = Math.min(850, Math.floor(calculatedScore));

  let tier = ScoreTier.NEW_USER;
  if (totalScore > 800) tier = ScoreTier.INK_LEGEND;
  else if (totalScore > 700) tier = ScoreTier.OG_MEMBER;
  else if (totalScore > 600) tier = ScoreTier.POWER_USER;
  else if (totalScore > 400) tier = ScoreTier.ACTIVE_USER;

  const maxTokenPoints = SUPPORTED_TOKENS.length * 500;

  return {
    stats: {
      address,
      ageDays: 145 + seed * 2,
      transactionCount: 850 + seed * 10 + gmInteractionCount + tydroSupplyCount + tydroBorrowCount,
      nftCount: totalNftCount,
      tokenHoldingsUsd: Math.floor(tokenHoldingsUsd),
      defiInteractionCount: 340 + seed * 5 + tydroSupplyCount + tydroBorrowCount,
      ecosystemParticipationScore: 85,
      nftHoldings,
      nftTotalScore,
      tokenHoldings,
      tokenTotalScore,
      gmInteractionCount,
      gmScore,
      tydroSupplyCount,
      tydroBorrowCount,
      tydroScore
    },
    score: {
      totalScore,
      tier,
      breakdown: {
        nftPower: Math.min(100, (nftTotalScore / 400) * 100),
        tokenWeight: Math.min(100, (tokenTotalScore / maxTokenPoints) * 100),
        defiUsage: Math.min(100, (tydroScore / 300) * 100 + 20),
        txActivity: 85,
        longevity: 60,
        ecosystemLoyalty: Math.min(100, (gmScore / 100) * 100 + 40)
      }
    }
  };
};

// Zeroed placeholder for REAL users: cards render honest zeros/dashes until
// the real metric states arrive (each card reads its real state first and
// falls back to `data.stats.*`). generateMockData's seeded values must never
// render on a real dashboard — they previously leaked through those fallback
// paths whenever a real metric state was missing or its fetch failed.
const generatePlaceholderData = (address: string): { stats: WalletStats, score: ScoreData } => {
  return {
    stats: {
      address,
      ageDays: 0,
      transactionCount: 0,
      nftCount: 0,
      tokenHoldingsUsd: 0,
      defiInteractionCount: 0,
      ecosystemParticipationScore: 0,
      nftHoldings: [],
      nftTotalScore: 0,
      tokenHoldings: [],
      tokenTotalScore: 0,
      gmInteractionCount: 0,
      gmScore: 0,
      tydroSupplyCount: 0,
      tydroBorrowCount: 0,
      tydroScore: 0
    },
    score: {
      totalScore: 0,
      tier: ScoreTier.NEW_USER,
      breakdown: {
        nftPower: 0,
        tokenWeight: 0,
        defiUsage: 0,
        txActivity: 0,
        longevity: 0,
        ecosystemLoyalty: 0
      }
    }
  };
};

interface NftCollectionHolding {
  name: string;
  address: string;
  logo: string;
  openseaUrl?: string | null;
  count: number;
}

interface RealTokenHolding {
  name: string;
  symbol: string;
  address: string;
  logo: string;
  balance: number;
  usdValue: number;
}

interface RealWalletStats {
  balanceUsd: number;
  balanceEth: number;
  totalTxns: number;
  nftCount: number;
  ageDays: number;
  nftCollections: NftCollectionHolding[];
  tokenHoldings: RealTokenHolding[];
}

interface ConsolidatedDashboardResponse {
  stats: RealWalletStats | null;
  bridge: BridgeVolumeResponse | null;
  swap: SwapVolumeResponse | null;
  volume: TotalVolumeResponse | null;
  score: WalletScoreResponse | null;
  analytics: { metrics?: Array<{ slug: string; total_value?: string; total_count?: number }> } | null;
  cards: { row3?: DashboardCardData[]; row4?: DashboardCardData[] } | null;
  nado: NadoMetrics | null;
  copink: CopinkMetrics | null;
  cryptoclash: CryptoClashMetrics | null;
  nft2me: Nft2MeResponse | null;
  sweep: SweepMetrics | null;
  zenithNft: ZenithNftMetrics | null;
  zenithStaking: ZenithStakingMetrics | null;
  tydro: {
    currentSupplyUsd?: number;
    currentSupplyEth?: number;
    totalDepositedUsd?: number;
    totalWithdrawnUsd?: number;
    depositCount?: number;
    withdrawCount?: number;
    currentBorrowUsd?: number;
    currentBorrowEth?: number;
    totalBorrowedUsd?: number;
    totalRepaidUsd?: number;
    borrowCount?: number;
    repayCount?: number;
  } | null;
  gmCount: { total_count?: number } | null;
  inkypumpCreatedTokens: { total_count?: number } | null;
  inkypumpBuyVolume: { total_value?: string; total_count?: number } | null;
  inkypumpSellVolume: { total_value?: string; total_count?: number } | null;
  zns: ZnsMetricsResponse | null;
  shelliesJoinedRaffles: { total_count?: number } | null;
  shelliesPayToPlay: { total_count?: number } | null;
  openseaBuyCount: { total_count?: number } | null;
  mintCount: { total_count?: number } | null;
  openseaSaleCount: { total_count?: number } | null;
  templarsNftBalance: { total_count?: number } | null;
  cowswapSwaps: {
    total_count?: number;
    total_value?: string;
    sub_aggregates?: Array<{
      token: string;
      usd_value: string;
      count: number;
    }>;
  } | null;
  errors?: string[];
  // Sprint 2 freshness metadata (optional, from the bundle fast path):
  // whether this payload was served from the server's dashboard snapshot
  // and when that snapshot was captured. Displayed honestly in the banner.
  from_snapshot?: boolean;
  captured_at?: string;
  // true = the live gather had missing metrics (they're being completed in
  // the background); the UI schedules one silent auto-heal refetch.
  partial?: boolean;
}

const REFRESH_COOLDOWN_MS = 30000; // 30 seconds

const isUsableWalletScore = (score: WalletScoreResponse | null | undefined): score is WalletScoreResponse => {
  return Boolean(score && Number(score.total_points) > 0);
};

export const Dashboard: React.FC<DashboardProps> = ({ walletAddress, isDemo, isAdmin }) => {
  // Feature flag for streaming
  const enableStreaming = process.env.NEXT_PUBLIC_ENABLE_STREAMING === 'true';

  // Streaming hook - only enabled if feature flag is on and not in demo mode
  const streamingState = useStreamingDashboard(walletAddress, enableStreaming && !isDemo);

  // CryptoClash authentication hook with callback to refetch data
  const handleCryptoClashAuthSuccess = useCallback(async () => {
    if (!walletAddress || isDemo) return;

    try {
      const response = await fetch(`/api/cryptoclash/${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        setCryptoclashMetrics(data);
      }
    } catch (error) {
      // Silently fail - metrics will be fetched on next dashboard refresh
    }
  }, [walletAddress, isDemo]);

  // Cache policy banner: how long per-wallet metrics are served from cache
  // (one real upstream scan per wallet per window). Server is the source of
  // truth; falls back to the documented default.
  const [cacheTtlMinutes, setCacheTtlMinutes] = useState<number>(60);

  // Sprint 2 freshness: was the latest payload served from the server's
  // dashboard snapshot, and when was that snapshot captured? Rendered
  // honestly in the cache banner — a user should never have to guess how
  // fresh their numbers are.
  const [snapshotInfo, setSnapshotInfo] = useState<{ from: boolean; capturedAt: string | null }>({ from: false, capturedAt: null });

  // Sprint 2 auto-heal state: when a partial bundle arrives (heavy metrics
  // still walking in the background), schedule up to 2 silent refetches.
  const autoHealRef = useRef<{ wallet: string; count: number; timer: ReturnType<typeof setTimeout> | null }>({ wallet: '', count: 0, timer: null });
  const walletRef = useRef(walletAddress);
  const processRef = useRef<(r: ConsolidatedDashboardResponse) => void>(() => {});
  useEffect(() => {
    walletRef.current = walletAddress;
    processRef.current = processConsolidatedResponse;
  });
  // Cancel any pending auto-heal on unmount.
  useEffect(() => () => {
    if (autoHealRef.current.timer) clearTimeout(autoHealRef.current.timer);
  }, []);
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/config');
        if (res.ok && !cancelled) {
          const cfg = await res.json();
          if (typeof cfg?.walletCacheTtlMinutes === 'number') setCacheTtlMinutes(cfg.walletCacheTtlMinutes);
        }
      } catch {
        // Keep default — banner text stays honest about the default policy.
      }
    })();
    return () => { cancelled = true; };
  }, [isDemo]);

  const cryptoClashAuth = useCryptoClashAuth(
    isDemo ? undefined : walletAddress,
    handleCryptoClashAuthSuccess
  );

  // Helper function to check if a metric is loading
  const isMetricLoading = (metricId: string): boolean => {
    if (!enableStreaming || isDemo) {
      // Fallback to individual state checks when streaming is disabled
      return false; // Will be handled by existing loading logic
    }
    return streamingState.loadingMetrics.has(metricId);
  };

  // Helper function to get metric data
  const getMetricData = (metricId: string): any => {
    if (!enableStreaming || isDemo) {
      // Fallback to individual state variables when streaming is disabled
      return null; // Will be handled by existing state logic
    }
    return streamingState.metrics[metricId] || null;
  };

  const [data, setData] = useState<{ stats: WalletStats, score: ScoreData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [realGmData, setRealGmData] = useState<{ count: number; } | null>(null);
  const [realOpenSeaBuys, setRealOpenSeaBuys] = useState<{ count: number; } | null>(null);
  const [realMintCount, setRealMintCount] = useState<{ count: number; } | null>(null);
  const [realOpenSeaSales, setRealOpenSeaSales] = useState<{ count: number; } | null>(null);
  const [realWalletStats, setRealWalletStats] = useState<RealWalletStats | null>(null);
  const [realTydroData, setRealTydroData] = useState<{
    supplyVolume: number;
    supplyCount: number;
    borrowVolume: number;
    borrowCount: number;
  } | null>(null);
  const [tydroCurrentSupply, setTydroCurrentSupply] = useState<{
    currentSupplyUsd: number;
    currentSupplyEth: number;
    totalDepositedUsd: number;
    totalWithdrawnUsd: number;
    depositCount: number;
    withdrawCount: number;
    currentBorrowUsd: number;
    currentBorrowEth: number;
    totalBorrowedUsd: number;
    totalRepaidUsd: number;
    borrowCount: number;
    repayCount: number;
  } | null>(null);
  const [bridgeVolume, setBridgeVolume] = useState<BridgeVolumeResponse | null>(null);
  const [inkySwapVolume, setInkySwapVolume] = useState<InkySwapVolumeData | null>(null);
  const [swapVolume, setSwapVolume] = useState<SwapVolumeResponse | null>(null);
  const [walletScore, setWalletScore] = useState<WalletScoreResponse | null>(null);
  const [totalVolume, setTotalVolume] = useState<TotalVolumeResponse | null>(null);
  const [znsMetrics, setZnsMetrics] = useState<ZnsMetricsResponse | null>(null);
  const [nft2meMetrics, setNft2meMetrics] = useState<Nft2MeResponse | null>(null);
  const [copinkMetrics, setCopinkMetrics] = useState<CopinkMetrics | null>(null);
  const [nadoMetrics, setNadoMetrics] = useState<NadoMetrics | null>(null);
  const [sweepMetrics, setSweepMetrics] = useState<SweepMetrics | null>(null);
  const [zenithNftMetrics, setZenithNftMetrics] = useState<ZenithNftMetrics | null>(null);
  const [zenithStakingMetrics, setZenithStakingMetrics] = useState<ZenithStakingMetrics | null>(null);
  const [cryptoclashMetrics, setCryptoclashMetrics] = useState<CryptoClashMetrics | null>(null);
  const [inkyPumpCreatedTokens, setInkyPumpCreatedTokens] = useState<{ count: number } | null>(null);
  const [inkyPumpBuyVolume, setInkyPumpBuyVolume] = useState<{ total_value: string; total_count: number } | null>(null);
  const [inkyPumpSellVolume, setInkyPumpSellVolume] = useState<{ total_value: string; total_count: number } | null>(null);

  // Shellies metrics state
  const [shelliesJoinedRaffles, setShelliesJoinedRaffles] = useState<{ total_count: number } | null>(null);
  const [shelliesPayToPlay, setShelliesPayToPlay] = useState<{ total_count: number } | null>(null);

  // Templars NFT metrics state
  const [templarsNftBalance, setTemplarsNftBalance] = useState<{ total_count: number } | null>(null);

  // Cow Swap metrics state
  const [cowswapSwaps, setCowswapSwaps] = useState<{
    total_count: number;
    total_value: string;
    sub_aggregates: Array<{
      token: string;
      usd_value: string;
      count: number;
    }>;
  } | null>(null);

  // Dynamic dashboard cards state
  const [dynamicCardsRow3, setDynamicCardsRow3] = useState<DashboardCardData[]>([]);
  const [dynamicCardsRow4, setDynamicCardsRow4] = useState<DashboardCardData[]>([]);

  // Refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  // Cooldown timer effect
  useEffect(() => {
    if (cooldownRemaining <= 0) return;

    const timer = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1000) return 0;
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldownRemaining]);

  // Helper function to process consolidated dashboard response and update all state
  const processConsolidatedResponse = useCallback((response: ConsolidatedDashboardResponse) => {
    // Freshness metadata from the bundle fast path (undefined on the legacy
    // fan-out path): was this payload served from the server snapshot?
    setSnapshotInfo({
      from: response.from_snapshot === true,
      capturedAt: response.captured_at || null,
    });

    // Sprint 2 auto-heal: a partial response means some heavy metrics timed
    // out on their first-ever gather (multi-minute walks) and were handed to
    // the background worker. The successful metrics are already cached, so a
    // silent refetch ~60s later usually returns the complete bundle — the
    // page fills itself in without user action. Guarded to 2 attempts per
    // wallet so it can never loop.
    if (response.partial === true && !isDemo && walletAddress) {
      const state = autoHealRef.current;
      if (state.wallet !== walletAddress) {
        state.wallet = walletAddress;
        state.count = 0;
      }
      if (state.count < 2) {
        state.count += 1;
        if (state.timer) clearTimeout(state.timer);
        const healWallet = walletAddress; // the wallet THIS response belongs to
        state.timer = setTimeout(() => {
          // User may have navigated to another wallet meanwhile — drop it.
          if (walletRef.current !== healWallet) return;
          fetch(`/api/${healWallet}/dashboard`)
            .then((r) => (r.ok ? r.json() : null))
            .then((res: ConsolidatedDashboardResponse | null) => {
              if (res && walletRef.current === healWallet) processRef.current(res);
            })
            .catch(() => undefined);
        }, 60_000);
      }
    }
    // Process wallet stats
    if (response.stats) {
      setRealWalletStats({
        balanceUsd: Number(response.stats.balanceUsd) || 0,
        balanceEth: Number(response.stats.balanceEth) || 0,
        totalTxns: Number(response.stats.totalTxns) || 0,
        nftCount: Number(response.stats.nftCount) || 0,
        ageDays: Number(response.stats.ageDays) || 0,
        nftCollections: response.stats.nftCollections || [],
        tokenHoldings: (response.stats.tokenHoldings || []).map((t) => ({
          ...t,
          balance: Number(t.balance) || 0,
          usdValue: Number(t.usdValue) || 0,
        })),
      });
    }

    // Process bridge volume
    if (response.bridge) {
      setBridgeVolume(response.bridge);
    }

    // Process swap volume
    if (response.swap) {
      setSwapVolume({
        totalUsd: response.swap.totalUsd || 0,
        txCount: response.swap.txCount || 0,
        byPlatform: response.swap.byPlatform?.map((p) => ({
          platform: p.platform,
          contractAddress: p.contractAddress,
          usdValue: p.usdValue,
          txCount: p.txCount,
        })) || [],
      });
    }

    // Process total volume
    if (response.volume) {
      setTotalVolume(response.volume);
    }

    // Process wallet score
    if (isUsableWalletScore(response.score)) {
      setWalletScore(response.score);
    }

    // Process analytics (Tydro and InkySwap data)
    if (response.analytics?.metrics) {
      const supplyMetric = response.analytics.metrics.find((m) => m.slug === 'tydro_usd_supply');
      const borrowMetric = response.analytics.metrics.find((m) => m.slug === 'Tydro_usd_borrow');
      setRealTydroData({
        supplyVolume: parseFloat(supplyMetric?.total_value || '0'),
        supplyCount: supplyMetric?.total_count || 0,
        borrowVolume: parseFloat(borrowMetric?.total_value || '0'),
        borrowCount: borrowMetric?.total_count || 0,
      });

      const inkySwapMetric = response.analytics.metrics.find((m) =>
        m.slug.toLowerCase().includes('inkyswap')
      );
      if (inkySwapMetric) {
        setInkySwapVolume({
          totalValue: parseFloat(inkySwapMetric.total_value || '0'),
          totalCount: inkySwapMetric.total_count || 0,
        });
      }
    }

    // Process dashboard cards
    if (response.cards) {
      setDynamicCardsRow3(response.cards.row3 || []);
      setDynamicCardsRow4(response.cards.row4 || []);
    }

    // Process Copink metrics
    if (response.copink) {
      setCopinkMetrics({
        totalVolume: response.copink.totalVolume || 0,
        subaccountsFound: response.copink.subaccountsFound || 0,
      });
    }

    // Process Nado metrics
    if (response.nado) {
      setNadoMetrics({
        totalDeposits: response.nado.totalDeposits || 0,
        totalTransactions: response.nado.totalTransactions || 0,
        nadoVolumeUSD: response.nado.nadoVolumeUSD || 0, // Main volume from Nado API
        dbTotalVolume: response.nado.dbTotalVolume || 0, // Database volume (fallback)
      });
    }

    // Process Sweep metrics
    if (response.sweep) {
      const sweepData = response.sweep as any;
      const subAggregates = sweepData.sub_aggregates as Array<{ label: string; value: string }> | undefined;
      const badgeAggregate = subAggregates?.find((s) => s.label === 'Sweep Badges');
      const streakAggregate = subAggregates?.find((s) => s.label === 'Total Streak');
      setSweepMetrics({
        totalCollections: sweepData.totalCollections ?? sweepData.total_count ?? 0,
        sweepBadgeBalance: sweepData.sweepBadgeBalance ?? (badgeAggregate ? parseInt(badgeAggregate.value, 10) : 0),
        totalStreak: sweepData.totalStreak ?? (streakAggregate ? parseInt(streakAggregate.value, 10) : 0),
      });
    }

    // Process InkScore Zenith metrics
    if (response.zenithNft) {
      setZenithNftMetrics({
        total_count: response.zenithNft.total_count || 0,
      });
    }
    if (response.zenithStaking) {
      setZenithStakingMetrics({
        total_staked: response.zenithStaking.total_staked || 0,
        one_month_count: response.zenithStaking.one_month_count || 0,
        one_week_count: response.zenithStaking.one_week_count || 0,
        one_day_count: response.zenithStaking.one_day_count || 0,
      });
    }

    // Process CryptoClash metrics
    if (response.cryptoclash) {
      setCryptoclashMetrics({
        clashTickets: response.cryptoclash.clashTickets || 0,
        lpTickets: response.cryptoclash.lpTickets || 0,
        points: response.cryptoclash.points || 0,
        totalBattles: response.cryptoclash.totalBattles || 0,
        isPatron: response.cryptoclash.isPatron || false,
      });
    }

    // Process NFT2Me metrics
    if (response.nft2me) {
      setNft2meMetrics({
        collectionsCreated: response.nft2me.collectionsCreated || 0,
        nftsMinted: response.nft2me.nftsMinted || 0,
        totalTransactions: response.nft2me.totalTransactions || 0,
      });
    }

    // Process Tydro current supply
    if (response.tydro) {
      setTydroCurrentSupply({
        currentSupplyUsd: response.tydro.currentSupplyUsd || 0,
        currentSupplyEth: response.tydro.currentSupplyEth || 0,
        totalDepositedUsd: response.tydro.totalDepositedUsd || 0,
        totalWithdrawnUsd: response.tydro.totalWithdrawnUsd || 0,
        depositCount: response.tydro.depositCount || 0,
        withdrawCount: response.tydro.withdrawCount || 0,
        currentBorrowUsd: response.tydro.currentBorrowUsd || 0,
        currentBorrowEth: response.tydro.currentBorrowEth || 0,
        totalBorrowedUsd: response.tydro.totalBorrowedUsd || 0,
        totalRepaidUsd: response.tydro.totalRepaidUsd || 0,
        borrowCount: response.tydro.borrowCount || 0,
        repayCount: response.tydro.repayCount || 0,
      });
    }

    // Process GM count
    if (response.gmCount) {
      setRealGmData({ count: response.gmCount.total_count || 0 });
    }

    // Process OpenSea buy count
    if (response.openseaBuyCount) {
      setRealOpenSeaBuys({ count: response.openseaBuyCount.total_count || 0 });
    }

    // Process Mint count
    if (response.mintCount) {
      setRealMintCount({ count: response.mintCount.total_count || 0 });
    }

    // Process OpenSea sale count
    if (response.openseaSaleCount) {
      setRealOpenSeaSales({ count: response.openseaSaleCount.total_count || 0 });
    }

    // Process InkyPump metrics
    if (response.inkypumpCreatedTokens) {
      setInkyPumpCreatedTokens({ count: response.inkypumpCreatedTokens.total_count || 0 });
    }
    if (response.inkypumpBuyVolume) {
      setInkyPumpBuyVolume({
        total_value: response.inkypumpBuyVolume.total_value || '0.00',
        total_count: response.inkypumpBuyVolume.total_count || 0,
      });
    }
    if (response.inkypumpSellVolume) {
      setInkyPumpSellVolume({
        total_value: response.inkypumpSellVolume.total_value || '0.00',
        total_count: response.inkypumpSellVolume.total_count || 0,
      });
    }

    // Process ZNS metrics
    if (response.zns) {
      setZnsMetrics({
        total_count: response.zns.total_count || 0,
        deploy_count: response.zns.deploy_count || 0,
        say_gm_count: response.zns.say_gm_count || 0,
        register_domain_count: response.zns.register_domain_count || 0,
      });
    }

    // Process Shellies metrics
    if (response.shelliesJoinedRaffles) {
      setShelliesJoinedRaffles({ total_count: response.shelliesJoinedRaffles.total_count || 0 });
    }
    if (response.shelliesPayToPlay) {
      setShelliesPayToPlay({ total_count: response.shelliesPayToPlay.total_count || 0 });
    }

    // Process Templars NFT balance
    if (response.templarsNftBalance) {
      setTemplarsNftBalance({ total_count: response.templarsNftBalance.total_count || 0 });
    }

    // Process Cow Swap metrics
    if (response.cowswapSwaps) {
      setCowswapSwaps({
        total_count: response.cowswapSwaps.total_count || 0,
        total_value: response.cowswapSwaps.total_value || '0',
        sub_aggregates: response.cowswapSwaps.sub_aggregates || [],
      });
    }
  }, []);

  // Process streaming metrics when they arrive
  useEffect(() => {
    if (!enableStreaming || isDemo || !streamingState.metrics) return;

    // Process each metric as it arrives from the stream
    Object.entries(streamingState.metrics).forEach(([metricId, data]) => {
      if (!data) return;

      switch (metricId) {
        case 'stats':
          setRealWalletStats({
            balanceUsd: Number(data.balanceUsd) || 0,
            balanceEth: Number(data.balanceEth) || 0,
            totalTxns: Number(data.totalTxns) || 0,
            nftCount: Number(data.nftCount) || 0,
            ageDays: Number(data.ageDays) || 0,
            nftCollections: data.nftCollections || [],
            tokenHoldings: (data.tokenHoldings || []).map((t: any) => ({
              ...t,
              balance: Number(t.balance) || 0,
              usdValue: Number(t.usdValue) || 0,
            })),
          });
          break;
        case 'bridge':
          setBridgeVolume(data);
          break;
        case 'swap':
          setSwapVolume(data);
          break;
        case 'volume':
          setTotalVolume(data);
          break;
        case 'score':
          if (isUsableWalletScore(data)) {
            setWalletScore(data);
          }
          break;
        case 'tydro':
          setTydroCurrentSupply(data);
          break;
        case 'gmCount':
          setRealGmData({ count: data.total_count || 0 });
          break;
        case 'openseaBuyCount':
          setRealOpenSeaBuys({ count: data.total_count || 0 });
          break;
        case 'mintCount':
          setRealMintCount({ count: data.total_count || 0 });
          break;
        case 'openseaSaleCount':
          setRealOpenSeaSales({ count: data.total_count || 0 });
          break;
        case 'copink':
          setCopinkMetrics(data);
          break;
        case 'nado':
          setNadoMetrics(data);
          break;
        case 'sweep':
          {
            const sweepData = data as any;
            const subAggregates = sweepData.sub_aggregates as Array<{ label: string; value: string }> | undefined;
            const badgeAggregate = subAggregates?.find((s) => s.label === 'Sweep Badges');
            const streakAggregate = subAggregates?.find((s) => s.label === 'Total Streak');
            setSweepMetrics({
              totalCollections: sweepData.totalCollections ?? sweepData.total_count ?? 0,
              sweepBadgeBalance: sweepData.sweepBadgeBalance ?? (badgeAggregate ? parseInt(badgeAggregate.value, 10) : 0),
              totalStreak: sweepData.totalStreak ?? (streakAggregate ? parseInt(streakAggregate.value, 10) : 0),
            });
          }
          break;
        case 'zenithNft':
          setZenithNftMetrics({ total_count: data.total_count || 0 });
          break;
        case 'zenithStaking':
          setZenithStakingMetrics({
            total_staked: data.total_staked || 0,
            one_month_count: data.one_month_count || 0,
            one_week_count: data.one_week_count || 0,
            one_day_count: data.one_day_count || 0,
          });
          break;
        case 'cryptoclash':
          setCryptoclashMetrics(data);
          break;
        case 'nft2me':
          setNft2meMetrics(data);
          break;
        case 'inkypumpCreatedTokens':
          setInkyPumpCreatedTokens({ count: data.total_count || 0 });
          break;
        case 'inkypumpBuyVolume':
          setInkyPumpBuyVolume(data);
          break;
        case 'inkypumpSellVolume':
          setInkyPumpSellVolume(data);
          break;
        case 'zns':
          setZnsMetrics(data);
          break;
        case 'shelliesJoinedRaffles':
          setShelliesJoinedRaffles({ total_count: data.total_count || 0 });
          break;
        case 'shelliesPayToPlay':
          setShelliesPayToPlay({ total_count: data.total_count || 0 });
          break;
        case 'templarsNftBalance':
          setTemplarsNftBalance({ total_count: data.total_count || 0 });
          break;
        case 'cowswapSwaps':
          setCowswapSwaps(data);
          break;
        case 'cards':
          if (data.row3) setDynamicCardsRow3(data.row3);
          if (data.row4) setDynamicCardsRow4(data.row4);
          break;
        case 'analytics':
          // Process analytics (Tydro and InkySwap data)
          if (data.metrics) {
            const supplyMetric = data.metrics.find((m: any) => m.slug === 'tydro_usd_supply');
            const borrowMetric = data.metrics.find((m: any) => m.slug === 'Tydro_usd_borrow');
            setRealTydroData({
              supplyVolume: parseFloat(supplyMetric?.total_value || '0'),
              supplyCount: supplyMetric?.total_count || 0,
              borrowVolume: parseFloat(borrowMetric?.total_value || '0'),
              borrowCount: borrowMetric?.total_count || 0,
            });

            const inkySwapMetric = data.metrics.find((m: any) =>
              m.slug.toLowerCase().includes('inkyswap')
            );
            if (inkySwapMetric) {
              setInkySwapVolume({
                totalValue: parseFloat(inkySwapMetric.total_value || '0'),
                totalCount: inkySwapMetric.total_count || 0,
              });
            }
          }
          break;
      }
    });
  }, [streamingState.metrics, enableStreaming, isDemo]);

  // Refresh all data function - uses consolidated endpoint
  const refreshAllData = useCallback(async () => {
    if (isDemo || isRefreshing || cooldownRemaining > 0) return;

    setIsRefreshing(true);

    // Clear all data to show skeleton UI
    setRealWalletStats(null);
    setRealGmData(null);
    setRealTydroData(null);
    setTydroCurrentSupply(null);
    setBridgeVolume(null);
    setInkySwapVolume(null);
    setSwapVolume(null);
    setWalletScore(null);
    setTotalVolume(null);
    setZnsMetrics(null);
    setNft2meMetrics(null);
    setCopinkMetrics(null);
    setNadoMetrics(null);
    setCryptoclashMetrics(null);
    setInkyPumpCreatedTokens(null);
    setInkyPumpBuyVolume(null);
    setInkyPumpSellVolume(null);
    setShelliesJoinedRaffles(null);
    setShelliesPayToPlay(null);
    setTemplarsNftBalance(null);
    setCowswapSwaps(null);
    setDynamicCardsRow3([]);
    setDynamicCardsRow4([]);

    try {
      // Single consolidated API call — ?refresh=true opens a short bypass
      // window server-side so cached wallet metrics older than the default
      // are recomputed live (bounded by the frontend refresh cooldown).
      const res = await fetch(`/api/${walletAddress}/dashboard?refresh=true`);
      if (res.ok) {
        const response: ConsolidatedDashboardResponse = await res.json();
        processConsolidatedResponse(response);
      }

      setLastUpdated(new Date());
      setCooldownRemaining(REFRESH_COOLDOWN_MS);
    } catch (err) {
      console.error('Failed to refresh dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [walletAddress, isDemo, isRefreshing, cooldownRemaining, processConsolidatedResponse]);

  // Format time ago for last updated
  const formatLastUpdated = (date: Date | null): string => {    if (!date) return '';
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 min ago';
    return `${minutes} mins ago`;
  };

  // Sprint 2: age of the snapshot the current payload came from (ISO string
  // from the server). Re-renders on the minute tick above.
  const formatSnapshotAge = (iso: string): string => {
    const ts = Date.parse(iso);
    if (!Number.isFinite(ts)) return 'recently';
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 90) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  };

  // Update "time ago" display every minute
  const [, setTimeUpdate] = useState(0);
  useEffect(() => {
    if (!lastUpdated) return;
    const timer = setInterval(() => setTimeUpdate(prev => prev + 1), 60000);
    return () => clearInterval(timer);
  }, [lastUpdated]);

  useEffect(() => {
    const timer = setTimeout(() => {
      // Demo: seeded mock data IS the product. Real users: zeroed placeholder —
      // mock values must never render on a real dashboard.
      if (isDemo) {
        setData(generateMockData(walletAddress));
      } else {
        setData(generatePlaceholderData(walletAddress));
      }
      setLoading(false);
      if (!isDemo) setLastUpdated(new Date());
    }, isDemo ? 1500 : 250);
    return () => clearTimeout(timer);
  }, [walletAddress, isDemo]);

  // Fetch all dashboard data using consolidated endpoint when not in demo mode
  // Skip if streaming is enabled (streaming hook handles data fetching)
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10 || enableStreaming) return;

    const fetchDashboardData = async () => {
      try {
        const res = await fetch(`/api/${walletAddress}/dashboard`);
        if (res.ok) {
          const response: ConsolidatedDashboardResponse = await res.json();
          processConsolidatedResponse(response);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      }
    };

    fetchDashboardData();
  }, [walletAddress, isDemo, enableStreaming, processConsolidatedResponse]);

  const handleAiAnalysis = async () => {
    if (!data) return;
    setAnalyzing(true);
    // Mock AI analysis for demo
    setTimeout(() => {
      setAiAnalysis({
        summary: "This wallet demonstrates strong engagement with the InkChain ecosystem, showing consistent DeFi activity and diverse NFT holdings.",
        strengths: ["Active DeFi participation with Tydro protocol", "Diverse NFT portfolio across verified collections", "Consistent transaction history"],
        weaknesses: ["Could increase token holdings diversity", "GM activity could be more frequent"],
        recommendation: "Consider increasing your stablecoin holdings and participating in more governance votes to boost your score."
      });
      setAnalyzing(false);
    }, 2000);
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center relative">
        <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none"></div>
        <div className="flex flex-col items-center gap-6 z-10">
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 border-4 border-ink-purple/20 rounded-full animate-pulse-slow"></div>
            <div className="absolute inset-0 border-4 border-t-ink-purple rounded-full animate-spin"></div>
          </div>
          <p className="text-slate-400 font-mono animate-pulse tracking-widest">ANALYZING CHAIN DATA...</p>
        </div>
      </div>
    );
  }

  const chartData = (() => {
    const MIN_EDGES = 5; // Minimum edges for a good radar chart visualization

    // If we have real wallet score data, build chart from breakdown
    if (!isDemo && walletScore) {
      const items: { subject: string; A: number; fullMark: number }[] = [];

      // Add native metrics
      const nativeLabels: Record<string, string> = {
        wallet_age: 'Age',
        total_tx: 'TXs',
        nft_collections: 'NFTs',
        erc20_tokens: 'Tokens',
        total_volume: 'Volume'
      };

      Object.entries(walletScore.breakdown.native).forEach(([key, data]) => {
        if (data) {
          items.push({
            subject: nativeLabels[key] || key,
            A: data.points || 0,
            fullMark: Math.max(data.points || 0, 100)
          });
        }
      });

      // Add platform metrics
      Object.entries(walletScore.breakdown.platforms).forEach(([slug, data]) => {
        // Shorten platform names for radar chart
        const shortName = slug.length > 8 ? slug.substring(0, 7) + '.' : slug;
        items.push({
          subject: shortName.charAt(0).toUpperCase() + shortName.slice(1),
          A: data.points || 0,
          fullMark: Math.max(data.points || 0, 100)
        });
      });

      // If no data, return default empty chart
      if (items.length === 0) {
        return [
          { subject: 'Age', A: 0, fullMark: 100 },
          { subject: 'TXs', A: 0, fullMark: 100 },
          { subject: 'NFTs', A: 0, fullMark: 100 },
          { subject: 'Tokens', A: 0, fullMark: 100 },
          { subject: 'DeFi', A: 0, fullMark: 100 },
        ];
      }

      // Pad with empty entries if we have fewer than MIN_EDGES
      const placeholderLabels = ['Activity', 'DeFi', 'Bridge', 'Swap', 'Social', 'Loyalty'];
      let placeholderIndex = 0;
      while (items.length < MIN_EDGES && placeholderIndex < placeholderLabels.length) {
        const label = placeholderLabels[placeholderIndex];
        // Only add if this label doesn't already exist
        if (!items.some(item => item.subject.toLowerCase() === label.toLowerCase())) {
          items.push({
            subject: label,
            A: 0,
            fullMark: 100
          });
        }
        placeholderIndex++;
      }

      // Calculate max for normalization
      const maxPoints = Math.max(...items.map(i => i.A), 100);
      return items.map(item => ({
        ...item,
        fullMark: maxPoints
      }));
    }

    // Demo/fallback data
    return [
      { subject: 'NFTs', A: data.score.breakdown.nftPower || 0, fullMark: 100 },
      { subject: 'Tokens', A: data.score.breakdown.tokenWeight || 0, fullMark: 100 },
      { subject: 'DeFi', A: data.score.breakdown.defiUsage || 0, fullMark: 100 },
      { subject: 'Activity', A: data.score.breakdown.txActivity || 0, fullMark: 100 },
      { subject: 'Age', A: data.score.breakdown.longevity || 0, fullMark: 100 },
      { subject: 'Loyalty', A: data.score.breakdown.ecosystemLoyalty || 0, fullMark: 100 },
    ];
  })();

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 relative">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none fixed"></div>

      <div className="max-w-7xl mx-auto space-y-6 relative z-10">
        {/* Header Info */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-display font-bold text-white flex items-center gap-3">
              Your Journey on the Ink Chain
              <span className="px-3 py-1 rounded-full bg-slate-800 text-sm font-normal border border-slate-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                INK Mainnet
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Refresh Button */}
            {!isDemo && (
              <div className="flex items-center gap-3">
                {lastUpdated && (
                  <span className="text-xs text-slate-500 hidden sm:block">
                    {formatLastUpdated(lastUpdated)}
                  </span>
                )}
                <button
                  onClick={refreshAllData}
                  disabled={isRefreshing || cooldownRemaining > 0}
                  className={`
                    group flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                    transition-all duration-200 border
                    ${isRefreshing || cooldownRemaining > 0
                      ? 'bg-slate-800/50 border-slate-700/50 text-slate-500 cursor-not-allowed'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:border-ink-purple/50 hover:text-white'
                    }
                  `}
                  title={cooldownRemaining > 0 ? `Wait ${Math.ceil(cooldownRemaining / 1000)}s` : 'Refresh data'}
                >
                  <RefreshCw
                    size={16}
                    className={`
                      transition-transform duration-200
                      ${isRefreshing ? 'animate-spin-slow' : 'group-hover:rotate-45'}
                    `}
                  />
                  <span className="hidden sm:inline">
                    {isRefreshing
                      ? 'Refreshing...'
                      : cooldownRemaining > 0
                        ? `${Math.ceil(cooldownRemaining / 1000)}s`
                        : 'Refresh'
                    }
                  </span>
                </button>
              </div>
            )}
            {isDemo && <div className="px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-sm font-medium animate-pulse">Demo Mode</div>}
          </div>
        </div>

        {/* Cache policy notice — one real scan per wallet per TTL window */}
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/40 text-[11px] text-slate-400">
          <span aria-hidden="true">🗄️</span>
          <span>
            Platform metrics are cached per wallet for <span className="text-slate-300 font-medium">{cacheTtlMinutes >= 60 ? `${cacheTtlMinutes / 60} hour${cacheTtlMinutes > 60 ? 's' : ''}` : `${cacheTtlMinutes} min`}</span>
            {' '}after the first scan. Refreshing within that window reuses the cached scan (faster for you, less load on the explorers) — use the Refresh button to pull a live scan.
            {snapshotInfo.from && snapshotInfo.capturedAt && (
              <>{' '}This view was served from a <span className="text-slate-300 font-medium">cached snapshot</span> scanned{' '}
                <time dateTime={snapshotInfo.capturedAt} title={new Date(snapshotInfo.capturedAt).toLocaleString()}>
                  {formatSnapshotAge(snapshotInfo.capturedAt)}
                </time>.
              </>
            )}
          </span>
        </div>

        {/* Top Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: 'Net Worth Estimate',
              value: !isDemo && realWalletStats
                ? `$${((realWalletStats.balanceUsd || 0) + (realWalletStats.tokenHoldings || []).filter(t => t.symbol !== 'ETH').reduce((sum, t) => sum + (t.usdValue || 0), 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$${(data.stats.tokenHoldingsUsd || 0).toLocaleString()}`,
              icon: Wallet,
              color: 'blue',
              delay: '0.1s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'Total Txns',
              value: !isDemo && realWalletStats
                ? (realWalletStats.totalTxns || 0).toLocaleString()
                : (data.stats.transactionCount || 0).toLocaleString(),
              icon: Activity,
              color: 'purple',
              delay: '0.2s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'Circulated Volume',
              value: !isDemo && totalVolume
                ? `$${(totalVolume.totalUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '$0.00',
              subValue: !isDemo && totalVolume
                ? `${(totalVolume.totalEth || 0).toFixed(4)} ETH`
                : undefined,
              icon: TrendingUp,
              color: 'cyan',
              delay: '0.25s',
              isLoading: !isDemo && !totalVolume
            },
            {
              label: 'NFTs Held',
              value: !isDemo && realWalletStats
                ? (realWalletStats.nftCount || 0).toLocaleString()
                : (data.stats.nftCount || 0).toLocaleString(),
              icon: Award,
              color: 'pink',
              delay: '0.3s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'On-Chain Age',
              value: !isDemo && realWalletStats
                ? `${realWalletStats.ageDays || 0} Days`
                : `${data.stats.ageDays || 0} Days`,
              icon: Clock,
              color: 'emerald',
              delay: '0.4s',
              isLoading: !isDemo && !realWalletStats
            }
          ].map((item, i) => (
            <div
              key={i}
              className="glass-card glass-card-hover p-6 rounded-xl flex items-center gap-4 animate-fade-in-up group"
              style={{ animationDelay: item.delay }}
            >
              <div className={`p-3 bg-${item.color}-500/10 rounded-lg text-${item.color}-400 group-hover:scale-110 transition-transform`}>
                <item.icon size={24} />
              </div>
              <div>
                <div className="text-slate-400 text-sm">{item.label}</div>
                <div className="text-xl font-bold font-display text-white">
                  {item.isLoading ? (
                    <span className="inline-block w-24 h-7 bg-slate-700/50 rounded animate-pulse"></span>
                  ) : item.value}
                </div>
                {'subValue' in item && item.subValue && (
                  <div className="text-xs text-slate-500">{item.subValue}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Row 2: Total INKSCORE (50%) + Tydro DeFi (50%) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Total INKSCORE Card - 50% width */}
          <div className="glass-card p-8 rounded-2xl animate-fade-in-up h-[300px] flex flex-col" style={{ animationDelay: '0.5s' }}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 flex-1">
              <div className="text-center relative flex-shrink-0">
                <div className="absolute -top-20 -left-20 w-40 h-40 bg-ink-purple/20 blur-3xl rounded-full"></div>
                <h2 className="text-slate-400 mb-2 relative z-10">Total INKSCORE</h2>
                {!isDemo && walletScore ? (
                  <>
                    <div className="text-6xl font-display font-bold text-white tracking-tighter mb-2 relative z-10 drop-shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                      {(walletScore.total_points || 0).toLocaleString()}
                    </div>
                    <div
                      className="inline-block px-4 py-1 rounded-full text-white text-sm font-semibold shadow-lg relative z-10"
                      style={{
                        background: walletScore.rank?.color
                          ? `linear-gradient(135deg, ${walletScore.rank.color}80, ${walletScore.rank.color})`
                          : 'linear-gradient(to right, var(--ink-blue), var(--ink-purple))',
                        boxShadow: walletScore.rank?.color
                          ? `0 4px 14px ${walletScore.rank.color}40`
                          : '0 4px 14px rgba(124, 58, 237, 0.4)'
                      }}
                    >
                      {walletScore.rank?.name || 'New User'}
                    </div>
                  </>
                ) : !isDemo && !walletScore ? (
                  <>
                    <div className="h-16 w-32 bg-slate-700/50 rounded animate-pulse mb-2 relative z-10"></div>
                    <div className="h-7 w-24 bg-slate-700/50 rounded-full animate-pulse relative z-10"></div>
                  </>
                ) : (
                  <>
                    <div className="text-6xl font-display font-bold text-white tracking-tighter mb-2 relative z-10 drop-shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                      {data.score.totalScore || 0}
                    </div>
                    <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-ink-blue to-ink-purple text-white text-sm font-semibold shadow-lg shadow-purple-900/40 relative z-10">
                      {data.score.tier || 'New User'}
                    </div>
                  </>
                )}
                <p className="mt-3 text-slate-400 text-sm max-w-xs relative z-10">
                  {!isDemo && walletScore && (walletScore.total_points || 0) > 0
                    ? 'Points based on your on-chain activity.'
                    : 'Top 5% of active InkChain addresses.'}
                </p>
                {/* Mint Score NFT Button */}
                {!isDemo && walletScore && (
                  <div className="relative z-10 max-w-xs">
                    <MintScoreNFT
                      walletAddress={walletAddress}
                      currentScore={walletScore.total_points || 0}
                      currentRank={walletScore.rank?.name || 'Unranked'}
                      rankColor={walletScore.rank?.color || '#6366f1'}
                    />
                  </div>
                )}
              </div>

              <div className="h-[200px] w-full md:w-[240px] flex-shrink-0">
                {!isDemo && !walletScore ? (
                  // Empty radar chart skeleton - 5 edges, no data, no labels
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={[
                      { subject: '', A: 0, fullMark: 100 },
                      { subject: '', A: 0, fullMark: 100 },
                      { subject: '', A: 0, fullMark: 100 },
                      { subject: '', A: 0, fullMark: 100 },
                      { subject: '', A: 0, fullMark: 100 },
                    ]}>
                      <PolarGrid stroke="#334155" />
                      <PolarAngleAxis dataKey="subject" tick={false} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    </RadarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                      <PolarGrid stroke="#334155" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 'dataMax']} tick={false} axisLine={false} />
                      <Radar name="Points" dataKey="A" stroke="#7c3aed" strokeWidth={2} fill="#7c3aed" fillOpacity={0.4} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                        itemStyle={{ color: '#a855f7' }}
                        formatter={(value) => [`${value} pts`, 'Points']}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Tydro DeFi Card - 50% width - Premium Card */}
          <div
            className="animated-border p-6 rounded-2xl animate-fade-in-up h-[300px] flex flex-col relative"
            style={{
              animationDelay: '0.55s',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)',
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <h3 className="text-xl font-bold text-white flex items-center gap-3">
                <a
                  href={PLATFORM_URLS.tydro}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center p-1.5 hover:ring-2 hover:ring-emerald-500/50 transition-all cursor-pointer"
                  title="Visit Tydro"
                >
                  <img
                    src={getProxiedImageUrl("https://app.tydro.com/tydro-logo.svg")}
                    alt="Tydro"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </a>
                <span className="text-white font-display">Tydro DeFi</span>
              </h3>

            </div>

            {!isDemo && (isMetricLoading('tydro') || (!realTydroData && !tydroCurrentSupply)) ? (
              <div className="flex-1 flex flex-col gap-3 relative z-10">
                {/* Current Positions Skeleton */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
                    <div className="h-3 w-24 bg-slate-700/40 rounded animate-pulse mb-2"></div>
                    <div className="h-7 w-20 bg-slate-700/50 rounded animate-pulse"></div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
                    <div className="h-3 w-24 bg-slate-700/40 rounded animate-pulse mb-2"></div>
                    <div className="h-7 w-20 bg-slate-700/50 rounded animate-pulse"></div>
                  </div>
                </div>
                {/* Historical Skeleton */}
                <div className="grid grid-cols-2 gap-3 flex-1">
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
                    <div className="h-3 w-28 bg-slate-700/30 rounded animate-pulse mb-2"></div>
                    <div className="h-6 w-24 bg-slate-700/40 rounded animate-pulse"></div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/20">
                    <div className="h-3 w-28 bg-slate-700/30 rounded animate-pulse mb-2"></div>
                    <div className="h-6 w-24 bg-slate-700/40 rounded animate-pulse"></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col gap-3 relative z-10">
                {/* Current Positions Row */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Current Supply Position - Event Sourced (deposits - withdrawals) */}
                  <div className="p-3 rounded-xl bg-green-500/10 border border-green-500/20 hover:border-green-500/40 transition-colors duration-200">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                          <Landmark size={12} className="text-green-400" />
                        </div>
                        <span className="text-xs font-medium text-slate-400">Current Supply</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 font-medium">LIVE</span>
                    </div>
                    <div className="text-2xl font-bold font-display text-green-400">
                      ${!isDemo && tydroCurrentSupply
                        ? (tydroCurrentSupply.currentSupplyUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '0.00'}
                    </div>
                    {!isDemo && tydroCurrentSupply && (tydroCurrentSupply.currentSupplyEth || 0) > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {(tydroCurrentSupply.currentSupplyEth || 0).toFixed(4)} ETH
                      </div>
                    )}
                  </div>

                  {/* Current Borrow Position */}
                  <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/40 transition-colors duration-200">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-orange-500/20 flex items-center justify-center">
                          <Zap size={12} className="text-orange-400" />
                        </div>
                        <span className="text-xs font-medium text-slate-400">Current Borrow</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-medium">LIVE</span>
                    </div>
                    <div className="text-2xl font-bold font-display text-orange-400">
                      ${!isDemo && tydroCurrentSupply
                        ? (tydroCurrentSupply.currentBorrowUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '0.00'}
                    </div>
                    {!isDemo && tydroCurrentSupply && (tydroCurrentSupply.currentBorrowEth || 0) > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {(tydroCurrentSupply.currentBorrowEth || 0).toFixed(4)} ETH
                      </div>
                    )}
                  </div>
                </div>

                {/* Historical Volume Row */}
                <div className="grid grid-cols-2 gap-3 flex-1">
                  {/* Historical Supply/Withdraw Volume */}
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors duration-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock size={12} className="text-slate-500" />
                      <span className="text-xs text-slate-500">Historical Supply/Withdraw</span>
                    </div>
                    <div className="flex justify-around items-baseline gap-2 mt-2">
                      <div>
                        <div className="text-xs text-green-400 mb-0.5">Supply</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? (tydroCurrentSupply.totalDepositedUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className=" pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? (tydroCurrentSupply.depositCount || 0) : 0} tx
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-red-400 mb-0.5">Withdraw</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? (tydroCurrentSupply.totalWithdrawnUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? (tydroCurrentSupply.withdrawCount || 0) : 0} tx
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>

                  {/* Historical Borrow/Repay Volume */}
                  <div className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 hover:border-slate-600/60 transition-colors duration-200">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock size={12} className="text-slate-500" />
                      <span className="text-xs text-slate-500">Historical Borrow/Repay</span>
                    </div>
                    <div className="flex justify-around items-baseline gap-2">
                      <div>
                        <div className="text-xs text-orange-400 mb-0.5">Borrow</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? (tydroCurrentSupply.totalBorrowedUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? (tydroCurrentSupply.borrowCount || 0) : 0} tx
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-blue-400 mb-0.5">Repay</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? (tydroCurrentSupply.totalRepaidUsd || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? (tydroCurrentSupply.repayCount || 0) : 0} tx
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3: Nado + GM + Bridge Volume + InkyPump + Swap Volume (5 columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Nado Card */}
          <div
            className="animated-border-indigo p-6 rounded-2xl animate-fade-in-up h-[300px] flex flex-col relative"
            style={{
              animationDelay: '0.55s',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(15, 23, 42, 0.6) 100%)',
            }}
          >
            <div className="flex items-center justify-between mb-3 relative z-10">
              <h3 className="text-xl font-bold text-white flex items-center gap-3">
                <a
                  href={PLATFORM_URLS.nado}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-9 h-9 rounded-full bg-slate-800 flex items-center justify-center p-1.5 hover:ring-2 hover:ring-indigo-500/50 transition-all cursor-pointer"
                  title="Visit Nado Finance"
                >
                  <img
                    src={getProxiedImageUrl("https://pbs.twimg.com/profile_images/2010908038514032641/5E7RkPLF_400x400.jpg")}
                    alt="Nado"
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=N&background=6366f1&color=fff&size=24';
                    }}
                  />
                </a>
                <span className="text-white font-display">Nado Finance</span>
              </h3>
            </div>

            {!isDemo && (isMetricLoading('nado') || !nadoMetrics) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-32 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-indigo-400">
                    {!isDemo && nadoMetrics
                      ? (nadoMetrics.totalTransactions || 0).toLocaleString()
                      : '12'}
                  </div>
                  <div className="text-xs text-slate-500">
                    {!isDemo && nadoMetrics
                      ? `${nadoMetrics.totalTransactions || 0} transaction${(nadoMetrics.totalTransactions || 0) !== 1 ? 's' : ''}`
                      : '12 transactions'}
                  </div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Metrics</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Total Deposits</span>
                      <span className="font-mono text-white">
                        ${!isDemo && nadoMetrics
                          ? (nadoMetrics.totalDeposits || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '8,750.00'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Total Volume</span>
                      <span className="font-mono text-white">
                        ${!isDemo && nadoMetrics?.nadoVolumeUSD !== undefined
                          ? (nadoMetrics.nadoVolumeUSD || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '12,340.00'}
                      </span>
                    </div>
                  </div>
                </div>

                {(!isDemo && nadoMetrics && nadoMetrics.totalTransactions > 0) || (isDemo) ? (
                  <div className="mt-2 text-xs text-indigo-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                    Active Nado User
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* GM Activity Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-purple-500/20 bg-gradient-to-br from-purple-500/12 to-purple-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.6s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.gm}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-yellow-500/50 rounded transition-all cursor-pointer"
                  title="Visit GM"
                >
                  <img
                    src="https://gm.inkonchain.com/favicon.ico"
                    alt="GM"
                    className="w-6 h-6 rounded"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </a>
                GM Activity
              </h3>
            </div>

            {!isDemo && (isMetricLoading('gmCount') || !realGmData) ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="h-16 w-24 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-4 w-32 bg-slate-700/30 rounded animate-pulse"></div>
              </div>
            ) : (
              <>
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="text-5xl font-bold font-display text-purple-500/80 mb-2">
                    {!isDemo && realGmData ? (realGmData.count || 0) : (data.stats.gmInteractionCount || 0)}
                  </div>
                  <div className="text-sm text-slate-400">Total Transactions</div>
                </div>
                {((!isDemo && realGmData ? (realGmData.count || 0) : (data.stats.gmInteractionCount || 0)) > 0) && (
                  <div className="mt-3 text-xs text-purple-500/80 flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                    Active GM Participant
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bridge Volume Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-teal-500/20 bg-gradient-to-br from-teal-500/12 to-teal-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.65s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.entries(BRIDGE_PLATFORMS).slice(0, 3).map(([name, platform], i) => (
                    <a
                      key={i}
                      href={platform.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:z-10 hover:ring-2 hover:ring-purple-500/50 rounded-full transition-all cursor-pointer"
                      style={{ zIndex: 3 - i }}
                      title={`Visit ${name}`}
                    >
                      <img
                        src={getProxiedImageUrl(platform.logo)}
                        alt={name}
                        className="w-6 h-6 rounded-full object-cover bg-slate-800"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${name.charAt(0)}&background=334155&color=94a3b8&size=24`;
                        }}
                      />
                    </a>
                  ))}
                </div>
                Bridge Volume
              </h3>
            </div>

            {!isDemo && (isMetricLoading('bridge') || !bridgeVolume) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-28 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse"></div>
              </div>
            ) : !isDemo && bridgeVolume ? (
              (() => {
                // Show all platforms from the API response
                // Use logo/url from API if available, fallback to hardcoded BRIDGE_PLATFORMS
                const allPlatforms = bridgeVolume.byPlatform.map(platformData => {
                  const displayName = platformData.subPlatform || platformData.platform;
                  const fallback = BRIDGE_PLATFORMS[displayName] || BRIDGE_PLATFORMS[platformData.platform];

                  return {
                    platformName: displayName,
                    logoUrl: platformData.logo || fallback?.logo || `https://ui-avatars.com/api/?name=${displayName.charAt(0)}&background=7c3aed&color=fff&size=24`,
                    platformUrl: platformData.url || fallback?.url || '#',
                    usdValue: platformData.usdValue || 0,
                    txCount: platformData.txCount || 0,
                    bridgedInUsd: platformData.bridgedInUsd,
                    bridgedInCount: platformData.bridgedInCount,
                    bridgedOutUsd: platformData.bridgedOutUsd,
                    bridgedOutCount: platformData.bridgedOutCount,
                  };
                });

                const totalUsd = bridgeVolume.totalUsd || 0;
                const totalTxCount = bridgeVolume.txCount || 0;

                return (
                  <>
                    <div className="mb-3">
                      <div className="text-2xl font-bold font-display text-teal-400">
                        ${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-xs text-slate-500">{totalTxCount} transactions</div>
                    </div>

                    <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">By Platform</span>
                      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {allPlatforms
                          .sort((a, b) => {
                            // Custom order: Ink Official -> Relay -> Native -> Bungee
                            const bridgeOrder: Record<string, number> = {
                              'Ink Official': 0,
                              'Relay': 1,
                              'Native Bridge (USDT0)': 2,
                              'Bungee': 3,
                            };
                            const orderA = bridgeOrder[a.platformName] ?? 99;
                            const orderB = bridgeOrder[b.platformName] ?? 99;
                            return orderA - orderB;
                          })
                          .map((platform, i) => (
                            <div key={i} className="text-[11px]">
                              <div className="flex justify-between items-center py-0.5">
                                <span className="text-slate-400 flex items-center gap-1">
                                  <a
                                    href={platform.platformUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:ring-2 hover:ring-purple-500/50 rounded transition-all cursor-pointer"
                                    title={`Visit ${platform.platformName}`}
                                  >
                                    <img
                                      src={getProxiedImageUrl(platform.logoUrl)}
                                      alt={platform.platformName}
                                      className="w-3 h-3 rounded"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </a>
                                  <span className="truncate max-w-[80px]">{platform.platformName}</span>
                                </span>
                                <span className="font-mono text-white text-[10px]">
                                  ${platform.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                              {/* Show bridged in/out for platforms that have both */}
                              {(platform.platformName === 'Native Bridge (USDT0)' || platform.platformName === 'Relay' || platform.platformName === 'Ink Official' || platform.platformName === 'Bungee') &&
                                (platform.bridgedInUsd !== undefined || platform.bridgedOutUsd !== undefined) &&
                                (platform.bridgedInUsd || 0) + (platform.bridgedOutUsd || 0) > 0 && (
                                  <div className="ml-4 flex gap-3 text-[9px] text-slate-500">
                                    <span className="text-green-400">
                                      ↓ ${(platform.bridgedInUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      <span className="text-slate-600 ml-0.5">({platform.bridgedInCount || 0})</span>
                                    </span>
                                    <span className="text-orange-400">
                                      ↑ ${(platform.bridgedOutUsd || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                      <span className="text-slate-600 ml-0.5">({platform.bridgedOutCount || 0})</span>
                                    </span>
                                  </div>
                                )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {totalTxCount > 0 && (
                      <div className="mt-2 text-xs text-teal-400 opacity-80 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
                        Active Bridger
                      </div>
                    )}
                  </>
                );
              })()
            ) : (
              <div className="flex-1 flex flex-col">
                {isDemo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-2xl font-bold font-display text-purple-400 mb-2">$12,450.00</div>
                      <div className="text-xs">Demo Bridge Volume</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center">
                    <div className="h-8 w-28 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                    <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Swap Volume Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-cyan-500/20 bg-gradient-to-br from-cyan-500/12 to-cyan-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.75s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.values(DEX_PLATFORMS).slice(0, 3).map((platform, i) => (
                    <a
                      key={i}
                      href={platform.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:z-10 hover:ring-2 hover:ring-cyan-500/50 rounded-full transition-all cursor-pointer"
                      style={{ zIndex: 3 - i }}
                      title={`Visit ${platform.name}`}
                    >
                      <img
                        src={getProxiedImageUrl(platform.logo)}
                        alt={platform.name}
                        className="w-6 h-6 rounded-full object-cover bg-slate-800"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${platform.name.charAt(0)}&background=334155&color=94a3b8&size=24`;
                        }}
                      />
                    </a>
                  ))}
                </div>
                Swap Volume
              </h3>
            </div>

            {!isDemo && (isMetricLoading('swap') || !swapVolume) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-28 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              </div>
            ) : !isDemo && swapVolume ? (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-cyan-400">
                    ${swapVolume.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-slate-500">{swapVolume.txCount} swaps</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">By Platform</span>
                  <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                    {Object.entries(DEX_PLATFORMS)
                      .map(([contractAddress, platformInfo]) => {
                        const platformData = swapVolume.byPlatform.find(
                          p => p.contractAddress.toLowerCase() === contractAddress.toLowerCase()
                        );
                        return {
                          contractAddress,
                          platformInfo,
                          usdValue: platformData?.usdValue || 0,
                          txCount: platformData?.txCount || 0,
                        };
                      })
                      .sort((a, b) => b.usdValue - a.usdValue)
                      .map((platform, i) => (
                        <div key={i} className="flex justify-between items-center text-[11px] py-0.5">
                          <span className="text-slate-400 flex items-center gap-1">
                            <a
                              href={platform.platformInfo.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:ring-2 hover:ring-cyan-500/50 rounded transition-all cursor-pointer"
                              title={`Visit ${platform.platformInfo.name}`}
                            >
                              <img
                                src={getProxiedImageUrl(platform.platformInfo.logo)}
                                alt={platform.platformInfo.name}
                                className="w-3 h-3 rounded"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                }}
                              />
                            </a>
                            {platform.platformInfo.name}
                          </span>
                          <span className="font-mono text-white text-[10px]">
                            ${platform.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                {swapVolume.txCount > 0 && (
                  <div className="mt-2 text-xs text-cyan-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    Active Trader
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col">
                {isDemo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-2xl font-bold font-display text-cyan-400 mb-2">$8,750.00</div>
                      <div className="text-xs">Demo Swap Volume</div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center">
                    <div className="h-8 w-28 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                    <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                )}
              </div>
            )}
          </div>


        </div>

        {/* Dynamic Cards Row 3 - Admin added aggregate cards */}
        {!isDemo && dynamicCardsRow3.length > 0 && (
          <DynamicCardsCarouselRow3 cards={dynamicCardsRow3} />
        )}

        {/* Row 4: Templars + OpenSea + Otomate */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {/* Templars of the Storm NFT Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-purple-500/20 bg-gradient-to-br from-purple-500/12 to-purple-900/5 h-[300px] flex flex-col" style={{ animationDelay: '1.1s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS['templars']}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-purple-500/50 rounded-full transition-all cursor-pointer"
                  title="View Collection"
                >
                  <img
                    src={getProxiedImageUrl('https://i2c.seadn.io/admin-uploads/f189f573f43d0fa8eab11049be7133/aaf189f573f43d0fa8eab11049be7133.png?h=250&w=250')}
                    alt="Templars of the Storm"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Templars&background=a855f7&color=fff&size=24';
                    }}
                  />
                </a>
                Templars of the Storm
              </h3>
            </div>

            {!isDemo ? (
              (isMetricLoading('templarsNftBalance') || !templarsNftBalance) ? (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-purple-400">
                      {templarsNftBalance.total_count.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      {templarsNftBalance.total_count} NFT{templarsNftBalance.total_count !== 1 ? 's' : ''} held
                    </div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Collection</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Templars of the Storm</span>
                        <span className="font-mono text-purple-400">NFT</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Balance</span>
                        <span className="font-mono text-white">{templarsNftBalance.total_count}</span>
                      </div>
                    </div>
                  </div>

                  {templarsNftBalance.total_count > 0 && (
                    <div className="mt-2 text-xs text-purple-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                      Templar Holder
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-purple-400">0</div>
                  <div className="text-xs text-slate-500">0 NFTs held</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Collection</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Templars of the Storm</span>
                      <span className="font-mono text-slate-500">NFT</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Balance</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* OpenSea Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-sky-500/20 bg-gradient-to-br from-sky-500/12 to-sky-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.75s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.opensea}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-sky-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit OpenSea"
                >
                  <img
                    src="https://opensea.io/favicon.ico"
                    alt="OpenSea"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=OS&background=2081e2&color=fff&size=24';
                    }}
                  />
                </a>
                OpenSea
              </h3>
            </div>

            {!isDemo ? (
              (isMetricLoading('openseaBuyCount') || isMetricLoading('mintCount') || isMetricLoading('openseaSaleCount') || !realOpenSeaBuys) ? (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-32 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                    <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                    <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-sky-400">
                      {((realOpenSeaBuys?.count || 0) + (realMintCount?.count || 0) + (realOpenSeaSales?.count || 0)).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">Total Activity</div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Type</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Buys</span>
                        <span className="font-mono text-white">{(realOpenSeaBuys?.count || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Sales</span>
                        <span className="font-mono text-white">{(realOpenSeaSales?.count || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Mints</span>
                        <span className="font-mono text-white">{(realMintCount?.count || 0).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {((realOpenSeaBuys?.count || 0) + (realMintCount?.count || 0) + (realOpenSeaSales?.count || 0)) > 0 && (
                    <div className="mt-2 text-xs text-sky-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                      Active NFT Trader
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-sky-400">10</div>
                  <div className="text-xs text-slate-500">Total Activity</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Type</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Buys</span>
                      <span className="font-mono text-white">5</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Sales</span>
                      <span className="font-mono text-white">2</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Mints</span>
                      <span className="font-mono text-white">3</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-sky-400 opacity-80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                  Active NFT Trader
                </div>
              </>
            )}
          </div>
          {/* Otomate Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-green-500/20 bg-gradient-to-br from-green-500/12 to-green-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.9s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.otomate}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-pink-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit Otomate"
                >
                  <img
                    src="https://www.otomate.trade/favicon.ico"
                    alt="Otomate"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=C&background=ec4899&color=fff&size=24';
                    }}
                  />
                </a>
                Otomate
              </h3>
            </div>

            {!isDemo ? (
              (isMetricLoading('copink') || !copinkMetrics) ? (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-32 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-green-400">
                      ${copinkMetrics.totalVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-500">
                      Total Trading Volume
                    </div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Account Details</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Subaccounts Found</span>
                        <span className="font-mono text-white">{copinkMetrics.subaccountsFound}</span>
                      </div>
                    </div>
                  </div>

                  {copinkMetrics.totalVolume > 0 && (
                    <div className="mt-2 text-xs text-green-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                      Active Otomate Trader
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-violet-400">$0.00</div>
                  <div className="text-xs text-slate-500">Total Trading Volume</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Account Details</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Subaccounts Found</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Dynamic Cards Row 4 - Admin added single platform cards */}
        {!isDemo && dynamicCardsRow4.length > 0 && (
          <DynamicCardsCarouselRow4 cards={dynamicCardsRow4} />
        )}

        {/* Row 4b: InkScore Zenith + Staking + Sweep + ZNS (single row) */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {/* InkScore Zenith NFT Card */}
          <div className="glass-card relative overflow-hidden p-6 rounded-2xl animate-fade-in-up border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-500/15 via-fuchsia-900/10 to-fuchsia-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.68s' }}>
            {/* Decorative glow + shine */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-fuchsia-500/20 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/70 to-transparent"></div>

            <div className="relative flex items-center justify-between mb-4 gap-2">
              <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                <a
                  href={PLATFORM_URLS.zenithOpensea}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ring-2 ring-fuchsia-500/30 hover:ring-fuchsia-400/60 rounded-full transition-all cursor-pointer"
                  title="View InkScore Zenith on OpenSea"
                >
                  <img
                    src="https://i2c.seadn.io/collection/inkscore-zenith/image_type_logo/831152ff66038d827191d68d3d66b9/2f831152ff66038d827191d68d3d66b9.png?h=250&w=250"
                    alt="InkScore Zenith"
                    className="w-7 h-7 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=Z&background=d946ef&color=fff&size=24';
                    }}
                  />
                </a>
                <span className="truncate">InkScore Zenith</span>
              </h3>
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/30">
                New
              </span>
            </div>

            {!isDemo ? (
              (isMetricLoading('zenithNft') || !zenithNftMetrics) ? (
                <div className="flex-1 flex flex-col justify-center items-center">
                  <div className="h-16 w-24 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-4 w-32 bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              ) : (
                <>
                  <div className="relative mb-3">
                    <div className="text-3xl font-extrabold font-display bg-gradient-to-r from-fuchsia-200 via-fuchsia-400 to-fuchsia-600 bg-clip-text text-transparent">
                      {zenithNftMetrics.total_count.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      NFTs Held
                    </div>
                  </div>

                  <div className="relative flex-1 pt-3 border-t border-fuchsia-500/15">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Collection Details</span>
                    <div className="space-y-2">
                      <a
                        href={PLATFORM_URLS.zenithNft}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex justify-between items-center text-[11px] hover:text-fuchsia-300 transition-colors cursor-pointer"
                        title="View InkScore Zenith on Explorer"
                      >
                        <span className="text-slate-400">Contract</span>
                        <span className="font-mono text-white hover:text-fuchsia-300 transition-colors">0xd028...8c78 ↗</span>
                      </a>
                    </div>
                  </div>

                  {zenithNftMetrics.total_count > 0 && (
                    <div className="mt-2 text-xs text-fuchsia-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 animate-pulse"></span>
                      Zenith Holder
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="relative mb-3">
                  <div className="text-3xl font-extrabold font-display bg-gradient-to-r from-fuchsia-200 via-fuchsia-400 to-fuchsia-600 bg-clip-text text-transparent">0</div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider">NFTs Held</div>
                </div>

                <div className="relative flex-1 pt-3 border-t border-fuchsia-500/15">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Collection Details</span>
                  <div className="space-y-2">
                    <a
                      href={PLATFORM_URLS.zenithNft}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex justify-between items-center text-[11px] hover:text-fuchsia-300 transition-colors cursor-pointer"
                      title="View InkScore Zenith on Explorer"
                    >
                      <span className="text-slate-400">Contract</span>
                      <span className="font-mono text-white hover:text-fuchsia-300 transition-colors">0xd028...8c78 ↗</span>
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* InkScore Zenith Staking Card */}
          <div className="glass-card relative overflow-hidden p-6 rounded-2xl animate-fade-in-up border border-indigo-500/25 bg-gradient-to-br from-indigo-500/15 via-violet-900/10 to-indigo-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.65s' }}>
            {/* Decorative glow + shine */}
            <div className="absolute -top-12 -right-12 w-36 h-36 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-400/70 to-transparent"></div>

            <div className="relative flex items-center justify-between mb-4 gap-2">
              <h3 className="text-base font-semibold text-white flex items-center gap-2 min-w-0">
                <a
                  href={PLATFORM_URLS.zenithStaking}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 ring-2 ring-indigo-500/30 hover:ring-indigo-400/60 rounded-full transition-all cursor-pointer"
                  title="View InkScore Zenith Staking"
                >
                  <img
                    src="/inkscore_logo.png"
                    alt="InkScore"
                    className="w-7 h-7 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=IS&background=6366f1&color=fff&size=24';
                    }}
                  />
                </a>
                <span className="truncate">InkScore Zenith Staking</span>
              </h3>
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                New
              </span>
            </div>

            {!isDemo ? (
              (isMetricLoading('zenithStaking') || !zenithStakingMetrics) ? (
                <div className="flex-1 flex flex-col justify-center items-center">
                  <div className="h-16 w-24 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-4 w-32 bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              ) : (
                <>
                  <div className="relative mb-3">
                    <div className="text-3xl font-extrabold font-display bg-gradient-to-r from-indigo-200 via-indigo-400 to-violet-600 bg-clip-text text-transparent">
                      {zenithStakingMetrics.total_staked.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      NFTs Staked
                    </div>
                  </div>

                  <div className="relative flex-1 pt-3 border-t border-indigo-500/15">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Lock Period</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">1 Month</span>
                        <span className="font-mono text-white">{zenithStakingMetrics.one_month_count.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">1 Week</span>
                        <span className="font-mono text-white">{zenithStakingMetrics.one_week_count.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">1 Day</span>
                        <span className="font-mono text-white">{zenithStakingMetrics.one_day_count.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {zenithStakingMetrics.total_staked > 0 && (
                    <div className="mt-2 text-xs text-indigo-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                      Active Staker
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="relative mb-3">
                  <div className="text-3xl font-extrabold font-display bg-gradient-to-r from-indigo-200 via-indigo-400 to-violet-600 bg-clip-text text-transparent">0</div>
                  <div className="text-[11px] text-slate-500 uppercase tracking-wider">NFTs Staked</div>
                </div>

                <div className="relative flex-1 pt-3 border-t border-indigo-500/15">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Lock Period</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">1 Month</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">1 Week</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">1 Day</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Sweep Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-yellow-500/20 bg-gradient-to-br from-yellow-500/12 to-yellow-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.93s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.sweep}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-yellow-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit Sweep"
                >
                  <img
                    src="https://sweep.haus/sweep.png"
                    alt="Sweep"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=S&background=eab308&color=fff&size=24';
                    }}
                  />
                </a>
                Sweep
              </h3>
            </div>

            {!isDemo && (isMetricLoading('sweep') || !sweepMetrics) ? (
              <div className="flex-1 flex flex-col justify-center items-center">
                <div className="h-16 w-24 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-4 w-32 bg-slate-700/30 rounded animate-pulse"></div>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-yellow-400">
                    {(!isDemo && sweepMetrics ? (sweepMetrics.totalCollections || 0) : 0).toLocaleString()}
                  </div>
                  <div className="text-xs text-slate-500">
                    NFT Collections Deployed
                  </div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">Account Details</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Sweep Badges</span>
                      <span className="font-mono text-white">{(sweepMetrics?.sweepBadgeBalance || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Total Streak</span>
                      <span className="font-mono text-white">{(sweepMetrics?.totalStreak || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {((!isDemo && sweepMetrics ? (sweepMetrics.totalCollections || 0) : 0) > 0 || (!isDemo && sweepMetrics ? (sweepMetrics.sweepBadgeBalance || 0) : 0) > 0) && (
                  <div className="mt-2 text-xs text-yellow-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse"></span>
                    NFT Creator
                  </div>
                )}
              </>
            )}
          </div>
          {/* ZNS Domain Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-lime-500/20 bg-gradient-to-br from-lime-500/12 to-lime-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.8s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.zns}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-blue-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit ZNS Connect"
                >
                  <img
                    src="https://pbs.twimg.com/profile_images/1813882885406965760/7wkPAsLn_400x400.jpg"
                    alt="ZNS"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=ZNS&background=3b82f6&color=fff&size=24';
                    }}
                  />
                </a>
                ZNS Connect
              </h3>
            </div>

            {!isDemo && (isMetricLoading('zns') || !znsMetrics) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-lime-400">
                    {!isDemo && znsMetrics ? znsMetrics.total_count : 0}
                  </div>
                  <div className="text-xs text-slate-500">
                    {!isDemo && znsMetrics ? znsMetrics.total_count : 0} transactions
                  </div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Deploy Smart Contract</span>
                      <span className="font-mono text-white">
                        {!isDemo && znsMetrics ? znsMetrics.deploy_count : 0}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Say GM</span>
                      <span className="font-mono text-white">
                        {!isDemo && znsMetrics ? znsMetrics.say_gm_count : 0}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Register Domain</span>
                      <span className="font-mono text-white">
                        {!isDemo && znsMetrics ? znsMetrics.register_domain_count : 0}
                      </span>
                    </div>
                  </div>
                </div>

                {!isDemo && znsMetrics && znsMetrics.total_count > 0 && (
                  <div className="mt-2 text-xs text-lime-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-lime-400 animate-pulse"></span>
                    Active ZNS User
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* InkyPump Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-pink-500/20 bg-gradient-to-br from-pink-500/12 to-pink-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.7s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.inkypump}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-pink-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit InkyPump"
                >
                  <img
                    src="https://www.inkypump.com/favicon.ico"
                    alt="InkyPump"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=IP&background=ec4899&color=fff&size=24';
                    }}
                  />
                </a>
                InkyPump
              </h3>
            </div>

            {!isDemo && (isMetricLoading('inkypumpCreatedTokens') || isMetricLoading('inkypumpBuyVolume') || isMetricLoading('inkypumpSellVolume') || !inkyPumpCreatedTokens || !inkyPumpBuyVolume || !inkyPumpSellVolume) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                <div className="h-20 w-full bg-slate-700/30 rounded animate-pulse"></div>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-pink-400">
                    {!isDemo && inkyPumpCreatedTokens ? inkyPumpCreatedTokens.count : 0}
                  </div>
                  <div className="text-xs text-slate-500">Created Tokens</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Created Tokens</span>
                      <span className="font-mono text-white">{!isDemo && inkyPumpCreatedTokens ? inkyPumpCreatedTokens.count : 0}</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Buy Token volume</span>
                      <span className="font-mono text-white">
                        ${!isDemo && inkyPumpBuyVolume ? parseFloat(inkyPumpBuyVolume.total_value).toFixed(2) : '0.00'}
                        <span className="pl-[2px] text-[10px] text-slate-500"> /
                          {!isDemo && inkyPumpBuyVolume ? inkyPumpBuyVolume.total_count || 0 : 0} tx
                        </span>
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Sell Token volume</span>
                      <span className="font-mono text-white">
                        ${!isDemo && inkyPumpSellVolume ? parseFloat(inkyPumpSellVolume.total_value).toFixed(2) : '0.00'}
                        <span className="pl-[2px] text-[10px] text-slate-500"> /
                          {!isDemo && inkyPumpSellVolume ? inkyPumpSellVolume.total_count || 0 : 0} tx
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
           {/* Shellies Unified Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-violet-500/20 bg-gradient-to-br from-violet-500/12 to-violet-900/5 h-[300px] flex flex-col" style={{ animationDelay: '1.0s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.shellies}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-violet-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit Shellies"
                >
                  <img
                    src="https://pbs.twimg.com/profile_images/1948768160733175808/aNFNH1IH_400x400.jpg"
                    alt="Shellies"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=S&background=8b5cf6&color=fff&size=24';
                    }}
                  />
                </a>
                Shellies
              </h3>
            </div>

            {!isDemo && (isMetricLoading('shelliesJoinedRaffles') || isMetricLoading('shelliesPayToPlay') || !shelliesJoinedRaffles || !shelliesPayToPlay) ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-32 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  <div className="h-4 w-full bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-violet-400">
                    {!isDemo && shelliesJoinedRaffles && shelliesPayToPlay
                      ? (shelliesJoinedRaffles.total_count + shelliesPayToPlay.total_count)
                      : 0}
                  </div>
                  <div className="text-xs text-slate-500">Total Transactions</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Activity</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Joined Raffles</span>
                      <span className="font-mono text-white">
                        {!isDemo && shelliesJoinedRaffles ? shelliesJoinedRaffles.total_count : 0}
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Pay to Play</span>
                      <span className="font-mono text-white">
                        {!isDemo && shelliesPayToPlay ? shelliesPayToPlay.total_count : 0}
                      </span>
                    </div>
                  </div>
                </div>

                {!isDemo && shelliesJoinedRaffles && shelliesPayToPlay &&
                  (shelliesJoinedRaffles.total_count + shelliesPayToPlay.total_count) > 0 && (
                    <div className="mt-2 text-xs text-violet-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span>
                      Active Shellies User
                    </div>
                  )}
              </>
            )}
          </div>
          {/* NFT2Me Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-cyan-500/20 bg-gradient-to-br from-cyan-500/12 to-cyan-900/5 h-[300px] flex flex-col" style={{ animationDelay: '0.95s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.nft2me}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-emerald-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit NFT2Me"
                >
                  <img
                    src="https://pbs.twimg.com/profile_images/1626191411384053761/NoRNmw9L_400x400.png"
                    alt="NFT2Me"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=N2M&background=10b981&color=fff&size=24';
                    }}
                  />
                </a>
                NFT2Me
              </h3>
            </div>

            {!isDemo ? (
              (isMetricLoading('nft2me') || !nft2meMetrics) ? (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-cyan-400">
                      {nft2meMetrics.totalTransactions.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      {nft2meMetrics.totalTransactions} transaction{nft2meMetrics.totalTransactions !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Collections Created</span>
                        <span className="font-mono text-white">{nft2meMetrics.collectionsCreated}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">NFTs Minted</span>
                        <span className="font-mono text-white">{nft2meMetrics.nftsMinted}</span>
                      </div>
                    </div>
                  </div>

                  {nft2meMetrics.totalTransactions > 0 && (
                    <div className="mt-2 text-xs text-emerald-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      NFT2Me Creator
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-cyan-400">3</div>
                  <div className="text-xs text-slate-500">3 transactions</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Collections Created</span>
                      <span className="font-mono text-white">1</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">NFTs Minted</span>
                      <span className="font-mono text-white">2</span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-emerald-400 opacity-80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  NFT2Me Creator
                </div>
              </>
            )}
          </div>
        </div>
        {/* Holdings Section - Tokens & NFTs */}
        {!isDemo && realWalletStats && (
          <HoldingsSection
            tokenHoldings={realWalletStats.tokenHoldings}
            nftCollections={realWalletStats.nftCollections}
            nativeEthUsd={realWalletStats.balanceUsd}
            nativeEthBalance={realWalletStats.balanceEth}
          />
        )}
      </div>

      {/* Streaming Debug Panel - Only show when streaming is enabled and not in demo mode */}
      {enableStreaming && !isDemo && (
        <StreamingDebugPanel
          isConnected={streamingState.isConnected}
          isComplete={streamingState.isComplete}
          loadingMetrics={streamingState.loadingMetrics}
          errors={streamingState.errors}
          totalDuration={streamingState.totalDuration}
          timedOut={streamingState.timedOut}
          totalMetrics={24}
        />
      )}
    </div>
  );
};

