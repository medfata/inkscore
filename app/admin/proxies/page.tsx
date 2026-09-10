"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AdminGate,
  ChevronLeftIcon,
  FeedbackBanner,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
} from '../admin-ui';

interface ProxyKey {
  id: string;
  label: string;
  api_key_masked: string;
  subaccount_id: string;
  account_type: string;
  status: 'active' | 'deprecated';
  deprecated_reason: string;
  quota_limit: string;
  quota_used: string;
  expires_at: string | null;
  proxy_count: number;
  last_sync_at: string | null;
  last_error: string;
}

interface PoolIp {
  subaccountId: string;
  proxyKey: string;
  urlMasked: string;
  online: boolean;
  adminDisabled: boolean;
  autoDisabled: boolean;
  disableReason: string;
  requests: number;
  ok: number;
  rateLimited: number;
  netErrors: number;
  lastError: string;
}

interface PoolStatus {
  mode: string;
  source: string;
  total: number;
  healthy: number;
}

interface StatusResponse {
  pool: PoolStatus;
  keys: ProxyKey[];
  ips: PoolIp[];
}

const fmtGB = (bytes: string | number): string => {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) || 0 : bytes;
  return `${(n / 1e9).toFixed(2)} GB`;
};

const fmtCountdown = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
};

const fmtWhen = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export default function AdminProxiesPage() {
  return (
    <AdminGate>
      {({ adminFetch }) => <ProxyPoolContent adminFetch={adminFetch} />}
    </AdminGate>
  );
}

function ProxyPoolContent({
  adminFetch,
}: {
  adminFetch: (url: string, options?: RequestInit) => Promise<Response>;
}) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showIps, setShowIps] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/proxies/status');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load proxy status');
      setData(json);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load proxy status.',
      });
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setAdding(true);
    setFeedback(null);
    try {
      const res = await adminFetch('/api/admin/proxies/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: newKey.trim(), label: newLabel.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add key');
      const added = (json.added as Array<{ proxies: number; label: string }> | undefined) || [];
      const total = added.reduce((a, k) => a + (k.proxies || 0), 0);
      setNewKey('');
      setNewLabel('');
      setFeedback({
        type: 'success',
        message: `Key validated — ${total} proxies joined the pool from ${added.length} subaccount${added.length === 1 ? '' : 's'}.`,
      });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to add key.' });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete key "${label}"? Its proxies leave the pool immediately.`)) return;
    setBusy(id);
    setFeedback(null);
    try {
      const res = await adminFetch(`/api/admin/proxies/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      setFeedback({ type: 'success', message: `Key "${label}" deleted.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Delete failed.' });
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (id: string) => {
    setBusy(id);
    setFeedback(null);
    try {
      const res = await adminFetch(`/api/admin/proxies/keys/${id}/sync`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      setFeedback({ type: 'success', message: `Synced — ${json.proxies} proxies online.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Sync failed.' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleIpToggle = async (ip: PoolIp) => {
    try {
      const res = await adminFetch('/api/admin/proxies/ips', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subaccountId: ip.subaccountId, proxyKey: ip.proxyKey, disabled: !ip.adminDisabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Toggle failed');
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Toggle failed.' });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        <p className="text-[15px] text-[#98989d] animate-pulse">Loading proxy status…</p>
      </div>
    );
  }

  const pool = data?.pool;
  const keys = data?.keys || [];
  const ips = data?.ips || [];
  const activeKeys = keys.filter((k) => k.status === 'active');
  const totalUsed = keys.reduce((a, k) => a + (parseInt(k.quota_used, 10) || 0), 0);
  const totalLimit = keys.reduce((a, k) => a + (parseInt(k.quota_limit, 10) || 0), 0);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20 py-8 sm:py-12">
        {/* Header */}
        <header className="animate-fade-in-up flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-7 sm:mb-9">
          <div>
            <h1 className="text-[28px] sm:text-[34px] leading-tight font-semibold tracking-[-0.02em]">
              Proxy Pool
            </h1>
            <p className="mt-1 text-[15px] text-[#98989d]">
              ProxyScrape API keys and the egress IPs that serve wallet metrics.
            </p>
          </div>
          <Link
            href="/admin"
            className="inline-flex items-center gap-0.5 text-[15px] text-[#0a84ff] transition-opacity hover:opacity-80"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Admin
          </Link>
        </header>

        <div className="space-y-4 sm:space-y-5">
          {feedback && <FeedbackBanner type={feedback.type} message={feedback.message} />}

          {/* Summary */}
          <section
            className="animate-fade-in-up grid grid-cols-2 xl:grid-cols-4 gap-px overflow-hidden rounded-2xl bg-white/[0.06]"
            style={{ animationDelay: '60ms' }}
          >
            <StatTile
              label="Healthy IPs"
              value={`${pool?.healthy ?? 0}`}
              sub={`of ${pool?.total ?? 0} in pool`}
              tone="green"
            />
            <StatTile
              label="Active keys"
              value={`${activeKeys.length}`}
              sub={`of ${keys.length} total`}
              tone="blue"
            />
            <StatTile
              label="Bandwidth left"
              value={totalLimit > 0 ? fmtGB(totalLimit - totalUsed) : '—'}
              sub={totalLimit > 0 ? `of ${fmtGB(totalLimit)}` : 'no quota data'}
            />
            <StatTile
              label="Egress mode"
              value={pool?.mode ?? '—'}
              sub={pool?.mode === 'hybrid' ? 'direct-first, pool fallback' : pool?.mode === 'off' ? 'direct only' : 'pool first'}
            />
          </section>
          {pool?.source && (
            <p className="animate-fade-in-up px-1 text-xs text-white/40" style={{ animationDelay: '80ms' }}>
              Pool source: {pool.source}
            </p>
          )}

          {/* Keys */}
          <div className="animate-fade-in-up flex items-center justify-between pt-2" style={{ animationDelay: '100ms' }}>
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">API keys</h2>
            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/[0.07] px-3.5 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.12]"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>

          <div className="space-y-4">
            {keys.length === 0 && (
              <div className="rounded-2xl bg-[#1c1c1e] p-8 text-center text-[15px] text-[#98989d]">
                No API keys yet. Add one below — its proxies join the pool automatically.
              </div>
            )}
            {keys.map((k, i) => (
              <KeyCard
                key={k.id}
                proxyKey={k}
                keyIps={ips.filter((ip) => ip.subaccountId === k.subaccount_id)}
                busy={busy === k.id}
                onSync={() => handleSync(k.id)}
                onDelete={() => handleDelete(k.id, k.label || k.api_key_masked)}
                delayMs={120 + i * 40}
              />
            ))}
          </div>

          {/* Add key */}
          <section
            className="animate-fade-in-up rounded-2xl bg-[#1c1c1e] p-6 sm:p-7"
            style={{ animationDelay: '160ms' }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.07] text-[#0a84ff]">
                <PlusIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Add API key</h2>
                <p className="text-[13px] text-[#98989d]">Validated live against ProxyScrape before it&apos;s stored.</p>
              </div>
            </div>
            <form onSubmit={handleAdd} className="mt-5 flex flex-col gap-3 lg:flex-row">
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="Paste ProxyScrape API key (64 characters)"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-[10px] bg-white/[0.07] px-4 py-2.5 font-mono text-[14px] text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/60"
              />
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (e.g. trial-sep-14)"
                className="min-w-0 flex-1 lg:max-w-[16rem] rounded-[10px] bg-white/[0.07] px-4 py-2.5 text-[14px] text-white placeholder:text-white/30 transition-colors focus:bg-white/[0.09] focus:outline-none focus:ring-2 focus:ring-[#0a84ff]/60"
              />
              <button
                type="submit"
                disabled={adding || !newKey.trim()}
                className="rounded-[10px] bg-[#0a84ff] px-6 py-2.5 text-[15px] font-medium text-white transition-colors hover:bg-[#2b95ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {adding ? 'Validating…' : 'Add key'}
              </button>
            </form>
            <p className="mt-3 text-xs leading-relaxed text-white/40">
              Keys are encrypted server-side and shown masked. Create them at proxyscrape.com → dashboard → API keys
              (datacenter read). Exhausted or expired keys are deprecated automatically and their IPs leave the pool.
            </p>
          </section>

          {/* IP health */}
          <section className="animate-fade-in-up pt-1" style={{ animationDelay: '200ms' }}>
            <button
              onClick={() => setShowIps((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[14px] text-[#98989d] transition-colors hover:text-white"
            >
              <span className={`transition-transform ${showIps ? 'rotate-90' : ''}`}>▸</span>
              Per-IP health ({ips.length} cached)
            </button>
            {showIps && (
              <div className="mt-3 overflow-hidden rounded-2xl bg-[#1c1c1e]">
                {ips.length === 0 && (
                  <p className="p-6 text-center text-[14px] text-[#98989d]">No cached IPs yet.</p>
                )}
                <div className="divide-y divide-white/[0.05] max-h-[26rem] overflow-y-auto">
                  {ips.map((ip) => (
                    <div
                      key={`${ip.subaccountId}:${ip.proxyKey}`}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-5 py-2.5"
                    >
                      <code className="font-mono text-[12.5px] text-white/70">{ip.urlMasked}</code>
                      <div className="flex items-center gap-2.5">
                        {!ip.online && <Pill tone="muted">provider offline</Pill>}
                        {ip.autoDisabled && (
                          <Pill tone="yellow" title={ip.disableReason}>
                            auto-disabled
                          </Pill>
                        )}
                        <span
                          className="text-xs tabular-nums text-white/35"
                          title={`${ip.requests} requests · ${ip.ok} ok · ${ip.rateLimited} rate-limited · ${ip.netErrors} network errors${ip.lastError ? ` · ${ip.lastError}` : ''}`}
                        >
                          {ip.requests} req / {ip.netErrors} err
                        </span>
                        <button
                          onClick={() => handleIpToggle(ip)}
                          className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${
                            ip.adminDisabled
                              ? 'bg-[#30d158]/15 text-[#4ade80] hover:bg-[#30d158]/25'
                              : 'bg-white/[0.07] text-white/70 hover:bg-white/[0.12]'
                          }`}
                        >
                          {ip.adminDisabled ? 'Enable' : 'Disable'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'green' | 'blue';
}) {
  const valueColor =
    tone === 'green' ? 'text-[#4ade80]' : tone === 'blue' ? 'text-[#0a84ff]' : 'text-white';
  return (
    <div className="bg-[#1c1c1e] p-5 sm:p-6">
      <p className="text-[13px] font-medium text-[#98989d]">{label}</p>
      <p className={`mt-1.5 text-3xl font-semibold tracking-[-0.02em] tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-white/35">{sub}</p>}
    </div>
  );
}

function Pill({
  tone,
  title,
  children,
}: {
  tone: 'green' | 'red' | 'yellow' | 'muted';
  title?: string;
  children: ReactNode;
}) {
  const cls =
    tone === 'green'
      ? 'bg-[#30d158]/10 text-[#4ade80]'
      : tone === 'red'
        ? 'bg-[#ff453a]/10 text-[#ff8a80]'
        : tone === 'yellow'
          ? 'bg-[#ffd60a]/10 text-[#ffd60a]'
          : 'bg-white/[0.06] text-[#98989d]';
  return (
    <span title={title} className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function KeyCard({
  proxyKey: k,
  keyIps,
  busy,
  onSync,
  onDelete,
  delayMs,
}: {
  proxyKey: ProxyKey;
  keyIps: PoolIp[];
  busy: boolean;
  onSync: () => void;
  onDelete: () => void;
  delayMs: number;
}) {
  const used = parseInt(k.quota_used, 10) || 0;
  const limit = parseInt(k.quota_limit, 10) || 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const deprecated = k.status === 'deprecated';
  const unhealthy = keyIps.filter((ip) => !ip.online || ip.adminDisabled || ip.autoDisabled).length;
  const barColor = pct > 90 ? 'bg-[#ff453a]' : pct > 70 ? 'bg-[#ffd60a]' : 'bg-[#30d158]';

  return (
    <div
      className={`animate-fade-in-up rounded-2xl bg-[#1c1c1e] p-6 sm:p-7 ${deprecated ? 'ring-1 ring-[#ff453a]/40' : ''}`}
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{k.label || 'Unlabeled key'}</h3>
            <Pill tone={deprecated ? 'red' : 'green'}>{deprecated ? 'deprecated' : 'active'}</Pill>
            <code className="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[12px] text-white/45">
              {k.api_key_masked}
            </code>
          </div>
          {deprecated && k.deprecated_reason && (
            <p className="mt-2 text-[13.5px] text-[#ff8a80]">Reason: {k.deprecated_reason}</p>
          )}
          {!deprecated && k.last_error && (
            <p className="mt-2 text-[13px] text-[#ffd60a]/90">Last sync issue: {k.last_error}</p>
          )}

          {/* Bandwidth */}
          <div className="mt-4 max-w-xl">
            <div className="mb-1.5 flex items-baseline justify-between text-xs text-[#98989d]">
              <span>
                Bandwidth <span className="tabular-nums text-white/70">{fmtGB(used)}</span> used of{' '}
                <span className="tabular-nums text-white/70">{limit > 0 ? fmtGB(limit) : '—'}</span>
              </span>
              <span className="tabular-nums">{limit > 0 ? `${pct.toFixed(1)}%` : ''}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Meta */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/40">
            <span>{fmtCountdown(k.expires_at)}</span>
            <span>
              {k.proxy_count} proxies{unhealthy > 0 ? ` · ${unhealthy} unhealthy` : ''}
            </span>
            {k.last_sync_at && <span>synced {fmtWhen(k.last_sync_at)}</span>}
            <span className="font-mono">{k.account_type}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          {!deprecated && (
            <button
              onClick={onSync}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-white/[0.07] px-3.5 py-2 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.12] disabled:opacity-40"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          <button
            onClick={onDelete}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#ff453a]/10 px-3.5 py-2 text-[13px] font-medium text-[#ff8a80] transition-colors hover:bg-[#ff453a]/20 disabled:opacity-40"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
