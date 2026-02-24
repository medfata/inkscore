#!/usr/bin/env tsx
/**
 * Memory Leak Detection for Dashboard Streaming
 * 
 * This script tests for memory leaks by:
 * 1. Opening and closing multiple streaming connections
 * 2. Monitoring memory usage over time
 * 3. Checking for proper EventSource cleanup
 * 
 * Usage:
 *   npm run test:memory-leaks
 *   or
 *   tsx scripts/test-memory-leaks.ts [wallet-address]
 */

const TEST_WALLET = process.argv[2] || '0x1234567890123456789012345678901234567890';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const ITERATIONS = 10;
const DELAY_BETWEEN_ITERATIONS = 500; // ms

interface MemorySnapshot {
  iteration: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  timestamp: number;
}

/**
 * Simple EventSource polyfill for Node.js
 */
class EventSource {
  private url: string;
  private controller: AbortController;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onopen: (() => void) | null = null;
  public readyState: number = 0; // 0 = CONNECTING, 1 = OPEN, 2 = CLOSED

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    this.controller = new AbortController();
    this.connect();
  }

  private async connect() {
    try {
      const response = await fetch(this.url, {
        signal: this.controller.signal,
        headers: {
          Accept: 'text/event-stream',
        },
      });

      this.readyState = EventSource.OPEN;

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

      this.readyState = EventSource.CLOSED;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        this.readyState = EventSource.CLOSED;
        if (this.onerror) {
          this.onerror(error);
        }
      }
    }
  }

  close() {
    this.readyState = EventSource.CLOSED;
    this.controller.abort();
  }
}

/**
 * Take a memory snapshot
 */
function takeSnapshot(iteration: number): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    iteration,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    rss: mem.rss,
    timestamp: Date.now(),
  };
}

/**
 * Format bytes to MB
 */
function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Run a single streaming connection
 */
async function runStreamingConnection(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const eventSource = new EventSource(
      `${BASE_URL}/api/${TEST_WALLET}/dashboard?stream=true`
    );

    let metricsReceived = 0;
    const timeout = setTimeout(() => {
      eventSource.close();
      reject(new Error('Connection timeout'));
    }, 30000);

    eventSource.onopen = () => {
      // Connection opened
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'metric') {
          metricsReceived++;
        }

        if (data.type === 'done') {
          clearTimeout(timeout);
          eventSource.close();
          resolve();
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    eventSource.onerror = (error) => {
      clearTimeout(timeout);
      eventSource.close();
      // Don't reject on error, just resolve
      resolve();
    };
  });
}

/**
 * Force garbage collection if available
 */
function forceGC() {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Calculate memory growth trend
 */
function calculateTrend(snapshots: MemorySnapshot[]): {
  slope: number;
  isLeaking: boolean;
} {
  if (snapshots.length < 3) {
    return { slope: 0, isLeaking: false };
  }

  // Simple linear regression on heap used
  const n = snapshots.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  snapshots.forEach((snapshot, i) => {
    const x = i;
    const y = snapshot.heapUsed;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Consider it a leak if memory grows > 5MB per iteration
  const isLeaking = slope > 5 * 1024 * 1024;

  return { slope, isLeaking };
}

/**
 * Print memory analysis
 */
function printAnalysis(snapshots: MemorySnapshot[]) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 MEMORY LEAK ANALYSIS');
  console.log('='.repeat(60));

  console.log('\n📈 Memory Snapshots:');
  console.log('  Iter | Heap Used | Heap Total |   RSS    | Delta');
  console.log('  ' + '-'.repeat(54));

  snapshots.forEach((snapshot, i) => {
    const delta =
      i > 0
        ? formatMB(snapshot.heapUsed - snapshots[i - 1].heapUsed)
        : '  -    ';

    console.log(
      `  ${String(snapshot.iteration).padStart(4)} | ${formatMB(snapshot.heapUsed).padStart(9)} | ${formatMB(snapshot.heapTotal).padStart(10)} | ${formatMB(snapshot.rss).padStart(8)} | ${delta}`
    );
  });

  const initial = snapshots[0];
  const final = snapshots[snapshots.length - 1];
  const growth = final.heapUsed - initial.heapUsed;
  const growthPercent = (growth / initial.heapUsed) * 100;

  console.log('\n📊 Summary:');
  console.log(`  Initial Heap:     ${formatMB(initial.heapUsed)}`);
  console.log(`  Final Heap:       ${formatMB(final.heapUsed)}`);
  console.log(`  Total Growth:     ${formatMB(growth)} (${growthPercent.toFixed(1)}%)`);
  console.log(`  Avg per Iteration: ${formatMB(growth / ITERATIONS)}`);

  const trend = calculateTrend(snapshots);
  console.log(`  Growth Trend:     ${formatMB(trend.slope)}/iteration`);

  console.log('\n✅ LEAK DETECTION:');

  const reasonableGrowth = growth < 50 * 1024 * 1024; // < 50MB total
  const reasonableTrend = !trend.isLeaking;

  console.log(
    `  ${reasonableGrowth ? '✓' : '✗'} Total growth < 50MB: ${formatMB(growth)}`
  );
  console.log(
    `  ${reasonableTrend ? '✓' : '✗'} Growth trend acceptable: ${formatMB(trend.slope)}/iter`
  );

  console.log('\n' + '='.repeat(60));

  if (reasonableGrowth && reasonableTrend) {
    console.log('✅ No significant memory leak detected!');
  } else {
    console.log('⚠️  Potential memory leak detected!');
  }

  console.log('='.repeat(60) + '\n');

  return reasonableGrowth && reasonableTrend;
}

/**
 * Main test function
 */
async function main() {
  console.log('🔍 Memory Leak Detection Test');
  console.log(`   Wallet: ${TEST_WALLET}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Iterations: ${ITERATIONS}`);
  console.log(`   Delay: ${DELAY_BETWEEN_ITERATIONS}ms`);

  // Check if GC is available
  if (!global.gc) {
    console.log('\n⚠️  Warning: Garbage collection not available');
    console.log('   Run with: node --expose-gc');
    console.log('   Results may be less accurate\n');
  }

  const snapshots: MemorySnapshot[] = [];

  // Initial GC and snapshot
  forceGC();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  snapshots.push(takeSnapshot(0));

  console.log('\n🔄 Running streaming connections...\n');

  // Run iterations
  for (let i = 1; i <= ITERATIONS; i++) {
    process.stdout.write(`  Iteration ${i}/${ITERATIONS}... `);

    try {
      await runStreamingConnection();
      console.log('✓');
    } catch (error) {
      console.log('✗ (error)');
    }

    // Force GC and take snapshot
    forceGC();
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_ITERATIONS));
    snapshots.push(takeSnapshot(i));
  }

  // Final GC and snapshot
  forceGC();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  snapshots.push(takeSnapshot(ITERATIONS + 1));

  // Analyze results
  const passed = printAnalysis(snapshots);

  process.exit(passed ? 0 : 1);
}

// Run test
main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
