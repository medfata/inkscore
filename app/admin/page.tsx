"use client";

import React, { useState, useEffect } from 'react';
import { MetricWithRelations, ContractMetadata, ContractFunction } from '@/lib/types/analytics';

export default function AdminPage() {
  const [metrics, setMetrics] = useState<MetricWithRelations[]>([]);
  const [contracts, setContracts] = useState<ContractMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMetric, setEditingMetric] = useState<MetricWithRelations | null>(null);
  const [editingContract, setEditingContract] = useState<ContractMetadata | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [metricsRes, contractsRes] = await Promise.all([
        fetch('/api/admin/metrics'),
        fetch('/api/admin/contracts'),
      ]);

      const metricsData = await metricsRes.json();
      const contractsData = await contractsRes.json();

      setMetrics(metricsData.metrics || []);
      setContracts(contractsData.contracts || []);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (metricId: number) => {
    if (!confirm('Are you sure you want to delete this metric?')) return;
    
    try {
      await fetch(`/api/admin/metrics/${metricId}`, { method: 'DELETE' });
      loadData();
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
      loadData();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
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
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Analytics Admin</h1>
            <p className="text-slate-400 mt-1">Manage metrics for real-time analytics</p>
          </div>
          <div className="flex gap-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
            >
              + Create Metric
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="text-slate-400 text-sm">Total Metrics</div>
            <div className="text-3xl font-bold mt-1">{metrics.length}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="text-slate-400 text-sm">Active Metrics</div>
            <div className="text-3xl font-bold mt-1 text-green-400">
              {metrics.filter(m => m.is_active).length}
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="text-slate-400 text-sm">Indexed Contracts</div>
            <div className="text-3xl font-bold mt-1">{contracts.length}</div>
          </div>
        </div>

        {/* Metrics List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <h2 className="text-xl font-semibold">Metrics</h2>
          </div>
          
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
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          metric.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
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
                        onClick={() => setEditingMetric(metric)}
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

        {/* Contracts List */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mt-8">
          <div className="p-4 border-b border-slate-800">
            <h2 className="text-xl font-semibold">Indexed Contracts</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="text-left p-3 text-sm font-medium text-slate-400">Name</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-400">Address</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-400">Category</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-400">Website</th>
                  <th className="text-left p-3 text-sm font-medium text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contracts.map((contract) => (
                  <tr key={contract.address} className="hover:bg-slate-800/30">
                    <td className="p-3 font-medium">{contract.name}</td>
                    <td className="p-3 font-mono text-sm text-slate-400">
                      {contract.address.slice(0, 10)}...{contract.address.slice(-8)}
                    </td>
                    <td className="p-3">
                      {contract.category && (
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-700">
                          {contract.category}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-sm text-blue-400">
                      {contract.website_url && (
                        <a href={contract.website_url} target="_blank" rel="noopener noreferrer">
                          {contract.website_url}
                        </a>
                      )}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setEditingContract(contract)}
                        className="px-3 py-1 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Create/Edit Metric Modal */}
      {(showCreateModal || editingMetric) && (
        <MetricModal
          metric={editingMetric}
          contracts={contracts}
          onClose={() => {
            setShowCreateModal(false);
            setEditingMetric(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingMetric(null);
            loadData();
          }}
        />
      )}

      {/* Edit Contract Modal */}
      {editingContract && (
        <ContractModal
          contract={editingContract}
          onClose={() => setEditingContract(null)}
          onSave={() => {
            setEditingContract(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}

// Metric Create/Edit Modal Component
function MetricModal({
  metric,
  contracts,
  onClose,
  onSave,
}: {
  metric: MetricWithRelations | null;
  contracts: ContractMetadata[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    slug: metric?.slug || '',
    name: metric?.name || '',
    description: metric?.description || '',
    aggregation_type: metric?.aggregation_type || 'count',
    currency: metric?.currency || 'COUNT',
    icon: metric?.icon || '',
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

  // Load functions when contracts change
  useEffect(() => {
    const loadFunctions = async () => {
      if (selectedContracts.length === 0) {
        setAvailableFunctions([]);
        return;
      }

      const allFunctions: ContractFunction[] = [];
      for (const address of selectedContracts) {
        try {
          const res = await fetch(`/api/admin/contracts/${address}/functions`);
          const data = await res.json();
          allFunctions.push(...(data.functions || []));
        } catch (error) {
          console.error('Failed to load functions:', error);
        }
      }

      // Deduplicate by function name
      const uniqueFunctions = allFunctions.reduce((acc, func) => {
        if (!acc.find(f => f.function_name === func.function_name)) {
          acc.push(func);
        }
        return acc;
      }, [] as ContractFunction[]);

      setAvailableFunctions(uniqueFunctions);
    };

    loadFunctions();
  }, [selectedContracts]);

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
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Slug</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                placeholder="bridge_volume"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                placeholder="Bridge Volume (USD)"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              rows={2}
              placeholder="Total volume of bridged transactions..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Aggregation Type</label>
              <select
                value={formData.aggregation_type}
                onChange={(e) => setFormData({ ...formData, aggregation_type: e.target.value as 'sum_eth_value' | 'count' | 'count_by_function' })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="count">Count</option>
                <option value="sum_eth_value">Sum ETH Value</option>
                <option value="count_by_function">Count by Function</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Currency</label>
              <select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value as 'USD' | 'ETH' | 'COUNT' })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="COUNT">Count</option>
                <option value="ETH">ETH</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Icon</label>
              <input
                type="text"
                value={formData.icon}
                onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
                placeholder="bridge"
              />
            </div>
          </div>

          {/* Contracts Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Select Contracts ({selectedContracts.length} selected)
            </label>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {contracts.map((contract) => (
                <label key={contract.address} className="flex items-center gap-3 cursor-pointer hover:bg-slate-700/50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedContracts.includes(contract.address)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedContracts([...selectedContracts, contract.address]);
                      } else {
                        setSelectedContracts(selectedContracts.filter(a => a !== contract.address));
                        // Also remove functions that might be from this contract
                      }
                    }}
                    className="rounded bg-slate-700 border-slate-600"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{contract.name}</div>
                    <div className="text-xs text-slate-500 font-mono">{contract.address}</div>
                  </div>
                  {contract.category && (
                    <span className="text-xs bg-slate-700 px-2 py-0.5 rounded">{contract.category}</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* Functions Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Select Functions ({selectedFunctions.length} selected)
              {selectedContracts.length === 0 && (
                <span className="text-slate-500 ml-2">- Select contracts first</span>
              )}
            </label>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
              {availableFunctions.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-4">
                  {selectedContracts.length === 0 
                    ? 'Select contracts to see available functions'
                    : 'No functions found for selected contracts'}
                </div>
              ) : (
                availableFunctions.map((func) => (
                  <label key={func.function_name} className="flex items-center gap-3 cursor-pointer hover:bg-slate-700/50 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={selectedFunctions.includes(func.function_name)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedFunctions([...selectedFunctions, func.function_name]);
                        } else {
                          setSelectedFunctions(selectedFunctions.filter(f => f !== func.function_name));
                        }
                      }}
                      className="rounded bg-slate-700 border-slate-600"
                    />
                    <div className="flex-1">
                      <div className="font-medium font-mono">{func.function_name}</div>
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

          {/* Actions */}
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
              disabled={saving || selectedContracts.length === 0}
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


// Contract Edit Modal Component
function ContractModal({
  contract,
  onClose,
  onSave,
}: {
  contract: ContractMetadata;
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    name: contract.name || '',
    website_url: contract.website_url || '',
    logo_url: contract.logo_url || '',
    category: contract.category || '',
    is_active: contract.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  // Load categories from database
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const res = await fetch('/api/admin/contracts/categories');
        const data = await res.json();
        setCategories(data.categories || []);
      } catch (error) {
        console.error('Failed to load categories:', error);
      }
    };
    loadCategories();
  }, []);

  // Filter categories based on input
  const filteredCategories = categories.filter(cat =>
    cat.toLowerCase().includes(formData.category.toLowerCase())
  );

  // Check if current input is a new category
  const isNewCategory = formData.category && 
    !categories.some(cat => cat.toLowerCase() === formData.category.toLowerCase());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const res = await fetch(`/api/admin/contracts/${contract.address}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update contract');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to update contract');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">Edit Contract</h2>
          <p className="text-sm text-slate-400 font-mono mt-1">{contract.address}</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Contract Name"
              required
            />
          </div>

          <div className="relative">
            <label className="block text-sm font-medium text-slate-400 mb-1">Category</label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) => {
                setFormData({ ...formData, category: e.target.value });
                setShowCategorySuggestions(true);
              }}
              onFocus={() => setShowCategorySuggestions(true)}
              onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 200)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Type to search or add new..."
            />
            {isNewCategory && formData.category && (
              <span className="absolute right-3 top-9 text-xs text-green-400">+ New category</span>
            )}
            
            {/* Autocomplete dropdown */}
            {showCategorySuggestions && (filteredCategories.length > 0 || isNewCategory) && (
              <div className="absolute z-10 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setFormData({ ...formData, category: cat });
                      setShowCategorySuggestions(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-white transition-colors"
                  >
                    {cat}
                  </button>
                ))}
                {isNewCategory && (
                  <button
                    type="button"
                    onClick={() => setShowCategorySuggestions(false)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-green-400 border-t border-slate-700 transition-colors"
                  >
                    + Create &quot;{formData.category}&quot;
                  </button>
                )}
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
              placeholder="https://example.com"
            />
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
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="rounded bg-slate-700 border-slate-600"
            />
            <label htmlFor="is_active" className="text-sm text-slate-400">
              Active (show in contract selection)
            </label>
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
              {saving ? 'Saving...' : 'Update Contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
