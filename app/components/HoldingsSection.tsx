"use client";

import React from 'react';
import { getProxiedImageUrl } from '@/lib/utils/imageProxy';

type TokenType = 'meme' | 'stablecoin' | 'native' | 'defi' | 'governance' | 'utility' | null;

interface TokenHolding {
  name: string;
  symbol: string;
  address: string;
  logo: string;
  balance: number;
  usdValue: number;
  tokenType?: TokenType;
}

interface NftCollectionHolding {
  name: string;
  address: string;
  logo: string;
  openseaUrl?: string | null;
  count: number;
}

interface HoldingsSectionProps {
  tokenHoldings: TokenHolding[];
  nftCollections: NftCollectionHolding[];
  nativeEthUsd: number;
  nativeEthBalance: number;
}

/* Tiny colored dot replacing the old badge pills — label surfaces on hover.
   Static, minimal, and professional: one dot communicates the token type
   without shouting. */
const TYPE_DOTS: Record<string, { dot: string; label: string }> = {
  meme: { dot: 'bg-yellow-400', label: 'Meme token' },
  stablecoin: { dot: 'bg-green-400', label: 'Stablecoin' },
  native: { dot: 'bg-blue-400', label: 'Native token' },
  defi: { dot: 'bg-purple-400', label: 'DeFi token' },
  governance: { dot: 'bg-orange-400', label: 'Governance token' },
  utility: { dot: 'bg-cyan-400', label: 'Utility token' },
};

const TypeDot: React.FC<{ type: TokenType }> = ({ type }) => {
  if (!type) return null;

  const style = TYPE_DOTS[type];
  if (!style) return null;

  return (
    <span
      aria-hidden="true"
      title={style.label}
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`}
    ></span>
  );
};

const avatarFallback = (name: string, size = 64) =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=334155&color=94a3b8&size=${size}`;

export const HoldingsSection: React.FC<HoldingsSectionProps> = ({
  tokenHoldings,
  nftCollections,
  nativeEthUsd,
  nativeEthBalance,
}) => {
  // Filter out USDGLO token and separate meme coins from regular tokens
  const filteredTokens = tokenHoldings.filter(token => token.symbol !== 'USDGLO');
  const memeCoins = filteredTokens.filter(token => token.tokenType === 'meme');
  const regularTokens = filteredTokens.filter(token => token.tokenType !== 'meme');

  // Custom sort order for meme coins: ANITA -> CAT -> PURPLE -> AK47 -> KRAKMASK -> BERT
  const memeCoinsOrder = ['ANITA', 'CAT', 'PURPLE', 'ANDRU', 'KRAK', 'BERT', 'BEAST'];
  const sortedMemeCoins = [...memeCoins].sort((a, b) => {
    const indexA = memeCoinsOrder.indexOf(a.symbol);
    const indexB = memeCoinsOrder.indexOf(b.symbol);

    // If both tokens are in our custom order, sort by that order
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    // If only one is in our custom order, prioritize it
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // If neither is in our custom order, sort alphabetically
    return a.symbol.localeCompare(b.symbol);
  });

  // Sort NFT collections to put Rekt Ink first
  const sortedNftCollections = [...nftCollections].sort((a, b) => {
    if (a.name === 'Rekt Ink') return -1;
    if (b.name === 'Rekt Ink') return 1;
    return 0;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
      {/* Token Holdings Card */}
      <div className="glass-card p-4 rounded-2xl border border-white/5 flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 min-w-0">
            <div className="flex items-center -space-x-3 shrink-0">
              {regularTokens.slice(0, 3).map((token, i) => (
                <img
                  key={i}
                  src={getProxiedImageUrl(token.logo)}
                  alt={token.symbol}
                  className="w-7 h-7 rounded-full object-cover bg-slate-800 ring-2 ring-slate-900/80"
                  style={{ zIndex: 3 - i }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = avatarFallback(token.symbol, 28);
                  }}
                />
              ))}
            </div>
            <span className="truncate">Token Holdings</span>
          </h3>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
            {regularTokens.length} token{regularTokens.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
          {regularTokens.map((token) => {
            // For ETH token, use native balance and USD value
            const isEthToken = token.symbol === 'ETH';
            const displayUsdValue = isEthToken ? nativeEthUsd : token.usdValue;
            const displayBalance = isEthToken ? nativeEthBalance : token.balance;
            return (
              <div
                key={token.address}
                className="flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                title={token.name}
              >
                <img
                  src={getProxiedImageUrl(token.logo)}
                  alt={token.symbol}
                  className="w-9 h-9 rounded-full object-cover bg-slate-800 shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = avatarFallback(token.symbol);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                    <span className="truncate">{token.symbol}</span>
                    <TypeDot type={token.tokenType || null} />
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">{token.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-display text-white">
                    ${displayUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {displayBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Meme Coins Card */}
      <div className="glass-card p-4 rounded-2xl border border-white/5 flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 min-w-0">
            <div className="flex items-center -space-x-3 shrink-0">
              {sortedMemeCoins.slice(0, 3).map((token, i) => (
                <img
                  key={i}
                  src={getProxiedImageUrl(token.logo)}
                  alt={token.symbol}
                  className="w-7 h-7 rounded-full object-cover bg-slate-800 ring-2 ring-slate-900/80"
                  style={{ zIndex: 3 - i }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = avatarFallback(token.symbol, 28);
                  }}
                />
              ))}
              {sortedMemeCoins.length === 0 && (
                <div className="w-7 h-7 rounded-full border border-white/10 bg-slate-800 flex items-center justify-center">
                  <span className="text-slate-400 text-xs">🚀</span>
                </div>
              )}
            </div>
            <span className="truncate">Meme Coins</span>
          </h3>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
            {sortedMemeCoins.length} meme{sortedMemeCoins.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
          {sortedMemeCoins.length > 0 ? (
            sortedMemeCoins.map((token) => (
              <div
                key={token.address}
                className="flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                title={token.name}
              >
                <img
                  src={getProxiedImageUrl(token.logo)}
                  alt={token.symbol}
                  className="w-9 h-9 rounded-full object-cover bg-slate-800 shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = avatarFallback(token.symbol);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white truncate">{token.symbol}</div>
                  <div className="text-[11px] text-slate-500 truncate">{token.name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold font-display text-white">
                    ${token.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="text-3xl mb-2 opacity-80">🐸</div>
              <div className="text-slate-400 text-sm">No meme coins yet</div>
              <div className="text-slate-500 text-[11px] mt-1">Time to ape in?</div>
            </div>
          )}
        </div>
      </div>

      {/* NFT Collections Card */}
      <div className="glass-card p-4 rounded-2xl border border-white/5 flex flex-col">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2 min-w-0">
            <div className="flex items-center -space-x-3 shrink-0">
              {sortedNftCollections.slice(0, 3).map((collection, i) => {
                const headerIcon = (
                  <img
                    src={getProxiedImageUrl(collection.logo)}
                    alt={collection.name}
                    className="w-7 h-7 rounded-full object-cover bg-slate-800 ring-2 ring-slate-900/80"
                    style={{ zIndex: 3 - i }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = avatarFallback(collection.name, 28);
                    }}
                  />
                );
                return collection.openseaUrl ? (
                  <a
                    key={i}
                    href={collection.openseaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View ${collection.name} on OpenSea`}
                    className="transition-opacity hover:opacity-80"
                    style={{ zIndex: 3 - i }}
                  >
                    {headerIcon}
                  </a>
                ) : (
                  <React.Fragment key={i}>{headerIcon}</React.Fragment>
                );
              })}
            </div>
            <span className="truncate">NFT Collections</span>
          </h3>
          <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
            {sortedNftCollections.filter(c => c.count > 0).length} held
          </span>
        </div>

        <div className="divide-y divide-white/5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
          {sortedNftCollections.map((collection) => {
            const icon = (
              <img
                src={getProxiedImageUrl(collection.logo)}
                alt={collection.name}
                className="w-9 h-9 rounded-full object-cover bg-slate-800 shrink-0"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = avatarFallback(collection.name);
                }}
              />
            );
            const iconWithLink = collection.openseaUrl ? (
              <a
                href={collection.openseaUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`View ${collection.name} on OpenSea`}
                className="rounded-full transition-opacity hover:opacity-80 hover:ring-2 hover:ring-white/30"
              >
                {icon}
              </a>
            ) : (
              icon
            );
            return (
              <div
                key={collection.address}
                className="flex items-center gap-3 py-2.5 transition-colors hover:bg-white/[0.03]"
                title={collection.name}
              >
                {iconWithLink}
                <div className="min-w-0 flex-1 text-sm font-semibold text-white truncate">
                  {collection.name}
                </div>
                <div
                  className={`text-sm font-bold font-display shrink-0 ${
                    collection.count > 0 ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {collection.count}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
