"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useIsAdmin } from '@/lib/hooks/useIsAdmin';
import ContractModal from '../components/ContractModal';
import { MetricWithRelations, ContractFunction } from '@/lib/types/analytics';
import {
  Platform,
  ContractWithPlatforms,
  PointsRuleWithRelations,
  Rank,
  NativeMetric,
  CalculationMode,
  PlatformType,
  PointRange,
} from '@/lib/types/platforms';
import { DashboardCardsTab } from './DashboardCardsTab';
import { AssetsTab } from './AssetsTab';
import { BackfillTab } from './BackfillTab';

type TabType = 'metrics' | 'platforms' | 'contracts' | 'rules' | 'ranks' | 'dashboard' | 'assets' | 'backfill';

export default function AdminPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { isAdmin, isChecking } = useIsAdmin();
  
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('platforms');

  // Metrics state
  const [metrics, setMetrics] = useState<MetricWithRelations[]>([]);

  // Platforms state
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [contracts, setContracts] = useState<ContractWithPlatforms[]>([]);
  const [rules, setRules] = useState<PointsRuleWithRelations[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [nativeMetrics, setNativeMetrics] = useState<NativeMetric[]>([]);

  const [loading, setLoading] = useState(true);

  // Modal states
  const [showMetricModal, setShowMetricModal] = useState(false);
  const [showPlatformModal, setShowPlatformModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [showRankModal, setShowRankModal] = useState(false);
  const [savingContract, setSavingContract] = useState(false);

  const [editingMetric, setEditingMetric] = useState<MetricWithRelations | null>(null);
  const [editingPlatform, setEditingPlatform] = useState<Platform | null>(null);
  const [editingContract, setEditingContract] = useState<ContractWithPlatforms | null>(null);
  const [editingRule, setEditingRule] = useState<PointsRuleWithRelations | null>(null);
  const [editingRank, setEditingRank] = useState<Rank | null>(null);

  // Simple authenticated fetch
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

  // Handle authentication
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
        throw new Error('Authentication failed');
      }

      const { token } = await response.json();
      setAuthToken(token);
    } catch (error) {
      console.error('Authentication failed:', error);
      alert('Authentication failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Individual load functions for each data type
  const loadMetrics = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/metrics');
      const data = await res.json();
      setMetrics(data.metrics || []);
    } catch (error) {
      console.error('Failed to load metrics:', error);
    }
  }, [adminFetch]);

  const loadPlatforms = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/platforms');
      const data = await res.json();
      setPlatforms(data.platforms || []);
    } catch (error) {
      console.error('Failed to load platforms:', error);
    }
  }, [adminFetch]);

  const loadContracts = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/platforms/contracts');
      const data = await res.json();
      setContracts(data.contracts || []);
    } catch (error) {
      console.error('Failed to load contracts:', error);
    }
  }, [adminFetch]);

  const loadRules = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/points/rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch (error) {
      console.error('Failed to load rules:', error);
    }
  }, [adminFetch]);

  const loadRanks = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/points/ranks');
      const data = await res.json();
      setRanks(data.ranks || []);
    } catch (error) {
      console.error('Failed to load ranks:', error);
    }
  }, [adminFetch]);

  const loadNativeMetrics = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/points/native-metrics');
      const data = await res.json();
      setNativeMetrics(data.metrics || []);
    } catch (error) {
      console.error('Failed to load native metrics:', error);
    }
  }, [adminFetch]);

  // Handle contract save with new hybrid indexer integration
  const handleContractSave = async (formData: any) => {
    setSavingContract(true);

    try {
      // Convert platform_id to platform_ids array for compatibility
      const payload = {
        ...formData,
        platform_ids: formData.platform_id ? [formData.platform_id] : [],
      };

      const url = editingContract
        ? `/api/admin/platforms/contracts/${editingContract.address}`
        : '/api/admin/platforms/contracts';
      const method = editingContract ? 'PUT' : 'POST';

      const res = await adminFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save contract');
      }

      // Close modal and refresh data
      setShowContractModal(false);
      setEditingContract(null);
      await loadContracts();

      // Show success message
      console.log(`Contract ${editingContract ? 'updated' : 'created'} successfully`);

    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save contract');
    } finally {
      setSavingContract(false);
    }
  };

  // Initial load - fetch all data once (only when authenticated)
  useEffect(() => {
    // Don't load data until we're authenticated
    if (!authToken) {
      return;
    }

    const loadAllData = async () => {
      try {
        await Promise.all([
          loadMetrics(),
          loadPlatforms(),
          loadContracts(),
          loadRules(),
          loadRanks(),
          loadNativeMetrics(),
        ]);
      } finally {
        setLoading(false);
      }
    };
    loadAllData();
  }, [authToken, loadMetrics, loadPlatforms, loadContracts, loadRules, loadRanks, loadNativeMetrics]);

  const tabs: { id: TabType; label: string; count?: number }[] = [
    { id: 'platforms', label: 'Platforms', count: platforms.length },
    { id: 'contracts', label: 'Contracts', count: contracts.length },
    { id: 'backfill', label: 'Backfill Jobs' },
    { id: 'metrics', label: 'Metrics', count: metrics.length },
    { id: 'assets', label: 'Assets' },
    { id: 'rules', label: 'Points Rules', count: rules.length },
    { id: 'ranks', label: 'Ranks', count: ranks.length },
    { id: 'dashboard', label: 'Dashboard Cards' },
  ];

  // 1. Not connected? Show connect message
  if (!isConnected || !address) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🔌</div>
          <h1 className="text-2xl font-bold mb-2">Wallet Not Connected</h1>
          <p className="text-slate-400 mb-6">
            Please connect your wallet to access the admin dashboard.
          </p>
          <appkit-button />
        </div>
      </div>
    );
  }

  // 2. Checking admin status? Show loading
  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Checking authorization...</div>
      </div>
    );
  }

  // 3. Not admin? Show not authorized
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-2xl font-bold mb-2">Not Authorized</h1>
          <p className="text-slate-400 mb-6">
            Your wallet ({address.slice(0, 6)}...{address.slice(-4)}) is not authorized to access the admin dashboard.
          </p>
          <a href="/" className="text-purple-400 hover:text-purple-300">
            Go back to main page
          </a>
        </div>
      </div>
    );
  }

  // 4. Admin but not authenticated? Show sign button
  if (!authToken) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="max-w-md text-center">
          <div className="text-6xl mb-4">✍️</div>
          <h1 className="text-2xl font-bold mb-2">Admin Authentication</h1>
          <p className="text-slate-400 mb-6">
            Please sign a message to verify you own this wallet and access the admin dashboard.
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

  // 4. Loading data? Show loading
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    );
  }

  // 4. Loading data? Show loading
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading admin dashboard...</div>
      </div>
    );
  }

  // 5. Show admin dashboard
  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div>
            <h1 className="text-3xl font-bold">Admin Dashboard</h1>
            <p className="text-slate-400 mt-1">Manage platforms, contracts, metrics, and points system</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-slate-800 pb-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-t-lg font-medium transition-colors whitespace-nowrap flex items-center gap-2 ${activeTab === tab.id
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'platforms' && (
          <PlatformsTab
            platforms={platforms}
            contracts={contracts}
            onCreatePlatform={() => { setEditingPlatform(null); setShowPlatformModal(true); }}
            onEditPlatform={(p) => { setEditingPlatform(p); setShowPlatformModal(true); }}
            onRefresh={loadPlatforms}
          />
        )}

        {activeTab === 'contracts' && (
          <ContractsTab
            contracts={contracts}
            platforms={platforms}
            onCreateContract={() => { setEditingContract(null); setShowContractModal(true); }}
            onEditContract={(c) => { setEditingContract(c); setShowContractModal(true); }}
            onRefresh={loadContracts}
          />
        )}

        {activeTab === 'metrics' && (
          <MetricsTab
            metrics={metrics}
            onCreateMetric={() => { setEditingMetric(null); setShowMetricModal(true); }}
            onEditMetric={(m) => { setEditingMetric(m); setShowMetricModal(true); }}
            onRefresh={loadMetrics}
          />
        )}

        {activeTab === 'rules' && (
          <RulesTab
            rules={rules}
            platforms={platforms}
            nativeMetrics={nativeMetrics}
            onCreateRule={() => { setEditingRule(null); setShowRuleModal(true); }}
            onEditRule={(r) => { setEditingRule(r); setShowRuleModal(true); }}
            onRefresh={loadRules}
          />
        )}

        {activeTab === 'ranks' && (
          <RanksTab
            ranks={ranks}
            onCreateRank={() => { setEditingRank(null); setShowRankModal(true); }}
            onEditRank={(r) => { setEditingRank(r); setShowRankModal(true); }}
            onRefresh={loadRanks}
          />
        )}

        {activeTab === 'dashboard' && (
          <DashboardCardsTab
            platforms={platforms}
            metrics={metrics}
          />
        )}

        {activeTab === 'assets' && (
          <AssetsTab />
        )}

        {activeTab === 'backfill' && (
          <BackfillTab contracts={contracts.map(c => ({ id: c.id, address: c.address, name: c.name }))} />
        )}
      </div>

      {/* Modals */}
      {showMetricModal && (
        <MetricModal
          metric={editingMetric}
          onClose={() => setShowMetricModal(false)}
          onSave={() => { setShowMetricModal(false); loadMetrics(); }}
        />
      )}

      {showPlatformModal && (
        <PlatformModal
          platform={editingPlatform}
          onClose={() => setShowPlatformModal(false)}
          onSave={() => { setShowPlatformModal(false); loadPlatforms(); }}
        />
      )}

      {showContractModal && (
        <ContractModal
          contract={editingContract ?? undefined}
          platforms={platforms}
          onClose={() => setShowContractModal(false)}
          onSave={handleContractSave}
          saving={savingContract}
        />
      )}

      {showRuleModal && (
        <RuleModal
          rule={editingRule}
          platforms={platforms}
          nativeMetrics={nativeMetrics}
          onClose={() => setShowRuleModal(false)}
          onSave={() => { setShowRuleModal(false); loadRules(); }}
        />
      )}

      {showRankModal && (
        <RankModal
          rank={editingRank}
          onClose={() => setShowRankModal(false)}
          onSave={() => { setShowRankModal(false); loadRanks(); }}
        />
      )}
    </div>
  );
}


// ============================================================================
// METRICS TAB
// ============================================================================

function MetricsTab({
  metrics,
  onCreateMetric,
  onEditMetric,
  onRefresh,
}: {
  metrics: MetricWithRelations[];
  onCreateMetric: () => void;
  onEditMetric: (m: MetricWithRelations) => void;
  onRefresh: () => void;
}) {
  const handleDelete = async (metricId: number) => {
    if (!confirm('Are you sure you want to delete this metric?')) return;
    try {
      await fetch(`/api/admin/metrics/${metricId}`, { method: 'DELETE' });
      onRefresh();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (metric: MetricWithRelations) => {
    try {
      await fetch(`/api/admin/metrics/${metric.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !metric.is_active }),
      });
      onRefresh();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-slate-400">
          {metrics.length} metrics • {metrics.filter(m => m.is_active).length} active
        </div>
        <button
          onClick={onCreateMetric}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Create Metric
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {metrics.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No metrics configured. Create your first metric to get started.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {metrics.map((metric) => (
              <div key={metric.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg">{metric.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${metric.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                        }`}>
                        {metric.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400">
                        {metric.currency}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1">
                      Slug: <code className="bg-slate-800 px-1 rounded">{metric.slug}</code>
                      {' • '}
                      Type: <code className="bg-slate-800 px-1 rounded">{metric.aggregation_type}</code>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="text-xs text-slate-500">Contracts:</span>
                      {metric.contracts.map((c) => (
                        <span key={c.contract_address} className="text-xs bg-slate-800 px-2 py-0.5 rounded font-mono">
                          {c.contract_address.slice(0, 6)}...{c.contract_address.slice(-4)}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="text-xs text-slate-500">Functions:</span>
                      {metric.functions.map((f) => (
                        <span key={f.function_name} className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
                          {f.function_name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(metric)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      {metric.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => onEditMetric(metric)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(metric.id)}
                      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================================
// PLATFORMS TAB
// ============================================================================

function PlatformsTab({
  platforms,
  contracts,
  onCreatePlatform,
  onEditPlatform,
  onRefresh,
}: {
  platforms: Platform[];
  contracts: ContractWithPlatforms[];
  onCreatePlatform: () => void;
  onEditPlatform: (p: Platform) => void;
  onRefresh: () => void;
}) {
  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this platform?')) return;
    try {
      await fetch(`/api/admin/platforms/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (platform: Platform) => {
    try {
      await fetch(`/api/admin/platforms/${platform.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !platform.is_active }),
      });
      onRefresh();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  const getContractsForPlatform = (platformId: number) => {
    return contracts.filter(c => c.platforms?.some(p => p.id === platformId));
  };

  const platformTypeColors: Record<string, string> = {
    dex: 'bg-blue-500/20 text-blue-400',
    defi: 'bg-purple-500/20 text-purple-400',
    bridge: 'bg-green-500/20 text-green-400',
    social: 'bg-pink-500/20 text-pink-400',
    launchpad: 'bg-orange-500/20 text-orange-400',
    nft: 'bg-cyan-500/20 text-cyan-400',
    other: 'bg-slate-500/20 text-slate-400',
  };

  const getPlatformTypeColor = (type: string) => {
    return platformTypeColors[type] || 'bg-indigo-500/20 text-indigo-400';
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-slate-400">
          {platforms.length} platforms • {platforms.filter(p => p.is_active).length} active
        </div>
        <button
          onClick={onCreatePlatform}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Add Platform
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {platforms.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No platforms configured. Create your first platform to get started.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {platforms.map((platform) => {
              const platformContracts = getContractsForPlatform(platform.id);
              return (
                <div key={platform.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      {platform.logo_url ? (
                        <img
                          src={platform.logo_url}
                          alt={platform.name}
                          className="w-12 h-12 rounded-lg object-cover bg-slate-800"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500">
                          {platform.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-lg">{platform.name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${platform.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                            }`}>
                            {platform.is_active ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${getPlatformTypeColor(platform.platform_type)}`}>
                            {platform.platform_type}
                          </span>
                        </div>
                        <p className="text-slate-400 text-sm mt-1">
                          Slug: <code className="bg-slate-800 px-1 rounded">{platform.slug}</code>
                          {platform.website_url && (
                            <>
                              {' • '}
                              <a href={platform.website_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                                {platform.website_url}
                              </a>
                            </>
                          )}
                        </p>
                        {platform.description && (
                          <p className="text-slate-500 text-sm mt-1">{platform.description}</p>
                        )}
                        {platformContracts.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="text-xs text-slate-500">Contracts:</span>
                            {platformContracts.map((c) => (
                              <span key={c.address} className="text-xs bg-slate-800 px-2 py-0.5 rounded font-mono">
                                {c.name || `${c.address.slice(0, 6)}...${c.address.slice(-4)}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleToggleActive(platform)}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                      >
                        {platform.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => onEditPlatform(platform)}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(platform.id)}
                        className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================================
// CONTRACTS TAB (Legacy - kept for reference)
// ============================================================================

function ContractsTab({
  contracts,
  platforms,
  onCreateContract,
  onEditContract,
  onRefresh,
}: {
  contracts: ContractWithPlatforms[];
  platforms: Platform[];
  onCreateContract: () => void;
  onEditContract: (c: ContractWithPlatforms) => void;
  onRefresh: () => void;
}) {
  const handleDelete = async (addr: string) => {
    if (!confirm('Delete this contract?')) return;
    await fetch(`/api/admin/contracts/${addr}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="text-slate-400">
          {contracts.length} contracts • {contracts.filter(c => c.is_active).length} active
        </div>
        <button onClick={onCreateContract} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium">+ Add Contract</button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-800/50">
            <tr>
              <th className="text-left p-3 text-sm font-medium text-slate-400">Contract</th>
              <th className="text-left p-3 text-sm font-medium text-slate-400">Platforms</th>
              <th className="text-left p-3 text-sm font-medium text-slate-400">Status</th>
              <th className="text-left p-3 text-sm font-medium text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {contracts.length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-slate-500">No contracts configured.</td></tr>
            ) : contracts
              .filter(c => c.is_active)
              .map((c) => (
                <tr key={c.address} className="hover:bg-slate-800/30">
                  <td className="p-3">
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{c.address.slice(0, 10)}...{c.address.slice(-6)}</div>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {c.platforms?.length ? c.platforms.map((p) => (
                        <span key={p.id} className="text-xs bg-slate-700 px-2 py-0.5 rounded">{p.name}</span>
                      )) : <span className="text-xs text-slate-500">-</span>}
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${c.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'}`}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => onEditContract(c)} className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded">Edit</button>
                      <button onClick={() => handleDelete(c.address)} className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}









// ============================================================================
// RULES TAB
// ============================================================================

function RulesTab({
  rules,
  platforms,
  nativeMetrics,
  onCreateRule,
  onEditRule,
  onRefresh,
}: {
  rules: PointsRuleWithRelations[];
  platforms: Platform[];
  nativeMetrics: NativeMetric[];
  onCreateRule: () => void;
  onEditRule: (r: PointsRuleWithRelations) => void;
  onRefresh: () => void;
}) {
  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      await fetch(`/api/admin/points/rules/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (rule: PointsRuleWithRelations) => {
    try {
      await fetch(`/api/admin/points/rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rule.is_active }),
      });
      onRefresh();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  const getPlatformName = (platformId: number | null) => {
    if (!platformId) return null;
    return platforms.find(p => p.id === platformId)?.name;
  };

  const getNativeMetricName = (metricId: number | null) => {
    if (!metricId) return null;
    return nativeMetrics.find(m => m.id === metricId)?.name;
  };

  const modeColors: Record<CalculationMode, string> = {
    range: 'bg-blue-500/20 text-blue-400',
    multiplier: 'bg-orange-500/20 text-orange-400',
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-slate-400">
          {rules.length} rules • {rules.filter(r => r.is_active).length} active
        </div>
        <button
          onClick={onCreateRule}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Add Rule
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {rules.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No points rules configured.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {rules.map((rule) => (
              <div key={rule.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold">{rule.name}</h3>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${rule.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                        }`}>
                        {rule.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${rule.metric_type === 'platform' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-pink-500/20 text-pink-400'
                        }`}>
                        {rule.metric_type}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${modeColors[rule.calculation_mode]}`}>
                        {rule.calculation_mode}
                      </span>
                    </div>
                    <p className="text-slate-400 text-sm mt-1">
                      {rule.metric_type === 'platform'
                        ? `Platform: ${getPlatformName(rule.platform_id) || 'Unknown'}`
                        : `Native Metric: ${getNativeMetricName(rule.native_metric_id) || 'Unknown'}`
                      }
                    </p>
                    {rule.description && (
                      <p className="text-slate-500 text-sm mt-1">{rule.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rule.calculation_mode === 'range' ? (
                        <>
                          <span className="text-xs text-slate-500">Ranges:</span>
                          {rule.ranges.map((range, idx) => (
                            <span key={idx} className="text-xs bg-slate-800 px-2 py-0.5 rounded">
                              {range.min}-{range.max ?? '∞'}: {range.points} pts
                            </span>
                          ))}
                        </>
                      ) : (
                        <span className="text-xs bg-slate-800 px-2 py-0.5 rounded">
                          x{rule.ranges[0]?.points || 1} multiplier
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(rule)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      {rule.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => onEditRule(rule)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================================
// RANKS TAB
// ============================================================================

function RanksTab({
  ranks,
  onCreateRank,
  onEditRank,
  onRefresh,
}: {
  ranks: Rank[];
  onCreateRank: () => void;
  onEditRank: (r: Rank) => void;
  onRefresh: () => void;
}) {
  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this rank?')) return;
    try {
      await fetch(`/api/admin/points/ranks/${id}`, { method: 'DELETE' });
      onRefresh();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (rank: Rank) => {
    try {
      await fetch(`/api/admin/points/ranks/${rank.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !rank.is_active }),
      });
      onRefresh();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div className="text-slate-400">
          {ranks.length} ranks • {ranks.filter(r => r.is_active).length} active
        </div>
        <button
          onClick={onCreateRank}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Add Rank
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {ranks.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No ranks configured.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {ranks.map((rank) => (
              <div key={rank.id} className="p-4 hover:bg-slate-800/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Rank Badge Preview */}
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg"
                      style={{
                        backgroundColor: rank.color ? `${rank.color}20` : '#334155',
                        color: rank.color || '#94a3b8',
                        border: `2px solid ${rank.color || '#475569'}`,
                      }}
                    >
                      {rank.logo_url ? (
                        <img src={rank.logo_url} alt={rank.name} className="w-8 h-8" />
                      ) : (
                        rank.name.charAt(0)
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold">{rank.name}</h3>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${rank.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                          }`}>
                          {rank.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-slate-400 text-sm mt-1">
                        Points: {rank.min_points.toLocaleString()} - {rank.max_points?.toLocaleString() ?? '∞'}
                      </p>
                      {rank.description && (
                        <p className="text-slate-500 text-sm mt-1">{rank.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(rank)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      {rank.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => onEditRank(rank)}
                      className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rank.id)}
                      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ============================================================================
// METRIC MODAL
// ============================================================================

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/-+/g, '_') // Replace dashes with underscores
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^_|_$/g, ''); // Remove leading/trailing underscores
}

function MetricModal({
  metric,
  onClose,
  onSave,
}: {
  metric: MetricWithRelations | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    slug: metric?.slug || '',
    name: metric?.name || '',
    aggregation_type: metric?.aggregation_type || 'count',
    currency: metric?.currency || 'COUNT',
    display_order: metric?.display_order || 0,
  });

  const [selectedContracts, setSelectedContracts] = useState<string[]>(
    metric?.contracts.map(c => c.contract_address) || []
  );

  const [selectedFunctions, setSelectedFunctions] = useState<string[]>(
    metric?.functions.map(f => f.function_name) || []
  );

  const [availableFunctions, setAvailableFunctions] = useState<ContractFunction[]>([]);
  const [saving, setSaving] = useState(false);

  // Name validation state
  const [nameError, setNameError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);

  // Fetch contracts from the platforms service (up-to-date indexed contracts)
  const [contracts, setContracts] = useState<{ address: string; name: string }[]>([]);
  const [loadingContracts, setLoadingContracts] = useState(true);
  const [contractSearch, setContractSearch] = useState('');

  // Auto-generate slug when name changes (only for new metrics)
  const handleNameChange = (newName: string) => {
    setFormData(prev => ({
      ...prev,
      name: newName,
      // Only auto-generate slug for new metrics, not when editing
      slug: !metric ? generateSlug(newName) : prev.slug,
    }));
  };

  // Validate name uniqueness with debounce
  useEffect(() => {
    if (!formData.name.trim()) {
      setNameError(null);
      return;
    }

    const checkNameUniqueness = async () => {
      setCheckingName(true);
      try {
        const res = await fetch('/api/admin/metrics');
        const data = await res.json();
        const existingMetrics = data.metrics || [];

        const isDuplicate = existingMetrics.some(
          (m: { id: number; name: string }) =>
            m.name.toLowerCase() === formData.name.trim().toLowerCase() &&
            m.id !== metric?.id // Exclude current metric when editing
        );

        setNameError(isDuplicate ? 'A metric with this name already exists' : null);
      } catch (error) {
        console.error('Failed to check name uniqueness:', error);
      } finally {
        setCheckingName(false);
      }
    };

    const timeoutId = setTimeout(checkNameUniqueness, 300);
    return () => clearTimeout(timeoutId);
  }, [formData.name, metric?.id]);

  // Load contracts from platforms service on mount
  useEffect(() => {
    const loadContracts = async () => {
      try {
        const res = await fetch('/api/admin/platforms/contracts');
        const data = await res.json();
        const contractsList = (data.contracts || []).map((c: { address: string; name: string }) => ({
          address: c.address,
          name: c.name,
        }));
        setContracts(contractsList);
      } catch (error) {
        console.error('Failed to load contracts:', error);
      } finally {
        setLoadingContracts(false);
      }
    };
    loadContracts();
  }, []);

  // Filter contracts by search term (address or name)
  const filteredContracts = contracts.filter((contract) => {
    if (!contractSearch.trim()) return true;
    const search = contractSearch.toLowerCase();
    return (
      contract.address.toLowerCase().includes(search) ||
      contract.name.toLowerCase().includes(search)
    );
  });

  // Extended type to include contract info for display
  type FunctionWithContract = ContractFunction & {
    contract_address: string;
    contract_name: string;
  };

  const [availableFunctionsWithContract, setAvailableFunctionsWithContract] = useState<FunctionWithContract[]>([]);

  useEffect(() => {
    const loadFunctions = async () => {
      if (selectedContracts.length === 0) {
        setAvailableFunctions([]);
        setAvailableFunctionsWithContract([]);
        return;
      }

      const allFunctions: FunctionWithContract[] = [];
      for (const address of selectedContracts) {
        // Find contract name from our contracts list
        const contractInfo = contracts.find(c => c.address.toLowerCase() === address.toLowerCase());
        const contractName = contractInfo?.name || address.slice(0, 8) + '...';

        try {
          const res = await fetch(`/api/admin/contracts/${address}/functions`);
          const data = await res.json();
          const funcs = (data.functions || []).map((f: ContractFunction) => ({
            ...f,
            contract_address: address,
            contract_name: contractName,
          }));
          allFunctions.push(...funcs);
        } catch (error) {
          console.error('Failed to load functions:', error);
        }
      }

      // Keep all functions (don't dedupe) - they may have same name but different contracts
      setAvailableFunctionsWithContract(allFunctions);

      // For backward compatibility, also set the unique function names
      const uniqueFunctions = allFunctions.reduce((acc, func) => {
        if (!acc.find(f => f.function_name === func.function_name)) {
          acc.push(func);
        }
        return acc;
      }, [] as ContractFunction[]);
      setAvailableFunctions(uniqueFunctions);
    };

    loadFunctions();
  }, [selectedContracts, contracts]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload = {
        ...formData,
        contracts: selectedContracts.map(address => ({
          address,
          include_mode: 'include' as const,
        })),
        functions: selectedFunctions.map(name => ({
          name,
          include_mode: 'include' as const,
        })),
      };

      const url = metric ? `/api/admin/metrics/${metric.id}` : '/api/admin/metrics';
      const method = metric ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save metric');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save metric');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {metric ? 'Edit Metric' : 'Create New Metric'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Select Contracts ({selectedContracts.length} selected)
            </label>
            <input
              type="text"
              value={contractSearch}
              onChange={(e) => setContractSearch(e.target.value)}
              placeholder="Search by address or name..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white mb-2"
            />
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {loadingContracts ? (
                <div className="text-slate-500 text-sm text-center py-4">Loading contracts...</div>
              ) : filteredContracts.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-4">
                  {contractSearch ? 'No contracts match your search' : 'No contracts available'}
                </div>
              ) : (
                filteredContracts.map((contract) => (
                  <label key={contract.address} className="flex items-center gap-3 cursor-pointer hover:bg-slate-700/50 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={selectedContracts.includes(contract.address)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedContracts([...selectedContracts, contract.address]);
                        } else {
                          setSelectedContracts(selectedContracts.filter(a => a !== contract.address));
                        }
                      }}
                      className="rounded bg-slate-700 border-slate-600"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{contract.name}</div>
                      <div className="text-xs text-slate-500 font-mono">{contract.address}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Select Functions ({selectedFunctions.length} selected)
              {selectedContracts.length === 0 && (
                <span className="text-slate-500 ml-2">- Select contracts first</span>
              )}
            </label>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {availableFunctionsWithContract.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-4">
                  {selectedContracts.length === 0
                    ? 'Select contracts to see available functions'
                    : 'No functions found for selected contracts'}
                </div>
              ) : (
                availableFunctionsWithContract.map((func, idx) => (
                  <label key={`${func.contract_address}-${func.function_name}-${idx}`} className="flex items-center gap-3 cursor-pointer hover:bg-slate-700/50 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={selectedFunctions.includes(func.function_name)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (!selectedFunctions.includes(func.function_name)) {
                            setSelectedFunctions([...selectedFunctions, func.function_name]);
                          }
                        } else {
                          setSelectedFunctions(selectedFunctions.filter(f => f !== func.function_name));
                        }
                      }}
                      className="rounded bg-slate-700 border-slate-600"
                    />
                    <div className="flex-1">
                      <div className="font-medium font-mono">
                        {func.function_name}
                        <span className="text-slate-500 font-normal text-xs ml-2">({func.contract_name})</span>
                      </div>
                      {func.function_selector && (
                        <div className="text-xs text-slate-500">{func.function_selector}</div>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{func.tx_count.toLocaleString()} txs</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-white ${nameError ? 'border-red-500' : 'border-slate-700'
                }`}
              placeholder="Bridge Volume (USD)"
              required
            />
            {checkingName && (
              <p className="text-xs text-slate-500 mt-1">Checking name...</p>
            )}
            {nameError && (
              <p className="text-xs text-red-400 mt-1">{nameError}</p>
            )}
            {formData.slug && !nameError && (
              <p className="text-xs text-slate-500 mt-1">
                Slug: <code className="bg-slate-800 px-1 rounded">{formData.slug}</code>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Metric Type</label>
            <select
              value={formData.aggregation_type}
              onChange={(e) => {
                const newType = e.target.value as 'sum_eth_value' | 'count';
                setFormData({
                  ...formData,
                  aggregation_type: newType,
                  // Auto-set currency based on type
                  currency: newType === 'count' ? 'COUNT' : formData.currency === 'COUNT' ? 'USD' : formData.currency,
                });
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="count">Count Transactions</option>
              <option value="sum_eth_value">Sum Value (ETH/USD)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {formData.aggregation_type === 'count'
                ? 'Counts the number of transactions matching the selected contracts and functions'
                : 'Sums the ETH value of transactions and converts to selected currency'}
            </p>
          </div>

          {formData.aggregation_type === 'sum_eth_value' && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Display Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as 'USD' | 'ETH' })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="USD">USD</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || selectedContracts.length === 0 || !!nameError}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : metric ? 'Update Metric' : 'Create Metric'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ============================================================================
// PLATFORM TYPE AUTOCOMPLETE
// ============================================================================

function PlatformTypeAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [existingTypes, setExistingTypes] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Default types to always show as suggestions
  const defaultTypes = ['dex', 'defi', 'bridge', 'social', 'launchpad', 'nft', 'other'];

  useEffect(() => {
    const loadTypes = async () => {
      try {
        const res = await fetch('/api/admin/platforms/types');
        const data = await res.json();
        setExistingTypes(data.types || []);
      } catch (error) {
        console.error('Failed to load platform types:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTypes();
  }, []);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Combine default types with existing types from DB, remove duplicates
  const allTypes = [...new Set([...defaultTypes, ...existingTypes])].sort();

  // Filter suggestions based on input
  const filteredSuggestions = inputValue.trim()
    ? allTypes.filter(type =>
      type.toLowerCase().includes(inputValue.toLowerCase())
    )
    : allTypes;

  // Check if current input is a new type
  const isNewType = inputValue.trim() &&
    !allTypes.some(type => type.toLowerCase() === inputValue.toLowerCase().trim());

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowSuggestions(true);
  };

  const handleSelectType = (type: string) => {
    setInputValue(type);
    onChange(type);
    setShowSuggestions(false);
  };

  const handleInputBlur = (e: React.FocusEvent) => {
    // Check if the related target is within our container (clicking a suggestion)
    // If so, don't do anything - let the mousedown handler take care of it
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    // Only update if we're actually leaving the component
    setTimeout(() => {
      if (inputValue.trim()) {
        onChange(inputValue.trim().toLowerCase());
      }
      setShowSuggestions(false);
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        onChange(inputValue.trim().toLowerCase());
        setShowSuggestions(false);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={() => setShowSuggestions(true)}
        onBlur={handleInputBlur}
        onKeyDown={handleKeyDown}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
        placeholder="Type or select a platform type..."
        required
      />

      {showSuggestions && !loading && (
        <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {isNewType && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectType(inputValue.trim().toLowerCase());
              }}
              className="w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors flex items-center gap-2 text-green-400"
            >
              <span className="text-xs bg-green-500/20 px-1.5 py-0.5 rounded">NEW</span>
              Create &quot;{inputValue.trim().toLowerCase()}&quot;
            </button>
          )}
          {filteredSuggestions.map((type) => (
            <button
              key={type}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelectType(type);
              }}
              className={`w-full px-3 py-2 text-left hover:bg-slate-700 transition-colors flex items-center justify-between ${type.toLowerCase() === inputValue.toLowerCase() ? 'bg-slate-700' : ''
                }`}
            >
              <span>{type}</span>
              {existingTypes.includes(type) && !defaultTypes.includes(type) && (
                <span className="text-xs text-slate-500">custom</span>
              )}
            </button>
          ))}
          {filteredSuggestions.length === 0 && !isNewType && (
            <div className="px-3 py-2 text-slate-500 text-sm">No matching types</div>
          )}
        </div>
      )}
    </div>
  );
}


// ============================================================================
// PLATFORM MODAL
// ============================================================================

function PlatformModal({
  platform,
  onClose,
  onSave,
}: {
  platform: Platform | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    slug: platform?.slug || '',
    name: platform?.name || '',
    description: platform?.description || '',
    logo_url: platform?.logo_url || '',
    website_url: platform?.website_url || '',
    platform_type: platform?.platform_type || 'dex',
  });
  const [saving, setSaving] = useState(false);

  // Name validation state
  const [nameError, setNameError] = useState<string | null>(null);
  const [checkingName, setCheckingName] = useState(false);

  // Auto-generate slug when name changes (only for new platforms)
  const handleNameChange = (newName: string) => {
    setFormData(prev => ({
      ...prev,
      name: newName,
      // Only auto-generate slug for new platforms, not when editing
      slug: !platform ? generateSlug(newName) : prev.slug,
    }));
  };

  // Validate name uniqueness with debounce
  useEffect(() => {
    if (!formData.name.trim()) {
      setNameError(null);
      return;
    }

    const checkNameUniqueness = async () => {
      setCheckingName(true);
      try {
        const res = await fetch('/api/admin/platforms');
        const data = await res.json();
        const existingPlatforms = data.platforms || [];

        const isDuplicate = existingPlatforms.some(
          (p: { id: number; name: string }) =>
            p.name.toLowerCase() === formData.name.trim().toLowerCase() &&
            p.id !== platform?.id // Exclude current platform when editing
        );

        setNameError(isDuplicate ? 'A platform with this name already exists' : null);
      } catch (error) {
        console.error('Failed to check name uniqueness:', error);
      } finally {
        setCheckingName(false);
      }
    };

    const timeoutId = setTimeout(checkNameUniqueness, 300);
    return () => clearTimeout(timeoutId);
  }, [formData.name, platform?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = platform ? `/api/admin/platforms/${platform.id}` : '/api/admin/platforms';
      const method = platform ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save platform');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save platform');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {platform ? 'Edit Platform' : 'Create Platform'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={`w-full bg-slate-800 border rounded-lg px-3 py-2 text-white ${nameError ? 'border-red-500' : 'border-slate-700'
                }`}
              placeholder="Velodrome"
              required
            />
            {checkingName && (
              <p className="text-xs text-slate-500 mt-1">Checking name...</p>
            )}
            {nameError && (
              <p className="text-xs text-red-400 mt-1">{nameError}</p>
            )}
            {formData.slug && !nameError && (
              <p className="text-xs text-slate-500 mt-1">
                Slug: <code className="bg-slate-800 px-1 rounded">{formData.slug}</code>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              rows={2}
              placeholder="A decentralized exchange..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Platform Type</label>
            <PlatformTypeAutocomplete
              value={formData.platform_type}
              onChange={(value) => setFormData({ ...formData, platform_type: value as PlatformType })}
            />
            <p className="text-xs text-slate-500 mt-1">Select an existing type or enter a new one</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Logo URL</label>
            <input
              type="url"
              value={formData.logo_url}
              onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="https://example.com/logo.png"
            />
            {formData.logo_url && (
              <div className="mt-2">
                <img src={formData.logo_url} alt="Preview" className="w-12 h-12 rounded-lg object-cover" />
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Website URL</label>
            <input
              type="url"
              value={formData.website_url}
              onChange={(e) => setFormData({ ...formData, website_url: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="https://velodrome.finance"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !!nameError}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : platform ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ============================================================================
// RULE MODAL
// ============================================================================

interface MetricOption {
  id: number;
  name: string;
  slug: string;
  aggregation_type: string;
  currency: string;
  contracts: string[];
}

function RuleModal({
  rule,
  platforms,
  nativeMetrics,
  onClose,
  onSave,
}: {
  rule: PointsRuleWithRelations | null;
  platforms: Platform[];
  nativeMetrics: NativeMetric[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    metric_type: rule?.metric_type || 'metric' as 'platform' | 'native' | 'metric',
    platform_id: rule?.platform_id || null as number | null,
    native_metric_id: rule?.native_metric_id || null as number | null,
    name: rule?.name || '',
    description: rule?.description || '',
    calculation_mode: rule?.calculation_mode || 'range' as CalculationMode,
    display_order: rule?.display_order || 0,
  });

  // For metric-based rules: cascading selection
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<number[]>([]);
  const [platformSearch, setPlatformSearch] = useState('');
  const [platformContractsMap, setPlatformContractsMap] = useState<Map<number, ContractWithPlatforms[]>>(new Map());
  const [selectedContractAddresses, setSelectedContractAddresses] = useState<string[]>([]);
  const [contractSearch, setContractSearch] = useState('');
  const [availableMetrics, setAvailableMetrics] = useState<MetricOption[]>([]);
  const [metricSearch, setMetricSearch] = useState('');
  const [selectedMetricIds, setSelectedMetricIds] = useState<number[]>(
    rule?.metrics?.map(m => m.id) || []
  );
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [initializing, setInitializing] = useState(!!rule && rule.metric_type === 'metric');

  const [ranges, setRanges] = useState<PointRange[]>(
    rule?.ranges || [{ min: 0, max: 10, points: 10 }]
  );
  const [multiplierValue, setMultiplierValue] = useState<number>(
    rule?.calculation_mode === 'multiplier' && rule?.ranges?.[0]?.points
      ? rule.ranges[0].points
      : 1
  );
  const [saving, setSaving] = useState(false);

  const calculationModes: { value: CalculationMode; label: string; description: string }[] = [
    { value: 'range', label: 'Range', description: 'Award points based on value ranges (e.g., 0-100 = 10pts, 100-500 = 50pts)' },
    { value: 'multiplier', label: 'Multiplier', description: 'Multiply the metric value by a rate (e.g., x2 means $100 volume = 200 points)' },
  ];

  // Initialize selections when editing an existing metric-based rule
  useEffect(() => {
    if (!rule || rule.metric_type !== 'metric' || !rule.metrics || rule.metrics.length === 0) {
      setInitializing(false);
      return;
    }

    const initializeSelections = async () => {
      try {
        // 1. Fetch all metrics to get their contract addresses
        const metricsRes = await fetch('/api/admin/metrics');
        const metricsData = await metricsRes.json();
        const allMetrics = metricsData.metrics || [];

        // Find the metrics that belong to this rule
        const ruleMetricIds = rule.metrics!.map(m => m.id);
        type MetricData = { id: number; name: string; slug: string; aggregation_type: string; currency: string; contracts: { contract_address: string }[] };
        const ruleMetrics = allMetrics.filter((m: MetricData) => ruleMetricIds.includes(m.id));

        // Extract all contract addresses from these metrics
        const contractAddresses = new Set<string>();
        for (const metric of ruleMetrics) {
          for (const c of (metric.contracts || [])) {
            contractAddresses.add(c.contract_address.toLowerCase());
          }
        }

        // 2. Fetch all contracts to find their platforms
        const contractsRes = await fetch('/api/admin/platforms/contracts');
        const contractsData = await contractsRes.json();
        const allContracts: ContractWithPlatforms[] = contractsData.contracts || [];

        // Find contracts that match and extract their platform IDs
        const platformIds = new Set<number>();
        for (const contract of allContracts) {
          if (contractAddresses.has(contract.address.toLowerCase())) {
            for (const platform of (contract.platforms || [])) {
              platformIds.add(platform.id);
            }
          }
        }

        // 3. Set all the selections
        setSelectedPlatformIds(Array.from(platformIds));
        setSelectedContractAddresses(Array.from(contractAddresses));
        setSelectedMetricIds(ruleMetricIds);

        // 4. Set available metrics for display
        setAvailableMetrics(ruleMetrics.map((m: MetricData) => ({
          id: m.id,
          name: m.name,
          slug: m.slug,
          aggregation_type: m.aggregation_type,
          currency: m.currency,
          contracts: m.contracts?.map(c => c.contract_address) || [],
        })));

      } catch (error) {
        console.error('Failed to initialize rule selections:', error);
      } finally {
        setInitializing(false);
      }
    };

    initializeSelections();
  }, [rule]);

  // Load contracts when platforms are selected (skip during initialization)
  useEffect(() => {
    if (initializing) return;
    if (formData.metric_type !== 'metric' || selectedPlatformIds.length === 0) {
      setPlatformContractsMap(new Map());
      return;
    }

    const loadContracts = async () => {
      setLoadingContracts(true);
      try {
        const res = await fetch('/api/admin/platforms/contracts');
        const data = await res.json();
        const allContracts: ContractWithPlatforms[] = data.contracts || [];

        const contractsByPlatform = new Map<number, ContractWithPlatforms[]>();
        for (const platformId of selectedPlatformIds) {
          const contracts = allContracts.filter(c =>
            c.platforms?.some(p => p.id === platformId)
          );
          contractsByPlatform.set(platformId, contracts);
        }
        setPlatformContractsMap(contractsByPlatform);
      } catch (error) {
        console.error('Failed to load contracts:', error);
      } finally {
        setLoadingContracts(false);
      }
    };

    loadContracts();
  }, [selectedPlatformIds, formData.metric_type, initializing]);

  // Load metrics when contracts are selected (skip during initialization)
  useEffect(() => {
    if (initializing) return;
    if (formData.metric_type !== 'metric' || selectedContractAddresses.length === 0) {
      setAvailableMetrics([]);
      return;
    }

    const loadMetrics = async () => {
      setLoadingMetrics(true);
      try {
        const res = await fetch('/api/admin/metrics');
        const data = await res.json();
        const allMetrics = data.metrics || [];

        type MetricData = { id: number; name: string; slug: string; aggregation_type: string; currency: string; contracts: { contract_address: string }[] };
        const filteredMetrics: MetricOption[] = allMetrics
          .filter((m: MetricData) =>
            m.contracts?.some(c =>
              selectedContractAddresses.includes(c.contract_address.toLowerCase())
            )
          )
          .map((m: MetricData) => ({
            id: m.id,
            name: m.name,
            slug: m.slug,
            aggregation_type: m.aggregation_type,
            currency: m.currency,
            contracts: m.contracts?.map(c => c.contract_address) || [],
          }));

        setAvailableMetrics(filteredMetrics);
      } catch (error) {
        console.error('Failed to load metrics:', error);
      } finally {
        setLoadingMetrics(false);
      }
    };

    loadMetrics();
  }, [selectedContractAddresses, formData.metric_type]);

  const allSelectedPlatformContracts = Array.from(platformContractsMap.values()).flat();

  const addRange = () => {
    const lastRange = ranges[ranges.length - 1];
    setRanges([...ranges, {
      min: lastRange ? (lastRange.max || lastRange.min) + 1 : 0,
      max: null,
      points: 0
    }]);
  };

  const updateRange = (index: number, field: keyof PointRange, value: number | null) => {
    const newRanges = [...ranges];
    newRanges[index] = { ...newRanges[index], [field]: value };
    setRanges(newRanges);
  };

  const removeRange = (index: number) => {
    if (ranges.length > 1) {
      setRanges(ranges.filter((_, i) => i !== index));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // For multiplier mode, store the multiplier value in ranges array
      const finalRanges = formData.calculation_mode === 'multiplier'
        ? [{ min: 0, max: null, points: multiplierValue }]
        : ranges;

      const payload = {
        ...formData,
        ranges: finalRanges,
        metric_ids: formData.metric_type === 'metric' ? selectedMetricIds : undefined,
      };

      const url = rule ? `/api/admin/points/rules/${rule.id}` : '/api/admin/points/rules';
      const method = rule ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save rule');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  if (initializing) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl p-8">
          <div className="text-center text-slate-400">Loading rule data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {rule ? 'Edit Points Rule' : 'Create Points Rule'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Rule Type Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Rule Type</label>
            <select
              value={formData.metric_type}
              onChange={(e) => {
                const newType = e.target.value as 'platform' | 'native' | 'metric';
                setFormData({
                  ...formData,
                  metric_type: newType,
                  platform_id: null,
                  native_metric_id: null,
                });
                setSelectedPlatformIds([]);
                setSelectedContractAddresses([]);
                setSelectedMetricIds([]);
              }}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="metric">Based on Metrics (Recommended)</option>
              <option value="native">Native Metric (Wallet Age, TX Count, etc.)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {formData.metric_type === 'metric' && 'Select platforms → contracts → metrics to define what activity earns points'}
              {formData.metric_type === 'native' && 'Points based on wallet-level metrics like age, transaction count, NFTs, or token holdings'}
            </p>
          </div>

          {/* Metric-based rule: Cascading selection */}
          {formData.metric_type === 'metric' && (
            <>
              {/* Step 1: Select Platforms */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  1. Select Platforms ({selectedPlatformIds.length} selected)
                </label>
                <input
                  type="text"
                  value={platformSearch}
                  onChange={(e) => setPlatformSearch(e.target.value)}
                  placeholder="Search platforms..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white mb-2"
                />
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
                  {platforms
                    .filter(p => !platformSearch.trim() || p.name.toLowerCase().includes(platformSearch.toLowerCase()))
                    .map((platform) => (
                      <label key={platform.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedPlatformIds.includes(platform.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPlatformIds([...selectedPlatformIds, platform.id]);
                            } else {
                              setSelectedPlatformIds(selectedPlatformIds.filter(id => id !== platform.id));
                              const addrs = platformContractsMap.get(platform.id)?.map(c => c.address.toLowerCase()) || [];
                              setSelectedContractAddresses(selectedContractAddresses.filter(a => !addrs.includes(a)));
                            }
                          }}
                          className="rounded bg-slate-700 border-slate-600"
                        />
                        <span className="text-sm">{platform.name}</span>
                      </label>
                    ))}
                  {platforms.filter(p => !platformSearch.trim() || p.name.toLowerCase().includes(platformSearch.toLowerCase())).length === 0 && (
                    <div className="text-slate-500 text-sm text-center py-2">No platforms match your search</div>
                  )}
                </div>
              </div>

              {/* Step 2: Select Contracts */}
              {selectedPlatformIds.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    2. Select Contracts ({selectedContractAddresses.length} selected)
                  </label>
                  <input
                    type="text"
                    value={contractSearch}
                    onChange={(e) => setContractSearch(e.target.value)}
                    placeholder="Search by name or address..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white mb-2"
                  />
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                    {loadingContracts ? (
                      <div className="text-slate-500 text-sm text-center py-2">Loading contracts...</div>
                    ) : allSelectedPlatformContracts.length === 0 ? (
                      <div className="text-slate-500 text-sm text-center py-2">No contracts found</div>
                    ) : (
                      allSelectedPlatformContracts
                        .filter(c => !contractSearch.trim() ||
                          c.name.toLowerCase().includes(contractSearch.toLowerCase()) ||
                          c.address.toLowerCase().includes(contractSearch.toLowerCase()))
                        .map((contract) => (
                          <label key={contract.address} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={selectedContractAddresses.includes(contract.address.toLowerCase())}
                              onChange={(e) => {
                                const addr = contract.address.toLowerCase();
                                if (e.target.checked) {
                                  setSelectedContractAddresses([...selectedContractAddresses, addr]);
                                } else {
                                  setSelectedContractAddresses(selectedContractAddresses.filter(a => a !== addr));
                                }
                              }}
                              className="rounded bg-slate-700 border-slate-600"
                            />
                            <span className="text-sm">{contract.name}</span>
                            <span className="text-xs text-slate-500 font-mono">{contract.address.slice(0, 8)}...</span>
                          </label>
                        ))
                    )}
                    {!loadingContracts && allSelectedPlatformContracts.length > 0 &&
                      allSelectedPlatformContracts.filter(c => !contractSearch.trim() ||
                        c.name.toLowerCase().includes(contractSearch.toLowerCase()) ||
                        c.address.toLowerCase().includes(contractSearch.toLowerCase())).length === 0 && (
                        <div className="text-slate-500 text-sm text-center py-2">No contracts match your search</div>
                      )}
                  </div>
                </div>
              )}

              {/* Step 3: Select Metrics */}
              {selectedContractAddresses.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    3. Select Metrics ({selectedMetricIds.length} selected)
                  </label>
                  <input
                    type="text"
                    value={metricSearch}
                    onChange={(e) => setMetricSearch(e.target.value)}
                    placeholder="Search metrics..."
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white mb-2"
                  />
                  <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto space-y-1">
                    {loadingMetrics ? (
                      <div className="text-slate-500 text-sm text-center py-2">Loading metrics...</div>
                    ) : availableMetrics.length === 0 ? (
                      <div className="text-slate-500 text-sm text-center py-2">No metrics found. Create metrics first.</div>
                    ) : (
                      availableMetrics
                        .filter(m => !metricSearch.trim() || m.name.toLowerCase().includes(metricSearch.toLowerCase()))
                        .map((metric) => (
                          <label key={metric.id} className="flex items-center gap-2 cursor-pointer hover:bg-slate-700/50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={selectedMetricIds.includes(metric.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedMetricIds([...selectedMetricIds, metric.id]);
                                } else {
                                  setSelectedMetricIds(selectedMetricIds.filter(id => id !== metric.id));
                                }
                              }}
                              className="rounded bg-slate-700 border-slate-600"
                            />
                            <span className="text-sm">{metric.name}</span>
                            <span className="text-xs text-slate-500">({metric.aggregation_type === 'count' ? 'Count' : metric.currency})</span>
                          </label>
                        ))
                    )}
                    {!loadingMetrics && availableMetrics.length > 0 &&
                      availableMetrics.filter(m => !metricSearch.trim() || m.name.toLowerCase().includes(metricSearch.toLowerCase())).length === 0 && (
                        <div className="text-slate-500 text-sm text-center py-2">No metrics match your search</div>
                      )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Native metric selection */}
          {formData.metric_type === 'native' && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Native Metric</label>
              <select
                value={formData.native_metric_id || ''}
                onChange={(e) => setFormData({ ...formData, native_metric_id: parseInt(e.target.value) || null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                required
              >
                <option value="">Select metric...</option>
                {nativeMetrics.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Rule Name */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Rule Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="e.g., Velodrome Swap Points"
              required
            />
          </div>

          {/* Calculation Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Calculation Mode</label>
            <select
              value={formData.calculation_mode}
              onChange={(e) => setFormData({ ...formData, calculation_mode: e.target.value as CalculationMode })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
            >
              {calculationModes.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {calculationModes.find(m => m.value === formData.calculation_mode)?.description}
            </p>
          </div>

          {/* Multiplier Input - shown when multiplier mode is selected */}
          {formData.calculation_mode === 'multiplier' && (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Multiplier Rate</label>
              <div className="flex items-center gap-3">
                <span className="text-slate-400 text-lg">x</span>
                <input
                  type="number"
                  value={multiplierValue}
                  onChange={(e) => setMultiplierValue(parseFloat(e.target.value) || 1)}
                  min="0.01"
                  step="0.1"
                  className="w-32 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-lg font-semibold"
                  placeholder="1"
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Example: If multiplier is x{multiplierValue} and user has $100 volume, they get {100 * multiplierValue} points
              </p>
            </div>
          )}

          {/* Ranges Editor - shown when range mode is selected */}
          {formData.calculation_mode === 'range' && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-400">Point Ranges</label>
                <button type="button" onClick={addRange} className="text-sm text-purple-400 hover:text-purple-300">+ Add Range</button>
              </div>
              <div className="space-y-2">
                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2 bg-slate-800 p-2 rounded-lg">
                    <input type="number" value={range.min} onChange={(e) => updateRange(index, 'min', parseInt(e.target.value) || 0)} className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-sm" placeholder="Min" />
                    <span className="text-slate-500">to</span>
                    <input type="number" value={range.max ?? ''} onChange={(e) => updateRange(index, 'max', e.target.value ? parseInt(e.target.value) : null)} className="w-24 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-sm" placeholder="∞" />
                    <span className="text-slate-500">=</span>
                    <input type="number" value={range.points} onChange={(e) => updateRange(index, 'points', parseInt(e.target.value) || 0)} className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-white text-sm" placeholder="Points" />
                    <span className="text-slate-500 text-sm">pts</span>
                    {ranges.length > 1 && <button type="button" onClick={() => removeRange(index)} className="text-red-400 hover:text-red-300 ml-2">×</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">Cancel</button>
            <button type="submit" disabled={saving || (formData.metric_type === 'metric' && selectedMetricIds.length === 0)} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors">
              {saving ? 'Saving...' : rule ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// ============================================================================
// RANK MODAL
// ============================================================================

function RankModal({
  rank,
  onClose,
  onSave,
}: {
  rank: Rank | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    name: rank?.name || '',
    min_points: rank?.min_points || 0,
    max_points: rank?.max_points || null as number | null,
    logo_url: rank?.logo_url || '',
    color: rank?.color || '#8b5cf6',
    description: rank?.description || '',
    display_order: rank?.display_order || 0,
  });
  const [saving, setSaving] = useState(false);

  const presetColors = [
    '#8b5cf6', // purple
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = rank ? `/api/admin/points/ranks/${rank.id}` : '/api/admin/points/ranks';
      const method = rank ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save rank');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save rank');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {rank ? 'Edit Rank' : 'Create Rank'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Preview */}
          <div className="flex justify-center mb-4">
            <div
              className="w-20 h-20 rounded-xl flex items-center justify-center font-bold text-2xl"
              style={{
                backgroundColor: formData.color ? `${formData.color}20` : '#334155',
                color: formData.color || '#94a3b8',
                border: `3px solid ${formData.color || '#475569'}`,
              }}
            >
              {formData.logo_url ? (
                <img src={formData.logo_url} alt={formData.name} className="w-12 h-12" />
              ) : (
                formData.name.charAt(0) || '?'
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Rank Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Gold"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Min Points</label>
              <input
                type="number"
                value={formData.min_points}
                onChange={(e) => setFormData({ ...formData, min_points: parseInt(e.target.value) || 0 })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Max Points</label>
              <input
                type="number"
                value={formData.max_points ?? ''}
                onChange={(e) => setFormData({ ...formData, max_points: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                placeholder="∞"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={formData.color || '#8b5cf6'}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-10 h-10 rounded cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={formData.color || ''}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                placeholder="#8b5cf6"
              />
            </div>
            <div className="flex gap-2 mt-2">
              {presetColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className="w-6 h-6 rounded-full border-2 border-transparent hover:border-white transition-colors"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Logo URL</label>
            <input
              type="url"
              value={formData.logo_url}
              onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="https://example.com/badge.png"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              rows={2}
              placeholder="Achieved by..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : rank ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
