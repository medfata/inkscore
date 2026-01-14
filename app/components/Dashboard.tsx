"use client";

import React, { useState, useEffect, useCallback } from 'react';
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

// Bridge platform logos and URLs
const BRIDGE_PLATFORMS: Record<string, { logo: string; url: string }> = {
  'Native Bridge (USDT0)': {
    logo: 'https://pbs.twimg.com/profile_images/1879546764971188224/SQISVYwX_400x400.jpg',
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
  'gm': 'https://gm.inkonchain.com',
  'inkypump': 'https://www.inkypump.com',
  'zns': 'https://zns.bio',
  'marvk': 'https://marvk.io',
  'nft2me': 'https://nft2me.com',
  'shellies': 'https://shellies.xyz',
};

// NFT Marketplace platform logos and info (keyed by lowercase contract address)
const NFT_PLATFORMS: Record<string, { name: string; logo: string; url: string }> = {
  '0x9ebf93fdba9f32accab3d6716322dccd617a78f3': {
    name: 'Squid Market',
    logo: 'https://www.squidmarket.xyz/favicon.ico',
    url: 'https://www.squidmarket.xyz/',
  },
  '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5': {
    name: 'Net Protocol',
    logo: 'https://www.netprotocol.app/favicon.ico',
    url: 'https://www.netprotocol.app/',
  },
  '0xbd6a027b85fd5285b1623563bbef6fadbe396afb': {
    name: 'Mintiq',
    logo: 'https://i.ibb.co/bMN9ppS7/mmm.png',
    url: 'https://mintiq.market/',
  }
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

// NFT Trading response type
interface NftTradingResponse {
  total_count: number;
  by_contract: Array<{
    contract_address: string;
    count: number;
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

// Marvk metrics response type
interface MarvkMetrics {
  lockTokenCount: number;
  vestTokenCount: number;
  totalTransactions: number;
}

interface DashboardProps {
  walletAddress: string;
  isDemo?: boolean;
}

const SUPPORTED_COLLECTIONS = [
  { name: 'Shellies', address: '0x1c9838cdc00fa39d953a54c755b95605ed5ea49c', points: 100, twitterHandle: 'ShelliesNFT' },
  { name: 'InkySquad', address: '0xE4e5D5170Ba5cae36D1876893D4b218E8Ed19C91', points: 100, twitterHandle: 'InkySquad' },
  { name: 'BOI', address: '0x63FEbFa0a5474803F4261a1628763b1B2cC3AB83', points: 100, twitterHandle: 'Boi_Ink' },
  { name: 'INK Bunnies', address: '0x4443970B315d3c08C2f962fe00770c52396AFDb7', points: 100, twitterHandle: 'InkBunnies' },
];

const SUPPORTED_TOKENS = [
  { name: 'Global Dollar', symbol: 'USDT0', address: '0x0200C29006150606B650577BBE7B6248F58470c1' },
  { name: 'USD Coin', symbol: 'USDC', address: '0xe343167631d89B6Ffc58B88d6b7fB0228795491D' },
  { name: 'Ethereum', symbol: 'ETH', address: '0x4200000000000000000000000000000000000006' },
  { name: 'ANITA', symbol: 'ANITA', address: '0x0606FC632ee812bA970af72F8489baAa443C4B98' },
  { name: 'Cat on Ink', symbol: 'CAT', address: '0x20C69C12abf2B6F8D8ca33604DD25C700c7e70A5' },
  { name: 'Purple', symbol: 'PURPLE', address: '0xD642B49d10cc6e1BC1c6945725667c35e0875f22' },
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

interface NftCollectionHolding {
  name: string;
  address: string;
  logo: string;
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

const REFRESH_COOLDOWN_MS = 30000; // 30 seconds

export const Dashboard: React.FC<DashboardProps> = ({ walletAddress, isDemo }) => {
  const [data, setData] = useState<{ stats: WalletStats, score: ScoreData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [realGmData, setRealGmData] = useState<{ count: number; } | null>(null);
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
  const [nftTrading, setNftTrading] = useState<NftTradingResponse | null>(null);
  const [walletScore, setWalletScore] = useState<WalletScoreResponse | null>(null);
  const [totalVolume, setTotalVolume] = useState<TotalVolumeResponse | null>(null);
  const [znsMetrics, setZnsMetrics] = useState<ZnsMetricsResponse | null>(null);
  const [nft2meMetrics, setNft2meMetrics] = useState<Nft2MeResponse | null>(null);
  const [marvkMetrics, setMarvkMetrics] = useState<MarvkMetrics | null>(null);
  const [inkyPumpCreatedTokens, setInkyPumpCreatedTokens] = useState<{ count: number } | null>(null);
  const [inkyPumpBuyVolume, setInkyPumpBuyVolume] = useState<{ total_value: string; total_count: number } | null>(null);
  const [inkyPumpSellVolume, setInkyPumpSellVolume] = useState<{ total_value: string; total_count: number } | null>(null);

  // Shellies metrics state
  const [shelliesJoinedRaffles, setShelliesJoinedRaffles] = useState<{ total_count: number } | null>(null);
  const [shelliesPayToPlay, setShelliesPayToPlay] = useState<{ total_count: number } | null>(null);
  const [shelliesStaking, setShelliesStaking] = useState<{ total_count: number } | null>(null);

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

  // Refresh all data function
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
    setNftTrading(null);
    setWalletScore(null);
    setTotalVolume(null);
    setZnsMetrics(null);
    setNft2meMetrics(null);
    setInkyPumpCreatedTokens(null);
    setInkyPumpBuyVolume(null);
    setInkyPumpSellVolume(null);

    // Clear Shellies data
    setShelliesJoinedRaffles(null);
    setShelliesPayToPlay(null);
    setShelliesStaking(null);

    try {
      const fetchPromises = [];

      // Wallet stats
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/stats`)
          .then(res => res.ok ? res.json() : null)
          .then(stats => {
            if (stats) {
              setRealWalletStats({
                balanceUsd: Number(stats.balanceUsd) || 0,
                balanceEth: Number(stats.balanceEth) || 0,
                totalTxns: Number(stats.totalTxns) || 0,
                nftCount: Number(stats.nftCount) || 0,
                ageDays: Number(stats.ageDays) || 0,
                nftCollections: stats.nftCollections || [],
                tokenHoldings: (stats.tokenHoldings || []).map((t: { name: string; symbol: string; address: string; logo: string; balance: number; usdValue: number }) => ({
                  ...t,
                  balance: Number(t.balance) || 0,
                  usdValue: Number(t.usdValue) || 0,
                })),
              });
            }
          })
          .catch(err => console.error('Failed to refresh wallet stats:', err))
      );

      // GM data
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/gm_count`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setRealGmData({ count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh GM data:', err))
      );

      // InkyPump created tokens data
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/inkypump_created_tokens`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setInkyPumpCreatedTokens({ count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh InkyPump created tokens data:', err))
      );

      // InkyPump buy volume data
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/inkypump_buy_volume`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setInkyPumpBuyVolume({ total_value: data.total_value || '0.00', total_count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh InkyPump buy volume data:', err))
      );

      // InkyPump sell volume data
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/inkypump_sell_volume`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setInkyPumpSellVolume({ total_value: data.total_value || '0.00', total_count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh InkyPump sell volume data:', err))
      );

      // Tydro data
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              const supplyMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'tydro_usd_supply');
              const borrowMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'Tydro_usd_borrow');
              setRealTydroData({
                supplyVolume: parseFloat(supplyMetric?.total_value || '0'),
                supplyCount: supplyMetric?.total_count || 0,
                borrowVolume: parseFloat(borrowMetric?.total_value || '0'),
                borrowCount: borrowMetric?.total_count || 0,
              });

              // InkySwap from same endpoint
              const inkySwapMetric = data.metrics?.find((m: { slug: string }) =>
                m.slug.toLowerCase().includes('inkyswap')
              );
              if (inkySwapMetric) {
                setInkySwapVolume({
                  totalValue: parseFloat(inkySwapMetric.total_value || '0'),
                  totalCount: inkySwapMetric.total_count || 0,
                });
              }
            }
          })
          .catch(err => console.error('Failed to refresh Tydro data:', err))
      );

      // Tydro current supply (event-sourced: deposits - withdrawals)
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/tydro`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setTydroCurrentSupply({
                currentSupplyUsd: data.currentSupplyUsd || 0,
                currentSupplyEth: data.currentSupplyEth || 0,
                totalDepositedUsd: data.totalDepositedUsd || 0,
                totalWithdrawnUsd: data.totalWithdrawnUsd || 0,
                depositCount: data.depositCount || 0,
                withdrawCount: data.withdrawCount || 0,
                currentBorrowUsd: data.currentBorrowUsd || 0,
                currentBorrowEth: data.currentBorrowEth || 0,
                totalBorrowedUsd: data.totalBorrowedUsd || 0,
                totalRepaidUsd: data.totalRepaidUsd || 0,
                borrowCount: data.borrowCount || 0,
                repayCount: data.repayCount || 0,
              });
            }
          })
          .catch(err => console.error('Failed to refresh Tydro current supply:', err))
      );

      // Bridge volume
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/bridge`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setBridgeVolume(data);
          })
          .catch(err => console.error('Failed to refresh bridge volume:', err))
      );

      // Swap volume
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/swap`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setSwapVolume({
                totalUsd: data.totalUsd || 0,
                txCount: data.txCount || 0,
                byPlatform: data.byPlatform?.map((p: { platform: string; contractAddress: string; usdValue: number; txCount: number }) => ({
                  platform: p.platform,
                  contractAddress: p.contractAddress,
                  usdValue: p.usdValue,
                  txCount: p.txCount,
                })) || [],
              });
            }
          })
          .catch(err => console.error('Failed to refresh swap volume:', err))
      );

      // NFT trading
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/nft_traded`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setNftTrading({
                total_count: data.total_count || 0,
                by_contract: data.by_contract || [],
              });
            }
          })
          .catch(err => console.error('Failed to refresh NFT trading:', err))
      );

      // Wallet score
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/score`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setWalletScore(data);
          })
          .catch(err => console.error('Failed to refresh wallet score:', err))
      );

      // Total volume
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/volume`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setTotalVolume(data);
          })
          .catch(err => console.error('Failed to refresh total volume:', err))
      );

      // ZNS metrics
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/zns`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setZnsMetrics({
                total_count: data.total_count || 0,
                deploy_count: data.deploy_count || 0,
                say_gm_count: data.say_gm_count || 0,
                register_domain_count: data.register_domain_count || 0,
              });
            }
          })
          .catch(err => console.error('Failed to refresh ZNS metrics:', err))
      );

      // NFT2Me metrics
      fetchPromises.push(
        fetch(`/api/wallet/${walletAddress}/nft2me`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setNft2meMetrics({
                collectionsCreated: data.collectionsCreated || 0,
                nftsMinted: data.nftsMinted || 0,
                totalTransactions: data.totalTransactions || 0,
              });
            }
          })
          .catch(err => console.error('Failed to refresh NFT2Me metrics:', err))
      );

      // Marvk metrics
      fetchPromises.push(
        fetch(`/api/marvk/${walletAddress}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setMarvkMetrics({
                lockTokenCount: data.lockTokenCount || 0,
                vestTokenCount: data.vestTokenCount || 0,
                totalTransactions: data.totalTransactions || 0,
              });
            }
          })
          .catch(err => console.error('Failed to refresh Marvk metrics:', err))
      );

      // Shellies metrics
      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/shellies_joined_raffles`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setShelliesJoinedRaffles({ total_count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh Shellies joined raffles:', err))
      );

      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/shellies_pay_to_play`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setShelliesPayToPlay({ total_count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh Shellies pay to play:', err))
      );

      fetchPromises.push(
        fetch(`/api/analytics/${walletAddress}/shellies_staking`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setShelliesStaking({ total_count: data.total_count || 0 });
          })
          .catch(err => console.error('Failed to refresh Shellies staking:', err))
      );

      await Promise.all(fetchPromises);
      setLastUpdated(new Date());
      setCooldownRemaining(REFRESH_COOLDOWN_MS);
    } finally {
      setIsRefreshing(false);
    }
  }, [walletAddress, isDemo, isRefreshing, cooldownRemaining]);

  // Format time ago for last updated
  const formatLastUpdated = (date: Date | null): string => {
    if (!date) return '';
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes === 1) return '1 min ago';
    return `${minutes} mins ago`;
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
      setData(generateMockData(walletAddress));
      setLoading(false);
      if (!isDemo) setLastUpdated(new Date());
    }, 1500);
    return () => clearTimeout(timer);
  }, [walletAddress, isDemo]);

  // Fetch real wallet stats when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchWalletStats = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/stats`);
        if (res.ok) {
          const stats = await res.json();
          setRealWalletStats({
            balanceUsd: Number(stats.balanceUsd) || 0,
            balanceEth: Number(stats.balanceEth) || 0,
            totalTxns: Number(stats.totalTxns) || 0,
            nftCount: Number(stats.nftCount) || 0,
            ageDays: Number(stats.ageDays) || 0,
            nftCollections: stats.nftCollections || [],
            tokenHoldings: (stats.tokenHoldings || []).map((t: { name: string; symbol: string; address: string; logo: string; balance: number; usdValue: number }) => ({
              ...t,
              balance: Number(t.balance) || 0,
              usdValue: Number(t.usdValue) || 0,
            })),
          });
        }
      } catch (err) {
        console.error('Failed to fetch wallet stats:', err);
      }
    };

    fetchWalletStats();
  }, [walletAddress, isDemo]);

  // Fetch real GM data when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchGmData = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}/gm_count`);
        if (res.ok) {
          const data = await res.json();
          setRealGmData({ count: data.total_count || 0 });
        }
      } catch (err) {
        console.error('Failed to fetch GM data:', err);
      }
    };

    fetchGmData();
  }, [walletAddress, isDemo]);

  // Fetch InkyPump data when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchInkyPumpData = async () => {
      try {
        // Fetch created tokens
        const createdTokensRes = await fetch(`/api/analytics/${walletAddress}/inkypump_created_tokens`);
        if (createdTokensRes.ok) {
          const data = await createdTokensRes.json();
          setInkyPumpCreatedTokens({ count: data.total_count || 0 });
        }

        // Fetch buy volume
        const buyVolumeRes = await fetch(`/api/analytics/${walletAddress}/inkypump_buy_volume`);
        if (buyVolumeRes.ok) {
          const data = await buyVolumeRes.json();
          setInkyPumpBuyVolume({ total_value: data.total_value || '0.00', total_count: data.total_count || 0 });
        }

        // Fetch sell volume
        const sellVolumeRes = await fetch(`/api/analytics/${walletAddress}/inkypump_sell_volume`);
        if (sellVolumeRes.ok) {
          const data = await sellVolumeRes.json();
          setInkyPumpSellVolume({ total_value: data.total_value || '0.00', total_count: data.total_count || 0 });
        }
      } catch (err) {
        console.error('Failed to fetch InkyPump data:', err);
      }
    };

    fetchInkyPumpData();
  }, [walletAddress, isDemo]);

  // Fetch real Tydro data when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchTydroData = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          const supplyMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'tydro_usd_supply');
          const borrowMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'Tydro_usd_borrow');

          setRealTydroData({
            supplyVolume: parseFloat(supplyMetric?.total_value || '0'),
            supplyCount: supplyMetric?.total_count || 0,
            borrowVolume: parseFloat(borrowMetric?.total_value || '0'),
            borrowCount: borrowMetric?.total_count || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch Tydro data:', err);
      }
    };

    fetchTydroData();
  }, [walletAddress, isDemo]);

  // Fetch Tydro current supply (event-sourced: deposits - withdrawals)
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchTydroCurrentSupply = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/tydro`);
        if (res.ok) {
          const data = await res.json();
          setTydroCurrentSupply({
            currentSupplyUsd: data.currentSupplyUsd || 0,
            currentSupplyEth: data.currentSupplyEth || 0,
            totalDepositedUsd: data.totalDepositedUsd || 0,
            totalWithdrawnUsd: data.totalWithdrawnUsd || 0,
            depositCount: data.depositCount || 0,
            withdrawCount: data.withdrawCount || 0,
            currentBorrowUsd: data.currentBorrowUsd || 0,
            currentBorrowEth: data.currentBorrowEth || 0,
            totalBorrowedUsd: data.totalBorrowedUsd || 0,
            totalRepaidUsd: data.totalRepaidUsd || 0,
            borrowCount: data.borrowCount || 0,
            repayCount: data.repayCount || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch Tydro current supply:', err);
      }
    };

    fetchTydroCurrentSupply();
  }, [walletAddress, isDemo]);

  // Fetch bridge volume when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchBridgeVolume = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/bridge`);
        if (res.ok) {
          const data = await res.json();
          setBridgeVolume(data);
        }
      } catch (err) {
        console.error('Failed to fetch bridge volume:', err);
      }
    };

    fetchBridgeVolume();
  }, [walletAddress, isDemo]);

  // Fetch InkySwap volume when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchInkySwapVolume = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          const inkySwapMetric = data.metrics?.find((m: { slug: string }) =>
            m.slug.toLowerCase().includes('inkyswap')
          );
          if (inkySwapMetric) {
            setInkySwapVolume({
              totalValue: parseFloat(inkySwapMetric.total_value || '0'),
              totalCount: inkySwapMetric.total_count || 0,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch InkySwap volume:', err);
      }
    };

    fetchInkySwapVolume();
  }, [walletAddress, isDemo]);

  // Fetch swap volume (DyorSwap and other DEXes) when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchSwapVolume = async () => {
      try {
        // Use the fast dedicated swap endpoint (like bridge endpoint)
        const res = await fetch(`/api/wallet/${walletAddress}/swap`);
        if (res.ok) {
          const data = await res.json();
          setSwapVolume({
            totalUsd: data.totalUsd || 0,
            txCount: data.txCount || 0,
            byPlatform: data.byPlatform?.map((p: { platform: string; contractAddress: string; usdValue: number; txCount: number }) => ({
              platform: p.platform,
              contractAddress: p.contractAddress,
              usdValue: p.usdValue,
              txCount: p.txCount,
            })) || [],
          });
        }
      } catch (err) {
        console.error('Failed to fetch swap volume:', err);
      }
    };

    fetchSwapVolume();
  }, [walletAddress, isDemo]);

  // Fetch NFT trading data when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchNftTrading = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}/nft_traded`);
        if (res.ok) {
          const data = await res.json();
          setNftTrading({
            total_count: data.total_count || 0,
            by_contract: data.by_contract || [],
          });
        }
      } catch (err) {
        console.error('Failed to fetch NFT trading data:', err);
      }
    };

    fetchNftTrading();
  }, [walletAddress, isDemo]);

  // Fetch wallet score when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchWalletScore = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/score`);
        if (res.ok) {
          const data = await res.json();
          setWalletScore(data);
        }
      } catch (err) {
        console.error('Failed to fetch wallet score:', err);
      }
    };

    fetchWalletScore();
  }, [walletAddress, isDemo]);

  // Fetch total volume when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchTotalVolume = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/volume`);
        if (res.ok) {
          const data = await res.json();
          setTotalVolume(data);
        }
      } catch (err) {
        console.error('Failed to fetch total volume:', err);
      }
    };

    fetchTotalVolume();
  }, [walletAddress, isDemo]);

  // Fetch ZNS metrics when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchZnsMetrics = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}/zns`);
        if (res.ok) {
          const data = await res.json();
          setZnsMetrics({
            total_count: data.total_count || 0,
            deploy_count: data.deploy_count || 0,
            say_gm_count: data.say_gm_count || 0,
            register_domain_count: data.register_domain_count || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch ZNS metrics:', err);
      }
    };

    fetchZnsMetrics();
  }, [walletAddress, isDemo]);

  // Fetch dynamic dashboard cards
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchDynamicCards = async () => {
      try {
        const res = await fetch(`/api/dashboard/cards/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          setDynamicCardsRow3(data.row3 || []);
          setDynamicCardsRow4(data.row4 || []);
        }
      } catch (err) {
        console.error('Failed to fetch dynamic dashboard cards:', err);
      }
    };

    fetchDynamicCards();
  }, [walletAddress, isDemo]);

  // Fetch Shellies metrics when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchShelliesMetrics = async () => {
      try {
        // Fetch joined raffles
        const joinedRafflesRes = await fetch(`/api/analytics/${walletAddress}/shellies_joined_raffles`);
        if (joinedRafflesRes.ok) {
          const data = await joinedRafflesRes.json();
          setShelliesJoinedRaffles({ total_count: data.total_count || 0 });
        }

        // Fetch pay to play
        const payToPlayRes = await fetch(`/api/analytics/${walletAddress}/shellies_pay_to_play`);
        if (payToPlayRes.ok) {
          const data = await payToPlayRes.json();
          setShelliesPayToPlay({ total_count: data.total_count || 0 });
        }

        // Fetch staking
        const stakingRes = await fetch(`/api/analytics/${walletAddress}/shellies_staking`);
        if (stakingRes.ok) {
          const data = await stakingRes.json();
          setShelliesStaking({ total_count: data.total_count || 0 });
        }
      } catch (err) {
        console.error('Failed to fetch Shellies metrics:', err);
      }
    };

    fetchShelliesMetrics();
  }, [walletAddress, isDemo]);

  // Fetch NFT2Me metrics when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchNft2meMetrics = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/nft2me`);
        if (res.ok) {
          const data = await res.json();
          setNft2meMetrics({
            collectionsCreated: data.collectionsCreated || 0,
            nftsMinted: data.nftsMinted || 0,
            totalTransactions: data.totalTransactions || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch NFT2Me metrics:', err);
      }
    };

    fetchNft2meMetrics();
  }, [walletAddress, isDemo]);

  // Fetch Marvk metrics when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchMarvkMetrics = async () => {
      try {
        const res = await fetch(`/api/marvk/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          setMarvkMetrics({
            lockTokenCount: data.lockTokenCount || 0,
            vestTokenCount: data.vestTokenCount || 0,
            totalTransactions: data.totalTransactions || 0,
          });
        }
      } catch (err) {
        console.error('Failed to fetch Marvk metrics:', err);
      }
    };

    fetchMarvkMetrics();
  }, [walletAddress, isDemo]);

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
          <div className="relative">
            <div className="w-20 h-20 border-4 border-ink-purple/20 rounded-full animate-pulse-slow"></div>
            <div className="absolute inset-0 border-4 border-t-ink-purple rounded-full animate-spin"></div>
            <Logo size="sm" showText={false} className="absolute inset-0 m-auto" />
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
            A: data.points,
            fullMark: Math.max(data.points, 100)
          });
        }
      });

      // Add platform metrics
      Object.entries(walletScore.breakdown.platforms).forEach(([slug, data]) => {
        // Shorten platform names for radar chart
        const shortName = slug.length > 8 ? slug.substring(0, 7) + '.' : slug;
        items.push({
          subject: shortName.charAt(0).toUpperCase() + shortName.slice(1),
          A: data.points,
          fullMark: Math.max(data.points, 100)
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
      { subject: 'NFTs', A: data.score.breakdown.nftPower, fullMark: 100 },
      { subject: 'Tokens', A: data.score.breakdown.tokenWeight, fullMark: 100 },
      { subject: 'DeFi', A: data.score.breakdown.defiUsage, fullMark: 100 },
      { subject: 'Activity', A: data.score.breakdown.txActivity, fullMark: 100 },
      { subject: 'Age', A: data.score.breakdown.longevity, fullMark: 100 },
      { subject: 'Loyalty', A: data.score.breakdown.ecosystemLoyalty, fullMark: 100 },
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

        {/* Top Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              label: 'Net Worth Estimate',
              value: !isDemo && realWalletStats
                ? `$${(realWalletStats.balanceUsd + realWalletStats.tokenHoldings.filter(t => t.symbol !== 'ETH').reduce((sum, t) => sum + t.usdValue, 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$${data.stats.tokenHoldingsUsd.toLocaleString()}`,
              icon: Wallet,
              color: 'blue',
              delay: '0.1s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'Total Txns',
              value: !isDemo && realWalletStats
                ? realWalletStats.totalTxns.toLocaleString()
                : data.stats.transactionCount.toLocaleString(),
              icon: Activity,
              color: 'purple',
              delay: '0.2s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'Circulated Volume',
              value: !isDemo && totalVolume
                ? `$${totalVolume.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '$0.00',
              subValue: !isDemo && totalVolume
                ? `${totalVolume.totalEth.toFixed(4)} ETH`
                : undefined,
              icon: TrendingUp,
              color: 'cyan',
              delay: '0.25s',
              isLoading: !isDemo && !totalVolume
            },
            {
              label: 'NFTs Held',
              value: !isDemo && realWalletStats
                ? realWalletStats.nftCount.toLocaleString()
                : data.stats.nftCount.toLocaleString(),
              icon: Award,
              color: 'pink',
              delay: '0.3s',
              isLoading: !isDemo && !realWalletStats
            },
            {
              label: 'On-Chain Age',
              value: !isDemo && realWalletStats
                ? `${realWalletStats.ageDays} Days`
                : `${data.stats.ageDays} Days`,
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
                      {walletScore.total_points.toLocaleString()}
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
                      {data.score.totalScore}
                    </div>
                    <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-ink-blue to-ink-purple text-white text-sm font-semibold shadow-lg shadow-purple-900/40 relative z-10">
                      {data.score.tier}
                    </div>
                  </>
                )}
                <p className="mt-3 text-slate-400 text-sm max-w-xs relative z-10">
                  {!isDemo && walletScore && walletScore.total_points > 0
                    ? 'Points based on your on-chain activity.'
                    : 'Top 5% of active InkChain addresses.'}
                </p>
                {/* Mint Score NFT Button */}
                {!isDemo && walletScore && (
                  <div className="relative z-10 max-w-xs">
                    <MintScoreNFT
                      walletAddress={walletAddress}
                      currentScore={walletScore.total_points}
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
                    src="https://app.tydro.com/tydro-logo.svg"
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

            {!isDemo && !realTydroData && !tydroCurrentSupply ? (
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
                        ? tydroCurrentSupply.currentSupplyUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '0.00'}
                    </div>
                    {!isDemo && tydroCurrentSupply && tydroCurrentSupply.currentSupplyEth > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {tydroCurrentSupply.currentSupplyEth.toFixed(4)} ETH
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
                        ? tydroCurrentSupply.currentBorrowUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '0.00'}
                    </div>
                    {!isDemo && tydroCurrentSupply && tydroCurrentSupply.currentBorrowEth > 0 && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {tydroCurrentSupply.currentBorrowEth.toFixed(4)} ETH
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
                            ? tydroCurrentSupply.totalDepositedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className=" pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? tydroCurrentSupply.depositCount : 0} tx
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-red-400 mb-0.5">Withdraw</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? tydroCurrentSupply.totalWithdrawnUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? tydroCurrentSupply.withdrawCount : 0} tx
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
                            ? tydroCurrentSupply.totalBorrowedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? tydroCurrentSupply.borrowCount : 0} tx
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-blue-400 mb-0.5">Repay</div>
                        <div className="text-sm font-bold font-display text-white">
                          ${!isDemo && tydroCurrentSupply
                            ? tydroCurrentSupply.totalRepaidUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '0.00'}
                          <div className="pl-[2px] inline text-[10px] text-slate-500"> /
                            {!isDemo && tydroCurrentSupply ? tydroCurrentSupply.repayCount : 0} tx
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

        {/* Row 3: GM + Bridge Volume + InkyPump + Swap Volume (4 columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* GM Activity Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-yellow-500/20 bg-yellow-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.6s' }}>
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

            {!isDemo && !realGmData ? (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="h-16 w-24 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-4 w-32 bg-slate-700/30 rounded animate-pulse"></div>
              </div>
            ) : (
              <>
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="text-5xl font-bold font-display text-white mb-2">
                    {!isDemo && realGmData ? realGmData.count : data.stats.gmInteractionCount}
                  </div>
                  <div className="text-sm text-slate-400">Total Transactions</div>
                </div>
                {((!isDemo && realGmData ? realGmData.count : data.stats.gmInteractionCount) > 0) && (
                  <div className="mt-3 text-xs text-purple-500/80 flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
                    Active GM Participant
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bridge Volume Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-purple-500/20 bg-purple-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.65s' }}>
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
                        src={platform.logo}
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

            {!isDemo && bridgeVolume ? (
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
                          .sort((a, b) => b.usdValue - a.usdValue)
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
                                      src={platform.logoUrl}
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

          {/* InkyPump Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-pink-500/20 bg-pink-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.7s' }}>
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

            {!isDemo && (!inkyPumpCreatedTokens || !inkyPumpBuyVolume || !inkyPumpSellVolume) ? (
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

          {/* Swap Volume Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-cyan-500/20 bg-cyan-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.75s' }}>
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
                        src={platform.logo}
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

            {!isDemo && swapVolume ? (
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
                                src={platform.platformInfo.logo}
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

        {/* Row 4: ZNS Domain + Marvk + NFT2Mint + NFT Trading (4 columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* ZNS Domain Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-blue-500/20 bg-blue-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.8s' }}>
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

            {!isDemo && !znsMetrics ? (
              <div className="flex-1 flex flex-col justify-center">
                <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse"></div>
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

          {/* NFT Trading Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-pink-500/20 bg-pink-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.95s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.values(NFT_PLATFORMS).slice(0, 3).map((platform, i) => (
                    <a
                      key={i}
                      href={platform.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:z-10 hover:ring-2 hover:ring-pink-500/50 rounded-full transition-all cursor-pointer"
                      style={{ zIndex: 3 - i }}
                      title={`Visit ${platform.name}`}
                    >
                      <img
                        src={platform.logo}
                        alt={platform.name}
                        className="w-6 h-6 rounded-full object-cover bg-slate-800"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${platform.name.charAt(0)}&background=334155&color=94a3b8&size=24`;
                        }}
                      />
                    </a>
                  ))}
                </div>
                NFT Trading
              </h3>
            </div>

            {!isDemo ? (
              nftTrading ? (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-green-400">
                      {(nftTrading?.total_count || 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">Total NFTs Traded</div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">By Platform</span>
                    <div className="space-y-1">
                      {Object.entries(NFT_PLATFORMS).map(([contractAddress, platformInfo], i) => {
                        const contractData = nftTrading?.by_contract.find(
                          (c) => c.contract_address.toLowerCase() === contractAddress.toLowerCase()
                        );
                        const count = contractData?.count || 0;

                        return (
                          <div key={i} className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1">
                              <a
                                href={platformInfo.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:ring-2 hover:ring-pink-500/50 rounded transition-all cursor-pointer"
                                title={`Visit ${platformInfo.name}`}
                              >
                                <img
                                  src={platformInfo.logo}
                                  alt={platformInfo.name}
                                  className="w-3 h-3 rounded"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              </a>
                              {platformInfo.name}
                            </span>
                            <span className="font-mono text-white">{count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(nftTrading?.total_count || 0) > 0 && (
                    <div className="mt-2 text-xs text-pink-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse"></span>
                      Active NFT Trader
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse"></div>
                </div>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-pink-400">24</div>
                  <div className="text-xs text-slate-500">Demo NFT Trades</div>
                </div>
                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">By Platform</span>
                  <div className="space-y-1">
                    {Object.entries(NFT_PLATFORMS).map(([, platformInfo], i) => (
                      <div key={i} className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400 flex items-center gap-1">
                          <a
                            href={platformInfo.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:ring-2 hover:ring-pink-500/50 rounded transition-all cursor-pointer"
                            title={`Visit ${platformInfo.name}`}
                          >
                            <img
                              src={platformInfo.logo}
                              alt={platformInfo.name}
                              className="w-3 h-3 rounded"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </a>
                          {platformInfo.name}
                        </span>
                        <span className="font-mono text-white">{Math.floor(Math.random() * 10)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* NFT2Me Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-emerald-500/20 bg-emerald-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.9s' }}>
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
              nft2meMetrics ? (
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
              ) : (
                <div className="flex-1 flex flex-col justify-center">
                  <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse mb-2"></div>
                  <div className="h-3 w-24 bg-slate-700/30 rounded animate-pulse mb-4"></div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                    <div className="h-3 w-full bg-slate-700/30 rounded animate-pulse"></div>
                  </div>
                </div>
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
          {/* Marvk Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-orange-500/20 bg-orange-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.85s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <a
                  href={PLATFORM_URLS.marvk}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:ring-2 hover:ring-orange-500/50 rounded-full transition-all cursor-pointer"
                  title="Visit Marvk"
                >
                  <img
                    src="https://pbs.twimg.com/profile_images/1969128458635689984/DRv5vIT2_400x400.jpg"
                    alt="Marvk"
                    className="w-6 h-6 rounded-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://ui-avatars.com/api/?name=M&background=f97316&color=fff&size=24';
                    }}
                  />
                </a>
                Marvk
              </h3>
            </div>

            {!isDemo ? (
              marvkMetrics ? (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-violet-400">
                      {marvkMetrics.totalTransactions.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      {marvkMetrics.totalTransactions} transaction{marvkMetrics.totalTransactions !== 1 ? 's' : ''}
                    </div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Lock Token</span>
                        <span className="font-mono text-white">{marvkMetrics.lockTokenCount}</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Vest Token</span>
                        <span className="font-mono text-white">{marvkMetrics.vestTokenCount}</span>
                      </div>
                    </div>
                  </div>

                  {marvkMetrics.totalTransactions > 0 && (
                    <div className="mt-2 text-xs text-orange-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                      Active Marvk User
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-3">
                    <div className="text-2xl font-bold font-display text-violet-400">
                      <div className="animate-pulse bg-slate-700 h-8 w-16 rounded"></div>
                    </div>
                    <div className="text-xs text-slate-500">Loading...</div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50">
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Lock Token</span>
                        <div className="animate-pulse bg-slate-700 h-3 w-8 rounded"></div>
                      </div>
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-400">Vest Token</span>
                        <div className="animate-pulse bg-slate-700 h-3 w-8 rounded"></div>
                      </div>
                    </div>
                  </div>
                </>
              )
            ) : (
              <>
                <div className="mb-3">
                  <div className="text-2xl font-bold font-display text-violet-400">0</div>
                  <div className="text-xs text-slate-500">0 transactions</div>
                </div>

                <div className="flex-1 pt-3 border-t border-slate-700/50">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-2 block">By Action</span>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Lock Token</span>
                      <span className="font-mono text-white">0</span>
                    </div>
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Vest Token</span>
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

        {/* Row 5: Shellies and Future Cards (4 columns) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Shellies Unified Card */}
          <div className="glass-card p-6 rounded-2xl animate-fade-in-up border border-violet-500/20 bg-violet-500/5 h-[300px] flex flex-col" style={{ animationDelay: '1.0s' }}>
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

            {!isDemo && (!shelliesJoinedRaffles || !shelliesPayToPlay || !shelliesStaking) ? (
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
                  <div className="text-2xl font-bold font-display text-violet-400">
                    {!isDemo && shelliesJoinedRaffles && shelliesPayToPlay && shelliesStaking
                      ? (shelliesJoinedRaffles.total_count + shelliesPayToPlay.total_count + shelliesStaking.total_count)
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
                    <div className="flex justify-between items-center text-[11px]">
                      <span className="text-slate-400">Staked Nfts</span>
                      <span className="font-mono text-white">
                        {!isDemo && shelliesStaking ? shelliesStaking.total_count : 0}
                      </span>
                    </div>
                  </div>
                </div>

                {!isDemo && shelliesJoinedRaffles && shelliesPayToPlay && shelliesStaking &&
                  (shelliesJoinedRaffles.total_count + shelliesPayToPlay.total_count + shelliesStaking.total_count) > 0 && (
                    <div className="mt-2 text-xs text-violet-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span>
                      Active Shellies User
                    </div>
                  )}
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
    </div>
  );
};

