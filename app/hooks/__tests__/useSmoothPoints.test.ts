import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSmoothPoints } from '../useSmoothPoints';

/**
 * jsdom has no requestAnimationFrame or matchMedia — stub both. rAF runs on
 * a real 16ms timer so the smoothing loop behaves like a browser's.
 * `reducedMotion` flips the matchMedia stub for the a11y test.
 */

let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  vi.stubGlobal(
    'requestAnimationFrame',
    (cb: (now: number) => void) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>));
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One second of accrual on a 1-day plan (5 pts / 86400s). */
const PER_SECOND = 5 / 86_400;

describe('useSmoothPoints', () => {
  it('starts at 0 (nothing shown pre-filled)', () => {
    const { result } = renderHook(() => useSmoothPoints(0));
    expect(result.current).toBe(0);
  });

  it('rolls in a non-zero target from 0', async () => {
    const { result, rerender } = renderHook(({ target }) => useSmoothPoints(target), {
      initialProps: { target: 0 },
    });

    rerender({ target: PER_SECOND * 30 }); // 30s worth already accrued at mount
    await waitFor(() => expect(result.current).toBeGreaterThan(0));
    // Converges to within SNAP_EPSILON (1e-6) — invisible at 4 decimals.
    await waitFor(
      () => expect(result.current).toBeCloseTo(PER_SECOND * 30, 4),
      { timeout: 3_000 }
    );
  });

  it('keeps ticking in real time as the target accrues every second', async () => {
    const { result, rerender } = renderHook(({ target }) => useSmoothPoints(target), {
      initialProps: { target: 0 },
    });

    // The stake just happened — one second of accrual is already live.
    let target = PER_SECOND;
    rerender({ target });
    await waitFor(() => expect(result.current).toBeGreaterThan(0));

    // Seven more 1 Hz accrual ticks — the display must follow every one.
    for (let second = 0; second < 7; second++) {
      target += PER_SECOND;
      rerender({ target });
      await act(async () => {
        await sleep(1_100); // a bit more than the 1 Hz cadence
      });
      expect(result.current).toBeGreaterThan(PER_SECOND * (second + 1) * 0.5);
    }

    // Converged on the latest accrued value — never frozen at 0.0000.
    expect(result.current).toBeCloseTo(target, 4);
    expect(result.current.toFixed(4)).not.toBe('0.0000');
  }, 20_000); // 7 × 1.1s cadence + intro — well over vitest's 5s default

  it('tracks the target directly under prefers-reduced-motion', async () => {
    reducedMotion = true;
    const { result, rerender } = renderHook(({ target }) => useSmoothPoints(target), {
      initialProps: { target: 0 },
    });

    rerender({ target: 12.4837 });
    await act(async () => {
      await sleep(50);
    });
    expect(result.current).toBe(12.4837);
  });
});
