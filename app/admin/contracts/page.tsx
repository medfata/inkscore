"use client";

import React, { useState, useEffect, useCallback } from 'react';

type IndexType = 'COUNT_TX' | 'USD_VOLUME';

interface IndexerContract {
  id: number;
  chain_id: number;
  address: string;
  name: string | null;
  deploy_block: number;
  index_type: IndexType;
  abi: any | null;
  is_active: boolean;
  created_at: string;
  chain_name: string;
  chain_display_name: string | null;
  indexing_progress: {
    total_ranges: number;
    complete_ranges: number;
    progress_percent: number;
    is_complete: boolean;
  } | null;
}

interface ChainConfig {
  chain_id: number;
  name: string;
  display_name: string | null;
  rpc_http: string[];
  rpc_ws: string[];
  block_time_ms: number;
  is_active: boolean;
  contract_count: number;
}

export default function IndexerContractsPage() {
  const [contracts, setContracts] = useState<IndexerContract[]>([]);
  const [chains, setChains] = useState<ChainConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingContract, setEditingContract] = useState<IndexerContract | null>(null);
  const [filterChainId, setFilterChainId] = useState<number | null>(null);

  const loadContracts = useCallback(async () => {
    try {
      const url = filterChainId 
        ? `/api/admin/indexer/contracts?chainId=${filterChainId}`
        : '/api/admin/indexer/contracts';
      const res = await fetch(url);
      const data = await res.json();
      setContracts(data.contracts || []);
    } catch (error) {
      console.error('Failed to load contracts:', error);
    }
  }, [filterChainId]);

  const loadChains = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/indexer/chains');
      const data = await res.json();
      setChains(data.chains || []);
    } catch (error) {
      console.error('Failed to load chains:', error);
    }
  }, []);

  useEffect(() => {
    const loadAll = async () => {
      await Promise.all([loadContracts(), loadChains()]);
      setLoading(false);
    };
    loadAll();
  }, [loadContracts, loadChains]);

  useEffect(() => {
    loadContracts();
  }, [filterChainId, loadContracts]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(loadContracts, 10000);
    return () => clearInterval(interval);
  }, [loadContracts]);

  const handleDelete = async (contract: IndexerContract) => {
    if (!confirm(`Delete contract ${contract.name || contract.address}?\n\nThis will permanently delete:\n- The contract configuration\n- All indexed transactions\n- All wallet interactions\n- Indexing progress data`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/indexer/contracts/${contract.id}`, { method: 'DELETE' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Delete failed');
      }
      
      // Show success message with deleted counts
      if (data.deleted) {
        const counts = data.deleted;
        alert(`Successfully deleted contract!\n\nRemoved:\n- ${counts.transaction_details || 0} transactions\n- ${counts.wallet_interactions || 0} interactions\n- ${counts.indexer_ranges || 0} indexer ranges`);
      }
      
      loadContracts();
    } catch (error) {
      console.error('Delete failed:', error);
      alert(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleToggleActive = async (contract: IndexerContract) => {
    try {
      await fetch(`/api/admin/indexer/contracts/${contract.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !contract.is_active }),
      });
      loadContracts();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  const indexTypeColors: Record<IndexType, string> = {
    COUNT_TX: 'bg-blue-500/20 text-blue-400',
    USD_VOLUME: 'bg-purple-500/20 text-purple-400',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-4 mb-2">
            <a href="/admin" className="text-slate-400 hover:text-white transition-colors">
              ← Back to Admin
            </a>
          </div>
          <h1 className="text-3xl font-bold">Indexer Contracts</h1>
          <p className="text-slate-400 mt-1">
            Manage contracts for the blockchain indexer (indexer-v1)
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-sm">Total Contracts</div>
            <div className="text-2xl font-bold">{contracts.length}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-sm">Active</div>
            <div className="text-2xl font-bold text-green-400">
              {contracts.filter(c => c.is_active).length}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-sm">COUNT_TX</div>
            <div className="text-2xl font-bold text-blue-400">
              {contracts.filter(c => c.index_type === 'COUNT_TX').length}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-slate-400 text-sm">USD_VOLUME</div>
            <div className="text-2xl font-bold text-purple-400">
              {contracts.filter(c => c.index_type === 'USD_VOLUME').length}
            </div>
          </div>
        </div>

        {/* Filters and Actions */}
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-4">
            <select
              value={filterChainId || ''}
              onChange={(e) => setFilterChainId(e.target.value ? parseInt(e.target.value) : null)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">All Chains</option>
              {chains.map(chain => (
                <option key={chain.chain_id} value={chain.chain_id}>
                  {chain.display_name || chain.name} ({chain.contract_count})
                </option>
              ))}
            </select>
            <span className="text-slate-400 text-sm">
              {contracts.length} contracts
            </span>
          </div>
          <button
            onClick={() => { setEditingContract(null); setShowModal(true); }}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
          >
            + Add Contract
          </button>
        </div>

        {/* Contracts Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          {contracts.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              No contracts configured. Add your first contract to start indexing.
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Contract</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Chain</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Type</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Deploy Block</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Progress</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-slate-400">Status</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contracts.map((contract) => (
                  <tr key={contract.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{contract.name || 'Unnamed'}</div>
                      <div className="text-xs text-slate-500 font-mono">
                        {contract.address.slice(0, 10)}...{contract.address.slice(-8)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm">
                        {contract.chain_display_name || contract.chain_name || `Chain ${contract.chain_id}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${indexTypeColors[contract.index_type]}`}>
                        {contract.index_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {contract.deploy_block.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      {contract.indexing_progress ? (
                        <div className="w-32">
                          <div className="flex justify-between text-xs mb-1">
                            <span className={contract.indexing_progress.is_complete ? 'text-green-400' : 'text-slate-400'}>
                              {contract.indexing_progress.progress_percent.toFixed(1)}%
                            </span>
                            <span className="text-slate-500">
                              {contract.indexing_progress.complete_ranges}/{contract.indexing_progress.total_ranges}
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${contract.indexing_progress.is_complete ? 'bg-green-500' : 'bg-blue-500'}`}
                              style={{ width: `${contract.indexing_progress.progress_percent}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-sm">Not started</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        contract.is_active 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {contract.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleToggleActive(contract)}
                          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                        >
                          {contract.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => { setEditingContract(contract); setShowModal(true); }}
                          className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(contract)}
                          className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 rounded transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Chain Configs Section */}
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">Chain Configurations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {chains.map(chain => (
              <div key={chain.chain_id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-semibold">{chain.display_name || chain.name}</h3>
                    <p className="text-xs text-slate-500">Chain ID: {chain.chain_id}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    chain.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {chain.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="text-sm text-slate-400 space-y-1">
                  <div>Contracts: <span className="text-white">{chain.contract_count}</span></div>
                  <div>Block time: <span className="text-white">{chain.block_time_ms}ms</span></div>
                  <div className="text-xs">
                    HTTP: {chain.rpc_http.length} endpoint{chain.rpc_http.length !== 1 ? 's' : ''}
                  </div>
                  <div className="text-xs">
                    WS: {chain.rpc_ws.length} endpoint{chain.rpc_ws.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contract Modal */}
      {showModal && (
        <ContractModal
          contract={editingContract}
          chains={chains}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); loadContracts(); }}
        />
      )}
    </div>
  );
}

// Contract Modal Component
function ContractModal({
  contract,
  chains,
  onClose,
  onSave,
}: {
  contract: IndexerContract | null;
  chains: ChainConfig[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    chain_id: contract?.chain_id || 57073,
    address: contract?.address || '',
    name: contract?.name || '',
    deploy_block: contract?.deploy_block || 0,
    index_type: contract?.index_type || 'COUNT_TX' as IndexType,
    is_active: contract?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const url = contract 
        ? `/api/admin/indexer/contracts/${contract.id}`
        : '/api/admin/indexer/contracts';
      
      const res = await fetch(url, {
        method: contract ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save contract');
      }

      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg">
        <h2 className="text-xl font-bold mb-4">
          {contract ? 'Edit Contract' : 'Add Contract'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Chain Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Chain</label>
            <select
              value={formData.chain_id}
              onChange={(e) => setFormData({ ...formData, chain_id: parseInt(e.target.value) })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              disabled={!!contract}
            >
              {chains.map(chain => (
                <option key={chain.chain_id} value={chain.chain_id}>
                  {chain.display_name || chain.name} ({chain.chain_id})
                </option>
              ))}
            </select>
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Contract Address</label>
            <input
              type="text"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="0x..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 font-mono"
              disabled={!!contract}
              required
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Name (optional)</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., UniversalRouter"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
            />
          </div>

          {/* Deploy Block */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Deploy Block</label>
            <input
              type="number"
              value={formData.deploy_block}
              onChange={(e) => setFormData({ ...formData, deploy_block: parseInt(e.target.value) || 0 })}
              placeholder="0"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Block number when the contract was deployed. Indexing starts from this block.
            </p>
          </div>

          {/* Index Type */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Index Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, index_type: 'COUNT_TX' })}
                className={`p-3 rounded-lg border transition-colors ${
                  formData.index_type === 'COUNT_TX'
                    ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="font-medium">COUNT_TX</div>
                <div className="text-xs mt-1">Light data: tx hash, block, from/to, method</div>
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, index_type: 'USD_VOLUME' })}
                className={`p-3 rounded-lg border transition-colors ${
                  formData.index_type === 'USD_VOLUME'
                    ? 'border-purple-500 bg-purple-500/20 text-purple-400'
                    : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="font-medium">USD_VOLUME</div>
                <div className="text-xs mt-1">Full data: all logs, asset transfers, gas</div>
              </button>
            </div>
          </div>

          {/* Active Toggle */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="w-4 h-4 rounded border-slate-700 bg-slate-800"
            />
            <label htmlFor="is_active" className="text-sm text-slate-400">
              Active (will be indexed)
            </label>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
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
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : (contract ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
