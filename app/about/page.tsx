"use client";

import React from 'react';
import Link from 'next/link';
import { Logo } from '../components/Logo';
import { ArrowLeft, Info, Users, ExternalLink, Calculator, Send } from '../components/Icons';

export default function AboutPage() {
  return (
    <div className="bg-ink-950 min-h-screen text-slate-200">
      {/* Header */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-4">
            <Logo size="sm" />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Dashboard
          </Link>
        </div>
      </nav>

      <main className="pt-20 max-w-4xl mx-auto px-6 pb-20">
        {/* Hero Section */}
        <section className="pt-12 mb-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ink-purple/10 border border-ink-purple/20 mb-6">
            <Info size={16} className="text-ink-purple" />
            <span className="text-sm text-ink-purple font-medium">About INKSCORE</span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-display font-bold mb-4">
            Everything You Need to <span className="text-gradient">Know</span>
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Learn how INKSCORE works, what makes it unique, and how you can participate in the ecosystem.
          </p>
        </section>

        {/* Key Information Cards */}
        <div className="space-y-6 mb-16">
          {/* NFT Updates */}
          <div className="glass-card p-6 rounded-xl hover:border-ink-purple/30 transition-all">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                <span className="text-2xl">🔄</span>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">NFT Updates & Burning</h3>
                <p className="text-slate-400 leading-relaxed">
                  When you update an already minted NFT, the first one gets automatically burned. This ensures 
                  you only have one active INKSCORE NFT at a time, representing your most current score and rank. 
                  Each update replaces the previous NFT with a new one reflecting your latest achievements.
                </p>
              </div>
            </div>
          </div>

          {/* Leaderboard Eligibility */}
          <div className="glass-card p-6 rounded-xl hover:border-ink-purple/30 transition-all">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0">
                <Users size={24} className="text-purple-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Leaderboard Eligibility</h3>
                <p className="text-slate-400 leading-relaxed">
                  The <Link href="/leaderboard" className="text-ink-accent hover:text-ink-purple transition-colors">Leaderboard</Link> lists 
                  only users who have minted their INKSCORE NFT. To appear on the leaderboard, you must mint your score as an NFT. 
                  This creates a verified, on-chain record of your achievement and allows you to compete with other users.
                </p>
              </div>
            </div>
          </div>

          {/* Platform Logos */}
          <div className="glass-card p-6 rounded-xl hover:border-ink-purple/30 transition-all">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                <ExternalLink size={24} className="text-green-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Clickable Platform Logos</h3>
                <p className="text-slate-400 leading-relaxed">
                  All platform logos throughout the site are clickable and will navigate you to the external platform. 
                  This makes it easy to explore the various dApps and protocols that contribute to your INKSCORE. 
                  Simply click on any logo to visit that platform directly.
                </p>
              </div>
            </div>
          </div>

          {/* Points Calculation */}
          <div className="glass-card p-6 rounded-xl hover:border-ink-purple/30 transition-all">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                <Calculator size={24} className="text-orange-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">Points Calculation</h3>
                <p className="text-slate-400 leading-relaxed">
                  Want to understand how your points are calculated? Visit the{' '}
                  <Link href="/how-it-works" className="text-ink-accent hover:text-ink-purple transition-colors">
                    How it Works
                  </Link>{' '}
                  page for a detailed breakdown of all metrics, tiers, and scoring formulas. Learn exactly how each 
                  platform and activity contributes to your total INKSCORE.
                </p>
              </div>
            </div>
          </div>

          {/* Platform Request */}
          <div className="glass-card p-6 rounded-xl hover:border-ink-purple/30 transition-all">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-pink-500/10 flex items-center justify-center shrink-0">
                <Send size={24} className="text-pink-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-2">List Your Platform</h3>
                <p className="text-slate-400 leading-relaxed mb-4">
                  Building on InkChain? Submit a request to include your platform in INKSCORE calculations.
                </p>
                <div className="mb-4">
                  <img 
                    src="/platform_request.png" 
                    alt="Platform Request Button in Navigation"
                    className="w-full rounded-lg border border-slate-700/50"
                  />
                </div>
                <button
                  onClick={() => {
                    window.location.href = '/?platform-request=true';
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-ink-purple/10 hover:bg-ink-purple/20 border border-ink-purple/30 text-ink-accent rounded-lg transition-all"
                >
                  <Send size={16} />
                  Submit Platform Request
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <section className="glass-card p-8 rounded-2xl">
          <h2 className="text-2xl font-display font-bold mb-6 text-center">Quick Links</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href="/how-it-works"
              className="p-4 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-ink-purple/30 transition-all group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">📚</span>
                <div>
                  <div className="font-semibold text-white group-hover:text-ink-purple transition-colors">
                    How it Works
                  </div>
                  <div className="text-sm text-slate-400">Learn about scoring</div>
                </div>
              </div>
            </Link>
            <Link
              href="/leaderboard"
              className="p-4 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-ink-purple/30 transition-all group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏆</span>
                <div>
                  <div className="font-semibold text-white group-hover:text-ink-purple transition-colors">
                    Leaderboard
                  </div>
                  <div className="text-sm text-slate-400">See top scores</div>
                </div>
              </div>
            </Link>
            <Link
              href="/"
              className="p-4 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-ink-purple/30 transition-all group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🎯</span>
                <div>
                  <div className="font-semibold text-white group-hover:text-ink-purple transition-colors">
                    Dashboard
                  </div>
                  <div className="text-sm text-slate-400">Check your score</div>
                </div>
              </div>
            </Link>
            <a
              href="https://x.com/Inkscore"
              target="_blank"
              rel="noopener noreferrer"
              className="p-4 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-ink-purple/30 transition-all group"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">𝕏</span>
                <div>
                  <div className="font-semibold text-white group-hover:text-ink-purple transition-colors">
                    Twitter
                  </div>
                  <div className="text-sm text-slate-400">Follow us</div>
                </div>
              </div>
            </a>
          </div>
        </section>

        {/* CTA */}
        <section className="text-center mt-16">
          <div className="glass-card p-8 rounded-2xl">
            <h3 className="text-2xl font-display font-bold mb-4">Ready to Get Started?</h3>
            <p className="text-slate-400 mb-6">
              Connect your wallet to see your INKSCORE and start earning points across the InkChain ecosystem.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-ink-blue hover:bg-blue-600 text-white font-semibold rounded-xl transition-all"
            >
              Go to Dashboard
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6">
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
            <Link href="/about" className="text-slate-500 hover:text-white transition-colors">About</Link>
            <Link href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</Link>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
