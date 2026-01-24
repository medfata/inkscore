"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import { Dashboard } from '../../components/Dashboard';
import { Logo } from '../../components/Logo';
import { ExternalLink } from '../../components/Icons';

export default function WalletTestPage() {
  const params = useParams();
  const address = params.address as string;

  // Validate address format (basic check)
  const isValidAddress = address && /^0x[a-fA-F0-9]{40}$/.test(address);

  if (!isValidAddress) {
    return (
      <div className="bg-ink-950 min-h-screen text-slate-200 font-sans">
        <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <a href="/" className="cursor-pointer hover:opacity-90 transition-opacity">
              <Logo size="sm" />
            </a>
            <div className="text-sm font-mono bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-400">
              Test Mode
            </div>
          </div>
        </nav>

        <main className="pt-32 px-6">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-3xl font-bold text-white mb-4">Invalid Wallet Address</h1>
            <p className="text-slate-400 mb-8">
              Please provide a valid Ethereum address in the URL.
            </p>
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
              <p className="text-sm text-slate-500 mb-2">Expected format:</p>
              <code className="text-ink-purple font-mono text-sm">
                /test/0x1234...abcd
              </code>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const displayAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans selection:bg-ink-purple selection:text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <a href="/" className="cursor-pointer hover:opacity-90 transition-opacity">
            <Logo size="sm" />
          </a>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 text-xs text-yellow-500 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 rounded-lg">
              <span>🧪 Test Mode</span>
            </div>
            <div className="text-sm font-mono bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-400 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
              {displayAddress}
            </div>
            <a
              href={`https://explorer.inkonchain.com/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
            >
              Explorer <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </nav>

      <main>
        <Dashboard walletAddress={address} isDemo={false} />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6 mt-auto relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <Logo size="sm" showText={false} />
            <span className="text-slate-500 text-sm">
              &copy; 2026 INKSCORE.
            </span>
          </div>
          <div className="flex gap-6">
            <a href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</a>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
