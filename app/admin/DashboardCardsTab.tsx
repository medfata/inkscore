"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { DashboardCardWithRelations, DashboardCardRow, DashboardCardType } from '@/lib/types/dashboard';
import { Platform } from '@/lib/types/platforms';
import { MetricWithRelations } from '@/lib/types/analytics';

interface DashboardCardsTabProps {
  platforms: Platform[];
  metrics: MetricWithRelations[];
}

const CARD_COLORS = [
  { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
  { value: 'cyan', label: 'Cyan', class: 'bg-cyan-500' },
  { value: 'yellow', label: 'Yellow', class: 'bg-yellow-500' },
  { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
  { value: 'emerald', label: 'Emerald', class: 'bg-emerald-500' },
  { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
];

export function DashboardCardsTab({ platforms, metrics }: DashboardCardsTabProps) {
  const [cards, setCards] = useState<DashboardCardWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingCard, setEditingCard] = useState<DashboardCardWithRelations | null>(null);
  const [draggedCard, setDraggedCard] = useState<DashboardCardWithRelations | null>(null);

  const loadCards = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/dashboard/cards');
      const data = await res.json();
      setCards(data.cards || []);
    } catch (error) {
      console.error('Failed to load dashboard cards:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  const handleDelete = async (cardId: number) => {
    if (!confirm('Are you sure you want to delete this card?')) return;
    try {
      await fetch(`/api/admin/dashboard/cards/${cardId}`, { method: 'DELETE' });
      loadCards();
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed');
    }
  };

  const handleToggleActive = async (card: DashboardCardWithRelations) => {
    try {
      await fetch(`/api/admin/dashboard/cards/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !card.is_active }),
      });
      loadCards();
    } catch (error) {
      console.error('Toggle failed:', error);
    }
  };

  const handleDragStart = (card: DashboardCardWithRelations) => {
    setDraggedCard(card);
  };

  const handleDragOver = (e: React.DragEvent, targetCard: DashboardCardWithRelations) => {
    e.preventDefault();
    if (!draggedCard || draggedCard.id === targetCard.id || draggedCard.row !== targetCard.row) return;
  };

  const handleDrop = async (targetCard: DashboardCardWithRelations) => {
    if (!draggedCard || draggedCard.id === targetCard.id || draggedCard.row !== targetCard.row) {
      setDraggedCard(null);
      return;
    }

    const rowCards = cards.filter(c => c.row === draggedCard.row);
    const draggedIndex = rowCards.findIndex(c => c.id === draggedCard.id);
    const targetIndex = rowCards.findIndex(c => c.id === targetCard.id);

    // Reorder
    const newRowCards = [...rowCards];
    newRowCards.splice(draggedIndex, 1);
    newRowCards.splice(targetIndex, 0, draggedCard);

    // Update order via API
    try {
      await fetch('/api/admin/dashboard/cards/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row: draggedCard.row,
          card_ids: newRowCards.map(c => c.id),
        }),
      });
      loadCards();
    } catch (error) {
      console.error('Reorder failed:', error);
    }

    setDraggedCard(null);
  };

  const row3Cards = cards.filter(c => c.row === 'row3').sort((a, b) => a.display_order - b.display_order);
  const row4Cards = cards.filter(c => c.row === 'row4').sort((a, b) => a.display_order - b.display_order);

  const getColorClass = (color: string) => {
    return CARD_COLORS.find(c => c.value === color)?.class || 'bg-slate-500';
  };

  if (loading) {
    return <div className="text-center text-slate-500 py-8">Loading dashboard cards...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div className="text-slate-400">
          {cards.length} cards • {cards.filter(c => c.is_active).length} active
        </div>
        <button
          onClick={() => { setEditingCard(null); setShowModal(true); }}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg font-medium transition-colors"
        >
          + Add Card
        </button>
      </div>

      {/* Row 3 - Aggregate Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 rounded text-sm">Row 3</span>
          Aggregate Cards (Multi-Platform)
        </h3>
        <p className="text-sm text-slate-500 mb-4">Cards that combine metrics from multiple platforms. Drag to reorder.</p>
        
        {row3Cards.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-8 text-center text-slate-500">
            No Row 3 cards. Add an aggregate card to display combined platform metrics.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {row3Cards.map((card) => (
              <CardItem
                key={card.id}
                card={card}
                colorClass={getColorClass(card.color)}
                onEdit={() => { setEditingCard(card); setShowModal(true); }}
                onDelete={() => handleDelete(card.id)}
                onToggle={() => handleToggleActive(card)}
                onDragStart={() => handleDragStart(card)}
                onDragOver={(e) => handleDragOver(e, card)}
                onDrop={() => handleDrop(card)}
                isDragging={draggedCard?.id === card.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Row 4 - Single Platform Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-400 rounded text-sm">Row 4</span>
          Single Platform Cards
        </h3>
        <p className="text-sm text-slate-500 mb-4">Cards for individual platform metrics. Drag to reorder.</p>
        
        {row4Cards.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 border-dashed rounded-xl p-8 text-center text-slate-500">
            No Row 4 cards. Add a single platform card to display individual metrics.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {row4Cards.map((card) => (
              <CardItem
                key={card.id}
                card={card}
                colorClass={getColorClass(card.color)}
                onEdit={() => { setEditingCard(card); setShowModal(true); }}
                onDelete={() => handleDelete(card.id)}
                onToggle={() => handleToggleActive(card)}
                onDragStart={() => handleDragStart(card)}
                onDragOver={(e) => handleDragOver(e, card)}
                onDrop={() => handleDrop(card)}
                isDragging={draggedCard?.id === card.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <DashboardCardModal
          card={editingCard}
          platforms={platforms}
          metrics={metrics}
          onClose={() => setShowModal(false)}
          onSave={() => { setShowModal(false); loadCards(); }}
        />
      )}
    </div>
  );
}

// Card Item Component
function CardItem({
  card,
  colorClass,
  onEdit,
  onDelete,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
  isDragging,
}: {
  card: DashboardCardWithRelations;
  colorClass: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  isDragging: boolean;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`bg-slate-900 border border-slate-800 rounded-xl p-4 cursor-move transition-all ${
        isDragging ? 'opacity-50 scale-95' : 'hover:border-slate-700'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${colorClass}`} />
          <h4 className="font-semibold">{card.title}</h4>
        </div>
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          card.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
        }`}>
          {card.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {card.subtitle && (
        <p className="text-sm text-slate-500 mb-3">{card.subtitle}</p>
      )}

      {/* Platforms */}
      {card.platforms.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-slate-500">Platforms:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {card.platforms.map((p) => (
              <span key={p.platform_id} className="flex items-center gap-1 text-xs bg-slate-800 px-2 py-0.5 rounded">
                {p.platform.logo_url && (
                  <img src={p.platform.logo_url} alt="" className="w-3 h-3 rounded" />
                )}
                {p.platform.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      {card.metrics.length > 0 && (
        <div className="mb-3">
          <span className="text-xs text-slate-500">Metrics:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {card.metrics.map((m) => (
              <span key={m.metric_id} className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded">
                {m.metric.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-slate-800">
        <button
          onClick={onToggle}
          className="flex-1 px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors"
        >
          {card.is_active ? 'Disable' : 'Enable'}
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

// Modal Component
function DashboardCardModal({
  card,
  platforms,
  metrics,
  onClose,
  onSave,
}: {
  card: DashboardCardWithRelations | null;
  platforms: Platform[];
  metrics: MetricWithRelations[];
  onClose: () => void;
  onSave: () => void;
}) {
  const [formData, setFormData] = useState({
    row: (card?.row || 'row3') as DashboardCardRow,
    card_type: (card?.card_type || 'aggregate') as DashboardCardType,
    title: card?.title || '',
    subtitle: card?.subtitle || '',
    color: card?.color || 'purple',
    metric_ids: card?.metrics.map(m => m.metric_id) || [] as number[],
    platform_ids: card?.platforms.map(p => p.platform_id) || [] as number[],
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const url = card ? `/api/admin/dashboard/cards/${card.id}` : '/api/admin/dashboard/cards';
      const method = card ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save card');
      }

      onSave();
    } catch (error) {
      console.error('Save failed:', error);
      alert(error instanceof Error ? error.message : 'Failed to save card');
    } finally {
      setSaving(false);
    }
  };

  const toggleMetric = (metricId: number) => {
    setFormData(prev => ({
      ...prev,
      metric_ids: prev.metric_ids.includes(metricId)
        ? prev.metric_ids.filter(id => id !== metricId)
        : [...prev.metric_ids, metricId],
    }));
  };

  const togglePlatform = (platformId: number) => {
    setFormData(prev => ({
      ...prev,
      platform_ids: prev.platform_ids.includes(platformId)
        ? prev.platform_ids.filter(id => id !== platformId)
        : [...prev.platform_ids, platformId],
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold">
            {card ? 'Edit Dashboard Card' : 'Create Dashboard Card'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Row Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Row</label>
            <div className="flex gap-3">
              <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                formData.row === 'row3' 
                  ? 'border-purple-500 bg-purple-500/10' 
                  : 'border-slate-700 hover:border-slate-600'
              }`}>
                <input
                  type="radio"
                  name="row"
                  value="row3"
                  checked={formData.row === 'row3'}
                  onChange={() => setFormData({ ...formData, row: 'row3', card_type: 'aggregate' })}
                  className="sr-only"
                />
                <div className="font-medium">Row 3 - Aggregate</div>
                <div className="text-xs text-slate-500 mt-1">Multi-platform combined metrics</div>
              </label>
              <label className={`flex-1 p-3 rounded-lg border cursor-pointer transition-colors ${
                formData.row === 'row4' 
                  ? 'border-cyan-500 bg-cyan-500/10' 
                  : 'border-slate-700 hover:border-slate-600'
              }`}>
                <input
                  type="radio"
                  name="row"
                  value="row4"
                  checked={formData.row === 'row4'}
                  onChange={() => setFormData({ ...formData, row: 'row4', card_type: 'single' })}
                  className="sr-only"
                />
                <div className="font-medium">Row 4 - Single</div>
                <div className="text-xs text-slate-500 mt-1">Individual platform metrics</div>
              </label>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Bridge Volume"
              required
            />
          </div>

          {/* Subtitle */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">Subtitle (optional)</label>
            <input
              type="text"
              value={formData.subtitle}
              onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white"
              placeholder="Total Bridged To Ink Chain"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {CARD_COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  className={`w-8 h-8 rounded-lg ${color.class} transition-all ${
                    formData.color === color.value 
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900' 
                      : 'opacity-60 hover:opacity-100'
                  }`}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          {/* Platforms */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Platforms (for logos)
            </label>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {platforms.filter(p => p.is_active).map((platform) => (
                  <label
                    key={platform.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      formData.platform_ids.includes(platform.id)
                        ? 'bg-purple-500/20 border border-purple-500/30'
                        : 'hover:bg-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.platform_ids.includes(platform.id)}
                      onChange={() => togglePlatform(platform.id)}
                      className="sr-only"
                    />
                    {platform.logo_url && (
                      <img src={platform.logo_url} alt="" className="w-5 h-5 rounded" />
                    )}
                    <span className="text-sm">{platform.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Selected: {formData.platform_ids.length} platforms
            </p>
          </div>

          {/* Metrics */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Metrics (data sources)
            </label>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-40 overflow-y-auto">
              <div className="space-y-1">
                {metrics.filter(m => m.is_active).map((metric) => (
                  <label
                    key={metric.id}
                    className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
                      formData.metric_ids.includes(metric.id)
                        ? 'bg-cyan-500/20 border border-cyan-500/30'
                        : 'hover:bg-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formData.metric_ids.includes(metric.id)}
                      onChange={() => toggleMetric(metric.id)}
                      className="sr-only"
                    />
                    <span className="text-sm flex-1">{metric.name}</span>
                    <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">{metric.currency}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Selected: {formData.metric_ids.length} metrics
            </p>
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
              disabled={saving || !formData.title}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-700 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : card ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
