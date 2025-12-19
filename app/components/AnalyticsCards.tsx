"use client";

import React, { useState, useEffect } from 'react';
import { UserAnalyticsResponse } from '@/lib/types/analytics';

interface AnalyticsCardsProps {
  walletAddress: string;
}

// Icon components matching the dashboard style
const BridgeIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
  </svg>
);

const SwapIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const GmIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

const RocketIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const BankIcon = ({ size = 20, className = "" }: { size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
  </svg>
);

const getIconComponent = (slug: string | null) => {
  switch (slug) {
    case 'bridge':
    case 'bridge_volume':
      return BridgeIcon;
    case 'swap':
    case 'swap_volume':
      return SwapIcon;
    case 'gm':
    case 'gm_count':
      return GmIcon;
    case 'inkypump':
    case 'inkypump_activity':
      return RocketIcon;
    case 'tydro':
    case 'tydro_defi':
      return BankIcon;
    default:
      return BridgeIcon;
  }
};

const getColorClasses = (slug: string | null) => {
  switch (slug) {
    case 'bridge':
    case 'bridge_volume':
      return { border: 'border-purple-500/20', bg: 'bg-purple-500/5', text: 'text-purple-400', badge: 'bg-purple-900/30 border-purple-500/30 text-purple-400' };
    case 'swap':
    case 'swap_volume':
      return { border: 'border-blue-500/20', bg: 'bg-blue-500/5', text: 'text-blue-400', badge: 'bg-blue-900/30 border-blue-500/30 text-blue-400' };
    case 'gm':
    case 'gm_count':
      return { border: 'border-yellow-500/20', bg: 'bg-yellow-500/5', text: 'text-yellow-500', badge: 'bg-yellow-900/30 border-yellow-500/30 text-yellow-400' };
    case 'inkypump':
    case 'inkypump_activity':
      return { border: 'border-pink-500/20', bg: 'bg-pink-500/5', text: 'text-pink-400', badge: 'bg-pink-900/30 border-pink-500/30 text-pink-400' };
    case 'tydro':
    case 'tydro_defi':
      return { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', text: 'text-emerald-400', badge: 'bg-emerald-900/30 border-emerald-500/30 text-emerald-400' };
    default:
      return { border: 'border-slate-500/20', bg: 'bg-slate-500/5', text: 'text-slate-400', badge: 'bg-slate-900/30 border-slate-500/30 text-slate-400' };
  }
};

const formatValue = (value: string, currency: string) => {
  const num = parseFloat(value);
  if (currency === 'USD') {
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (currency === 'ETH') {
    return `${num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ETH`;
  }
  return num.toLocaleString();
};

export const AnalyticsCards: React.FC<AnalyticsCardsProps> = ({ walletAddress }) => {
  const [analytics, setAnalytics] = useState<UserAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!walletAddress || walletAddress.length < 10) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/analytics/${walletAddress}`);
        
        if (!res.ok) {
          throw new Error('Failed to fetch analytics');
        }

        const data = await res.json();
        setAnalytics(data);
      } catch (err) {
        console.error('Failed to fetch analytics:', err);
        setError('Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [walletAddress]);

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2].map((i) => (
          <div key={i} className="glass-card p-6 rounded-xl animate-pulse">
            <div className="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
            <div className="h-10 bg-slate-800 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (error || !analytics || analytics.metrics.length === 0) {
    return null; // Don't show anything if no data
  }

  // Exclude metrics that have dedicated cards in the Dashboard
  const excludedSlugs = ['gm_count', 'tydro_defi'];
  const filteredMetrics = analytics.metrics.filter(m => !excludedSlugs.includes(m.slug));

  if (filteredMetrics.length === 0) {
    return null;
  }

  return (
    <>
      {filteredMetrics.map((metric, index) => {
        const IconComponent = getIconComponent(metric.slug);
        const colors = getColorClasses(metric.slug);
        const hasSubAggregates = metric.sub_aggregates && metric.sub_aggregates.length > 0;
        const hasByFunction = metric.sub_aggregates.some(s => s.by_function && Object.keys(s.by_function).length > 0);

        return (
          <div
            key={metric.slug}
            className={`glass-card p-6 rounded-xl animate-fade-in-up border ${colors.border} ${colors.bg}`}
            style={{ animationDelay: `${0.75 + index * 0.05}s` }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <IconComponent size={20} className={colors.text} />
                {metric.name}
              </h3>
              <div className={`text-xs font-bold px-2 py-1 rounded border ${colors.badge}`}>
                {metric.currency}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className={`text-2xl font-bold font-display ${colors.text}`}>
                  {formatValue(metric.total_value, metric.currency)}
                </div>
                <div className="text-xs text-slate-500">Total Volume</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold font-display text-white">
                  {metric.total_count.toLocaleString()}
                </div>
                <div className="text-xs text-slate-500">Transactions</div>
              </div>
            </div>

            {/* Sub-aggregates by contract */}
            {hasSubAggregates && (
              <div className="mt-4 pt-3 border-t border-slate-700/50 space-y-2">
                {metric.sub_aggregates.slice(0, 3).map((sub, i) => (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <span className="text-slate-400 font-mono text-xs">
                      {sub.contract_name || `${sub.contract_address.slice(0, 6)}...${sub.contract_address.slice(-4)}`}
                    </span>
                    <span className="font-mono text-white">
                      {metric.currency === 'COUNT' 
                        ? `${sub.count.toLocaleString()} txs`
                        : formatValue(sub.usd_value, 'USD')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* By function breakdown */}
            {hasByFunction && (
              <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2">
                <span className="text-xs text-slate-500 uppercase tracking-wider">By Function</span>
                {metric.sub_aggregates.map((sub) => 
                  sub.by_function && Object.entries(sub.by_function).slice(0, 4).map(([func, funcData]) => (
                    <div key={func} className="flex justify-between items-center text-sm">
                      <span className="text-slate-400 font-mono text-xs">{func}()</span>
                      <span className="font-mono text-white">{funcData.count.toLocaleString()} txs</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {metric.total_count > 0 && (
              <div className={`mt-3 text-xs ${colors.text} opacity-80 flex items-center gap-1`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colors.text.replace('text-', 'bg-')} animate-pulse`}></span>
                Active User
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
