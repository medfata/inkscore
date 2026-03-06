#!/usr/bin/env tsx
/**
 * Slow Network Conditions Test for Dashboard Streaming
 * 
 * This script tests streaming behavior under slow network conditions by:
 * 1. Simulating slow network with delays
 * 2. Verifying progressive metric delivery
 * 3. Checking for buffering issues
 * 
 * Usage:
 *   npm run test:slow-network
 *   or
 *   tsx scripts/test-slow-network.ts [wallet-address]
 * 
 * Note: For true network throttling, use browser DevTools or network proxy tools
 */

const TEST_WALLET = process.argv[2] || '0x1234567890123456789012345678901234567890';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

interface MetricTiming {
  metricId: string;
  timestamp: number;
  relativeTime: number;
}

/**
 * Test streaming with slow reads (simulates slow network)
 */
async function testSlowNetworkStreaming(): Promise<{
  timings: MetricTiming[];
  totalDuration: number;
  metricsReceived: number;
  isProgressive: boolean;
}> {
  const startTime = Date.now();
  const timings: MetricTiming[] = [];
  let metricsReceived = 0;

  console.log('🔄 Testing streaming with slow network simulation...\n');

  try {
    const response = await fetch(
      `${BASE_URL}/api/${TEST_WALLET}/dashboard?stream=true`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

    while (true) {
      // Simulate slow network by adding delay between reads
      await new Promise((resolve) => setTimeout(resolve, 50));

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric') {
              const timing: MetricTiming = {
                metricId: data.id,
                timestamp: Date.now(),
                relativeTime: Date.now() - startTime,
              };
              timings.push(timing);
              metricsReceived++;

              console.log(
                `  ✓ Metric ${metricsReceived}: ${data.id.padEnd(25)} @ ${timing.relativeTime}ms`
              );
            }

            if (data.type === 'done') {
              break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }

    reader.releaseLock();
  } catch (error) {
    console.error('Error during streaming:', error);
  }

  const totalDuration = Date.now() - startTime;

  // Check if metrics arrived progressively (not all at once)
  const isProgressive = checkProgressiveDelivery(timings);

  return {
    timings,
    totalDuration,
    metricsReceived,
    isProgressive,
  };
}

/**
 * Check if metrics were delivered progressively
 */
function checkProgressiveDelivery(timings: MetricTiming[]): boolean {
  if (timings.length < 5) return false;

  // Check time spread between first and last metric
  const firstTime = timings[0].relativeTime;
  const lastTime = timings[timings.length - 1].relativeTime;
  const timeSpread = lastTime - firstTime;

  // Metrics should arrive over at least 500ms (not all at once)
  if (timeSpread < 500) return false;

  // Check that metrics don't all arrive in large batches
  // Calculate time gaps between consecutive metrics
  const gaps: number[] = [];
  for (let i = 1; i < timings.length; i++) {
    gaps.push(timings[i].relativeTime - timings[i - 1].relativeTime);
  }

  // Most gaps should be relatively small (< 2000ms)
  const largeGaps = gaps.filter((gap) => gap > 2000).length;
  const largeGapRatio = largeGaps / gaps.length;

  // If more than 30% of gaps are large, metrics are arriving in batches
  return largeGapRatio < 0.3;
}

/**
 * Analyze timing distribution
 */
function analyzeTimingDistribution(timings: MetricTiming[]): {
  quartiles: number[];
  median: number;
  mean: number;
  stdDev: number;
} {
  const times = timings.map((t) => t.relativeTime).sort((a, b) => a - b);

  const q1 = times[Math.floor(times.length * 0.25)];
  const q2 = times[Math.floor(times.length * 0.5)]; // median
  const q3 = times[Math.floor(times.length * 0.75)];

  const mean = times.reduce((sum, t) => sum + t, 0) / times.length;

  const variance =
    times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
  const stdDev = Math.sqrt(variance);

  return {
    quartiles: [q1, q2, q3],
    median: q2,
    mean,
    stdDev,
  };
}

/**
 * Print test results
 */
function printResults(result: {
  timings: MetricTiming[];
  totalDuration: number;
  metricsReceived: number;
  isProgressive: boolean;
}) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SLOW NETWORK TEST RESULTS');
  console.log('='.repeat(60));

  console.log('\n📈 Delivery Statistics:');
  console.log(`  Total Metrics:     ${result.metricsReceived}`);
  console.log(`  Total Duration:    ${result.totalDuration}ms`);

  if (result.timings.length > 0) {
    const firstMetric = result.timings[0];
    const lastMetric = result.timings[result.timings.length - 1];
    const timeSpread = lastMetric.relativeTime - firstMetric.relativeTime;

    console.log(`  First Metric:      ${firstMetric.relativeTime}ms`);
    console.log(`  Last Metric:       ${lastMetric.relativeTime}ms`);
    console.log(`  Time Spread:       ${timeSpread}ms`);

    const distribution = analyzeTimingDistribution(result.timings);
    console.log(`  Median Time:       ${Math.round(distribution.median)}ms`);
    console.log(`  Mean Time:         ${Math.round(distribution.mean)}ms`);
    console.log(`  Std Deviation:     ${Math.round(distribution.stdDev)}ms`);

    console.log('\n📊 Quartiles:');
    console.log(`  25%: ${Math.round(distribution.quartiles[0])}ms`);
    console.log(`  50%: ${Math.round(distribution.quartiles[1])}ms`);
    console.log(`  75%: ${Math.round(distribution.quartiles[2])}ms`);
  }

  console.log('\n✅ PROGRESSIVE DELIVERY CHECK:');
  console.log(
    `  ${result.isProgressive ? '✓' : '✗'} Metrics delivered progressively: ${result.isProgressive ? 'YES' : 'NO'}`
  );

  if (!result.isProgressive) {
    console.log('     ⚠️  Metrics may be buffered or arriving in large batches');
  }

  console.log('\n' + '='.repeat(60));

  if (result.isProgressive && result.metricsReceived >= 20) {
    console.log('✅ Streaming works correctly under slow network conditions!');
  } else {
    console.log('⚠️  Streaming may have issues under slow network conditions');
  }

  console.log('='.repeat(60) + '\n');

  return result.isProgressive && result.metricsReceived >= 20;
}

/**
 * Test buffering headers
 */
async function testBufferingHeaders(): Promise<boolean> {
  console.log('🔍 Checking anti-buffering headers...\n');

  try {
    const response = await fetch(
      `${BASE_URL}/api/${TEST_WALLET}/dashboard?stream=true`,
      { method: 'HEAD' }
    );

    const headers = {
      'content-type': response.headers.get('content-type'),
      'cache-control': response.headers.get('cache-control'),
      'x-accel-buffering': response.headers.get('x-accel-buffering'),
      connection: response.headers.get('connection'),
    };

    console.log('  Response Headers:');
    Object.entries(headers).forEach(([key, value]) => {
      console.log(`    ${key}: ${value || '(not set)'}`);
    });

    const hasCorrectContentType = headers['content-type'] === 'text/event-stream';
    const hasNoCache = headers['cache-control']?.includes('no-cache') || false;
    const hasNoBuffering = headers['x-accel-buffering'] === 'no';

    console.log('\n  Header Checks:');
    console.log(
      `    ${hasCorrectContentType ? '✓' : '✗'} Content-Type: text/event-stream`
    );
    console.log(`    ${hasNoCache ? '✓' : '✗'} Cache-Control: no-cache`);
    console.log(`    ${hasNoBuffering ? '✓' : '✗'} X-Accel-Buffering: no`);

    return hasCorrectContentType && hasNoCache && hasNoBuffering;
  } catch (error) {
    console.error('  ✗ Error checking headers:', error);
    return false;
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('🌐 Slow Network Conditions Test');
  console.log(`   Wallet: ${TEST_WALLET}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log();

  // Test 1: Check headers
  const headersOk = await testBufferingHeaders();
  console.log();

  // Test 2: Test streaming with slow reads
  const result = await testSlowNetworkStreaming();

  // Print results
  const passed = printResults(result);

  // Overall result
  const allPassed = headersOk && passed;

  if (allPassed) {
    console.log('✅ All slow network tests passed!');
  } else {
    console.log('⚠️  Some slow network tests failed');
  }

  process.exit(allPassed ? 0 : 1);
}

// Run test
main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
