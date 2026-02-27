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
                  <div className="glass-card p-8 rounded-2xl animate-fade-in-up border-2" 
                    style={{ 
                      borderColor: phase1Status.isPhase1 ? 'rgba(52, 211, 153, 0.3)' : 'rgba(148, 163, 184, 0.3)',
                      animationDelay: '0.4s' 
                    }}
                  >
                    <div className="text-center mb-6">
                      {phase1Status.isPhase1 ? (
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 mb-4">
                          <CheckCircle size={40} className="text-emerald-400" />
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-500/10 border-2 border-slate-500/30 mb-4">
                          <AlertCircle size={40} className="text-slate-400" />
                        </div>
                      )}
                      
                      <h2 className={`text-3xl font-display font-bold mb-2 ${phase1Status.isPhase1 ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {phase1Status.isPhase1 ? 'Congratulations!' : 'Not Eligible'}
                      </h2>
                      
                      <p className="text-slate-400">
                        {phase1Status.isPhase1 
                          ? 'Your wallet is eligible for Phase 1' 
                          : 'Your wallet is not in Phase 1'}
                      </p>
                    </div>

                    {phase1Status.isPhase1 && phase1Status.score && (
                      <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700/50">
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-slate-400 text-sm">Your Score</span>
                          <span className="text-2xl font-display font-bold text-white">
                            {phase1Status.score.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 text-sm">Total Phase 1 Wallets</span>
                          <span className="text-lg font-mono text-slate-300">
                            {phase1Status.totalPhase1Wallets.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    )}

                    {!phase1Status.isPhase1 && (
                      <div className="bg-slate-900/50 rounded-xl p-6 border border-slate-700/50">
                        <p className="text-slate-400 text-sm text-center">
                          Don't worry! Keep building your InkScore for future opportunities.
                        </p>
                      </div>
                    )}

                    <div className="mt-6 text-center">
                      <Link 
                        href="/"
                        className="inline-flex items-center gap-2 text-ink-purple hover:text-purple-400 transition-colors text-sm font-medium"
                      >
                        View Your Dashboard →
                      </Link>
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
