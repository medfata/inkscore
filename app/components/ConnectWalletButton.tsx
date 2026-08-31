'use client';

import { useAccount } from 'wagmi';
import { useAppKit } from '@reown/appkit/react';
import { Loader2 } from './Icons';

const SIZES = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-2.5 text-sm',
  lg: 'px-8 py-3.5 text-base',
} as const;

interface ConnectWalletButtonProps {
  /** sm = header nav, lg = hero / page CTAs */
  size?: keyof typeof SIZES;
  label?: string;
  className?: string;
}

/**
 * Single Connect Wallet control shared across all pages (header, hero, CTAs).
 * Self-contained: opens the AppKit modal and tracks its own connecting state.
 */
export function ConnectWalletButton({
  size = 'md',
  label = 'Connect Wallet',
  className = '',
}: ConnectWalletButtonProps) {
  const { open } = useAppKit();
  const { isConnecting } = useAccount();

  return (
    <button
      onClick={() => open()}
      disabled={isConnecting}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white font-medium text-slate-950 shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-all duration-200 hover:bg-white/90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${SIZES[size]} ${className}`}
    >
      {isConnecting && <Loader2 size={16} className="animate-spin" />}
      <span>{isConnecting ? 'Connecting...' : label}</span>
    </button>
  );
}
