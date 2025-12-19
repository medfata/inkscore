"use client";

import React from 'react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizes = {
  sm: { w: 32, h: 32, text: 'text-xl' },
  md: { w: 40, h: 40, text: 'text-2xl' },
  lg: { w: 64, h: 64, text: 'text-4xl' },
  xl: { w: 96, h: 96, text: 'text-6xl' },
};

export const Logo: React.FC<LogoProps> = ({ className = '', showText = true, size = 'md' }) => {
  const s = sizes[size];

  return (
    <div className={`flex items-center gap-3 ${className} select-none group`}>
      <div className="relative">
        <svg
          width={s.w}
          height={s.h}
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="drop-shadow-[0_0_10px_rgba(124,58,237,0.5)] group-hover:drop-shadow-[0_0_15px_rgba(168,85,247,0.7)] transition-all duration-500"
        >
          <defs>
            <linearGradient id="inkGradient" x1="0" y1="0" x2="100" y2="100">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="50%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#a855f7" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <path
            d="M50 5 L93.3 30 V80 L50 105 L6.7 80 V30 Z"
            stroke="url(#inkGradient)"
            strokeWidth="3"
            fill="rgba(15, 23, 42, 0.6)"
            className="group-hover:scale-105 origin-center transition-transform duration-500"
          />

          <path
            d="M50 25 C50 25 25 50 25 65 C25 80 37 90 50 90 C63 90 75 80 75 65 C75 50 50 25 50 25 Z"
            fill="url(#inkGradient)"
            className="animate-pulse-slow"
          />

          <path
            d="M40 65 L48 72 L60 55"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-90"
          />
        </svg>

        <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-400 rounded-full animate-ping opacity-75"></div>
      </div>

      {showText && (
        <div className="flex flex-col">
          <span className={`font-display font-bold tracking-tight text-white leading-none ${s.text}`}>
            INKSCORE
          </span>
          {size !== 'sm' && (
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
              Analytics
            </span>
          )}
        </div>
      )}
    </div>
  );
};
