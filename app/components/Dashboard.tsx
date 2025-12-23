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
import { Sparkles, ShieldCheck, Activity, Wallet, Award, Clock, Image, ExternalLink, Coins, Sun, Landmark, Zap, ArrowLeftRight, RefreshCw } from './Icons';
import { ScoreData, WalletStats, ScoreTier, AiAnalysisResult, NftHolding, TokenHolding } from '../types';
import { Logo } from './Logo';
import { HoldingsSection } from './HoldingsSection';
import { WalletScoreResponse } from '../../lib/types/platforms';

// Bridge platform logos
const BRIDGE_PLATFORM_LOGOS: Record<string, string> = {
  'Owlto': 'https://owlto.finance/favicon.ico',
  'Orbiter': 'https://www.orbiter.finance/favicon.ico',
  'Gas.zip': 'https://www.gas.zip/favicon.ico',
  'Relay': 'https://relay.link/favicon.ico',
  'Ink Official': 'https://inkonchain.com/favicon.ico',
};

// DEX platform logos and info (keyed by lowercase contract address)
const DEX_PLATFORMS: Record<string, { name: string; logo: string }> = {
  '0x9b17690de96fcfa80a3acaefe11d936629cd7a77': {
    name: 'DyorSwap',
    logo: 'https://dyorswap.finance/favicon.ico',
  },
  '0x551134e92e537ceaa217c2ef63210af3ce96a065': {
    name: 'InkySwap',
    logo: 'https://inkyswap.com/logo-mobile.svg',
  },
  '0x01d40099fcd87c018969b0e8d4ab1633fb34763c': {
    name: 'Velodrome',
    logo: 'https://velodrome.finance/images/VELO/favicon.ico',
  },
  '0xd7e72f3615aa65b92a4dbdc211e296a35512988b': {
    name: 'Curve',
    logo: 'https://cdn.jsdelivr.net/gh/curvefi/curve-assets/branding/logo.png',
  },
};

// Fallback name mapping for platform names from the API
const DEX_NAME_OVERRIDES: Record<string, string> = {
  'Unknown DEX': 'Curve',
  'Velodrome UniversalRouter': 'Velodrome',
  'DyorRouterV2': 'DyorSwap',
};

// NFT Marketplace platform logos and info (keyed by lowercase contract address)
const NFT_PLATFORMS: Record<string, { name: string; logo: string; url: string }> = {
  '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5': {
    name: 'Net Protocol',
    logo: 'https://www.netprotocol.app/favicon.ico',
    url: 'https://www.netprotocol.app/',
  },
  '0xbd6a027b85fd5285b1623563bbef6fadbe396afb': {
    name: 'Mintiq',
    logo: 'https://i.ibb.co/bMN9ppS7/mmm.png',
    url: 'https://mintiq.market/',
  },
  '0x9ebf93fdba9f32accab3d6716322dccd617a78f3': {
    name: 'Squid Market',
    logo: 'https://www.squidmarket.xyz/favicon.ico',
    url: 'https://www.squidmarket.xyz/',
  },
};

// Bridge volume response type
interface BridgeVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  byPlatform: Array<{
    platform: string;
    subPlatform?: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
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
  const [bridgeVolume, setBridgeVolume] = useState<BridgeVolumeResponse | null>(null);
  const [inkySwapVolume, setInkySwapVolume] = useState<InkySwapVolumeData | null>(null);
  const [swapVolume, setSwapVolume] = useState<SwapVolumeResponse | null>(null);
  const [nftTrading, setNftTrading] = useState<NftTradingResponse | null>(null);
  const [walletScore, setWalletScore] = useState<WalletScoreResponse | null>(null);

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
    setBridgeVolume(null);
    setInkySwapVolume(null);
    setSwapVolume(null);
    setNftTrading(null);
    setWalletScore(null);

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

  // Fetch real Tydro data when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchTydroData = async () => {
      try {
        const res = await fetch(`/api/analytics/${walletAddress}`);
        if (res.ok) {
          const data = await res.json();
          console.log('Analytics data:', data); // Debug log
          const supplyMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'tydro_usd_supply');
          const borrowMetric = data.metrics?.find((m: { slug: string }) => m.slug === 'Tydro_usd_borrow');

          console.log('Tydro metrics:', { supplyMetric, borrowMetric }); // Debug log

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
        erc20_tokens: 'Tokens'
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Net Worth Estimate',
              value: !isDemo && realWalletStats
                ? `$${(realWalletStats.balanceUsd + realWalletStats.tokenHoldings.filter(t => t.symbol !== 'ETH').reduce((sum, t) => sum + t.usdValue, 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
              </div>
            </div>
          ))}
        </div>

        {/* Row 2: Total INKSCORE (50%) + Bridge Volume (25%) + Swap Volume (25%) */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Total INKSCORE Card - 50% width (2 columns) */}
          <div className="lg:col-span-2 glass-card p-8 rounded-2xl animate-fade-in-up h-[300px] flex flex-col" style={{ animationDelay: '0.5s' }}>
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 flex-1">
              <div className="text-center md:text-left relative flex-shrink-0">
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

          {/* Bridge Volume Card - 25% width (1 column) */}
          <div className="lg:col-span-1 glass-card p-6 rounded-2xl animate-fade-in-up border border-purple-500/20 bg-purple-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.55s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.entries(BRIDGE_PLATFORM_LOGOS).slice(0, 3).map(([name, logo], i) => (
                    <img
                      key={i}
                      src={logo}
                      alt={name}
                      className="w-7 h-7 rounded-full object-cover border-2 border-purple-500 bg-slate-800"
                      style={{ zIndex: 3 - i }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${name.charAt(0)}&background=334155&color=94a3b8&size=28`;
                      }}
                    />
                  ))}
                </div>
                Bridge Volume
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-purple-900/30 border-purple-500/30 text-purple-400">
                USD
              </div>
            </div>

            {!isDemo && bridgeVolume ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-3xl font-bold font-display text-purple-400">
                      ${bridgeVolume.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-500">Total Bridged To Ink Chain</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold font-display text-white">
                      {bridgeVolume.txCount.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">Transactions</div>
                  </div>
                </div>

                {bridgeVolume.byPlatform.length > 0 && (
                  <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                    <span className="text-xs text-slate-500 uppercase tracking-wider mb-2">By Platform</span>
                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar max-h-[140px]">
                      {bridgeVolume.byPlatform.map((platform, i) => {
                        const displayName = platform.subPlatform || platform.platform;
                        const logoUrl = BRIDGE_PLATFORM_LOGOS[displayName] || BRIDGE_PLATFORM_LOGOS[platform.platform];

                        return (
                          <div key={i} className="flex justify-between items-center text-xs py-0.5">
                            <span className="text-slate-400 flex items-center gap-1.5">
                              {logoUrl && (
                                <img
                                  src={logoUrl}
                                  alt={displayName}
                                  className="w-3.5 h-3.5 rounded"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              {displayName}
                            </span>
                            <div className="text-right">
                              <span className="font-mono text-white text-xs">
                                ${platform.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span className="text-slate-500 text-[10px] ml-1.5">
                                ({platform.txCount})
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {bridgeVolume.txCount > 0 && (
                  <div className="mt-3 text-xs text-purple-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                    Active Bridger
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex flex-col">
                {isDemo ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-500">
                      <div className="text-3xl font-bold font-display text-purple-400 mb-2">$12,450.00</div>
                      <div className="text-xs">Demo Bridge Volume</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="h-9 w-32 bg-slate-700/50 rounded animate-pulse"></div>
                        <div className="h-3 w-28 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                      </div>
                      <div className="text-right">
                        <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse ml-auto"></div>
                        <div className="h-3 w-20 bg-slate-700/30 rounded mt-1 animate-pulse ml-auto"></div>
                      </div>
                    </div>
                    <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                      <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse mb-2"></div>
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex justify-between items-center">
                            <div className="h-4 w-20 bg-slate-700/40 rounded animate-pulse"></div>
                            <div className="h-4 w-24 bg-slate-700/40 rounded animate-pulse"></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Swap Volume Card - 25% width (1 column) */}
          <div className="lg:col-span-1 glass-card p-6 rounded-2xl animate-fade-in-up border border-cyan-500/20 bg-cyan-500/5 h-[300px] flex flex-col" style={{ animationDelay: '0.6s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.values(DEX_PLATFORMS).slice(0, 3).map((platform, i) => (
                    <img
                      key={i}
                      src={platform.logo}
                      alt={platform.name}
                      className="w-7 h-7 rounded-full object-cover border-2 border-cyan-500 bg-slate-800"
                      style={{ zIndex: 3 - i }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${platform.name.charAt(0)}&background=334155&color=94a3b8&size=28`;
                      }}
                    />
                  ))}
                </div>
                Swap Volume
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-cyan-900/30 border-cyan-500/30 text-cyan-400">
                USD
              </div>
            </div>

            {!isDemo && swapVolume ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-3xl font-bold font-display text-cyan-400">
                      ${swapVolume.totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-xs text-slate-500">Total Swapped</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold font-display text-white">
                      {swapVolume.txCount.toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">Swaps</div>
                  </div>
                </div>

                {swapVolume.byPlatform.length > 0 && (
                  <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                    <span className="text-xs text-slate-500 uppercase tracking-wider mb-2">By Platform</span>
                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar max-h-[140px]">
                      {swapVolume.byPlatform.map((platform, i) => {
                        const platformInfo = DEX_PLATFORMS[platform.contractAddress.toLowerCase()];
                        const logoUrl = platformInfo?.logo;
                        // Use platform info name, then check name overrides, then fall back to API name
                        const displayName = platformInfo?.name || DEX_NAME_OVERRIDES[platform.platform] || platform.platform;

                        return (
                          <div key={i} className="flex justify-between items-center text-xs py-0.5">
                            <span className="text-slate-400 flex items-center gap-1.5">
                              {logoUrl && (
                                <img
                                  src={logoUrl}
                                  alt={displayName}
                                  className="w-3.5 h-3.5 rounded"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              {displayName}
                            </span>
                            <div className="text-right">
                              <span className="font-mono text-white text-xs">
                                ${platform.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                              <span className="text-slate-500 text-[10px] ml-1.5">
                                ({platform.txCount})
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {swapVolume.txCount > 0 && (
                  <div className="mt-3 text-xs text-cyan-400 opacity-80 flex items-center gap-1">
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
                      <div className="text-3xl font-bold font-display text-cyan-400 mb-2">$8,750.00</div>
                      <div className="text-xs">Demo Swap Volume</div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="h-9 w-32 bg-slate-700/50 rounded animate-pulse"></div>
                        <div className="h-3 w-24 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                      </div>
                      <div className="text-right">
                        <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse ml-auto"></div>
                        <div className="h-3 w-12 bg-slate-700/30 rounded mt-1 animate-pulse ml-auto"></div>
                      </div>
                    </div>
                    <div className="flex-1 pt-3 border-t border-slate-700/50 flex flex-col min-h-0">
                      <div className="h-3 w-20 bg-slate-700/30 rounded animate-pulse mb-2"></div>
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex justify-between items-center">
                            <div className="h-4 w-20 bg-slate-700/40 rounded animate-pulse"></div>
                            <div className="h-4 w-24 bg-slate-700/40 rounded animate-pulse"></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Row 3: GM Activity + InkySwap Volume + Tydro DeFi Activity + NFT Trading (same height) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* GM Activity Card */}
          <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-yellow-500/20 bg-yellow-500/5 h-[200px] flex flex-col" style={{ animationDelay: '0.6s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <img
                  src="https://gm.inkonchain.com/favicon.ico"
                  alt="GM"
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                GM Activity
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-yellow-900/30 border-yellow-500/30 text-yellow-400">
                COUNT
              </div>
            </div>

            {!isDemo && !realGmData ? (
              <div className="flex items-center justify-between flex-1">
                <div>
                  <div className="h-8 w-20 bg-slate-700/50 rounded animate-pulse"></div>
                  <div className="h-3 w-24 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                </div>
                <div className="text-right">
                  <div className="h-8 w-16 bg-slate-700/50 rounded animate-pulse ml-auto"></div>
                  <div className="h-3 w-20 bg-slate-700/30 rounded mt-1 animate-pulse ml-auto"></div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between flex-1">
                  <div>
                    <div className="text-2xl font-bold font-display text-white">
                      {!isDemo && realGmData ? realGmData.count : data.stats.gmInteractionCount} <span className="text-sm font-normal text-slate-400">txs</span>
                    </div>
                    <div className="text-xs text-slate-500">Total Interactions</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold font-display text-yellow-500">
                      +{((!isDemo && realGmData ? realGmData.count : data.stats.gmInteractionCount) * 2)}
                    </div>
                    <div className="text-xs text-slate-500">Points Earned</div>
                  </div>
                </div>
                {((!isDemo && realGmData ? realGmData.count : data.stats.gmInteractionCount) > 0) && (
                  <div className="mt-auto text-xs text-yellow-500/80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                    Active GM Participant
                  </div>
                )}
              </>
            )}
          </div>

          {/* InkySwap Volume Card */}
          <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-cyan-500/20 bg-cyan-500/5 h-[200px] flex flex-col" style={{ animationDelay: '0.65s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <img
                  src="https://inkyswap.com/logo-mobile.svg"
                  alt="InkySwap"
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                InkySwap Volume
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-cyan-900/30 border-cyan-500/30 text-cyan-400">
                USD
              </div>
            </div>

            {!isDemo && !inkySwapVolume ? (
              <div className="flex items-center justify-between flex-1">
                <div>
                  <div className="h-8 w-24 bg-slate-700/50 rounded animate-pulse"></div>
                  <div className="h-3 w-20 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                </div>
                <div className="text-right">
                  <div className="h-8 w-14 bg-slate-700/50 rounded animate-pulse ml-auto"></div>
                  <div className="h-3 w-20 bg-slate-700/30 rounded mt-1 animate-pulse ml-auto"></div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between flex-1">
                  <div>
                    <div className="text-2xl font-bold font-display text-cyan-400">
                      ${!isDemo && inkySwapVolume
                        ? inkySwapVolume.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '5,230.00'}
                    </div>
                    <div className="text-xs text-slate-500">Total Volume</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold font-display text-white">
                      {!isDemo && inkySwapVolume ? inkySwapVolume.totalCount.toLocaleString() : '42'}
                    </div>
                    <div className="text-xs text-slate-500">Transactions</div>
                  </div>
                </div>
                {((!isDemo && inkySwapVolume ? inkySwapVolume.totalCount : 42) > 0) && (
                  <div className="mt-auto text-xs text-cyan-400 opacity-80 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    Active Swapper
                  </div>
                )}
              </>
            )}
          </div>

          {/* Tydro DeFi Card */}
          <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-emerald-500/20 bg-emerald-500/5 h-[200px] flex flex-col" style={{ animationDelay: '0.7s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <img
                  src="https://app.tydro.com/tydro-logo.svg"
                  alt="Tydro"
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
                Tydro DeFi
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-emerald-900/30 border-emerald-500/30 text-emerald-400">
                USD
              </div>
            </div>

            {!isDemo && !realTydroData ? (
              <div className="flex-1 flex flex-col justify-center space-y-4">
                {/* Supply Row Skeleton */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-700/50 animate-pulse"></div>
                    <div>
                      <div className="h-3 w-12 bg-slate-700/40 rounded animate-pulse"></div>
                      <div className="h-3 w-16 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-slate-700/50 rounded animate-pulse"></div>
                </div>
                <div className="border-t border-slate-700/50"></div>
                {/* Borrow Row Skeleton */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-700/50 animate-pulse"></div>
                    <div>
                      <div className="h-3 w-12 bg-slate-700/40 rounded animate-pulse"></div>
                      <div className="h-3 w-16 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="h-6 w-20 bg-slate-700/50 rounded animate-pulse"></div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col justify-center space-y-4">
                {/* Supply Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                      <Landmark size={14} className="text-green-400" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Supply</div>
                      <div className="text-xs text-slate-500">
                        {!isDemo && realTydroData ? realTydroData.supplyCount : data.stats.tydroSupplyCount} txns
                      </div>
                    </div>
                  </div>
                  <div className="text-xl font-bold font-display text-green-400">
                    ${!isDemo && realTydroData
                      ? realTydroData.supplyVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : (data.stats.tydroSupplyCount * 100).toFixed(2)}
                  </div>
                </div>

                {/* Divider */}
                <div className="border-t border-slate-700/50"></div>

                {/* Borrow Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                      <Zap size={14} className="text-orange-400" />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Borrow</div>
                      <div className="text-xs text-slate-500">
                        {!isDemo && realTydroData ? realTydroData.borrowCount : data.stats.tydroBorrowCount} txns
                      </div>
                    </div>
                  </div>
                  <div className="text-xl font-bold font-display text-orange-400">
                    ${!isDemo && realTydroData
                      ? realTydroData.borrowVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                      : (data.stats.tydroBorrowCount * 200).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* NFT Trading Card */}
          <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-pink-500/20 bg-pink-500/5 h-[200px] flex flex-col" style={{ animationDelay: '0.75s' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <div className="flex items-center -space-x-3">
                  {Object.values(NFT_PLATFORMS).slice(0, 3).map((platform, i) => (
                    <img
                      key={i}
                      src={platform.logo}
                      alt={platform.name}
                      className="w-7 h-7 rounded-full object-cover border-2 border-pink-500 bg-slate-800"
                      style={{ zIndex: 3 - i }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${platform.name.charAt(0)}&background=334155&color=94a3b8&size=28`;
                      }}
                    />
                  ))}
                </div>
                NFT Trading
              </h3>
              <div className="text-xs font-bold px-2 py-1 rounded border bg-pink-900/30 border-pink-500/30 text-pink-400">
                COUNT
              </div>
            </div>

            {!isDemo ? (
              nftTrading ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-3xl font-bold font-display text-pink-400">
                        {(nftTrading?.total_count || 0).toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500">Total NFTs Traded</div>
                    </div>
                  </div>

                  <div className="flex-1 pt-3 border-t border-slate-700/50 flex items-center justify-center">
                    <div className="flex items-center justify-center gap-6">
                      {Object.entries(NFT_PLATFORMS).map(([contractAddress, platformInfo], i) => {
                        const contractData = nftTrading?.by_contract.find(
                          (c) => c.contract_address.toLowerCase() === contractAddress.toLowerCase()
                        );
                        const count = contractData?.count || 0;

                        return (
                          <div key={i} className="relative group" title={platformInfo.name}>
                            <img
                              src={platformInfo.logo}
                              alt={platformInfo.name}
                              className="w-10 h-10 rounded-full object-cover border-2 border-slate-700 group-hover:border-pink-500/50 transition-all bg-slate-800"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${platformInfo.name.charAt(0)}&background=334155&color=94a3b8&size=40`;
                              }}
                            />
                            <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-pink-500 text-white text-[10px] font-bold flex items-center justify-center shadow-lg">
                              {count}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {(nftTrading?.total_count || 0) > 0 && (
                    <div className="mt-auto text-xs text-pink-400 opacity-80 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-pink-400 animate-pulse"></span>
                      Active NFT Trader
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="h-9 w-16 bg-slate-700/50 rounded animate-pulse"></div>
                      <div className="h-3 w-24 bg-slate-700/30 rounded mt-1 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="flex-1 pt-3 border-t border-slate-700/50 flex items-center justify-center">
                    <div className="flex items-center justify-center gap-6">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="relative">
                          <div className="w-10 h-10 rounded-full bg-slate-700/50 animate-pulse"></div>
                          <div className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-slate-600/50 animate-pulse"></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-slate-500">
                  <div className="text-3xl font-bold font-display text-pink-400 mb-2">24</div>
                  <div className="text-xs">Demo NFT Trades</div>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Holdings Section - Tokens & NFTs */}
        {!isDemo && realWalletStats && (
          <HoldingsSection
            tokenHoldings={realWalletStats.tokenHoldings}
            nftCollections={realWalletStats.nftCollections}
            nativeEthUsd={realWalletStats.balanceUsd}
          />
        )}
      </div>
    </div>
  );
};
