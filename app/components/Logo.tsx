"use client";

import React from 'react';
import Image from 'next/image';

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
        <Image
          src="/inkscore_logo.png"
          alt="Inkscore Logo"
          width={s.w}
          height={s.h}
          className="drop-shadow-[0_0_10px_rgba(124,58,237,0.5)] group-hover:drop-shadow-[0_0_15px_rgba(168,85,247,0.7)] transition-all duration-500 group-hover:scale-105"
        />
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
