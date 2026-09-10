"use client";

import { useState, useEffect, useCallback, type ClipboardEvent, type ReactNode } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';
import Link from 'next/link';
import {
  MAX_WALLET_BONUS_POINTS,
  WALLET_ADDRESS_RE,
  parsePastedBonuses,
} from '@/lib/wallet-bonus-format';

interface BonusData {
  points: number;
  updated_by: string | null;
  updated_at: string | null;
}

interface WalletBonusEntry {
  address: string;
  points: number;
}

interface WalletBonusData {
  wallets: WalletBonusEntry[];
  updated_by: string | null;
  updated_at: string | null;
}

interface WalletBonusRow {
  id: number;
  address: string;
  points: string;
}

const WALLET_SEARCH_THRESHOLD = 5;

let nextRowId = 1;
const newRow = (address = '', points = ''): WalletBonusRow => ({
  id: nextRowId++,
  address,
  points,
});

const formatDateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

/* ---- Minimal line icons (SF-symbol feel, stroke-based) ---- */

const iconProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const WalletIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <rect x="2.75" y="5.75" width="18.5" height="13.5" rx="3.25" />
    <path d="M16.25 10.75h5v5.5h-5a2.75 2.75 0 1 1 0-5.5Z" />
  </svg>
);

const LockIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <rect x="4.75" y="10.75" width="14.5" height="9.5" rx="3" />
    <path d="M8.25 10.5V8a3.75 3.75 0 0 1 7.5 0v2.5" />
  </svg>
);

const PenIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M12 20.25h8.5" />
    <path d="M16.6 3.9a2.1 2.1 0 0 1 3 3L7.6 18.9l-4.1 1 1-4.1Z" />
  </svg>
);

const SearchIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-3.6-3.6" />
  </svg>
);

const PlusIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="M12 5.5v13M5.5 12h13" />
  </svg>
);

const MinusCircleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M8.75 12h6.5" />
  </svg>
);

const CheckCircleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="m8.6 12.3 2.3 2.3 4.5-4.8" />
  </svg>
);

const AlertCircleIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <circle cx="12" cy="12" r="8.75" />
    <path d="M12 8v4.75M12 16.1h.01" />
  </svg>
);

const ChevronRightIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

const ChevronLeftIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" {...iconProps}>
    <path d="m14.5 6-6 6 6 6" />
  </svg>
);

/* ---- Shared bits ---- */

function FeedbackBanner({
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
        type === 'success'
          ? 'bg-[#30d158]/10 text-[#4ade80]'
          : 'bg-[#ff453a]/10 text-[#ff8a80]'
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
function GateScreen({
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

/**
 * Admin page for the signup bonus ("Welcome Bonus") added to every wallet's
 * score. Auth flow mirrors /admin: connect wallet → server-side admin check →
 * sign message → 1-hour Bearer session token on every API call.
 */
export default function AdminPointsPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { isAdmin, isChecking } = useIsAdmin();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [bonus, setBonus] = useState<BonusData | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Per-wallet bonuses (stacked on top of the global bonus)
  const [walletRows, setWalletRows] = useState<WalletBonusRow[]>([]);
  const [walletSearch, setWalletSearch] = useState('');
  const [walletsAudit, setWalletsAudit] = useState<{ updated_by: string | null; updated_at: string | null }>({
    updated_by: null,
    updated_at: null,
  });
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [walletsSaving, setWalletsSaving] = useState(false);
  const [walletsFeedback, setWalletsFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [showDetails, setShowDetails] = useState(false);

  // Authenticated fetch (same pattern as /admin)
  const adminFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    if (!authToken) throw new Error('Not authenticated');

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${authToken}`,
      },
    });
  }, [authToken]);

  // Sign message → session token (same message format as /admin + auth/verify)
  const handleAuthenticate = async () => {
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
  };

  // Load the current bonus once authenticated
  const loadBonus = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await adminFetch('/api/admin/points/bonus');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load bonus');
      setBonus(data);
      setInputValue(String(data.points));
    } catch (error) {
      console.error('Failed to load bonus:', error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load the current bonus.',
      });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  // Save the new bonus value
  const handleSave = async () => {
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      setFeedback({ type: 'error', message: 'Enter a whole number of points (0 or more).' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      const res = await adminFetch('/api/admin/points/bonus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save bonus');

      setBonus(data);
      setInputValue(String(data.points));
      setFeedback({
        type: 'success',
        message:
          data.points > 0
            ? `Bonus set to ${data.points.toLocaleString()} points. It lands on every wallet's score within ~1 minute (engine cache) and shows as a "Welcome Bonus" bar on dashboards.`
            : 'Bonus disabled (0). Wallet scores no longer include it once the engine cache refreshes (~1 minute).',
      });
    } catch (error) {
      console.error('Failed to save bonus:', error);
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save the bonus.',
      });
    } finally {
      setSaving(false);
    }
  };

  // Load the per-wallet bonus list once authenticated
  const loadWalletBonuses = useCallback(async () => {
    setWalletsLoading(true);
    setWalletsFeedback(null);
    try {
      const res = await adminFetch('/api/admin/points/wallet-bonus');
      const data: WalletBonusData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load wallet bonuses');
      setWalletRows(data.wallets.map((w) => newRow(w.address, String(w.points))));
      setWalletsAudit({ updated_by: data.updated_by, updated_at: data.updated_at });
      setRowErrors({});
    } catch (error) {
      console.error('Failed to load wallet bonuses:', error);
      setWalletsFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load wallet bonuses.',
      });
    } finally {
      setWalletsLoading(false);
    }
  }, [adminFetch]);

  // Validate rows client-side. Returns the payload or null (sets errors).
  const validateWalletRows = (rows: WalletBonusRow[]) => {
    const errors: Record<number, string> = {};
    const seen = new Set<string>();
    let firstError: string | null = null;

    rows.forEach((row, index) => {
      const label = `Row ${index + 1}`;
      const address = row.address.trim();
      if (!WALLET_ADDRESS_RE.test(address)) {
        errors[row.id] = 'Enter a valid 0x address (40 hex characters).';
        firstError ??= `${label}: invalid wallet address.`;
        return;
      }
      const key = address.toLowerCase();
      if (seen.has(key)) {
        errors[row.id] = 'Duplicate wallet address.';
        firstError ??= `${label}: duplicate wallet address.`;
        return;
      }
      seen.add(key);
      const points = Number(row.points);
      if (!Number.isInteger(points) || points < 1) {
        errors[row.id] = 'Enter a whole number of 1 or more.';
        firstError ??= `${label}: invalid bonus points.`;
      } else if (points > MAX_WALLET_BONUS_POINTS) {
        errors[row.id] = `Max ${MAX_WALLET_BONUS_POINTS.toLocaleString()} points.`;
        firstError ??= `${label}: bonus exceeds the maximum.`;
      }
    });

    setRowErrors(errors);
    if (firstError) {
      setWalletsFeedback({ type: 'error', message: firstError });
      return null;
    }
    return rows.map((row) => ({
      address: row.address.trim().toLowerCase(),
      points: Number(row.points),
    }));
  };

  // Save the whole wallet-bonus list
  const handleSaveWallets = async () => {
    const payload = validateWalletRows(walletRows);
    if (!payload) return;

    setWalletsSaving(true);
    setWalletsFeedback(null);
    try {
      const res = await adminFetch('/api/admin/points/wallet-bonus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets: payload }),
      });
      const data: WalletBonusData & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save wallet bonuses');

      setWalletRows(data.wallets.map((w) => newRow(w.address, String(w.points))));
      setWalletsAudit({ updated_by: data.updated_by, updated_at: data.updated_at });
      setRowErrors({});
      setWalletsFeedback({
        type: 'success',
        message:
          data.wallets.length > 0
            ? `Saved ${data.wallets.length} wallet ${data.wallets.length === 1 ? 'bonus' : 'bonuses'}. They stack on top of the global bonus within ~1 minute (engine cache) and stay hidden from dashboard bars.`
            : 'Wallet bonus list cleared. Only the global bonus applies now.',
      });
    } catch (error) {
      console.error('Failed to save wallet bonuses:', error);
      setWalletsFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save wallet bonuses.',
      });
    } finally {
      setWalletsSaving(false);
    }
  };

  // Vercel-env-var-style paste: "0xabc…, 500" (comma/space/slash/newlines)
  // pasted into an address field expands into rows automatically.
  const handleAddressPaste = (
    e: ClipboardEvent<HTMLInputElement>,
    rowId: number
  ) => {
    const text = e.clipboardData.getData('text');
    if (!text || /^\s*0x[a-fA-F0-9]{40}\s*$/.test(text)) return; // plain address → default fill

    const entries = parsePastedBonuses(text);
    if (entries.length === 0) return;

    e.preventDefault();
    setWalletRows((prev) => {
      const index = prev.findIndex((r) => r.id === rowId);
      if (index === -1) return prev;
      const target = prev[index];
      // Single "address + points" paste into an empty row just fills it.
      if (entries.length === 1 && target.address.trim() === '' && target.points.trim() === '') {
        const next = [...prev];
        next[index] = { ...target, address: entries[0].address, points: entries[0].points };
        return next;
      }
      const expanded = entries.map((en) => newRow(en.address, en.points));
      // First entry replaces the pasted-into row only if that row is empty.
      if (target.address.trim() === '' && target.points.trim() === '') {
        return [...prev.slice(0, index), ...expanded, ...prev.slice(index + 1)];
      }
      return [...prev.slice(0, index + 1), ...expanded, ...prev.slice(index + 1)];
    });
    setWalletsFeedback(null);
  };

  // Instant client-side filter — render-only, hidden rows are still saved.
  const filteredWalletRows =
    walletSearch.trim() === ''
      ? walletRows
      : walletRows.filter((row) =>
          row.address.toLowerCase().includes(walletSearch.trim().toLowerCase())
        );

  useEffect(() => {
    if (authToken) {
      loadBonus();
      loadWalletBonuses();
    }
  }, [authToken, loadBonus, loadWalletBonuses]);

  // 1. Not connected? Show connect prompt
  if (!isConnected || !address) {
    return (
      <GateScreen
        icon={<WalletIcon className="h-7 w-7" />}
        title="Wallet Not Connected"
        message="Connect an admin wallet to manage the signup bonus."
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
        <Link
          href="/"
          className="text-[15px] text-[#0a84ff] hover:opacity-80 transition-opacity"
        >
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

  // 5. Authenticated → bonus manager
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-8 sm:py-12">
        {/* Header */}
        <header className="animate-fade-in-up flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-7 sm:mb-9">
          <div>
            <h1 className="text-[28px] sm:text-[34px] leading-tight font-semibold tracking-[-0.02em]">
              Points Bonus
            </h1>
            <p className="mt-1 text-[15px] text-[#98989d]">
              Free points added to every wallet&apos;s score, on top of activity points.
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-0.5 text-[15px] text-[#0a84ff] transition-opacity hover:opacity-80"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Admin Dashboard
          </Link>
        </header>

        <div className="space-y-4 sm:space-y-5">
          {/* Global bonus */}
          <section
            className="animate-fade-in-up rounded-2xl bg-[#1c1c1e] overflow-hidden"
            style={{ animationDelay: '80ms' }}
          >
            <div className="flex flex-col xl:flex-row xl:items-center gap-8 xl:gap-12 p-6 sm:p-8">
              {/* Current value */}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-[#98989d]">Global bonus</p>
                <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-5xl sm:text-6xl font-semibold tracking-[-0.02em] tabular-nums">
                    {loading ? '—' : (bonus?.points ?? 0).toLocaleString()}
                  </span>
                  <span className="text-[15px] text-[#98989d]">points per wallet</span>
                </div>
                <p className="mt-2.5 text-xs text-white/40">
                  {bonus?.updated_by ? (
                    <>
                      Updated by{' '}
                      <span className="font-mono text-white/50">{bonus.updated_by}</span>
                      {' · '}
                      {formatDateTime(bonus.updated_at)}
                    </>
                  ) : (
                    'Never changed — default 0'
                  )}
                </p>
              </div>

              {/* Editor */}
              <div className="w-full shrink-0 xl:w-[26rem]">
                <label
                  htmlFor="bonus-input"
                  className="mb-2 block text-[13px] font-medium text-[#98989d]"
                >
                  New value
                </label>
                <div className="flex gap-2.5">
                  <input
                    id="bonus-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={loading || saving}
                    placeholder="e.g. 2000"
                    className="min-w-0 flex-1 rounded-[10px] bg-white/[0.07] px-4 py-2.5 text-[15px] tabular-nums text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/60 disabled:opacity-50"
                  />
                  <button
                    onClick={handleSave}
                    disabled={loading || saving}
                    className="shrink-0 rounded-[10px] bg-[#0a84ff] px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#2b95ff] active:bg-[#0a84ff] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
                <p className="mt-2 text-xs text-white/40">
                  Set 0 to disable. Applies to all wallets — rank tiers include it.
                </p>
              </div>
            </div>

            {feedback && <FeedbackBanner type={feedback.type} message={feedback.message} className="mx-6 sm:mx-8 mb-6" />}
          </section>

          {/* Wallet-specific bonuses */}
          <section
            className="animate-fade-in-up rounded-2xl bg-[#1c1c1e] overflow-hidden"
            style={{ animationDelay: '160ms' }}
          >
            <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 sm:px-6 pt-5 sm:pt-6 pb-3">
              <div>
                <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
                  Wallet-specific bonuses
                </h2>
                <p className="mt-0.5 text-sm text-[#98989d]">
                  Extra points for specific wallets, stacked on top of the global bonus.
                </p>
              </div>
              {!walletsLoading && walletRows.length > 0 && (
                <span className="text-sm tabular-nums text-[#98989d]">
                  {walletRows.length} {walletRows.length === 1 ? 'wallet' : 'wallets'}
                </span>
              )}
            </header>

            {/* Instant search (render-only filter — hidden rows are still saved) */}
            {walletRows.length > WALLET_SEARCH_THRESHOLD && (
              <div className="px-5 sm:px-6 pb-3">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    type="text"
                    value={walletSearch}
                    onChange={(e) => setWalletSearch(e.target.value)}
                    disabled={walletsLoading || walletsSaving}
                    placeholder="Search wallet address…"
                    aria-label="Search wallet bonuses"
                    className="w-full rounded-[10px] bg-white/[0.07] py-2 pl-10 pr-3 text-sm text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/60 disabled:opacity-50"
                  />
                </div>
                {walletSearch.trim() !== '' && (
                  <p className="mt-1.5 text-xs text-white/40">
                    Showing {filteredWalletRows.length} of {walletRows.length} wallets
                  </p>
                )}
              </div>
            )}

            {/* Rows */}
            {walletsLoading ? (
              <div className="space-y-2 px-5 sm:px-6 py-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-11 rounded-[10px]" />
                ))}
              </div>
            ) : walletRows.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-white/40">
                  <PlusIcon className="h-5 w-5" />
                </div>
                <p className="text-sm text-[#98989d]">No wallet-specific bonuses yet. Add one below.</p>
                <p className="mt-1.5 text-xs text-white/40">
                  Paste lines like <code className="font-mono text-white/50">0xabc…123, 500</code>{' '}
                  into the address field to add several at once.
                </p>
              </div>
            ) : filteredWalletRows.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-[#98989d]">
                No wallets match “{walletSearch.trim()}”.
              </div>
            ) : (
              <ul>
                {filteredWalletRows.map((row) => (
                  <li key={row.id} className="border-t border-white/[0.06] transition-colors hover:bg-white/[0.02]">
                    <div className="flex items-center gap-2.5 px-3.5 sm:px-4 py-2">
                      <input
                        type="text"
                        value={row.address}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          const address = e.target.value;
                          setWalletRows((prev) =>
                            prev.map((r) => (r.id === row.id ? { ...r, address } : r))
                          );
                        }}
                        onPaste={(e) => handleAddressPaste(e, row.id)}
                        disabled={walletsSaving}
                        placeholder="0x…"
                        aria-label="Wallet address"
                        className={`min-w-0 flex-1 rounded-lg bg-transparent px-2.5 py-2 font-mono text-[13px] text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/50 disabled:opacity-50 ${
                          rowErrors[row.id] ? 'ring-1 ring-inset ring-[#ff453a]/60' : ''
                        }`}
                      />
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.points}
                        onChange={(e) => {
                          const points = e.target.value;
                          setWalletRows((prev) =>
                            prev.map((r) => (r.id === row.id ? { ...r, points } : r))
                          );
                        }}
                        disabled={walletsSaving}
                        placeholder="500"
                        aria-label="Bonus points"
                        className={`w-20 sm:w-24 shrink-0 rounded-lg bg-transparent px-2.5 py-2 text-right text-[15px] tabular-nums text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/50 disabled:opacity-50 ${
                          rowErrors[row.id] ? 'ring-1 ring-inset ring-[#ff453a]/60' : ''
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setWalletRows((prev) => prev.filter((r) => r.id !== row.id));
                          setRowErrors((prev) => {
                            if (!(row.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[row.id];
                            return next;
                          });
                        }}
                        disabled={walletsSaving}
                        aria-label={`Remove bonus for ${row.address || 'wallet'}`}
                        title="Remove"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/30 transition-colors hover:bg-[#ff453a]/10 hover:text-[#ff453a] disabled:opacity-50"
                      >
                        <MinusCircleIcon className="h-[18px] w-[18px]" />
                      </button>
                    </div>
                    {rowErrors[row.id] && (
                      <p className="-mt-1 px-4 pb-2.5 text-xs text-[#ff8a80]">{rowErrors[row.id]}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* Add row — always available while the list isn't loading */}
            {!walletsLoading && (
              <button
                type="button"
                onClick={() => setWalletRows((prev) => [...prev, newRow()])}
                disabled={walletsSaving}
                className="flex w-full items-center gap-2 border-t border-white/[0.06] px-4 py-3 text-left text-[15px] text-[#0a84ff] transition-colors hover:bg-white/[0.03] disabled:opacity-40"
              >
                <PlusIcon className="h-4 w-4" />
                Add wallet
              </button>
            )}

            {walletsFeedback && (
              <FeedbackBanner
                type={walletsFeedback.type}
                message={walletsFeedback.message}
                className="mx-5 sm:mx-6 mb-4 mt-3"
              />
            )}

            {/* Actions */}
            <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-white/[0.06] px-5 sm:px-6 py-4">
              <p className="text-xs text-white/40">
                Tip: paste “address, points” pairs — one per line — into any address field to
                bulk-add.
              </p>
              <button
                type="button"
                onClick={handleSaveWallets}
                disabled={walletsLoading || walletsSaving}
                className="rounded-[10px] bg-[#0a84ff] px-5 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#2b95ff] active:bg-[#0a84ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {walletsSaving ? 'Saving…' : 'Save wallet bonuses'}
              </button>
            </footer>

            {/* Audit info */}
            <p className="border-t border-white/[0.06] px-5 sm:px-6 py-3.5 text-xs text-white/40">
              Last updated:{' '}
              {walletsAudit.updated_by ? (
                <>
                  by <span className="font-mono text-white/50">{walletsAudit.updated_by}</span>
                  {' · '}
                  {formatDateTime(walletsAudit.updated_at)}
                </>
              ) : (
                'never changed (no wallet bonuses)'
              )}
            </p>
          </section>

          {/* How it works — quiet disclosure */}
          <section
            className="animate-fade-in-up rounded-2xl bg-[#1c1c1e] overflow-hidden"
            style={{ animationDelay: '240ms' }}
          >
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
              className="flex w-full items-center justify-between gap-4 px-5 sm:px-6 py-4 text-left"
            >
              <span className="text-[17px] font-semibold tracking-[-0.01em]">How this works</span>
              <ChevronRightIcon
                className={`h-4 w-4 text-white/40 transition-transform duration-200 ${
                  showDetails ? 'rotate-90' : ''
                }`}
              />
            </button>
            {showDetails && (
              <div className="animate-fade-in space-y-3 border-t border-white/[0.06] px-5 sm:px-6 pb-6 pt-4 text-sm leading-relaxed text-[#98989d]">
                <p>
                  The value is stored in the <code className="font-mono text-[13px] text-white/70">app_settings</code>{' '}
                  table and read by the scoring engine with a ~1-minute cache. Every wallet&apos;s
                  total gets these points added and dashboards render a “Welcome Bonus” bar, so the
                  bars always sum to the headline score.
                </p>
                <p>
                  Note: the leaderboard shows scores baked into minted NFTs and clamps them upward,
                  so leaderboard values can lag until wallets refresh their NFT.
                </p>
                <p>
                  Wallet-specific bonuses stack on top of the global bonus for those wallets only.
                  Like the global bonus, they are folded into the hidden bonus total — dashboards
                  never render a separate bonus bar.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
