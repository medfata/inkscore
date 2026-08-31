"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Smooth count-up engine for the staking points accumulator.
 *
 * ONE continuous requestAnimationFrame loop for the hook's lifetime: every
 * frame the displayed value eases toward the live target with exponential
 * smoothing (fast at first, slowing as it converges). This gives:
 *
 *  - INTRO: display starts at 0, so an already-accumulated balance rolls in
 *    fast instead of appearing pre-filled (identical feel to a timed intro).
 *  - REAL TIME: the target advances every second (accrual math in the
 *    parent); each 1 Hz bump is visibly absorbed well inside its second —
 *    the counter can never freeze on a stale value.
 *
 * Respects prefers-reduced-motion: no loop — the value simply tracks the
 * target directly.
 */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Time-constant of the approach: ~95% of any step is covered in ~3τ. */
const APPROACH_TAU_MS = 260;

/** Below this, the difference is invisible at 4 decimals — go idle. */
const SNAP_EPSILON = 1e-6;

/** Clamp frame gaps (backgrounded tabs) so the catch-up stays smooth. */
const MAX_FRAME_GAP_MS = 250;

function subscribeToReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True when the user prefers reduced motion (SSR-safe: false on the server). */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  );
}

export function useSmoothPoints(target: number, options?: { approachTauMs?: number }): number {
  const tauMs = options?.approachTauMs ?? APPROACH_TAU_MS;
  const [display, setDisplay] = useState(0);
  const reduced = usePrefersReducedMotion();

  const displayRef = useRef(0);
  // Latest target, mirrored via effect (never written during render) so the
  // always-running frame loop eases toward the live 1 Hz value.
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (reduced) {
      // No animation: jump straight to the target and stay there.
      displayRef.current = targetRef.current;
      setDisplay(targetRef.current);
      return;
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(MAX_FRAME_GAP_MS, now - last);
      last = now;
      const diff = targetRef.current - displayRef.current;
      if (Math.abs(diff) > SNAP_EPSILON) {
        displayRef.current += diff * (1 - Math.exp(-dt / tauMs));
        setDisplay(displayRef.current);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reduced, tauMs]);

  // Reduced motion: skip the animation state entirely and track the target.
  return reduced ? target : display;
}
