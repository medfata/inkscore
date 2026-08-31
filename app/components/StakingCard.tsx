"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Clock, Loader2, Lock, Unlock } from './Icons';
import type { ZenithNFT } from '@/lib/staking-contract';
import { awardForLock } from '@/lib/staking-points';
import { PointsAccumulator } from './PointsAccumulator';

export type StakingPhase =
  | 'idle'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'success'
  | 'error';

export type StakingMode = 'available' | 'staked';

export interface StakingCardProps {
  token: ZenithNFT;
  /** Current on-chain state — drives button action + card theme */
  mode: StakingMode;
  phase: StakingPhase;
  /** Shown when phase === 'error' */
  errorMessage?: string;
  /** Pre-formatted fee chip, e.g. "0.001 ETH" or "" (free) */
  feeLabel: string;
  /** Authoritative image URL (chain-resolved or OpenSea CDN) — null while/when unresolved */
  imageUrl?: string | null;
  /** True while the authoritative URL is still being resolved server-side */
  imagePending?: boolean;
  /** Position within grid — drives staggered entrance */
  index: number;
  /** Disables the button while another card's transaction is in flight */
  otherActionPending?: boolean;
  /** True while waiting for collection data to reflect this card's just-confirmed tx */
  syncing?: boolean;
  /** Stake start (unix seconds) — present on staked cards */
  stakedAtSec?: number;
  /** Lock-end (unix seconds) — present on staked cards; countdown target */
  unlockAtSec?: number;
  /** Chosen lock period label, e.g. "1 Week" — shown as a badge on staked cards */
  durationLabel?: string;
  onAction: () => void;
}

const FALLBACK_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="250"%3E%3Crect fill="%231e293b" width="200" height="250"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".35em" fill="%2394a3b8" font-size="16" font-family="monospace"%3EZENITH%3C/text%3E%3C/svg%3E';

const BUSY_PHASES: ReadonlySet<StakingPhase> = new Set([
  'signing',
  'broadcasting',
  'confirming',
]);

function busyLabel(phase: StakingPhase): string {
  switch (phase) {
    case 'signing':
      return 'Confirm in wallet';
    case 'broadcasting':
      return 'Sending';
    case 'confirming':
      return 'Confirming';
    default:
      return '';
  }
}

/** Shared 1 Hz clock — only ticks while enabled. */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    // Async first tick so a newly enabled countdown starts fresh without
    // calling setState synchronously inside the effect.
    const immediate = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, intervalMs);
    return () => {
      window.clearTimeout(immediate);
      window.clearInterval(id);
    };
  }, [enabled, intervalMs]);
  return now;
}

/** "23h 04m 59s" / "1d 4h 12m" style remaining-time label. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/** Compact "1d 04h" / "04h 12m" label for tight badges. */
function formatRemainingShort(ms: number): string {
  if (ms <= 0) return 'now';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(totalSeconds % 60).slice(-2)}s`;
}

export const StakingCard: React.FC<StakingCardProps> = ({
  token,
  mode,
  phase,
  errorMessage,
  feeLabel,
  imageUrl,
  imagePending,
  index,
  otherActionPending,
  syncing,
  stakedAtSec,
  unlockAtSec,
  durationLabel,
  onAction,
}) => {
  const busy = BUSY_PHASES.has(phase);
  const isStaked = mode === 'staked';
  const disabled = busy || !!otherActionPending || !!syncing;

  /* ------------------------- lock countdown ------------------------- */
  const hasLock = isStaked && !!unlockAtSec && unlockAtSec > 0;
  const now = useNow(hasLock);
  const nowSec = Math.floor(now / 1000);

  // Chain-clock anchor: a just-staked position can carry a stakedAt slightly
  // in the client's FUTURE (user clock behind chain time) — the accrued
  // fraction then clamps to 0 and the points counter appears frozen. Capture
  // the gap when lock data arrives (async tick, same pattern as useNow) and
  // run the card's timeline on chain-anchored time. Capped so a garbage
  // timestamp can't skew it far.
  const [chainClockOffsetSec, setChainClockOffsetSec] = useState(0);
  useEffect(() => {
    if (stakedAtSec == null) return;
    const t = window.setTimeout(() => {
      const gap = stakedAtSec - Date.now() / 1000;
      if (gap > 0 && gap < 300) setChainClockOffsetSec(gap);
    }, 0);
    return () => window.clearTimeout(t);
  }, [stakedAtSec]);
  const chainNowSec = Math.floor(nowSec + chainClockOffsetSec);

  const locked = hasLock ? chainNowSec < unlockAtSec : false;
  const remainingMs = hasLock ? Math.max(0, unlockAtSec * 1000 - chainNowSec * 1000) : 0;
  // Elapsed share of the total lock (for the thin progress bar). Falls back
  // to a busy-ish 0 when stakedAt is unavailable (transient fallback meta).
  const progress = hasLock && stakedAtSec && unlockAtSec > stakedAtSec
    ? Math.min(100, Math.max(0, ((chainNowSec - stakedAtSec) / (unlockAtSec - stakedAtSec)) * 100))
    : 0;

  // Points plan award for this position — derived from the on-chain lock
  // duration; null (accumulator hidden) when the duration is unknown.
  const pointsAward = useMemo(
    () =>
      hasLock && stakedAtSec != null && unlockAtSec != null
        ? awardForLock(stakedAtSec, unlockAtSec)
        : null,
    [hasLock, stakedAtSec, unlockAtSec]
  );

  const action = isStaked ? (locked ? 'Locked' : 'Unstake') : 'Stake';
  // Staked but lock data not loaded yet — stay on the safe side and keep
  // the button disabled rather than offering an unstake that would revert.
  const lockPending = isStaked && !hasLock;
  const buttonDisabled = disabled || locked || lockPending;

  // Image source: ONLY the authoritative resolver (chain tokenURI /
  // OpenSea CDN). Blockscout's metadata cache is stale for some tokens
  // (pre-reveal CIDs) and is deliberately never rendered.
  const preferred = imageUrl || FALLBACK_IMAGE;
  const [imgSrc, setImgSrc] = useState(preferred);
  const [lastPreferred, setLastPreferred] = useState(preferred);
  if (preferred !== lastPreferred) {
    // Adjust state during render when the upstream image source changes.
    setLastPreferred(preferred);
    setImgSrc(preferred);
  }

  const handleImageError = () => {
    if (imgSrc !== FALLBACK_IMAGE) {
      setImgSrc(FALLBACK_IMAGE);
    }
  };

  return (
    <div
      className="animate-fade-in-up group/card relative flex flex-col"
      style={{ animationDelay: `${Math.min(index * 45, 400)}ms` }}
    >
      {/* ------------------------- Card body (not clickable) ------------------------- */}
      <div
        className={`relative flex flex-col overflow-hidden rounded-2xl text-left backdrop-blur-md transition-all duration-300 ${
          busy
            ? 'border border-transparent animated-border-violet'
            : phase === 'error'
              ? 'border border-red-500/40 bg-slate-900/60'
              : isStaked
                ? locked
                  ? 'border border-emerald-500/25 shadow-[0_0_28px_-10px_rgba(16,185,129,0.3)]'
                  : 'border border-emerald-500/40 shadow-[0_0_28px_-10px_rgba(16,185,129,0.45)]'
                : 'border border-white/5 bg-slate-900/60'
        } ${otherActionPending && !busy ? 'opacity-50 saturate-50' : ''}`}
      >
        {/* ------------------------- Artwork ------------------------- */}
        <div
          className={`relative aspect-[4/5] w-full overflow-hidden transition-opacity duration-300 ${
            busy ? 'opacity-60' : ''
          } ${phase === 'success' ? 'animate-ring-pulse' : ''}`}
        >
          {imagePending ? (
            <div className="skeleton h-full w-full" aria-label="Loading artwork" />
          ) : (
            <img
              src={imgSrc}
              alt={token.name}
              loading="lazy"
              decoding="async"
              onError={handleImageError}
              className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/card:scale-110"
            />
          )}

          {/* Sheen sweep on hover */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.06] to-transparent opacity-0 transition-opacity duration-500 group-hover/card:opacity-100"
          />

          {/* Staked status badge — top-left */}
          {isStaked && (
            <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-full border border-emerald-400/50 bg-emerald-400/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-950 shadow-[0_0_12px_-2px_rgba(52,211,153,0.8)]">
              <Lock size={10} className="shrink-0" />
              Staked
            </span>
          )}

          {/* Lock-period badge — top-right */}
          {isStaked && durationLabel && (
            <span className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
              {durationLabel}
            </span>
          )}

          {/* Bottom info — Apple-minimal overlay. Price line renders only
              when the explorer reports a collection exchange rate. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-3 pt-10">
            <p className="truncate text-sm font-semibold tracking-tight text-white" title={token.name}>
              {token.name}
            </p>
            {token.priceUsd ? (
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">${token.priceUsd}</p>
            ) : null}
          </div>

          {/* Busy state dims via opacity-60 above; status lives in the button */}
        </div>

        {/* --------------------- Countdown / lock status --------------------- */}
        {hasLock && (
          <div
            className={`px-3 pt-2.5 ${locked ? 'text-emerald-300/90' : 'text-emerald-400'}`}
            aria-live={locked ? 'off' : 'polite'}
          >
            {locked ? (
              <>
                <div className="flex items-center justify-between gap-2 text-[11px] font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={11} className="shrink-0 opacity-80" />
                    Unlocks in
                  </span>
                  <span className="tabular-nums font-semibold" title={new Date((unlockAtSec ?? 0) * 1000).toLocaleString()}>
                    {formatRemaining(remainingMs)}
                  </span>
                </div>
                {/* Elapsed-lock progress */}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-600/70 to-emerald-400/90 transition-[width] duration-1000 ease-linear"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                {/* Live points accumulator — counts up on mount, ticks in real time */}
                {pointsAward !== null && stakedAtSec != null && (
                  <PointsAccumulator award={pointsAward} fraction={progress / 100} />
                )}
              </>
            ) : pointsAward !== null ? (
              /* Lock complete — ONE pill, no bar: the earned award IS the state */
              <div
                className="animate-pill-pop inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-1 text-[11px] font-semibold text-emerald-400"
                aria-label={`${pointsAward} points earned — NFT unlocked, unstake to bank them`}
              >
                <Check size={11} className="shrink-0" />
                {pointsAward} pts earned — ready to unstake
              </div>
            ) : (
              <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 py-1 text-emerald-400">
                <Unlock size={11} className="shrink-0" />
                Lock released — ready to unstake
              </span>
            )}
          </div>
        )}

        {/* ------------------------- Stake / Unstake ------------------------- */}
        <div className="p-2.5">
          <button
            type="button"
            onClick={onAction}
            disabled={buttonDisabled}
            aria-pressed={isStaked}
            aria-busy={busy || syncing}
            aria-label={`${action} NFT #${token.id}. ${
              isStaked
                ? locked
                  ? `Currently staked, unlocks in ${formatRemainingShort(remainingMs)}.`
                  : lockPending
                    ? 'Currently staked, lock status loading.'
                    : 'Currently staked, lock released.'
                : 'Currently in wallet'
            }.${feeLabel ? ` Fee ${feeLabel}.` : ' No fee.'}`}
            className={`w-full rounded-xl px-3 py-2.5 text-[13px] font-semibold tracking-[-0.01em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-purple/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed ${
              busy || syncing
                ? 'bg-white/[0.08] text-slate-300'
                : isStaked
                  ? locked
                    ? 'cursor-not-allowed bg-emerald-500/[0.07] text-emerald-300/50'
                    : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 active:bg-emerald-500/30'
                  : 'bg-ink-purple text-white hover:bg-ink-accent active:bg-violet-800'
            }`}
          >
            {busy || syncing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 size={14} className="shrink-0 animate-spin" />
                {busy ? busyLabel(phase) : 'Syncing'}
              </span>
            ) : isStaked && (locked || lockPending) ? (
              <span className="flex items-center justify-center gap-2">
                <Lock size={13} className="shrink-0" />
                Locked
              </span>
            ) : (
              action
            )}
          </button>
        </div>
      </div>

      {phase === 'error' && errorMessage && (
        <p role="alert" className="mt-2 px-1 text-[11px] leading-snug break-words text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
