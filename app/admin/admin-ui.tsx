"use client";

import { useCallback, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAccount, useSignMessage } from 'wagmi';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';

/* ---- Minimal line icons (SF-symbol feel, stroke-based) ---- */

export const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export const WalletIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <rect x="2.75" y="5.75" width="18.5" height="13.5" rx="3.25" />
    <path d="M16.25 10.75h5v5.5h-5a2.75 2.75 0 1 1 0-5.5Z" />
  </svg>
);

export const LockIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <rect x="4.75" y="10.75" width="14.5" height="9.5" rx="3" />
    <path d="M8.25 10.5V8a3.75 3.75 0 0 1 7.5 0v2.5" />
  </svg>
);

export const PenIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M12 20.25h8.5" />
    <path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L7.6 18.9l-4.1 1 1-4.1Z" />
  </svg>
);

export const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="m8.6 12.3 2.3 2.3 4.5-4.8" />
  </svg>
);

export const AlertCircleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M12 8v4.75M12 16.1h.01" />
  </svg>
);

export const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

export const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

export const ServerIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <rect x="3.25" y="4.25" width="17.5" height="6.5" rx="2.25" />
    <rect x="3.25" y="13.25" width="17.5" height="6.5" rx="2.25" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);

export const KeyIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="8" cy="15.5" r="4" />
    <path d="m11 12.5 8.5-8.5M16 7.5l2.5 2.5M13.5 10l2 2" />
  </svg>
);

export const RefreshIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M20.25 12a8.25 8.25 0 1 1-2.42-5.83" />
    <path d="M20.25 3.75v4.5h-4.5" />
  </svg>
);

export const TrashIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M4.75 6.75h14.5M9.5 6.5V5a1.25 1.25 0 0 1 1.25-1.25h2.5A1.25 1.25 0 0 1 14.5 5v1.5" />
    <path d="M6.75 6.75 7.5 19a1.75 1.75 0 0 0 1.75 1.5h5.5A1.75 1.75 0 0 0 16.5 19l.75-12.25" />
  </svg>
);

export const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

/* ---- Shared pieces ---- */

export function FeedbackBanner({
  type,
  message,
  className = '',
}: {
  type: 'success' | 'error';
  message: string;
  className?: string;
}) {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      className={`animate-fade-in flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm leading-relaxed ${
        type === 'success' ? 'bg-[#30d158]/10 text-[#4ade80]' : 'bg-[#ff453a]/10 text-[#ff8a80]'
      } ${className}`}
    >
      {type === 'success' ? (
        <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <span>{message}</span>
    </div>
  );
}

/** Centered gate screen: app-icon tile + title + subtext + action. */
export function GateScreen({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode;
  title: string;
  message: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center animate-fade-in">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1c1c1e] text-white/70">
          {icon}
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#98989d]">{message}</p>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}

export interface AdminContext {
  authToken: string;
  address: string;
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

/**
 * Wallet-gated admin shell: connect → server-side admin check → sign message →
 * 1-hour Bearer session token. Renders the same gate screens as /admin/points
 * and hands the authed context to the page content.
 */
export function AdminGate({ children }: { children: (ctx: AdminContext) => ReactNode }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { isAdmin, isChecking } = useIsAdmin();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const handleAuthenticate = useCallback(async () => {
    if (!address) return;
    setIsAuthenticating(true);
    try {
      const timestamp = Date.now();
      const message = `Sign this message to authenticate as admin.\n\nWallet: ${address}\nTimestamp: ${timestamp}`;
      const signature = await signMessageAsync({ message });
      const response = await fetch('/api/admin/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || 'Authentication failed');
      }
      const { token } = await response.json();
      setAuthToken(token);
    } catch (error) {
      console.error('Authentication failed:', error);
      alert(error instanceof Error ? error.message : 'Authentication failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, signMessageAsync]);

  const adminFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      if (!authToken) throw new Error('Not authenticated');
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Authorization: `Bearer ${authToken}`,
        },
      });
    },
    [authToken]
  );

  // 1. Not connected?
  if (!isConnected || !address) {
    return (
      <GateScreen
        icon={<WalletIcon className="h-7 w-7" />}
        title="Wallet Not Connected"
        message="Connect an admin wallet to continue."
      >
        <div className="flex justify-center">
          <appkit-button />
        </div>
      </GateScreen>
    );
  }

  // 2. Checking admin status?
  if (isChecking) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <p className="text-[15px] text-[#98989d] animate-pulse">Checking authorization…</p>
      </div>
    );
  }

  // 3. Connected but not an admin?
  if (!isAdmin) {
    return (
      <GateScreen
        icon={<LockIcon className="h-7 w-7" />}
        title="Not Authorized"
        message={`Your wallet (${address.slice(0, 6)}…${address.slice(-4)}) is not on the admin list.`}
      >
        <Link href="/" className="text-[15px] text-[#0a84ff] hover:opacity-80 transition-opacity">
          Go back to main page
        </Link>
      </GateScreen>
    );
  }

  // 4. Admin but no session token yet → sign message
  if (!authToken) {
    return (
      <GateScreen
        icon={<PenIcon className="h-7 w-7" />}
        title="Admin Authentication"
        message="Sign a message to prove you own this wallet. It costs no gas — it only creates a 1-hour session token."
      >
        <button
          onClick={handleAuthenticate}
          disabled={isAuthenticating}
          className="rounded-[10px] bg-[#0a84ff] px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-[#2b95ff] active:bg-[#0a84ff] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isAuthenticating ? 'Waiting for signature…' : 'Sign Message to Continue'}
        </button>
      </GateScreen>
    );
  }

  // 5. Authenticated
  return <>{children({ authToken, address, adminFetch })}</>;
}
