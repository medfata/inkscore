"use client";

import React, { useState, useEffect, useCallback } from 'react';

interface BackfillJob {
  id: number;
  job_type: string;
  contract_id: number;
  priority: number;
  status: string;
  payload: {
    contractId: number;
    contractAddress: string;
    fromDate: string;
    toDate: string;
    progress?: number;
  };
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  contract_name: string;
  contract_address: string;
}

interface BackfillStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface Contract {
  id: number;
  address: string;
  name: string;
}

interface BackfillTabProps {
  contracts: Contract[];
}

export function BackfillTab({ contracts }: BackfillTabProps) {
  const [jobs, setJobs] = useState<BackfillJob[]>([]);
  const [stats, setStats] = useState<BackfillStats>({ pending: 0, processing: 0, completed: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const loadJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      
      const res = await fetch(`/api/admin/backfill?${params.toString()}`);
      const data = await res.json();
      setJobs(data.jobs || []);
      setStats(data.stats || { pending: 0, processing: 0, completed: 0, failed: 0 });
    } catch (error) {
      console.error('Failed to load backfill jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadJobs();
    // Auto-refresh every 10 seconds
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleCancel = async (jobId: number) => {
    if (!confirm('Cancel this job?')) return;
    try {
      await fetch(`/api/admin/backfill/${jobId}`, { method: 'DELETE' });
      loadJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const handleRetry = async (jobId: number) => {
    try {
      await fetch(`/api/admin/backfill/${jobId}`, { method: 'POST' });
      loadJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'processing': return 'bg-blue-500/20 text-blue-400';
      case 'completed': return 'bg-green-500/20 text-green-400';
      case 'failed': return 'bg-red-500/20 text-red-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatDateShort = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-400">Loading...</div>;
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-400">{stats.pending}</div>
          <div className="text-sm text-slate-400">Pending</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">{stats.processing}</div>
          <div className="text-sm text-slate-400">Processing</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-400">{stats.completed}</div>
          <div className="text-sm text-slate-400">Completed</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-400">{stats.failed}</div>
          <div className="text-sm text-slate-400">Failed</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={loadJobs}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-sm"
          >
            Refresh
          </button>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium"
        >
          + Create Backfill Job
        </button>
      </div>

      {/* Jobs List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No backfill jobs found. Create one to get started.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {jobs.map((job) => (
              <div key={job.id} className="p-4 hover:bg-slate-800/50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 text-sm">#{job.id}</span>
                      <h3 className="font-semibold">{job.contract_name || 'Unknown Contract'}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(job.status)}`}>
                        {job.status}
                      </span>
                      {job.payload?.progress !== undefined && job.status === 'processing' && (
                        <span className="text-xs text-blue-400">
                          {job.payload.progress.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-400 mt-1">
                      <code className="bg-slate-800 px-1 rounded text-xs">
                        {job.payload?.contractAddress?.slice(0, 10)}...{job.payload?.contractAddress?.slice(-8)}
                      </code>
                    </div>
                    <div className="text-sm text-slate-500 mt-2">
                      📅 {formatDateShort(job.payload?.fromDate)} → {formatDateShort(job.payload?.toDate)}
                    </div>
                    <div className="text-xs text-slate-600 mt-1">
                      Created: {formatDate(job.created_at)}
                      {job.started_at && ` • Started: ${formatDate(job.started_at)}`}
                      {job.completed_at && ` • Completed: ${formatDate(job.completed_at)}`}
                    </div>
                    {job.error_message && (
                      <div className="text-xs text-red-400 mt-1">
                        Error: {job.error_message}
                      </div>
                    )}
                    {job.attempts > 0 && (
                      <div className="text-xs text-slate-500 mt-1">
                        Attempts: {job.attempts}/{job.max_attempts}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {job.status === 'failed' && (
                      <button
                        onClick={() => handleRetry(job.id)}
                        className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 rounded"
                      >
                        Retry
                      </button>
                    )}
                    {(job.status === 'pending' || job.status === 'failed') && (
                      <button
                        onClick={() => handleCancel(job.id)}
                        className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateBackfillModal
          contracts={contracts}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            loadJobs();
          }}
        />
      )}
    </div>
  );
}

function CreateBackfillModal({
  contracts,
  onClose,
  onCreated
}: {
  contracts: Contract[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [contractAddress, setContractAddress] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [priority, setPriority] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Set default dates (last 30 days)
  useEffect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setToDate(now.toISOString().slice(0, 16));
    setFromDate(thirtyDaysAgo.toISOString().slice(0, 16));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const res = await fetch('/api/admin/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress,
          fromDate: new Date(fromDate).toISOString(),
          toDate: new Date(toDate).toISOString(),
          priority
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create job');
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Create Backfill Job</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Contract
            </label>
            <select
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value)}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            >
              <option value="">Select a contract...</option>
              {contracts.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.name} ({c.address.slice(0, 8)}...)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                From Date
              </label>
              <input
                type="datetime-local"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">
                To Date
              </label>
              <input
                type="datetime-local"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Priority (1 = highest, 10 = lowest)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm">{error}</div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BackfillTab;
