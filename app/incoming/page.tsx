"use client";

import { useState, useEffect, Suspense } from 'react';
import { useAccount, useDisconnect } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Logo } from '../components/Logo';
import { Menu, X, Clock, CheckCircle, AlertCircle, Award } from '../components/Icons';

const TARGET_DATE = new Date('2026-03-01T10:00:00').getTime();

interface Phase1Status {
  isPhase1: boolean;
  score: number | null;
  totalPhase1Wallets: number;
}

function IncomingPageContent() {
  const searchParams = useSearchParams();
  const isAdminMode = searchParams.get('admin') === 'true';
  
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTimerEnded, setIsTimerEnded] = useState(isAdminMode); // Start as ended if admin mode
  const [phase1Status, setPhase1Status] = useState<Phase1Status | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

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
        // Only set timer as not ended if not in admin mode
        if (!isAdminMode) {
          setIsTimerEnded(false);
        }
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        setIsTimerEnded(true);
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [isAdminMode]);

  const handleConnect = () => {
    open();
  };

  const handleDisconnect = () => {
    disconnect();
    setPhase1Status(null);
    setHasChecked(false);
  };

  const handleCheckPhase1 = async () => {
    if (!address) {
      handleConnect();
      return;
    }

    setIsChecking(true);
    setHasChecked(false);

    try {
      const response = await fetch(`/api/phase1/check/${address}`);
      if (response.ok) {
        const data: Phase1Status = await response.json();
        setPhase1Status(data);
        setHasChecked(true);
      } else {
        console.error('Failed to check Phase 1 status');
      }
    } catch (error) {
      console.error('Error checking Phase 1 status:', error);
    } finally {
      setIsChecking(false);
    }
  };

  const displayAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;
  const pageTitle = isTimerEnded ? 'Checker' : 'Incoming';

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
              {pageTitle}
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
            <a href="/incoming" className="block text-white font-semibold">{pageTitle}</a>
            {isConnected ? (
              <button onClick={handleDisconnect} className="block w-full text-left text-red-400">Disconnect</button>
            ) : (
              <button onClick={handleConnect} className="block w-full text-left text-ink-purple font-semibold">Connect Wallet</button>
            )}
          </div>
        )}
      </nav>

      <main className="pt-24 pb-12 px-4 sm:px-6">
        {/* Admin Mode Banner */}
        {isAdminMode && (
          <div className="max-w-4xl mx-auto mb-6 animate-fade-in-up">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
              <span className="text-yellow-400 text-sm font-medium">
                Admin Mode Active - Timer bypassed for testing
              </span>
            </div>
          </div>
        )}
        
        <div className="max-w-4xl mx-auto">
          
          {!isTimerEnded ? (
            <>
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
            </>
          ) : (
            <>
              {/* Checker Mode */}
              <section className="pt-8 mb-12 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-8 animate-fade-in-up">
                  <Award size={16} className="text-emerald-400" />
                  <span className="text-sm text-emerald-400 font-medium">Phase 1 Checker</span>
                </div>
                <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
                  Check Your <span className="text-gradient">Phase 1</span> Status
                </h1>
                <p className="text-slate-400 text-lg max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                  Connect your wallet to see if you're eligible for InkScore Phase 1
                </p>
              </section>

              <div className="max-w-2xl mx-auto">
                {/* Check Button */}
                <div className="glass-card p-8 rounded-2xl mb-8 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
                  <button
                    onClick={handleCheckPhase1}
                    disabled={isChecking}
                    className="group relative w-full px-8 py-4 rounded-xl text-lg font-semibold transition-all overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-ink-purple to-purple-600 group-hover:from-purple-600 group-hover:to-ink-purple transition-all"></div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                    <span className="relative z-10 text-white flex items-center justify-center gap-2">
                      {isChecking ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          Checking...
                        </>
                      ) : isConnected ? (
                        <>
                          <Award size={20} />
                          Check Phase 1 Status
                        </>
                      ) : (
                        <>
                          Connect Wallet to Check
                        </>
                      )}
                    </span>
                  </button>

                  {!isConnected && (
                    <p className="text-center text-slate-500 text-sm mt-4">
                      Please connect your wallet to check your eligibility
                    </p>
                  )}
                </div>

                {/* Results */}
                {hasChecked && phase1Status && (
                  <div className="relative overflow-hidden rounded-3xl animate-fade-in-up" 
                    style={{ animationDelay: '0.4s' }}
                  >
                    {/* Animated background gradient */}
                    <div className={`absolute inset-0 ${phase1Status.isPhase1 
                      ? 'bg-gradient-to-br from-emerald-500/20 via-teal-500/10 to-cyan-500/20' 
                      : 'bg-gradient-to-br from-slate-700/20 via-slate-600/10 to-slate-500/20'
                    }`}>
                      <div className="absolute inset-0 backdrop-blur-3xl"></div>
                    </div>

                    <div className={`relative glass-card p-10 border-2 ${phase1Status.isPhase1 
                      ? 'border-emerald-400/30' 
                      : 'border-slate-500/30'
                    }`}>
                      <div className="text-center mb-8">
                        {/* Emoji Face */}
                        <div className="mb-6 animate-bounce-slow">
                          <span className="text-8xl" role="img" aria-label={phase1Status.isPhase1 ? "happy face" : "sad face"}>
                            {phase1Status.isPhase1 ? '😊' : '😢'}
                          </span>
                        </div>
                        
                        <h2 className={`text-4xl font-display font-bold mb-3 ${phase1Status.isPhase1 
                          ? 'text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400' 
                          : 'text-slate-400'
                        }`}>
                          {phase1Status.isPhase1 ? "You Are Eligible" : 'Not Eligible'}
                        </h2>
                        
                        <p className={`text-lg ${phase1Status.isPhase1 ? 'text-emerald-300/80' : 'text-slate-400'}`}>
                          {phase1Status.isPhase1 
                            ? 'Your wallet has been successfully recorded in the Phase 1 snapshot. Your participation and on-chain activity qualified you for this phase.' 
                            : "This wallet was not eligible for Phase 1. Phase 2 opens soon — new activity will count toward the next snapshot."}
                        </p>
                      </div>

                      {!phase1Status.isPhase1 && (
                        <div className="bg-slate-900/60 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50 mb-6">
                          <p className="text-slate-300 text-center leading-relaxed">
                            Keep engaging with Ink ecosystem! <br/>
                            <span className="text-slate-400 text-sm">Future phases are coming soon.</span>
                          </p>
                        </div>
                      )}

                      <div className="flex gap-4 justify-center">
                        <Link 
                          href="/"
                          className={`group relative px-6 py-3 rounded-xl font-medium transition-all overflow-hidden ${
                            phase1Status.isPhase1 
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white' 
                              : 'bg-slate-700/50 hover:bg-slate-700 text-slate-300'
                          }`}
                        >
                          <span className="relative z-10 flex items-center gap-2">
                            View Dashboard
                            <span className="group-hover:translate-x-1 transition-transform">→</span>
                          </span>
                        </Link>
                        
                        {!phase1Status.isPhase1 && (
                          <button
                            onClick={() => {
                              setHasChecked(false);
                              setPhase1Status(null);
                            }}
                            className="px-6 py-3 rounded-xl font-medium bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition-all border border-slate-700/50"
                          >
                            Check Another Wallet
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
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

export default function IncomingPage() {
  return (
    <Suspense fallback={
      <div className="bg-ink-950 min-h-screen text-slate-200 font-sans flex items-center justify-center">
        <div className="animate-pulse text-slate-400">Loading...</div>
      </div>
    }>
      <IncomingPageContent />
    </Suspense>
  );
}
