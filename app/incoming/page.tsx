"use client";

import React, { useState, useEffect } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import Link from 'next/link';
import { Logo } from '../components/Logo';
import { Menu, X, Clock } from '../components/Icons';

const TARGET_DATE = new Date('2026-03-01T10:00:00').getTime();

export default function IncomingPage() {
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const { address, isConnected, isConnecting } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useAppKit();

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const difference = TARGET_DATE - now;

      if (difference > 0) {
        setTimeLeft({
          days: Math.floor(difference / (1000 * 60 * 60 * 24)),
          hours: Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60)),
          seconds: Math.floor((difference % (1000 * 60)) / 1000)
        });
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleConnect = () => {
    open();
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans selection:bg-ink-purple selection:text-white overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-4">
            <Logo size="sm" />
          </Link>

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
            <a href="/incoming" className="text-sm font-medium text-white transition-colors relative group">
              Incoming
              <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-ink-purple"></span>
            </a>

            {isConnected ? (
              <div className="flex items-center gap-4">
                <div className="text-sm font-mono bg-slate-900/80 border border-slate-700 px-3 py-1.5 rounded-lg text-slate-400 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
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
            <a href="/incoming" className="block text-white font-semibold">Incoming</a>
            {isConnected ? (
              <button onClick={handleDisconnect} className="block w-full text-left text-red-400">Disconnect</button>
            ) : (
              <button onClick={handleConnect} className="block w-full text-left text-ink-purple font-semibold">Connect Wallet</button>
            )}
          </div>
        )}
      </nav>

      <main className="pt-24 pb-12 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <section className="pt-8 mb-12 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ink-purple/10 border border-ink-purple/20 mb-8">
              <Clock size={16} className="text-ink-purple" />
              <span className="text-sm text-ink-purple font-medium">Incoming</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
              Something <span className="text-gradient">epic</span> is coming...
            </h1>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Great things take time. Stay tuned!
            </p>
          </section>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 mb-12">
            <div className="glass-card p-6 md:p-8 rounded-2xl animate-fade-in-up text-center" style={{ animationDelay: '0.1s' }}>
              <div className="text-4xl md:text-6xl font-display font-bold text-white mb-2">
                {String(timeLeft.days).padStart(2, '0')}
              </div>
              <div className="text-ink-purple font-medium">Days</div>
            </div>

            <div className="glass-card p-6 md:p-8 rounded-2xl animate-fade-in-up text-center" style={{ animationDelay: '0.2s' }}>
              <div className="text-4xl md:text-6xl font-display font-bold text-white mb-2">
                {String(timeLeft.hours).padStart(2, '0')}
              </div>
              <div className="text-ink-purple font-medium">Hours</div>
            </div>

            <div className="glass-card p-6 md:p-8 rounded-2xl animate-fade-in-up text-center" style={{ animationDelay: '0.3s' }}>
              <div className="text-4xl md:text-6xl font-display font-bold text-white mb-2">
                {String(timeLeft.minutes).padStart(2, '0')}
              </div>
              <div className="text-ink-purple font-medium">Minutes</div>
            </div>

            <div className="glass-card p-6 md:p-8 rounded-2xl animate-fade-in-up text-center" style={{ animationDelay: '0.4s' }}>
              <div className="text-4xl md:text-6xl font-display font-bold text-white mb-2">
                {String(timeLeft.seconds).padStart(2, '0')}
              </div>
              <div className="text-ink-purple font-medium">Seconds</div>
            </div>
          </div>

          <section className="text-center">
            <div className="glass-card p-6 rounded-xl inline-block">
              <p className="text-slate-400 text-sm">
                Target date: <span className="text-white font-medium">March 1, 2026</span>
              </p>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
              <Logo size="sm" showText={false} />
              <span className="text-slate-500 text-sm">&copy; 2026 INKSCORE.</span>
            </div>
            <span className="text-slate-600 text-xs">Not affiliated with Ink and Kraken</span>
          </div>
          <div className="flex gap-6">
            <Link href="/about" className="text-slate-500 hover:text-white transition-colors">About</Link>
            <Link href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</Link>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
