"use client";

import React from 'react';
import { useSmoothPoints } from '../hooks/useSmoothPoints';

export interface PointsAccumulatorProps {
  /** Full plan award (5 / 15 / 50) — the counter's completion target */
  award: number;
  /** Elapsed fraction of the lock period, 0..1 (live, re-evaluated at 1 Hz) */
  fraction: number;
}

/**
 * Live points accumulator for a LOCKED NFT card — the accruing state only.
 * (The completed state is owned by StakingCard, which renders a single
 * merged "pts earned — ready to unstake" pill instead.)
 *
 * The already-accumulated balance is never shown pre-filled — on mount it
 * counts up fast from zero to the current value (useSmoothPoints intro),
 * then keeps ticking in real time at the plan's accrual pace.
 *
 * 4 decimals keep every plan visibly alive (~2–5s per 0.0001 tick):
 * 1 Day ≈ 1.7s · 1 Week ≈ 4s · 1 Month ≈ 5.2s.
 */
export const PointsAccumulator: React.FC<PointsAccumulatorProps> = ({ award, fraction }) => {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const display = useSmoothPoints(award * clamped);

  // Fixed 4-decimal formatting, split so the integer part reads as the hero
  // number and the decimals as its quiet trailing edge.
  const formatted = display.toFixed(4);
  const dotIndex = formatted.indexOf('.');
  const intPart = formatted.slice(0, dotIndex);
  const decPart = formatted.slice(dotIndex); // includes the dot

  return (
    <div className="mt-2 flex items-baseline justify-between gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Points
      </span>
      <span
        className="tabular-nums leading-none"
        aria-label={`Accruing ${award} points over the lock period — ${formatted} earned so far`}
        aria-live="off"
      >
        <span className="text-[13px] font-bold text-emerald-300 animate-points-breathe">
          +{intPart}
        </span>
        <span className="text-[10px] font-semibold text-emerald-400/70">{decPart}</span>
        <span className="ml-0.5 text-[10px] font-medium text-slate-500">/ {award} pts</span>
      </span>
    </div>
  );
};
