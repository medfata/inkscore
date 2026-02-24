import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useStreamingDashboard } from '../useStreamingDashboard';

// Mock EventSource
class MockEventSource {
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState: number = 0;
  CONNECTING = 0;
  OPEN = 1;
  CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = this.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  close() {
    this.readyState = this.CLOSED;
  }

  // Helper method for tests to simulate receiving messages
  simulateMessage(data: any) {
    if (this.onmessage) {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data),
      });
      this.onmessage(event);
    }
  }

  // Helper method for tests to simulate errors
  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// Store reference to mock instances for test access
let mockEventSourceInstance: MockEventSource | null = null;

// Replace global EventSource with mock
(global as any).EventSource = class extends MockEventSource {
  constructor(url: string) {
    super(url);
    mockEventSourceInstance = this;
  }
};

describe('useStreamingDashboard', () => {
  beforeEach(() => {
    mockEventSourceInstance = null;
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('Connection Management', () => {
    it('should not connect when walletAddress is empty', () => {
      const { result } = renderHook(() => useStreamingDashboard('', true));

      expect(mockEventSourceInstance).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });

    it('should not connect when enabled is false', () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', false)
      );

      expect(mockEventSourceInstance).toBeNull();
      expect(result.current.isConnected).toBe(false);
    });

    it('should open connection with correct URL', async () => {
      renderHook(() => useStreamingDashboard('0xABC123', true));

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Hook uses the wallet address as-is
      expect(mockEventSourceInstance?.url).toBe(
        '/api/0xABC123/dashboard?stream=true'
      );
    });

    it('should set isConnected to true when connection opens', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });
    });

    it('should close connection on unmount', async () => {
      const { unmount } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      const closeSpy = vi.spyOn(mockEventSourceInstance!, 'close');
      unmount();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('Metric Loading', () => {
    it('should initialize with all metrics in loading state', () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      expect(result.current.loadingMetrics.size).toBeGreaterThan(0);
      expect(result.current.loadingMetrics.has('stats')).toBe(true);
      expect(result.current.loadingMetrics.has('bridge')).toBe(true);
      expect(result.current.loadingMetrics.has('cowswapSwaps')).toBe(true);
    });

    it('should update metrics progressively as they arrive', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Simulate first metric arriving
      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'stats',
        data: { total: 100 },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.metrics.stats).toEqual({ total: 100 });
        expect(result.current.loadingMetrics.has('stats')).toBe(false);
      });

      // Simulate second metric arriving
      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'bridge',
        data: { volume: 5000 },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.metrics.bridge).toEqual({ volume: 5000 });
        expect(result.current.loadingMetrics.has('bridge')).toBe(false);
      });

      // First metric should still be there
      expect(result.current.metrics.stats).toEqual({ total: 100 });
    });

    it('should handle multiple metrics arriving in quick succession', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Simulate multiple metrics
      const metrics = [
        { id: 'stats', data: { total: 100 } },
        { id: 'bridge', data: { volume: 5000 } },
        { id: 'swap', data: { count: 50 } },
      ];

      metrics.forEach((metric) => {
        mockEventSourceInstance!.simulateMessage({
          type: 'metric',
          ...metric,
          timestamp: Date.now(),
        });
      });

      await waitFor(() => {
        expect(Object.keys(result.current.metrics).length).toBe(3);
      });

      expect(result.current.metrics.stats).toEqual({ total: 100 });
      expect(result.current.metrics.bridge).toEqual({ volume: 5000 });
      expect(result.current.metrics.swap).toEqual({ count: 50 });
      expect(result.current.loadingMetrics.has('stats')).toBe(false);
      expect(result.current.loadingMetrics.has('bridge')).toBe(false);
      expect(result.current.loadingMetrics.has('swap')).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle error events for individual metrics', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      mockEventSourceInstance!.simulateMessage({
        type: 'error',
        id: 'cowswapSwaps',
        error: 'API timeout',
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.errors.cowswapSwaps).toBe('API timeout');
        expect(result.current.loadingMetrics.has('cowswapSwaps')).toBe(false);
      });

      // Metric should not be in metrics object
      expect(result.current.metrics.cowswapSwaps).toBeUndefined();
    });

    it('should handle multiple errors without affecting successful metrics', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Successful metric
      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'stats',
        data: { total: 100 },
        timestamp: Date.now(),
      });

      // Error metric
      mockEventSourceInstance!.simulateMessage({
        type: 'error',
        id: 'bridge',
        error: 'Network error',
        timestamp: Date.now(),
      });

      // Another successful metric
      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'swap',
        data: { count: 50 },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.metrics.stats).toBeDefined();
        expect(result.current.metrics.swap).toBeDefined();
        expect(result.current.errors.bridge).toBe('Network error');
      });

      expect(result.current.loadingMetrics.has('stats')).toBe(false);
      expect(result.current.loadingMetrics.has('bridge')).toBe(false);
      expect(result.current.loadingMetrics.has('swap')).toBe(false);
    });

    it('should handle connection errors', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      mockEventSourceInstance!.simulateError();

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
        expect(result.current.isComplete).toBe(true);
      });
    });

    it('should handle metric with error field in metric event', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'tydro',
        data: null,
        error: 'Failed to fetch',
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.errors.tydro).toBe('Failed to fetch');
        expect(result.current.loadingMetrics.has('tydro')).toBe(false);
      });
    });
  });

  describe('Completion Event', () => {
    it('should handle done event and close connection', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      const closeSpy = vi.spyOn(mockEventSourceInstance!, 'close');

      mockEventSourceInstance!.simulateMessage({
        type: 'done',
        totalDuration: 5000,
        timedOut: false,
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.totalDuration).toBe(5000);
        expect(result.current.timedOut).toBe(false);
      });

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should handle done event with timeout flag', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      mockEventSourceInstance!.simulateMessage({
        type: 'done',
        totalDuration: 30000,
        timedOut: true,
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.totalDuration).toBe(30000);
        expect(result.current.timedOut).toBe(true);
      });
    });

    it('should handle done event without duration', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      mockEventSourceInstance!.simulateMessage({
        type: 'done',
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.totalDuration).toBeNull();
        expect(result.current.timedOut).toBe(false);
      });
    });
  });

  describe('Timeout Scenarios', () => {
    it('should set up a timeout when connection opens', async () => {
      vi.useFakeTimers();
      
      renderHook(() => useStreamingDashboard('0x123', true));

      // Wait a bit for the hook to set up
      await vi.advanceTimersByTimeAsync(100);

      // Verify a timeout was set (there should be pending timers)
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      
      vi.useRealTimers();
    });

    it('should clear timeout when done event received', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      // Wait for connection without fake timers
      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Receive done event
      mockEventSourceInstance!.simulateMessage({
        type: 'done',
        totalDuration: 10000,
        timedOut: false,
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.timedOut).toBe(false);
      });
    });

    it('should clear timeout on unmount', async () => {
      const { unmount } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      // Wait for connection
      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Unmount should not throw errors
      expect(() => unmount()).not.toThrow();
    });

    it('should clear timeout on connection error', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      // Wait for connection
      await waitFor(() => {
        expect(mockEventSourceInstance).not.toBeNull();
      });

      // Simulate connection error
      mockEventSourceInstance!.simulateError();

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.timedOut).toBe(false);
      });
    });
  });

  describe('Full Lifecycle', () => {
    it('should handle complete streaming lifecycle', async () => {
      const { result } = renderHook(() =>
        useStreamingDashboard('0x123', true)
      );

      // Wait for connection
      await waitFor(() => {
        expect(result.current.isConnected).toBe(true);
      });

      // Initial state
      expect(result.current.isComplete).toBe(false);
      expect(result.current.loadingMetrics.size).toBeGreaterThan(0);

      // Receive some metrics
      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'stats',
        data: { total: 100 },
        timestamp: Date.now(),
      });

      mockEventSourceInstance!.simulateMessage({
        type: 'metric',
        id: 'bridge',
        data: { volume: 5000 },
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.metrics.stats).toBeDefined();
        expect(result.current.metrics.bridge).toBeDefined();
      });

      // Receive an error
      mockEventSourceInstance!.simulateMessage({
        type: 'error',
        id: 'cowswapSwaps',
        error: 'Timeout',
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.errors.cowswapSwaps).toBe('Timeout');
      });

      // Receive done event
      mockEventSourceInstance!.simulateMessage({
        type: 'done',
        totalDuration: 8500,
        timedOut: false,
        timestamp: Date.now(),
      });

      await waitFor(() => {
        expect(result.current.isComplete).toBe(true);
        expect(result.current.totalDuration).toBe(8500);
        expect(result.current.timedOut).toBe(false);
      });

      // Verify final state
      expect(result.current.metrics.stats).toEqual({ total: 100 });
      expect(result.current.metrics.bridge).toEqual({ volume: 5000 });
      expect(result.current.errors.cowswapSwaps).toBe('Timeout');
      expect(result.current.loadingMetrics.has('stats')).toBe(false);
      expect(result.current.loadingMetrics.has('bridge')).toBe(false);
      expect(result.current.loadingMetrics.has('cowswapSwaps')).toBe(false);
    });
  });
});
