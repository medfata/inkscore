"use client";

import React, { useEffect, useRef, useState } from 'react';
import { X } from './Icons';
import { STAKING_DURATIONS, type StakingDuration, type ZenithNFT } from '@/lib/staking-contract';

export interface StakeModalProps {
  /** NFT the user is about to stake */
  token: ZenithNFT;
  /** Pre-formatted stake fee chip, e.g. "0.0015 ETH" or "" (free) */
  feeLabel: string;
  /** Authoritative artwork URL — null while/when unresolved */
  imageUrl?: string | null;
  onClose: () => void;
  /** Called with the chosen LockPeriod enum value */
  onConfirm: (durationIndex: StakingDuration['index']) => void;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120"%3E%3Crect fill="%232c2c2e" width="120" height="120"/%3E%3C/svg%3E';

/**
 * Lock-period picker shown when the user presses Stake on an NFT card.
 * Deliberately minimal: a segmented control, one footnote, two actions.
 */
export const StakeModal: React.FC<StakeModalProps> = ({
  token,
  feeLabel,
  imageUrl,
  onClose,
  onConfirm,
}) => {
  /** Default to the longest period — the user can always pick a shorter one. */
  const [selected, setSelected] = useState<StakingDuration['index']>(2);
  const panelRef = useRef<HTMLDivElement>(null);

  /* -------- dismiss: Escape key + backdrop click ------------------ */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /* -------- lock body scroll while open --------------------------- */
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /* -------- initial focus on the dialog panel ---------------------- */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div aria-hidden className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-md" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Stake ${token.name} — choose lock period`}
        tabIndex={-1}
        className="animate-fade-in-up relative w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#1c1c1e] p-6 shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-white">Stake NFT</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 rounded-full p-1.5 text-slate-500 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            <X size={16} />
          </button>
        </div>

        {/* NFT identity */}
        <div className="mt-4 flex items-center gap-3">
          <img
            src={imageUrl || FALLBACK_IMAGE}
            alt=""
            className="h-10 w-10 shrink-0 rounded-lg object-cover"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white" title={token.name}>
              {token.name}
            </p>
            <p className="text-xs text-slate-500">InkScore Zenith</p>
          </div>
        </div>

        {/* Segmented control */}
        <div
          role="radiogroup"
          aria-label="Lock period"
          className="mt-5 flex rounded-[10px] bg-white/[0.06] p-1"
        >
          {STAKING_DURATIONS.map((d) => {
            const active = selected === d.index;
            return (
              <button
                key={d.index}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(d.index)}
                className={`flex-1 rounded-lg px-1 py-1.5 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                  active
                    ? 'bg-[#48484a] text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="block text-[13px] font-medium leading-tight">{d.label}</span>
                <span
                  className={`block text-[10px] font-semibold leading-tight ${
                    active ? 'text-emerald-300' : 'text-emerald-500/70'
                  }`}
                >
                  +{d.points} pts
                </span>
              </button>
            );
          })}
        </div>

        {/* Footnote — fee disclosure only (fees are currently zero) */}
        {feeLabel ? (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            Stake fee {feeLabel}.
          </p>
        ) : null}

        {/* Actions */}
        <div className="mt-6 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-white/[0.08] py-2.5 text-[13px] font-semibold text-slate-200 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected === null}
            onClick={() => selected !== null && onConfirm(selected)}
            aria-label={selected !== null ? `Stake ${token.name} for ${STAKING_DURATIONS[selected].label}` : 'Select a lock period'}
            className="flex-1 rounded-xl bg-ink-purple py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-ink-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-purple/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stake
          </button>
        </div>
      </div>
    </div>
  );
};
