"use client";

import React, { useState, useEffect, useCallback } from 'react';

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
  quota_checked_at: string | null;
  expires_at: string | null;
  proxy_count: number;
  last_sync_at: string | null;
  last_error: string;
  created_at: string;
}

interface PoolIp {
  subaccountId: string;
  proxyKey: string;
  urlMasked: string;
  online: boolean;
  adminDisabled: boolean;
  autoDisabled: boolean;
  disableReason: string;
  consecFails: number;
  requests: number;
  ok: number;
  rateLimited: number;
  netErrors: number;
  lastError: string;
  lastUsedAt: string | null;
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

function fmtGB(bytes: string | number): string {
  const n = typeof bytes === 'string' ? parseInt(bytes, 10) || 0 : bytes;
  return `${(n / 1e9).toFixed(2)} GB`;
}

function fmtCountdown(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
}

export function ProxiesTab({ adminFetch }: { adminFetch: (url: string, options?: RequestInit) => Promise<Response> }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showIps, setShowIps] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await adminFetch('/api/admin/proxies/status');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load proxy status');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [adminFetch]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    setAdding(true);
    setError('');
    try {
      const res = await adminFetch('/api/admin/proxies/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: newKey.trim(), label: newLabel.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to add key');
      setNewKey('');
      setNewLabel('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add key');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string, label: string) => {
    if (!confirm(`Delete key "${label}"? Its proxies leave the pool immediately.`)) return;
    setBusy(id);
    try {
      const res = await adminFetch(`/api/admin/proxies/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (id: string) => {
    setBusy(id);
    try {
      const res = await adminFetch(`/api/admin/proxies/keys/${id}/sync`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const handleIpToggle = async (ip: PoolIp) => {
    const disabled = !(ip.adminDisabled);
    try {
      const res = await adminFetch('/api/admin/proxies/ips', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subaccountId: ip.subaccountId, proxyKey: ip.proxyKey, disabled }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Toggle failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-400">Loading proxy status...</div>;
  }

  const pool = data?.pool;
  const keys = data?.keys || [];
  const ips = data?.ips || [];
  const activeKeys = keys.filter((k) => k.status === 'active');
  const totalUsed = keys.reduce((a, k) => a + (parseInt(k.quota_used, 10) || 0), 0);
  const totalLimit = keys.reduce((a, k) => a + (parseInt(k.quota_limit, 10) || 0), 0);

  return (
    <div>
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Pool summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">{pool?.healthy ?? 0}<span className="text-sm text-slate-500">/{pool?.total ?? 0}</span></div>
          <div className="text-sm text-slate-400">Healthy IPs in pool</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">{activeKeys.length}<span className="text-sm text-slate-500">/{keys.length}</span></div>
          <div className="text-sm text-slate-400">Active keys</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-400">{totalLimit > 0 ? fmtGB(totalLimit - totalUsed) : '—'}</div>
          <div className="text-sm text-slate-400">Bandwidth left (all keys)</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-slate-200">{pool?.mode ?? '—'}</div>
          <div className="text-sm text-slate-400">Egress mode</div>
        </div>
      </div>
      {pool?.source && <div className="text-xs text-slate-500 mb-6">Pool source: {pool.source}</div>}

      {/* Keys */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg">Proxy API keys</h3>
        <button onClick={load} className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm">
          Refresh
        </button>
      </div>

      <div className="space-y-4 mb-8">
        {keys.length === 0 && (
          <div className="p-8 text-center text-slate-500 bg-slate-900 border border-slate-800 rounded-xl">
            No API keys yet. Add one below — its proxies join the pool automatically.
          </div>
        )}
        {keys.map((k) => {
          const used = parseInt(k.quota_used, 10) || 0;
          const limit = parseInt(k.quota_limit, 10) || 0;
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          const deprecated = k.status === 'deprecated';
          const keyIps = ips.filter((i) => i.subaccountId === k.subaccount_id);
          const unhealthy = keyIps.filter((i) => !i.online || i.adminDisabled || i.autoDisabled).length;
          return (
            <div key={k.id} className={`bg-slate-900 border rounded-xl p-4 ${deprecated ? 'border-red-500/40' : 'border-slate-800'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h4 className="font-semibold">{k.label || 'Unlabeled key'}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${deprecated ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                      {deprecated ? 'deprecated' : 'active'}
                    </span>
                    <code className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{k.api_key_masked}</code>
                  </div>
                  {deprecated && k.deprecated_reason && (
                    <div className="text-sm text-red-400 mt-1">Reason: {k.deprecated_reason}</div>
                  )}
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Bandwidth: {fmtGB(used)} used / {fmtGB(limit)}</span>
                      <span>{pct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-xs text-slate-500 mt-2 flex gap-4 flex-wrap">
                    <span>⏳ {fmtCountdown(k.expires_at)}</span>
                    <span>🔌 {k.proxy_count} proxies ({unhealthy} unhealthy)</span>
                    {k.last_sync_at && <span>🔄 synced {new Date(k.last_sync_at).toLocaleString()}</span>}
                  </div>
                  {k.last_error && !deprecated && (
                    <div className="text-xs text-yellow-400 mt-1">Last sync issue: {k.last_error}</div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {!deprecated && (
                    <button
                      onClick={() => handleSync(k.id)}
                      disabled={busy === k.id}
                      className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                    >
                      {busy === k.id ? '…' : 'Sync now'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(k.id, k.label || k.api_key_masked)}
                    disabled={busy === k.id}
                    className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add key */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 mb-8">
        <h3 className="font-semibold mb-3">Add API key</h3>
        <form onSubmit={handleAdd} className="flex flex-col md:flex-row gap-3">
          <input
            type="password"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Paste 64-char ProxyScrape API key"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono text-sm"
            autoComplete="off"
          />
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. trial-sep-14)"
            className="md:w-56 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={adding || !newKey.trim()}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium disabled:opacity-50"
          >
            {adding ? 'Validating…' : 'Add key'}
          </button>
        </form>
        <p className="text-xs text-slate-500 mt-2">
          The key is validated live against ProxyScrape, then stored encrypted server-side.
          Its proxies join the pool immediately. Create keys at proxyscrape.com dashboard → API keys (datacenter read).
        </p>
      </div>

      {/* IP table */}
      <div className="mb-4">
        <button onClick={() => setShowIps(!showIps)} className="text-sm text-slate-400 hover:text-slate-200">
          {showIps ? '▾' : '▸'} Per-IP health ({ips.length} cached)
        </button>
      </div>
      {showIps && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-8">
          <div className="divide-y divide-slate-800 max-h-96 overflow-y-auto">
            {ips.map((ip) => (
              <div key={`${ip.subaccountId}:${ip.proxyKey}`} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                <code className="font-mono text-xs text-slate-300">{ip.urlMasked}</code>
                <div className="flex items-center gap-2 shrink-0">
                  {!ip.online && <span className="px-2 py-0.5 rounded text-xs bg-slate-500/20 text-slate-400">provider offline</span>}
                  {ip.autoDisabled && <span className="px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400" title={ip.disableReason}>auto-disabled</span>}
                  <span className="text-xs text-slate-500" title={`req ${ip.requests} • ok ${ip.ok} • 429 ${ip.rateLimited} • net-err ${ip.netErrors}${ip.lastError ? ` • ${ip.lastError}` : ''}`}>
                    {ip.requests} req / {ip.netErrors} err
                  </span>
                  <button
                    onClick={() => handleIpToggle(ip)}
                    className={`px-2 py-0.5 text-xs rounded ${ip.adminDisabled ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-700 hover:bg-slate-600'}`}
                  >
                    {ip.adminDisabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ProxiesTab;
