"use client";

import React, { useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip
} from 'recharts';
import { Sparkles, ShieldCheck, Activity, Wallet, Award, Clock, Image, ExternalLink, Coins, Sun, Landmark, Zap } from './Icons';
import { ScoreData, WalletStats, ScoreTier, AiAnalysisResult, NftHolding, TokenHolding } from '../types';
import { Logo } from './Logo';
import { AnalyticsCards } from './AnalyticsCards';

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
  { name: 'Ethereum', symbol: 'ETH', address: '0x2D270e6886d130D724215A266106e6832161EAEd' },
  { name: 'Anita', symbol: 'ANITA', address: '0x4200000000000000000000000000000000000006' },
  { name: 'Cat', symbol: 'CAT', address: '0x0606FC632ee812bA970af72F8489baAa443C4B98' },
  { name: 'ILA', symbol: 'ILA', address: '0x20C69C12abf2B6F8D8ca33604DD25C700c7e70A5' },
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

export const Dashboard: React.FC<DashboardProps> = ({ walletAddress, isDemo }) => {
  const [data, setData] = useState<{ stats: WalletStats, score: ScoreData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [realGmData, setRealGmData] = useState<{ count: number; } | null>(null);
  const [realWalletStats, setRealWalletStats] = useState<RealWalletStats | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setData(generateMockData(walletAddress));
      setLoading(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [walletAddress]);

  // Fetch real wallet stats when not in demo mode
  useEffect(() => {
    if (isDemo || !walletAddress || walletAddress.length < 10) return;

    const fetchWalletStats = async () => {
      try {
        const res = await fetch(`/api/wallet/${walletAddress}/stats`);
        if (res.ok) {
          const stats = await res.json();
          setRealWalletStats({
            balanceUsd: stats.balanceUsd || 0,
            totalTxns: stats.totalTxns || 0,
            nftCount: stats.nftCount || 0,
            ageDays: stats.ageDays || 0,
            nftCollections: stats.nftCollections || [],
            tokenHoldings: stats.tokenHoldings || [],
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

  const chartData = [
    { subject: 'NFTs', A: data.score.breakdown.nftPower, fullMark: 100 },
    { subject: 'Tokens', A: data.score.breakdown.tokenWeight, fullMark: 100 },
    { subject: 'DeFi', A: data.score.breakdown.defiUsage, fullMark: 100 },
    { subject: 'Activity', A: data.score.breakdown.txActivity, fullMark: 100 },
    { subject: 'Age', A: data.score.breakdown.longevity, fullMark: 100 },
    { subject: 'Loyalty', A: data.score.breakdown.ecosystemLoyalty, fullMark: 100 },
  ];

  return (
    <div className="min-h-screen pt-24 pb-12 px-4 sm:px-6 relative">
      <div className="absolute inset-0 grid-bg opacity-20 pointer-events-none fixed"></div>

      <div className="max-w-7xl mx-auto space-y-6 relative z-10">
        {/* Header Info */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 animate-fade-in-up">
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
              <span className="w-1 h-8 bg-ink-purple rounded-full"></span>
              Wallet Overview
            </h1>
            <div className="flex items-center gap-2 text-slate-400 font-mono text-sm mt-1 ml-3">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              {walletAddress}
              <span className="px-2 py-0.5 rounded bg-slate-800 text-xs border border-slate-700">INK Mainnet</span>
            </div>
          </div>
          <div className="flex gap-3">
            {isDemo && <div className="px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-lg text-sm font-medium animate-pulse">Demo Mode</div>}
          </div>
        </div>

        {/* Top Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { 
              label: 'Net Worth Estimate', 
              value: !isDemo && realWalletStats 
                ? `$${(realWalletStats.balanceUsd + realWalletStats.tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
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
                    <span className="inline-block w-16 h-6 bg-slate-700 rounded animate-pulse"></span>
                  ) : item.value}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Special Token Holdings */}
        {!isDemo && realWalletStats && realWalletStats.tokenHoldings && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {realWalletStats.tokenHoldings.map((token, i) => {
              // For ETH token, use native balance from balanceUsd
              const displayUsdValue = token.symbol === 'ETH' ? realWalletStats.balanceUsd : token.usdValue;
              return (
                <div
                  key={token.address}
                  className="glass-card glass-card-hover p-6 rounded-xl flex items-center gap-4 animate-fade-in-up group"
                  style={{ animationDelay: `${0.45 + i * 0.05}s` }}
                >
                  <img
                    src={token.logo}
                    alt={token.symbol}
                    className="w-12 h-12 rounded-lg object-cover group-hover:scale-110 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(token.symbol)}&background=334155&color=94a3b8`;
                    }}
                  />
                  <div>
                    <div className="text-slate-400 text-sm">{token.symbol}</div>
                    <div className="text-xl font-bold font-display text-white">
                      ${displayUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Special NFT Collections */}
        {!isDemo && realWalletStats && realWalletStats.nftCollections && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {realWalletStats.nftCollections.map((collection, i) => (
              <div
                key={collection.address}
                className="glass-card glass-card-hover p-6 rounded-xl flex items-center gap-4 animate-fade-in-up group"
                style={{ animationDelay: `${0.65 + i * 0.05}s` }}
              >
                <img
                  src={collection.logo}
                  alt={collection.name}
                  className="w-12 h-12 rounded-lg object-cover group-hover:scale-110 transition-transform"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(collection.name)}&background=334155&color=94a3b8`;
                  }}
                />
                <div>
                  <div className="text-slate-400 text-sm">{collection.name}</div>
                  <div className="text-xl font-bold font-display text-white">{collection.count}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main Content Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Score & Chart */}
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-card p-8 rounded-2xl animate-fade-in-up" style={{ animationDelay: '0.5s' }}>
              <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                <div className="text-center md:text-left relative">
                  <div className="absolute -top-20 -left-20 w-40 h-40 bg-ink-purple/20 blur-3xl rounded-full"></div>
                  <h2 className="text-slate-400 mb-2 relative z-10">Total INKSCORE</h2>
                  <div className="text-7xl font-display font-bold text-white tracking-tighter mb-2 relative z-10 drop-shadow-[0_0_15px_rgba(124,58,237,0.3)]">
                    {data.score.totalScore}
                  </div>
                  <div className="inline-block px-4 py-1 rounded-full bg-gradient-to-r from-ink-blue to-ink-purple text-white text-sm font-semibold shadow-lg shadow-purple-900/40 relative z-10">
                    {data.score.tier}
                  </div>
                  <p className="mt-4 text-slate-400 text-sm max-w-xs relative z-10">
                    Your score is in the top 5% of active InkChain addresses.
                  </p>
                </div>

                <div className="h-[300px] w-full md:w-[400px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={chartData}>
                      <PolarGrid stroke="#334155" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar name="You" dataKey="A" stroke="#7c3aed" strokeWidth={2} fill="#7c3aed" fillOpacity={0.4} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }} itemStyle={{ color: '#a855f7' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Token Portfolio Impact Section */}
            <div className="glass-card glass-card-hover p-6 rounded-2xl animate-fade-in-up" style={{ animationDelay: '0.55s' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 text-blue-500 flex items-center justify-center">
                  <Coins size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-display font-semibold text-white">Token Holdings Impact</h3>
                  <div className="text-sm text-slate-400">Total Contribution: <span className="text-ink-accent font-mono font-bold">+{data.stats.tokenTotalScore} Points</span></div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="pb-3 pl-2 font-medium">Token</th>
                      <th className="pb-3 font-medium">Contract</th>
                      <th className="pb-3 font-medium text-right">Balance</th>
                      <th className="pb-3 font-medium text-right">Value (USD)</th>
                      <th className="pb-3 font-medium text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.stats.tokenHoldings.map((token, i) => (
                      <tr key={i} className="hover:bg-slate-800/30 transition-colors group">
                        <td className="py-4 pl-2 font-medium text-white flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-300 ring-2 ring-transparent group-hover:ring-ink-blue transition-all">
                            {token.symbol.substring(0, 3)}
                          </div>
                          <div>
                            <div className="leading-none">{token.symbol}</div>
                            <div className="text-[10px] text-slate-500 font-normal">{token.name}</div>
                          </div>
                        </td>
                        <td className="py-4 text-slate-500 font-mono text-xs">
                          <div className="flex items-center gap-1 group-hover:text-slate-300 transition-colors">
                            {token.contractAddress.substring(0, 6)}...{token.contractAddress.substring(token.contractAddress.length - 4)}
                            <ExternalLink size={10} className="hover:text-white cursor-pointer" />
                          </div>
                        </td>
                        <td className="py-4 text-right font-mono text-slate-300">
                          {token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </td>
                        <td className="py-4 text-right font-mono text-slate-300">
                          ${token.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-4 text-right">
                          <div className="inline-flex items-center gap-1 font-mono font-bold">
                            <span className={token.points > 0 ? "text-green-400" : "text-slate-600"}>
                              {token.points > 0 ? `+${token.points}` : 0}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 pt-4 border-t border-slate-700/50 flex justify-between items-center text-xs text-slate-500">
                  <span>* Prices fetched from Oracle</span>
                  <span>Hold &gt;$500 per token for max points</span>
                </div>
              </div>
            </div>

            {/* NFT Portfolio Impact Section */}
            <div className="glass-card glass-card-hover p-6 rounded-2xl animate-fade-in-up" style={{ animationDelay: '0.6s' }}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-pink-500/20 text-pink-500 flex items-center justify-center">
                  <Image size={20} />
                </div>
                <div>
                  <h3 className="text-xl font-display font-semibold text-white">NFT Portfolio Impact</h3>
                  <div className="text-sm text-slate-400">Total Contribution: <span className="text-ink-accent font-mono font-bold">+{data.stats.nftTotalScore} Points</span></div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="pb-3 pl-2 font-medium">Collection</th>
                      <th className="pb-3 font-medium">Contract</th>
                      <th className="pb-3 font-medium text-right">Held</th>
                      <th className="pb-3 font-medium text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.stats.nftHoldings.map((nft, i) => (
                      <tr key={i} className="hover:bg-slate-800/30 transition-colors group">
                        <td className="py-4 pl-2 font-medium text-white flex items-center gap-3">
                          <div className="relative">
                            <img
                              src={`https://unavatar.io/twitter/${nft.twitterHandle}`}
                              alt={nft.name}
                              className="w-8 h-8 rounded-md object-cover bg-slate-700 ring-2 ring-transparent group-hover:ring-ink-purple transition-all"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${nft.name}&background=334155&color=94a3b8`;
                              }}
                            />
                          </div>
                          {nft.name}
                        </td>
                        <td className="py-4 text-slate-500 font-mono text-xs">
                          <div className="flex items-center gap-1 group-hover:text-slate-300 transition-colors">
                            {nft.contractAddress.substring(0, 6)}...{nft.contractAddress.substring(nft.contractAddress.length - 4)}
                            <ExternalLink size={10} className="hover:text-white cursor-pointer" />
                          </div>
                        </td>
                        <td className="py-4 text-right">
                          {nft.count > 0 ? (
                            <span className="px-2 py-1 rounded bg-slate-800 text-white font-mono">{nft.count}</span>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                        <td className="py-4 text-right font-mono text-green-400 font-bold">
                          {nft.totalPoints > 0 ? `+${nft.totalPoints}` : 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-4 pt-4 border-t border-slate-700/50 flex justify-between items-center text-xs text-slate-500">
                  <span>* Points calculated based on InkChain snapshot</span>
                  <span>Hold more verified NFTs to increase score</span>
                </div>
              </div>
            </div>

            {/* AI Analysis Section */}
            <div className="glass-card p-1 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 animate-fade-in-up" style={{ animationDelay: '0.7s' }}>
              <div className="bg-slate-950/80 rounded-xl p-6 backdrop-blur-sm h-full relative overflow-hidden">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-ink-accent/10 blur-3xl rounded-full"></div>

                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div className="flex items-center gap-3">
                    <Sparkles className="text-ink-accent animate-pulse" />
                    <h3 className="text-xl font-display font-semibold">AI Reputation Audit</h3>
                  </div>
                  {!aiAnalysis && (
                    <button
                      onClick={handleAiAnalysis}
                      disabled={analyzing}
                      className="px-4 py-2 bg-ink-purple hover:bg-purple-700 disabled:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-purple-900/20"
                    >
                      {analyzing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Analyzing...
                        </>
                      ) : "Generate Insight"}
                    </button>
                  )}
                </div>

                {!aiAnalysis && !analyzing && (
                  <div className="text-center py-8 text-slate-500">
                    <p>Unlock deep insights into your score using Gemini AI.</p>
                    <p className="text-sm mt-2">Analyzes patterns, consistency, and growth potential.</p>
                  </div>
                )}

                {aiAnalysis && (
                  <div className="space-y-6 animate-fade-in">
                    <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-800 border-l-4 border-l-ink-purple">
                      <p className="text-slate-300 italic">&quot;{aiAnalysis.summary}&quot;</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-green-400 text-sm font-bold uppercase tracking-wider mb-3">Key Strengths</h4>
                        <ul className="space-y-2">
                          {aiAnalysis.strengths.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                              <ShieldCheck className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-orange-400 text-sm font-bold uppercase tracking-wider mb-3">Improvements</h4>
                        <ul className="space-y-2">
                          {aiAnalysis.weaknesses.map((w, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                              <div className="w-4 h-4 rounded-full border border-orange-500/50 flex items-center justify-center mt-0.5 flex-shrink-0 text-[10px] text-orange-500">!</div>
                              {w}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-800">
                      <h4 className="text-ink-purple text-sm font-bold uppercase tracking-wider mb-2">Recommendation</h4>
                      <p className="text-slate-400 text-sm">{aiAnalysis.recommendation}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Benefits & Details */}
          <div className="space-y-6">
            {/* Real Analytics Cards (only when connected, not demo) */}
            {!isDemo && walletAddress && (
              <AnalyticsCards walletAddress={walletAddress} />
            )}

            {/* GM Activity Card */}
            <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-yellow-500/20 bg-yellow-500/5" style={{ animationDelay: '0.8s' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Sun className="text-yellow-500" size={20} />
                  GM Activity
                </h3>
                <div className="text-xs font-mono text-slate-500 bg-slate-900/50 px-2 py-1 rounded">
                  {GM_CONTRACT_ADDRESS.substring(0, 6)}...{GM_CONTRACT_ADDRESS.substring(GM_CONTRACT_ADDRESS.length - 4)}
                </div>
              </div>

              <div className="flex items-center justify-between">
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
                <div className="mt-3 text-xs text-yellow-500/80 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse"></span>
                  Active GM Participant
                </div>
              )}
            </div>

            {/* Tydro DeFi Activity Card */}
            <div className="glass-card p-6 rounded-xl animate-fade-in-up border border-blue-500/20 bg-blue-500/5" style={{ animationDelay: '0.82s' }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Landmark className="text-blue-400" size={20} />
                  DeFi Activity (Tydro)
                </h3>
                <div className="text-xs font-bold text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-500/30">
                  PROTOCOL
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Supply tx <span className="text-slate-500">({data.stats.tydroSupplyCount})</span></span>
                  <span className="font-mono text-white">+{data.stats.tydroSupplyCount * 10} pts</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-slate-400">Borrow tx <span className="text-slate-500">({data.stats.tydroBorrowCount})</span></span>
                  <span className="font-mono text-white">+{data.stats.tydroBorrowCount * 20} pts</span>
                </div>
                {(data.stats.tydroSupplyCount > 0 && data.stats.tydroBorrowCount > 0) && (
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400 flex items-center gap-1"><Zap size={12} className="text-ink-accent"/> Power User Bonus</span>
                    <span className="font-mono text-ink-accent font-bold">+50 pts</span>
                  </div>
                )}

                <div className="h-px bg-slate-700/50 my-2"></div>

                <div className="flex justify-between items-center font-bold">
                  <span className="text-white">Total DeFi Score</span>
                  <span className="text-blue-400 font-display text-lg">{data.stats.tydroScore} pts</span>
                </div>
              </div>
            </div>

            <div className="glass-card p-6 rounded-xl animate-fade-in-up" style={{ animationDelay: '0.85s' }}>
              <h3 className="text-lg font-semibold mb-4">Tier Benefits</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-green-500/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center"><ShieldCheck size={16} /></div>
                  <div>
                    <div className="font-medium text-sm">Airdrop Multiplier</div>
                    <div className="text-xs text-green-400">1.5x Boost Active</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-blue-500/30 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center"><Activity size={16} /></div>
                  <div>
                    <div className="font-medium text-sm">Priority Access</div>
                    <div className="text-xs text-slate-400">Launchpad Whitelist</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700 opacity-50">
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 text-purple-500 flex items-center justify-center"><Award size={16} /></div>
                  <div>
                    <div className="font-medium text-sm">Governance Power</div>
                    <div className="text-xs text-slate-400">Unlocks at 800+ Score</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card p-6 rounded-xl animate-fade-in-up" style={{ animationDelay: '0.9s' }}>
              <h3 className="text-lg font-semibold mb-4">Latest Activity</h3>
              <div className="relative border-l border-slate-700 ml-2 space-y-6">
                {[
                  { action: 'Liquidity Added', prot: 'InkSwap', time: '2h ago' },
                  { action: 'GM Interaction', prot: 'GM Contract', time: '4h ago' },
                  { action: 'NFT Purchased', prot: 'InkSea', time: '1d ago' },
                  { action: 'Governance Vote', prot: 'InkDAO', time: '3d ago' }
                ].map((item, i) => (
                  <div key={i} className="pl-6 relative group">
                    <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-slate-600 border border-slate-900 group-hover:bg-ink-purple group-hover:scale-125 transition-all"></span>
                    <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{item.action}</div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-ink-purple">{item.prot}</span>
                      <span className="text-slate-500">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
