"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';
import Link from 'next/link';

interface BonusData {
  points: number;
  updated_by: string | null;
  updated_at: string | null;
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
        </div>
      </div>
    </div>
  );
}
