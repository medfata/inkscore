/**
 * Performance Tests for Dashboard Streaming
 * 
 * Tests:
 * - Time to first metric
 * - Time to 80% of metrics
 * - Comparison with non-streaming implementation
 * - Memory leak detection (EventSource cleanup)
 * - Slow network conditions
 * - Buffering issues
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock environment
const TEST_WALLET = '0x1234567890123456789012345678901234567890';
const API_BASE_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

interface PerformanceMetrics {
  timeToFirstMetric: number;
  timeTo80Percent: number;
  totalDuration: number;
  metricsReceived: number;
  totalMetrics: number;
  memoryBefore: number;
  memoryAfter: number;
}

describe('Dashboard Streaming Performance Tests', () => {
  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
  });

  /**
   * Test 1: Measure time to first metric
   * Requirement: Time to first metric < 2 seconds
   */
  it('should receive first metric within 2 seconds', async () => {
    const startTime = Date.now();
    let firstMetricTime: number | null = null;
    let metricsReceived = 0;

    const response = await fetch(
      `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`,
      { signal: controller.signal }
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric' && firstMetricTime === null) {
              firstMetricTime = Date.now() - startTime;
              metricsReceived++;
              break;
            }
          }
        }

        if (firstMetricTime !== null) break;
      }
    } finally {
      reader.releaseLock();
    }

    expect(firstMetricTime).not.toBeNull();
    expect(firstMetricTime!).toBeLessThan(2000); // < 2 seconds

    console.log(`✓ Time to first metric: ${firstMetricTime}ms`);
  }, 10000);

  /**
   * Test 2: Measure time to 80% of metrics
   * Requirement: Time to 80% of metrics < 5 seconds
   */
  it('should receive 80% of metrics within 5 seconds', async () => {
    const startTime = Date.now();
    const TOTAL_METRICS = 27;
    const TARGET_METRICS = Math.ceil(TOTAL_METRICS * 0.8); // 22 metrics
    let metricsReceived = 0;
    let timeTo80Percent: number | null = null;

    const response = await fetch(
      `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`,
      { signal: controller.signal }
    );

    expect(response.ok).toBe(true);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric') {
              metricsReceived++;

              if (metricsReceived >= TARGET_METRICS && timeTo80Percent === null) {
                timeTo80Percent = Date.now() - startTime;
                break;
              }
            }

            if (data.type === 'done') {
              break;
            }
          }
        }

        if (timeTo80Percent !== null) break;
      }
    } finally {
      reader.releaseLock();
    }

    expect(timeTo80Percent).not.toBeNull();
    expect(timeTo80Percent!).toBeLessThan(5000); // < 5 seconds

    console.log(`✓ Time to 80% of metrics (${TARGET_METRICS}/${TOTAL_METRICS}): ${timeTo80Percent}ms`);
  }, 15000);

  /**
   * Test 3: Compare streaming vs non-streaming performance
   * Measure perceived performance improvement
   */
  it('should show performance improvement over non-streaming', async () => {
    // Test streaming implementation
    const streamingMetrics = await measureStreamingPerformance();

    // Test non-streaming implementation
    const nonStreamingMetrics = await measureNonStreamingPerformance();

    console.log('\n=== Performance Comparison ===');
    console.log(`Streaming - Time to first metric: ${streamingMetrics.timeToFirstMetric}ms`);
    console.log(`Non-streaming - Time to first data: ${nonStreamingMetrics.totalDuration}ms`);
    console.log(`Streaming - Time to 80%: ${streamingMetrics.timeTo80Percent}ms`);
    console.log(`Streaming - Total duration: ${streamingMetrics.totalDuration}ms`);
    console.log(`Non-streaming - Total duration: ${nonStreamingMetrics.totalDuration}ms`);

    // Streaming should deliver first metric much faster
    expect(streamingMetrics.timeToFirstMetric).toBeLessThan(
      nonStreamingMetrics.totalDuration * 0.5
    );

    // 80% of metrics should arrive before non-streaming completes
    expect(streamingMetrics.timeTo80Percent).toBeLessThan(
      nonStreamingMetrics.totalDuration
    );

    console.log(`✓ Streaming is ${Math.round((nonStreamingMetrics.totalDuration / streamingMetrics.timeToFirstMetric))}x faster to first metric`);
  }, 30000);

  /**
   * Test 4: Check for memory leaks (EventSource cleanup)
   * Ensure connections are properly closed and memory is released
   */
  it('should not leak memory after stream completion', async () => {
    const iterations = 5;
    const memorySnapshots: number[] = [];

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const initialMemory = process.memoryUsage().heapUsed;
    memorySnapshots.push(initialMemory);

    // Run multiple streaming requests
    for (let i = 0; i < iterations; i++) {
      await new Promise<void>((resolve) => {
        const eventSource = new EventSource(
          `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`
        );

        let metricsReceived = 0;

        eventSource.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === 'metric') {
            metricsReceived++;
          }

          if (data.type === 'done') {
            eventSource.close();
            resolve();
          }
        };

        eventSource.onerror = () => {
          eventSource.close();
          resolve();
        };

        // Timeout safety
        setTimeout(() => {
          eventSource.close();
          resolve();
        }, 10000);
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const currentMemory = process.memoryUsage().heapUsed;
      memorySnapshots.push(currentMemory);

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const finalMemory = memorySnapshots[memorySnapshots.length - 1];
    const memoryGrowth = finalMemory - initialMemory;
    const memoryGrowthMB = memoryGrowth / 1024 / 1024;

    console.log('\n=== Memory Usage ===');
    console.log(`Initial: ${(initialMemory / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Final: ${(finalMemory / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Growth: ${memoryGrowthMB.toFixed(2)} MB`);

    // Memory growth should be reasonable (< 50MB for 5 iterations)
    expect(memoryGrowthMB).toBeLessThan(50);

    console.log(`✓ No significant memory leak detected`);
  }, 60000);

  /**
   * Test 5: Test with slow network conditions
   * Simulate slow network and verify streaming still works
   */
  it('should handle slow network conditions gracefully', async () => {
    const startTime = Date.now();
    let firstMetricTime: number | null = null;
    let metricsReceived = 0;
    const metricTimings: number[] = [];

    // Note: This test relies on actual network conditions
    // For true slow network simulation, use network throttling tools
    const response = await fetch(
      `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`,
      { signal: controller.signal }
    );

    expect(response.ok).toBe(true);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric') {
              const timing = Date.now() - startTime;
              metricTimings.push(timing);

              if (firstMetricTime === null) {
                firstMetricTime = timing;
              }

              metricsReceived++;
            }

            if (data.type === 'done') {
              break;
            }
          }
        }

        if (metricsReceived >= 27) break;
      }
    } finally {
      reader.releaseLock();
    }

    // Verify metrics arrive progressively (not all at once)
    expect(metricTimings.length).toBeGreaterThan(0);

    // Check that metrics arrive over time (not buffered)
    const timeSpread = metricTimings[metricTimings.length - 1] - metricTimings[0];
    expect(timeSpread).toBeGreaterThan(100); // At least 100ms spread

    console.log(`✓ Metrics received progressively over ${timeSpread}ms`);
  }, 35000);

  /**
   * Test 6: Verify no buffering issues
   * Ensure metrics are sent immediately, not buffered
   */
  it('should send metrics immediately without buffering', async () => {
    const metricTimestamps: number[] = [];
    const startTime = Date.now();

    const response = await fetch(
      `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`,
      { signal: controller.signal }
    );

    expect(response.ok).toBe(true);
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    try {
      let metricsReceived = 0;

      while (metricsReceived < 10) {
        // Check first 10 metrics
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric') {
              metricTimestamps.push(Date.now() - startTime);
              metricsReceived++;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Verify metrics arrive progressively
    expect(metricTimestamps.length).toBeGreaterThanOrEqual(5);

    // Check that there's variation in arrival times (not all at once)
    const uniqueTimestamps = new Set(metricTimestamps);
    expect(uniqueTimestamps.size).toBeGreaterThan(1);

    console.log(`✓ Metrics arrive progressively: ${metricTimestamps.slice(0, 5).join('ms, ')}ms...`);
  }, 15000);
});

/**
 * Helper function to measure streaming performance
 */
async function measureStreamingPerformance(): Promise<PerformanceMetrics> {
  const startTime = Date.now();
  const TOTAL_METRICS = 27;
  const TARGET_METRICS = Math.ceil(TOTAL_METRICS * 0.8);

  let timeToFirstMetric: number | null = null;
  let timeTo80Percent: number | null = null;
  let totalDuration = 0;
  let metricsReceived = 0;

  const memoryBefore = process.memoryUsage().heapUsed;

  const response = await fetch(
    `http://localhost:3000/api/${TEST_WALLET}/dashboard?stream=true`
  );

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));

          if (data.type === 'metric') {
            metricsReceived++;

            if (timeToFirstMetric === null) {
              timeToFirstMetric = Date.now() - startTime;
            }

            if (metricsReceived >= TARGET_METRICS && timeTo80Percent === null) {
              timeTo80Percent = Date.now() - startTime;
            }
          }

          if (data.type === 'done') {
            totalDuration = Date.now() - startTime;
            break;
          }
        }
      }

      if (totalDuration > 0) break;
    }
  } finally {
    reader.releaseLock();
  }

  const memoryAfter = process.memoryUsage().heapUsed;

  return {
    timeToFirstMetric: timeToFirstMetric || 0,
    timeTo80Percent: timeTo80Percent || 0,
    totalDuration,
    metricsReceived,
    totalMetrics: TOTAL_METRICS,
    memoryBefore,
    memoryAfter,
  };
}

/**
 * Helper function to measure non-streaming performance
 */
async function measureNonStreamingPerformance(): Promise<PerformanceMetrics> {
  const startTime = Date.now();
  const memoryBefore = process.memoryUsage().heapUsed;

  const response = await fetch(
    `http://localhost:3000/api/${TEST_WALLET}/dashboard`
  );

  const data = await response.json();
  const totalDuration = Date.now() - startTime;

  const memoryAfter = process.memoryUsage().heapUsed;

  // Count metrics in response
  const metricsReceived = Object.keys(data).filter(
    (key) => key !== 'errors'
  ).length;

  return {
    timeToFirstMetric: totalDuration, // All data arrives at once
    timeTo80Percent: totalDuration,
    totalDuration,
    metricsReceived,
    totalMetrics: metricsReceived,
    memoryBefore,
    memoryAfter,
  };
}

/**
 * Helper: EventSource polyfill for Node.js testing
 * Note: In real browser tests, use native EventSource
 */
class EventSource {
  private url: string;
  private controller: AbortController;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onopen: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.controller = new AbortController();
    this.connect();
  }

  private async connect() {
    try {
      const response = await fetch(this.url, {
        signal: this.controller.signal,
      });

      if (this.onopen) {
        this.onopen();
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            if (this.onmessage) {
              this.onmessage({ data: line.slice(6) });
            }
          }
        }
      }
    } catch (error) {
      if (this.onerror) {
        this.onerror(error);
      }
    }
  }

  close() {
    this.controller.abort();
  }
}

// Make EventSource available globally for tests
(global as any).EventSource = EventSource;
