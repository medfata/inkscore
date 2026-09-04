"use client";

import React, { useState, useEffect } from 'react';
import { Activity, Layers, Lock, BarChart3, Award } from './Icons';
import { Logo } from './Logo';
import { ConnectWalletButton } from './ConnectWalletButton';

const FeatureCard = ({ icon: Icon, title, desc, delay }: { icon: React.ElementType, title: string, desc: string, delay: string }) => (
  <div
    className="glass-card glass-card-hover p-6 rounded-xl group relative overflow-hidden animate-fade-in-up"
    style={{ animationDelay: delay }}
  >
    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500">
      <div className="w-20 h-20 bg-ink-purple/20 blur-2xl rounded-full"></div>
    </div>
    <div className="w-12 h-12 rounded-lg bg-ink-purple/10 flex items-center justify-center mb-4 text-ink-purple group-hover:scale-110 transition-transform duration-300">
      <Icon size={24} />
    </div>
    <h3 className="text-xl font-display font-semibold mb-2 text-white">{title}</h3>
    <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
  </div>
);

const StepCard = ({ number, title, desc }: { number: string, title: string, desc: string }) => (
  <div className="relative pl-8 border-l-2 border-slate-800 hover:border-ink-purple transition-colors duration-300 py-4 group">
    <span className="absolute -left-[9px] top-6 w-4 h-4 rounded-full bg-slate-900 border-2 border-slate-600 group-hover:border-ink-purple transition-colors shadow-[0_0_10px_rgba(0,0,0,0.5)] group-hover:shadow-[0_0_10px_rgba(124,58,237,0.5)]"></span>
    <span className="text-xs font-bold text-ink-purple uppercase tracking-wider mb-1 block opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300">{number}</span>
    <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-slate-300 transition-all">{title}</h3>
    <p className="text-slate-400 text-sm group-hover:text-slate-300 transition-colors">{desc}</p>
  </div>
);

export const Landing: React.FC = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = 850;
    const duration = 2000;
    const increment = end / (duration / 16);

    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none z-0"></div>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 z-10">
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-ink-blue/20 blur-[120px] rounded-full -z-10 animate-blob mix-blend-screen"></div>
        <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-ink-purple/20 blur-[120px] rounded-full -z-10 animate-blob animation-delay-2000 mix-blend-screen"></div>

        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="text-center lg:text-left space-y-8 animate-fade-in-up">
            <h1 className="text-5xl lg:text-6xl font-display font-bold leading-[1.05] tracking-[-0.02em]">
              Your Reputation on <br />
              <span className="text-gradient">InkChain, Scored.</span>
            </h1>

            <p className="text-lg text-slate-400 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              INKSCORE is the definitive on-chain credit score. Analyze your wallet activity, DeFi participation, and NFT holdings to prove your worth in the ecosystem.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start pt-4">
              <ConnectWalletButton size="lg" />
              <a
                href="/staking"
                className="group inline-flex items-center justify-center gap-2.5 rounded-full border border-white/25 bg-white/5 px-8 py-3.5 text-base font-medium text-white transition-all duration-200 hover:border-white/40 hover:bg-white/10 active:scale-[0.97]"
              >
                InkScore Staking
                <span className="shine-tag"><span className="shine-tag-text">New</span></span>
              </a>
            </div>
          </div>

          <div className="relative perspective-1000">
            <div className="glass-card p-8 rounded-3xl relative z-10 max-w-md mx-auto shadow-2xl shadow-ink-purple/10 border border-white/10">
              <div className="flex justify-between items-start mb-10">
                <Logo size="sm" showText={false} />
                <div className="flex flex-col items-end">
                  <div className="text-xs text-slate-400 uppercase tracking-widest mb-1">Total INKSCORE</div>
                  <div className="flex items-center gap-1 text-yellow-500">
                    <Award size={16} />
                    <span className="text-xs font-bold">LEGEND TIER</span>
                  </div>
                </div>
              </div>

              <div className="flex items-end gap-4 mb-8 relative">
                <span className="text-8xl font-display font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-400 tracking-tighter">
                  {count}
                </span>
                <span className="text-lg text-green-400 font-medium mb-4 flex items-center gap-1 bg-green-900/20 px-2 py-1 rounded-md border border-green-500/20">
                  <Activity size={14} /> +12
                </span>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Reputation Health</span>
                  <span className="text-white font-bold">Excellent</span>
                </div>
                <div className="w-full bg-slate-800 h-3 rounded-full overflow-hidden p-[1px]">
                  <div
                    className="h-full bg-gradient-to-r from-ink-blue via-ink-purple to-ink-accent rounded-full transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(124,58,237,0.5)]"
                    style={{ width: `${(count / 850) * 100}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-xs text-slate-500 pt-2 border-t border-slate-800/50 mt-4">
                  <span>Top 1% of users</span>
                  <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div> Live Updates</span>
                </div>
              </div>
            </div>

            <div className="absolute top-10 -right-10 w-full h-full bg-gradient-to-br from-ink-purple/20 to-transparent rounded-3xl -z-10 blur-xl"></div>
            <div className="absolute -bottom-10 -left-10 w-2/3 h-2/3 bg-gradient-to-tr from-ink-blue/20 to-transparent rounded-full -z-10 blur-2xl"></div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 relative">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-3xl lg:text-4xl font-display font-bold mb-4">What is INKSCORE?</h2>
            <p className="text-slate-400 max-w-2xl mx-auto">Transparency and trust for the decentralized web. Built on InkChain, designed for the future.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard icon={BarChart3} title="Reputation Score" desc="A quantitative measure of your on-chain behavior and consistency." delay="0.1s" />
            <FeatureCard icon={Layers} title="Ink Native" desc="Built specifically for the InkChain ecosystem and its unique protocols." delay="0.2s" />
            <FeatureCard icon={Lock} title="Non-Custodial" desc="Read-only access. We calculate scores without touching your assets." delay="0.3s" />
            <FeatureCard icon={Activity} title="Dynamic Updates" desc="Your score evolves in real-time as you interact with the chain." delay="0.4s" />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-6 bg-slate-900/30 border-y border-white/5 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-ink-purple/50 to-transparent"></div>
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="order-2 lg:order-1">
            <h2 className="text-3xl lg:text-4xl font-display font-bold mb-6">How We Calculate</h2>
            <p className="text-slate-400 mb-8 leading-relaxed">
              The INKSCORE algorithm aggregates data across five key dimensions to produce a holistic view of your wallet&apos;s health and activity.
            </p>
            <div className="space-y-6">
              <StepCard number="01" title="DeFi Usage (30%)" desc="Liquidity provision, staking duration, and swap volume." />
              <StepCard number="02" title="Asset Holdings (25%)" desc="Quality of tokens and NFTs held in the wallet." />
              <StepCard number="03" title="Activity & Age (20%)" desc="Transaction frequency and wallet longevity." />
              <StepCard number="04" title="Ecosystem Loyalty (25%)" desc="Interaction with native InkChain dApps and governance." />
            </div>
          </div>

          <div className="relative order-1 lg:order-2 flex justify-center">
            <div className="w-80 h-80 rounded-full border border-slate-700/50 flex items-center justify-center relative">
              <div className="absolute inset-0 bg-ink-purple/5 rounded-full animate-pulse-slow"></div>
              <div className="absolute inset-10 border border-slate-700/50 rounded-full flex items-center justify-center">
                <div className="absolute inset-0 bg-ink-blue/5 rounded-full animate-pulse-slow" style={{ animationDelay: '1s' }}></div>
                <div className="absolute inset-10 border border-slate-700/50 rounded-full flex items-center justify-center bg-slate-900 shadow-2xl shadow-ink-purple/20">
                  <div className="text-center p-6">
                    <Logo size="md" showText={false} className="justify-center mb-2" />
                    <div className="text-xs text-slate-500 mt-2 font-mono">AI DRIVEN</div>
                  </div>
                </div>
              </div>

              <div className="absolute w-full h-full animate-spin [animation-duration:10s]">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1.5 w-3 h-3 bg-ink-accent rounded-full shadow-[0_0_10px_#a855f7]"></div>
              </div>
              <div className="absolute w-[75%] h-[75%] animate-spin [animation-duration:7s] [animation-direction:reverse]">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 bg-ink-blue rounded-full shadow-[0_0_10px_#2563eb]"></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
