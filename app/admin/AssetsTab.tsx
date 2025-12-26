"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { TrackedAsset, AssetType, TokenType } from '@/lib/types/assets';

interface AssetsTabProps {
  onRefresh?: () => void;
}

const ASSET_TYPE_OPTIONS: { value: AssetType; label: string; color: string; borderColor: string }[] = [
  { value: 'erc20_token', label: 'ERC20 Token', color: 'bg-blue-500/20 text-blue-400', borderColor: 'border-blue-500' },
  { value: 'meme_coin', label: 'Meme Coin', color: 'bg-yellow-500/20 text-yellow-400', borderColor: 'border-yellow-500' },
  { value: 'nft_collection', label: 'NFT Collection', color: 'bg-pink-500/20 text-pink-400', borderColor: 'border-pink-500' },
];

const TOKEN_TYPE_OPTIONS: { value: TokenType; label: string }[] = [
  { value: 'native', label: 'Native' },
  { value: 'stablecoin', label: 'Stablecoin' },
  { value: 'defi', label: 'DeFi' },
  { value: 'governance', label: 'Governance' },
  { value: 'utility', label: 'Utility' },
  { value: 'meme', label: 'Meme' },
];

export function AssetsTab({ onRefresh }: AssetsTabProps) {
  const [assets, setAssets] = useState<TrackedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<TrackedAsset | null>(null);
  const [activeFilter, setActiveFilter] = useState<AssetType | 'all'>('all');
  const [draggedAsset, setDraggedAsset] = useState<TrackedAsset | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/assets?includeInactive=true');
      const data = await res.json();
      setAssets(data.assets || []);
    } catch (error) {
      console.error('Failed to load assets:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handleDelete = async (assetId: number) => {
    if (!confirm('Are you sure you want to delete this asset?')) return;
    try {
      await fetch(`/api/admin/assets/${assetId}`, { method: 'DELETE' });
      loadAssets();
      onRefresh?.();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (asset: TrackedAsset) => {
    try {
      await fetch(`/api/admin/assets/${asset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !asset.is_active }),
      });
      loadAssets();
      onRefresh?.();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  const handleDragStart = (asset: TrackedAsset) => {
    setDraggedAsset(asset);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (targetAsset: TrackedAsset) => {
    if (!draggedAsset || draggedAsset.id === targetAsset.id || draggedAsset.asset_type !== targetAsset.asset_type) {
      setDraggedAsset(null);
      return;
    }

    const typeAssets = assets
      .filter(a => a.asset_type === draggedAsset.asset_type)
      .sort((a, b) => a.display_order - b.display_order);
    
    const draggedIndex = typeAssets.findIndex(a => a.id === draggedAsset.id);
    const targetIndex = typeAssets.findIndex(a => a.id === targetAsset.id);

    const newTypeAssets = [...typeAssets];
    newTypeAssets.splice(draggedIndex, 1);
    newTypeAssets.splice(targetIndex, 0, draggedAsset);

    try {
      await fetch('/api/admin/assets/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: draggedAsset.asset_type,
          asset_ids: newTypeAssets.map(a => a.id),
        }),
      });
      loadAssets();
    } catch (error) {
      console.error('Reorder failed:', error);
    }

    setDraggedAsset(null);
  };

  const filteredAssets = activeFilter === 'all' 
    ? assets 
    : assets.filter(a => a.asset_type === activeFilter);

  const getAssetTypeColor = (type: AssetType) => {
    return ASSET_TYPE_OPTIONS.find(o => o.value === type)?.color || 'bg-slate-500/20 text-slate-400';
  };

  if (loading) {
    return <div className="text-center text-slate-500 py-8">Loading assets...</div>;
  }

  const erc20Count = assets.filter(a => a.asset_type === 'erc20_token').length;
  const memeCount = assets.filter(a => a.asset_type === 'meme_coin').length;
  const nftCount = assets.filter(a => a.asset_type === 'nft_collection').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="text-slate-400">
          {assets.length} assets • {assets.filter(a => a.is_active).length} active
        </div>
        <button
          onClick={() => { setEditingAsset(null); setShowModal(true); }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Add Asset
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeFilter === 'all' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          All ({assets.length})
        </button>
        <button
          onClick={() => setActiveFilter('erc20_token')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeFilter === 'erc20_token' ? 'bg-blue-600 text-white' : 'text-blue-400 hover:bg-blue-600/20'
          }`}
        >
          ERC20 Tokens ({erc20Count})
        </button>
        <button
          onClick={() => setActiveFilter('meme_coin')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeFilter === 'meme_coin' ? 'bg-yellow-600 text-white' : 'text-yellow-400 hover:bg-yellow-600/20'
          }`}
        >
          Meme Coins ({memeCount})
        </button>
        <button
          onClick={() => setActiveFilter('nft_collection')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            activeFilter === 'nft_collection' ? 'bg-pink-600 text-white' : 'text-pink-400 hover:bg-pink-600/20'
          }`}
        >
          NFT Collections ({nftCount})
        </button>
      </div>

      {/* Assets Grid */}
      {filteredAssets.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-8 text-center text-slate-500">
          No assets found. Add your first asset to get started.
        </div>
      ) : (
        <>
          {activeFilter !== 'all' && (
            <p className="text-xs text-slate-500">Drag cards to reorder within this category</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                typeColor={getAssetTypeColor(asset.asset_type)}
                onEdit={() => { setEditingAsset(asset); setShowModal(true); }}
                onDelete={() => handleDelete(asset.id)}
                onToggle={() => handleToggleActive(asset)}
                onDragStart={() => handleDragStart(asset)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(asset)}
                isDragging={draggedAsset?.id === asset.id}
                canDrag={activeFilter !== 'all'}
              />
            ))}
          </div>
        </>
      )}

      {/* Modal */}
      {showModal && (
        <AssetModal
          asset={editingAsset}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); loadAssets(); onRefresh?.(); }}
        />
      )}
    </div>
  );
}

// Asset Card Component
function AssetCard({
  asset,
  typeColor,
  onEdit,
  onDelete,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
  canDrag,
}: {
  asset: TrackedAsset;
  typeColor: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragging: boolean;
  canDrag: boolean;
}) {
  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? onDragOver : undefined}
      onDrop={canDrag ? onDrop : undefined}
      className={`bg-slate-900 border border-slate-800 rounded-xl p-4 transition-all ${
        canDrag ? 'cursor-move' : ''
      } ${isDragging ? 'opacity-50 scale-95' : 'hover:border-slate-700'}`}
    >
      <div className="flex items-start gap-3 mb-3">
        {asset.logo_url ? (
          <img
            src={asset.logo_url}
            alt={asset.name}
            className="w-12 h-12 rounded-lg object-cover bg-slate-800"
            onError={(e) => {
              (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(asset.symbol || asset.name.charAt(0))}&background=334155&color=94a3b8`;
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center text-slate-500 text-lg font-bold">
            {asset.symbol?.charAt(0) || asset.name.charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-semibold truncate">{asset.name}</h4>
            {asset.symbol && (
              <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                {asset.symbol}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${typeColor}`}>
              {asset.asset_type.replace('_', ' ')}
            </span>
            {asset.token_type && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
                {asset.token_type}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              asset.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
            }`}>
              {asset.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      <div className="text-xs text-slate-500 font-mono truncate mb-3">
        {asset.address}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          onClick={onToggle}
          className="flex-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          {asset.is_active ? 'Disable' : 'Enable'}
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="flex-1 px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// Lookup result from Routescan
interface LookupResult {
  address: string;
  name: string;
  symbol: string | null;
  decimals: number;
  logo_url: string;
  description: string;
  website_url: string;
  twitter_handle: string;
  token_standard: string;
  is_nft: boolean;
}

// Asset Modal Component - Two-step flow
function AssetModal({
  asset,
  onClose,
  onSave,
}: {
  asset: TrackedAsset | null;
  onClose: () => void;
  onSave: () => void;
}) {
  // Step 1: Address input + asset type selection
  // Step 2: Review & edit fetched data
  const [step, setStep] = useState<1 | 2>(asset ? 2 : 1);
  const [address, setAddress] = useState(asset?.address || '');
  const [assetType, setAssetType] = useState<AssetType>(asset?.asset_type || 'erc20_token');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Form data for step 2
  const [formData, setFormData] = useState({
    name: asset?.name || '',
    symbol: asset?.symbol || '',
    logo_url: asset?.logo_url || '',
    decimals: asset?.decimals ?? 18,
    token_type: (asset?.token_type || '') as TokenType | '',
    description: asset?.description || '',
    website_url: asset?.website_url || '',
    twitter_handle: asset?.twitter_handle || '',
  });

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Lookup address from Routescan
  const handleLookup = async () => {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setLookupError('Please enter a valid contract address');
      return;
    }

    setLookupLoading(true);
    setLookupError(null);

    try {
      const res = await fetch(`/api/admin/assets/lookup?address=${address}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to lookup address');
      }

      const result: LookupResult = data;

      // Auto-detect asset type if it's an NFT
      if (result.is_nft && assetType !== 'nft_collection') {
        setAssetType('nft_collection');
      }

      // Populate form with fetched data
      setFormData({
        name: result.name || '',
        symbol: result.symbol || '',
        logo_url: result.logo_url || '',
        decimals: result.decimals ?? 18,
        token_type: assetType === 'meme_coin' ? 'meme' : '',
        description: result.description || '',
        website_url: result.website_url || '',
        twitter_handle: result.twitter_handle || '',
      });

      setStep(2);
    } catch (err) {
      console.error('Lookup failed:', err);
      setLookupError(err instanceof Error ? err.message : 'Failed to lookup address');
    } finally {
      setLookupLoading(false);
    }
  };

  // Save asset
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const payload = {
        asset_type: assetType,
        address: address.toLowerCase(),
        name: formData.name,
        symbol: formData.symbol || undefined,
        logo_url: formData.logo_url || undefined,
        decimals: assetType === 'nft_collection' ? 0 : formData.decimals,
        token_type: formData.token_type || undefined,
        description: formData.description || undefined,
        website_url: formData.website_url || undefined,
        twitter_handle: formData.twitter_handle || undefined,
      };

      const url = asset ? `/api/admin/assets/${asset.id}` : '/api/admin/assets';
      const method = asset ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save asset');
      }

      onSave();
    } catch (err) {
      console.error('Save failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save asset');
    } finally {
      setSaving(false);
    }
  };

  // Auto-set token_type for meme coins
  useEffect(() => {
    if (assetType === 'meme_coin' && !formData.token_type) {
      setFormData(prev => ({ ...prev, token_type: 'meme' }));
    }
  }, [assetType, formData.token_type]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {asset ? 'Edit Asset' : step === 1 ? 'Add New Asset' : 'Confirm Asset Details'}
          </h2>
          {!asset && (
            <div className="flex gap-2 mt-3">
              <div className={`flex-1 h-1 rounded ${step >= 1 ? 'bg-purple-500' : 'bg-slate-700'}`} />
              <div className={`flex-1 h-1 rounded ${step >= 2 ? 'bg-purple-500' : 'bg-slate-700'}`} />
            </div>
          )}
        </div>

        {/* Step 1: Address + Type */}
        {step === 1 && (
          <div className="p-6 space-y-5">
            {lookupError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {lookupError}
              </div>
            )}

            {/* Asset Type Selection */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-3">Asset Type</label>
              <div className="grid grid-cols-3 gap-3">
                {ASSET_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAssetType(option.value)}
                    className={`p-4 rounded-xl border-2 transition-all text-center ${
                      assetType === option.value
                        ? `${option.borderColor} ${option.color}`
                        : 'border-slate-700 hover:border-slate-600 text-slate-400'
                    }`}
                  >
                    <div className="text-2xl mb-1">
                      {option.value === 'erc20_token' ? '🪙' : option.value === 'meme_coin' ? '🐸' : '🖼️'}
                    </div>
                    <div className="text-sm font-medium">{option.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Contract Address */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Contract Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value.trim())}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-white font-mono text-sm focus:border-purple-500 focus:outline-none"
                placeholder="0x..."
              />
              <p className="text-xs text-slate-500 mt-2">
                We&apos;ll fetch token details automatically from Routescan
              </p>
            </div>

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
                onClick={handleLookup}
                disabled={lookupLoading || !address}
                className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors flex items-center gap-2"
              >
                {lookupLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Fetching...
                  </>
                ) : (
                  'Continue'
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Review & Edit */}
        {step === 2 && (
          <div className="p-6 space-y-4">
            {saveError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {saveError}
              </div>
            )}

            {/* Preview Card */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 flex items-center gap-4">
              {formData.logo_url ? (
                <img
                  src={formData.logo_url}
                  alt={formData.name}
                  className="w-16 h-16 rounded-xl object-cover bg-slate-800"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.symbol || formData.name.charAt(0))}&background=334155&color=94a3b8&size=64`;
                  }}
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-slate-700 flex items-center justify-center text-2xl">
                  {assetType === 'nft_collection' ? '🖼️' : '🪙'}
                </div>
              )}
              <div>
                <div className="font-semibold text-lg">{formData.name || 'Unnamed'}</div>
                {formData.symbol && <div className="text-slate-400">{formData.symbol}</div>}
                <div className="text-xs text-slate-500 font-mono mt-1">{address}</div>
              </div>
            </div>

            {/* Editable Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Token name"
                />
              </div>

              {assetType !== 'nft_collection' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Symbol</label>
                    <input
                      type="text"
                      value={formData.symbol}
                      onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                      placeholder="ETH"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Decimals</label>
                    <input
                      type="number"
                      value={formData.decimals}
                      onChange={(e) => setFormData({ ...formData, decimals: parseInt(e.target.value) || 18 })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                      min="0"
                      max="18"
                    />
                  </div>
                </>
              )}

              {assetType !== 'nft_collection' && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Token Type</label>
                  <select
                    value={formData.token_type}
                    onChange={(e) => setFormData({ ...formData, token_type: e.target.value as TokenType })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  >
                    <option value="">Select type...</option>
                    {TOKEN_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Logo URL</label>
                <input
                  type="url"
                  value={formData.logo_url}
                  onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="https://..."
                />
              </div>

              {assetType === 'nft_collection' && (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Twitter Handle</label>
                  <div className="flex items-center">
                    <span className="text-slate-500 mr-1">@</span>
                    <input
                      type="text"
                      value={formData.twitter_handle}
                      onChange={(e) => setFormData({ ...formData, twitter_handle: e.target.value.replace('@', '') })}
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                      placeholder="ShelliesNFT"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between gap-3 pt-4 border-t border-slate-700">
              {!asset && (
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
                >
                  ← Back
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.name}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving...
                    </>
                  ) : asset ? (
                    'Update'
                  ) : (
                    'Add Asset'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
