"use client";

import { useState, useEffect } from 'react';
import { Logo } from '../components/Logo';
import { Trophy, Loader2, ExternalLink, Star, Sparkles, RefreshCw, Menu, X, Plus } from '../components/Icons';
import Link from 'next/link';

const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';

interface LeaderboardEntry {
  wallet_address: string;
  token_id: string;
  nft_image_url: string;
  score: number;
  rank: string;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
  total: number;
  limit: number;
  currentPage: number;
  totalPages: number;
  hasMore: boolean;
}

export default function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    fetchLeaderboard(currentPage);
  }, [currentPage]);

  const fetchLeaderboard = async (page: number) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/nft/leaderboard?page=${page}`);

      if (!response.ok) {
        throw new Error('Failed to fetch leaderboard');
      }

      const data: LeaderboardResponse = await response.json();
      setLeaderboard(data.leaderboard);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const abbreviateAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (hasMore) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans selection:bg-ink-purple selection:text-white">
      {/* Navigation - Same as home page */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="cursor-pointer hover:opacity-90 transition-opacity">
            <Logo size="sm" />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/how-it-works" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
              How it Works
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </Link>
            <Link href="/leaderboard" className="text-sm font-medium text-white relative">
              Leaderboard
              <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-ink-purple"></span>
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden text-slate-400 hover:text-white"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-ink-900 border-b border-slate-800 p-6 space-y-4 animate-fade-in-up">
            <Link href="/how-it-works" className="block text-slate-300">How it Works</Link>
            <Link href="/leaderboard" className="block text-white font-semibold">Leaderboard</Link>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className="pt-32 pb-20 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          {/* Header with enhanced styling */}
          <div className="text-center mb-16 animate-fade-in-up">
            <div className="inline-flex items-center justify-center gap-3 mb-6 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/20 via-purple-500/20 to-blue-500/20 blur-3xl"></div>
              <Trophy size={48} className="text-yellow-400 relative z-10 animate-pulse" />
              <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-white via-purple-200 to-blue-200 bg-clip-text text-transparent relative z-10">
                Leaderboard
              </h1>
            </div>
            <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto mb-4">
              NFT holders on InkScore
            </p>
            {total > 0 && (
              <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
                <Sparkles size={16} className="text-purple-400" />
                <span>{total.toLocaleString()} NFT{total === 1 ? '' : 's'} minted</span>
              </div>
            )}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-32 animate-fade-in">
              <Loader2 size={48} className="animate-spin text-purple-400 mb-4" />
              <p className="text-slate-500">Loading leaderboard...</p>
            </div>
          )}

          {/* Error State */}
          {error && !isLoading && (
            <div className="text-center py-32 animate-fade-in">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
                <ExternalLink size={32} className="text-red-400" />
              </div>
              <p className="text-red-400 text-lg mb-6">{error}</p>
              <button
                onClick={() => fetchLeaderboard(1)}
                className="group relative px-6 py-3 rounded-lg text-sm font-medium transition-all overflow-hidden"
              >
                <div className="absolute inset-0 bg-purple-500/20 border border-purple-500/40 group-hover:bg-purple-500/30 transition-colors"></div>
                <span className="relative z-10 flex items-center gap-2 text-purple-400">
                  <RefreshCw size={16} />
                  Try Again
                </span>
              </button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !error && leaderboard.length === 0 && (
            <div className="text-center py-32 animate-fade-in">
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-slate-800/50 border border-slate-700 mb-6">
                <Trophy size={48} className="text-slate-600" />
              </div>
              <h2 className="text-2xl font-bold text-slate-300 mb-2">No NFTs Minted Yet</h2>
              <p className="text-slate-500 mb-8">Be the first to mint your InkScore and claim the top spot!</p>
              <Link
                href="/"
                className="inline-block px-6 py-3 bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/40 rounded-lg text-purple-400 hover:from-purple-500/30 hover:to-blue-500/30 transition-all"
              >
                Go to Dashboard
              </Link>
            </div>
          )}

          {/* Leaderboard Content */}
          {!isLoading && !error && leaderboard.length > 0 && (
            <>
              {/* Full Leaderboard Table */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-sm animate-fade-in-up">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/80">
                        <th className="text-left px-4 md:px-6 py-4 text-xs md:text-sm font-semibold text-slate-400 uppercase tracking-wider">#</th>
                        <th className="text-center px-4 md:px-6 py-4 text-xs md:text-sm font-semibold text-slate-400 uppercase tracking-wider">NFT</th>
                        <th className="text-left px-4 md:px-6 py-4 text-xs md:text-sm font-semibold text-slate-400 uppercase tracking-wider">Wallet</th>
                        <th className="text-left px-4 md:px-6 py-4 text-xs md:text-sm font-semibold text-slate-400 uppercase tracking-wider">Current Score</th>
                        <th className="text-left px-4 md:px-6 py-4 text-xs md:text-sm font-semibold text-slate-400 uppercase tracking-wider">Rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((entry, index) => {
                        const globalIndex = (currentPage - 1) * 10 + index;
                        return (
                          <tr
                            key={entry.token_id}
                            className="border-b border-slate-800/50 hover:bg-slate-800/40 transition-all duration-200 group"
                            style={{ animationDelay: `${index * 30}ms` }}
                          >
                            {/* Index */}
                            <td className="px-4 md:px-6 py-4">
                              <div className="flex items-center gap-2">
                                {globalIndex === 0 && <Trophy size={20} className="text-yellow-400 animate-pulse" />}
                                {globalIndex === 1 && <Trophy size={20} className="text-slate-300" />}
                                {globalIndex === 2 && <Trophy size={20} className="text-orange-400" />}
                                <span className={`font-semibold ${globalIndex < 3 ? 'text-white text-lg' : 'text-slate-400'}`}>
                                  #{globalIndex + 1}
                                </span>
                              </div>
                            </td>

                            {/* NFT Image */}
                            <td className="px-4 md:px-6 py-4">
                              <div className="flex justify-center">
                                <a
                                  href={`https://explorer.inkonchain.com/token/${NFT_CONTRACT_ADDRESS}/instance/${entry.token_id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block"
                                >
                                  <div className="w-14 h-14 md:w-16 md:h-16 rounded-lg overflow-hidden border-2 border-slate-700 hover:border-purple-500/50 transition-all hover:scale-110 shadow-lg cursor-pointer">
                                    <img
                                      src={entry.nft_image_url}
                                      alt={`NFT #${entry.token_id}`}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect fill="%23334155" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23cbd5e1" font-size="20"%3ENFT%3C/text%3E%3C/svg%3E';
                                      }}
                                    />
                                  </div>
                                </a>
                              </div>
                            </td>

                            {/* Wallet */}
                            <td className="px-4 md:px-6 py-4">
                              <a
                                href={`https://explorer.inkonchain.com/address/${entry.wallet_address}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs md:text-sm text-purple-400 hover:text-purple-300 flex items-center gap-1.5 group-hover:underline transition-all"
                              >
                                {abbreviateAddress(entry.wallet_address)}
                                <ExternalLink size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            </td>

                            {/* Score */}
                            <td className="px-4 md:px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-white font-bold text-base md:text-lg">
                                  {entry.score.toLocaleString()}
                                </span>
                                <span className="text-slate-500 text-xs">points</span>
                              </div>
                            </td>

                            {/* Rank */}
                            <td className="px-4 md:px-6 py-4">
                              <span className="text-slate-300 text-sm">
                                {entry.rank}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 1}
                  className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Previous
                </button>
                <span className="text-slate-400">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={!hasMore}
                  className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  Next
                </button>
              </div>

              {/* Refresh Button */}
              <div className="mt-4 text-center">
                <button
                  onClick={() => {
                    setCurrentPage(1);
                    fetchLeaderboard(1);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  <RefreshCw size={16} />
                  Refresh
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer - Same as home page */}
      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6 mt-auto relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <Logo size="sm" showText={false} />
            <span className="text-slate-500 text-sm">
              &copy; 2026 INKSCORE.
            </span>
          </div>
          <div className="flex gap-6">
            <a href="/about" className="text-slate-500 hover:text-white transition-colors">About</a>
            <a href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</a>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
