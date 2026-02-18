"use client";

import { useState, useEffect } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';
import { Landing } from './components/Landing';
import { Dashboard } from './components/Dashboard';
import { Menu, X, Plus } from './components/Icons';
import { Logo } from './components/Logo';
import { PlatformRequestModal } from './components/PlatformRequestModal';

enum View {
  LANDING,
  DASHBOARD
}

export default function Home() {
  const [currentView, setCurrentView] = useState<View>(View.LANDING);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [isPlatformRequestModalOpen, setIsPlatformRequestModalOpen] = useState(false);

  const { address, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();

  // Auto-switch to dashboard when connected
  useEffect(() => {
    if (isConnected && address && !isDemo) {
      setCurrentView(View.DASHBOARD);
    }
  }, [isConnected, address, isDemo]);

  // Check for platform-request query parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('platform-request') === 'true') {
      setIsPlatformRequestModalOpen(true);
      // Clean up the URL without reloading
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = () => {
    open();
  };

  const startDemo = () => {
    setIsDemo(true);
    setCurrentView(View.DASHBOARD);
  };

  const handleDisconnect = () => {
    disconnect();
    setIsDemo(false);
    setCurrentView(View.LANDING);
  };

  const displayAddress = isDemo 
    ? "0xDEMO...USER" 
    : address 
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : null;

  const fullAddress = isDemo ? "" : address || "";

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans selection:bg-ink-purple selection:text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div
            className="cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => {
              if (!isConnected && !isDemo) {
                setCurrentView(View.LANDING);
              }
            }}
          >
            <Logo size="sm" />
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="/about" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
              About
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </a>
            <a href="/how-it-works" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
              How it Works
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </a>
            <a href="/leaderboard" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
              Leaderboard
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </a>
            <a href="/incoming" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
              Incoming
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </a>
            <button
              onClick={() => setIsPlatformRequestModalOpen(true)}
              className="text-sm font-medium text-ink-accent hover:text-white transition-colors relative group flex items-center gap-1"
            >
              <Plus size={14} />
              Platform Request
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
            </button>

            {(isConnected || isDemo) ? (
              <div className="flex items-center gap-4 animate-fade-in-up">
                <div className="text-sm font-mono bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-400 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isDemo ? 'bg-yellow-500' : 'bg-green-500'}`}></div>
                  {displayAddress}
                </div>
                <button
                  onClick={handleDisconnect}
                  className="text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="group relative px-5 py-2.5 rounded-lg text-sm font-medium transition-all overflow-hidden disabled:opacity-50"
              >
                <div className="absolute inset-0 bg-white/5 border border-white/10 group-hover:bg-white/10 transition-colors"></div>
                <span className="relative z-10 text-white">
                  {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                </span>
              </button>
            )}
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
            <a href="/about" className="block text-slate-300">About</a>
            <a href="/how-it-works" className="block text-slate-300">How it Works</a>
            <a href="/leaderboard" className="block text-slate-300">Leaderboard</a>
            <a href="/incoming" className="block text-slate-300">Incoming</a>
            <button
              onClick={() => {
                setIsPlatformRequestModalOpen(true);
                setIsMobileMenuOpen(false);
              }} 
              className="block text-ink-accent"
            >
              Platform Request
            </button>
            {(isConnected || isDemo) ? (
              <button onClick={handleDisconnect} className="block w-full text-left text-red-400">Disconnect</button>
            ) : (
              <button onClick={handleConnect} className="block w-full text-left text-ink-purple font-semibold">Connect Wallet</button>
            )}
          </div>
        )}
      </nav>

      <main>
        {currentView === View.LANDING ? (
          <Landing onConnect={handleConnect} onDemo={startDemo} />
        ) : (
          <Dashboard walletAddress={fullAddress} isDemo={isDemo} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6 mt-auto relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              <Logo size="sm" showText={false} />
              <span className="text-slate-500 text-sm">
                &copy; 2026 INKSCORE.
              </span>
            </div>
            <span className="text-slate-600 text-xs">
              Not affiliated with Ink and Kraken
            </span>
          </div>
          <div className="flex gap-6">
            <a href="/about" className="text-slate-500 hover:text-white transition-colors">About</a>
            <a href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</a>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>

      <PlatformRequestModal 
        isOpen={isPlatformRequestModalOpen} 
        onClose={() => setIsPlatformRequestModalOpen(false)} 
      />
    </div>
  );
}
