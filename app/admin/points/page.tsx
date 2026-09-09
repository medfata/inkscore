"use client";

import { useState, useEffect, useCallback, type ClipboardEvent } from 'react';
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

  useEffect(() => {
    if (authToken) {
      loadBonus();
    }
  }, [authToken, loadBonus]);

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
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🔌</div>
          <h1 className="text-2xl font-bold mb-2">Wallet Not Connected</h1>
          <p className="text-slate-400 mb-6">
            Connect an admin wallet to manage the signup bonus.
          </p>
          <appkit-button />
        </div>
      </div>
    );
  }

  // 2. Checking admin status?
  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Checking authorization...</div>
      </div>
    );
  }

  // 3. Connected but not an admin?
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">Not Authorized</h1>
          <p className="text-slate-400 mb-6">
            Your wallet ({address.slice(0, 6)}...{address.slice(-4)}) is not on the admin list.
          </p>
          <Link href="/" className="text-purple-400 hover:text-purple-300">
            Go back to main page
          </Link>
        </div>
      </div>
    );
  }

  // 4. Admin but no session token yet → sign message
  if (!authToken) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">✍️</div>
          <h1 className="text-2xl font-bold mb-2">Admin Authentication</h1>
          <p className="text-slate-400 mb-6">
            Sign a message to prove you own this wallet. This costs no gas — it only creates a
            1-hour session token.
          </p>
          <button
            onClick={handleAuthenticate}
            disabled={isAuthenticating}
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isAuthenticating ? 'Waiting for signature...' : 'Sign Message to Continue'}
          </button>
        </div>
      </div>
    );
  }

  // 5. Authenticated → bonus manager
  const formatDateTime = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString() : '—';

  return (
    <div className="min-h-screen bg-slate-950 text-white px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Points Bonus</h1>
            <p className="text-slate-400 mt-1 text-sm">
              Free points added to every wallet&apos;s score on top of activity points.
            </p>
          </div>
          <Link
            href="/admin"
            className="text-sm text-slate-400 hover:text-white transition-colors whitespace-nowrap"
          >
            ← Admin Dashboard
          </Link>
        </div>

        {/* Bonus card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-baseline justify-between">
            <span className="text-slate-400 text-sm font-medium uppercase tracking-wider">
              Current bonus
            </span>
            <span className="text-4xl font-extrabold text-white">
              {loading ? '…' : (bonus?.points ?? 0).toLocaleString()}
              <span className="text-base font-medium text-slate-500 ml-2">pts</span>
            </span>
          </div>

          <div className="h-px bg-slate-800" />

          <div>
            <label htmlFor="bonus-input" className="block text-sm font-medium text-slate-300 mb-2">
              Set new bonus (points per wallet)
            </label>
            <div className="flex gap-3">
              <input
                id="bonus-input"
                type="number"
                min={0}
                step={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                disabled={loading || saving}
                placeholder="e.g. 2000"
                className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50"
              />
              <button
                onClick={handleSave}
                disabled={loading || saving}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {saving ? 'Saving...' : 'Save Bonus'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Set 0 to disable. Applies to all wallets — rank tiers include it.
            </p>
          </div>

          {/* Feedback */}
          {feedback && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                feedback.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border border-red-500/30 text-red-300'
              }`}
            >
              {feedback.message}
            </div>
          )}

          {/* Audit info */}
          <div className="text-xs text-slate-500 border-t border-slate-800 pt-4">
            Last updated:{' '}
            {bonus?.updated_by ? (
              <span>
                by <span className="font-mono text-slate-400">{bonus.updated_by}</span> at{' '}
                {formatDateTime(bonus.updated_at)}
              </span>
            ) : (
              <span>never changed (default 0)</span>
            )}
          </div>
        </div>

        {/* Wallet-specific bonuses card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Wallet-Specific Bonuses</h2>
              <p className="text-slate-400 text-sm mt-1">
                Extra points for specific wallets, stacked on top of the global bonus.
              </p>
            </div>
            {walletRows.length > 0 && (
              <span className="text-sm text-slate-400 whitespace-nowrap">
                {walletRows.length} {walletRows.length === 1 ? 'wallet' : 'wallets'}
              </span>
            )}
          </div>

          {/* Instant search (render-only filter — hidden rows are still saved) */}
          {walletRows.length > WALLET_SEARCH_THRESHOLD && (
            <div>
              <input
                type="text"
                value={walletSearch}
                onChange={(e) => setWalletSearch(e.target.value)}
                disabled={walletsLoading || walletsSaving}
                placeholder="Search wallet address…"
                aria-label="Search wallet bonuses"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 text-sm"
              />
              {walletSearch.trim() !== '' && (
                <p className="text-xs text-slate-500 mt-1.5">
                  Showing {filteredWalletRows.length} of {walletRows.length} wallets
                </p>
              )}
            </div>
          )}

          {/* Rows */}
          {walletsLoading ? (
            <p className="text-slate-500 text-sm">Loading wallet bonuses…</p>
          ) : walletRows.length === 0 ? (
            <p className="text-slate-500 text-sm border border-dashed border-slate-700 rounded-lg px-4 py-6 text-center">
              No wallet-specific bonuses yet. Add one below — or paste lines like{' '}
              <code className="font-mono text-slate-400">0xabc…123, 500</code> into the
              address field to add several at once.
            </p>
          ) : filteredWalletRows.length === 0 ? (
            <p className="text-slate-500 text-sm border border-dashed border-slate-700 rounded-lg px-4 py-6 text-center">
              No wallets match “{walletSearch.trim()}”.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden sm:grid grid-cols-[1fr_7rem_2.5rem] gap-3 px-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                <span>Wallet address</span>
                <span>Bonus pts</span>
                <span />
              </div>
              {filteredWalletRows.map((row) => (
                <div key={row.id}>
                  <div className="grid grid-cols-[1fr_7rem_2.5rem] gap-3 items-center">
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
                      className={`min-w-0 bg-slate-950 border rounded-lg px-4 py-2.5 font-mono text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 ${
                        rowErrors[row.id] ? 'border-red-500/70' : 'border-slate-700'
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
                      className={`min-w-0 bg-slate-950 border rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 ${
                        rowErrors[row.id] ? 'border-red-500/70' : 'border-slate-700'
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
                      className="h-10 w-10 flex items-center justify-center rounded-lg text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                  {rowErrors[row.id] && (
                    <p className="text-xs text-red-300 mt-1 px-1">{rowErrors[row.id]}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setWalletRows((prev) => [...prev, newRow()])}
              disabled={walletsLoading || walletsSaving}
              className="px-4 py-2.5 border border-slate-700 hover:border-slate-500 rounded-lg text-sm font-medium text-slate-300 transition-colors disabled:opacity-50"
            >
              + Add wallet
            </button>
            <button
              type="button"
              onClick={handleSaveWallets}
              disabled={walletsLoading || walletsSaving}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {walletsSaving ? 'Saving...' : 'Save Wallet Bonuses'}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Tip: paste one “address, points” pair per line into any address field to bulk-add.
          </p>

          {/* Feedback */}
          {walletsFeedback && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                walletsFeedback.type === 'success'
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-red-500/10 border border-red-500/30 text-red-300'
              }`}
            >
              {walletsFeedback.message}
            </div>
          )}

          {/* Audit info */}
          <div className="text-xs text-slate-500 border-t border-slate-800 pt-4">
            Last updated:{' '}
            {walletsAudit.updated_by ? (
              <span>
                by <span className="font-mono text-slate-400">{walletsAudit.updated_by}</span> at{' '}
                {formatDateTime(walletsAudit.updated_at)}
              </span>
            ) : (
              <span>never changed (no wallet bonuses)</span>
            )}
          </div>
        </div>

        {/* How it works */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 text-sm text-slate-400 space-y-2">
          <p className="text-slate-300 font-medium">How this works</p>
          <p>
            The value is stored in the <code className="text-slate-300">app_settings</code> table and
            read by the scoring engine with a ~1-minute cache. Every wallet&apos;s total gets these
            points added and dashboards render a &quot;Welcome Bonus&quot; bar, so the bars always
            sum to the headline score.
          </p>
          <p>
            Note: the leaderboard shows scores baked into minted NFTs and clamps them upward, so
            leaderboard values can lag until wallets refresh their NFT.
          </p>
          <p>
            Wallet-specific bonuses stack on top of the global bonus for those wallets only.
            Like the global bonus, they are folded into the hidden bonus total — dashboards
            never render a separate bonus bar.
          </p>
        </div>
      </div>
    </div>
  );
}
