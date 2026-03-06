#!/usr/bin/env tsx
/**
 * Dashboard Streaming Performance Benchmark
 * 
 * This script measures and compares the performance of streaming vs non-streaming
 * dashboard implementations.
 * 
 * Usage:
 *   npm run benchmark:streaming
 *   or
 *   tsx scripts/benchmark-streaming.ts [wallet-address]
 */

const TEST_WALLET = process.argv[2] || '0x1234567890123456789012345678901234567890';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const ITERATIONS = 3;

interface BenchmarkResult {
  timeToFirstMetric: number;
  timeTo80Percent: number;
  totalDuration: number;
  metricsReceived: number;
  errors: number;
}

interface ComparisonResult {
  streaming: BenchmarkResult;
  nonStreaming: BenchmarkResult;
  improvement: {
    firstMetricSpeedup: number;
    perceivedSpeedup: number;
  };
}

/**
 * Benchmark streaming implementation
 */
async function benchmarkStreaming(): Promise<BenchmarkResult> {
  const startTime = Date.now();
  const TOTAL_METRICS = 27;
  const TARGET_METRICS = Math.ceil(TOTAL_METRICS * 0.8);

  let timeToFirstMetric: number | null = null;
  let timeTo80Percent: number | null = null;
  let metricsReceived = 0;
  let errors = 0;

  try {
    const response = await fetch(
      `${BASE_URL}/api/${TEST_WALLET}/dashboard?stream=true`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
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
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'metric') {
              metricsReceived++;

              if (timeToFirstMetric === null) {
                timeToFirstMetric = Date.now() - startTime;
              }

              if (metricsReceived >= TARGET_METRICS && timeTo80Percent === null) {
                timeTo80Percent = Date.now() - startTime;
              }

              if (data.error) {
                errors++;
              }
            }

            if (data.type === 'error') {
              errors++;
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
    console.error('Streaming benchmark error:', error);
    errors++;
  }

  const totalDuration = Date.now() - startTime;

  return {
    timeToFirstMetric: timeToFirstMetric || totalDuration,
    timeTo80Percent: timeTo80Percent || totalDuration,
    totalDuration,
    metricsReceived,
    errors,
  };
}

/**
 * Benchmark non-streaming implementation
 */
async function benchmarkNonStreaming(): Promise<BenchmarkResult> {
  const startTime = Date.now();
  let metricsReceived = 0;
  let errors = 0;

  try {
    const response = await fetch(`${BASE_URL}/api/${TEST_WALLET}/dashboard`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Count metrics
    metricsReceived = Object.keys(data).filter((key) => key !== 'errors').length;

    // Count errors
    if (data.errors && Array.isArray(data.errors)) {
      errors = data.errors.length;
    }
  } catch (error) {
    console.error('Non-streaming benchmark error:', error);
    errors++;
  }

  const totalDuration = Date.now() - startTime;

  return {
    timeToFirstMetric: totalDuration, // All data arrives at once
    timeTo80Percent: totalDuration,
    totalDuration,
    metricsReceived,
    errors,
  };
}

/**
 * Run benchmark with multiple iterations
 */
async function runBenchmark(
  name: string,
  fn: () => Promise<BenchmarkResult>
): Promise<BenchmarkResult> {
  console.log(`\n🔄 Running ${name} (${ITERATIONS} iterations)...`);

  const results: BenchmarkResult[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    process.stdout.write(`  Iteration ${i + 1}/${ITERATIONS}... `);
    const result = await fn();
    results.push(result);
    console.log(`✓ ${result.totalDuration}ms`);

    // Small delay between iterations
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Calculate averages
  const avg = {
    timeToFirstMetric:
      results.reduce((sum, r) => sum + r.timeToFirstMetric, 0) / ITERATIONS,
    timeTo80Percent:
      results.reduce((sum, r) => sum + r.timeTo80Percent, 0) / ITERATIONS,
    totalDuration:
      results.reduce((sum, r) => sum + r.totalDuration, 0) / ITERATIONS,
    metricsReceived:
      results.reduce((sum, r) => sum + r.metricsReceived, 0) / ITERATIONS,
    errors: results.reduce((sum, r) => sum + r.errors, 0) / ITERATIONS,
  };

  return avg;
}

/**
 * Format duration in ms
 */
function formatDuration(ms: number): string {
  return `${Math.round(ms)}ms`;
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/**
 * Print comparison results
 */
function printResults(comparison: ComparisonResult) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 PERFORMANCE BENCHMARK RESULTS');
  console.log('='.repeat(60));

  console.log('\n📈 STREAMING IMPLEMENTATION:');
  console.log(`  Time to First Metric:  ${formatDuration(comparison.streaming.timeToFirstMetric)}`);
  console.log(`  Time to 80% Metrics:   ${formatDuration(comparison.streaming.timeTo80Percent)}`);
  console.log(`  Total Duration:        ${formatDuration(comparison.streaming.totalDuration)}`);
  console.log(`  Metrics Received:      ${Math.round(comparison.streaming.metricsReceived)}`);
  console.log(`  Errors:                ${Math.round(comparison.streaming.errors)}`);

  console.log('\n📉 NON-STREAMING IMPLEMENTATION:');
  console.log(`  Time to First Data:    ${formatDuration(comparison.nonStreaming.timeToFirstMetric)}`);
  console.log(`  Total Duration:        ${formatDuration(comparison.nonStreaming.totalDuration)}`);
  console.log(`  Metrics Received:      ${Math.round(comparison.nonStreaming.metricsReceived)}`);
  console.log(`  Errors:                ${Math.round(comparison.nonStreaming.errors)}`);

  console.log('\n🚀 PERFORMANCE IMPROVEMENT:');
  console.log(
    `  First Metric Speedup:  ${comparison.improvement.firstMetricSpeedup.toFixed(1)}x faster`
  );
  console.log(
    `  Perceived Speedup:     ${comparison.improvement.perceivedSpeedup.toFixed(1)}x faster`
  );

  // Check requirements
  console.log('\n✅ REQUIREMENTS CHECK:');

  const firstMetricOk = comparison.streaming.timeToFirstMetric < 2000;
  console.log(
    `  ${firstMetricOk ? '✓' : '✗'} Time to first metric < 2s: ${formatDuration(comparison.streaming.timeToFirstMetric)}`
  );

  const eightyPercentOk = comparison.streaming.timeTo80Percent < 5000;
  console.log(
    `  ${eightyPercentOk ? '✓' : '✗'} Time to 80% metrics < 5s: ${formatDuration(comparison.streaming.timeTo80Percent)}`
  );

  const improvementOk = comparison.improvement.perceivedSpeedup >= 2;
  console.log(
    `  ${improvementOk ? '✓' : '✗'} 50%+ perceived improvement: ${formatPercent((comparison.improvement.perceivedSpeedup - 1) * 100)} faster`
  );

  console.log('\n' + '='.repeat(60));

  if (firstMetricOk && eightyPercentOk && improvementOk) {
    console.log('✅ All performance requirements met!');
  } else {
    console.log('⚠️  Some performance requirements not met');
  }

  console.log('='.repeat(60) + '\n');
}

/**
 * Main benchmark function
 */
async function main() {
  console.log('🎯 Dashboard Streaming Performance Benchmark');
  console.log(`   Wallet: ${TEST_WALLET}`);
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   Iterations: ${ITERATIONS}`);

  try {
    // Run benchmarks
    const streamingResult = await runBenchmark('Streaming', benchmarkStreaming);
    const nonStreamingResult = await runBenchmark(
      'Non-Streaming',
      benchmarkNonStreaming
    );

    // Calculate improvements
    const comparison: ComparisonResult = {
      streaming: streamingResult,
      nonStreaming: nonStreamingResult,
      improvement: {
        firstMetricSpeedup:
          nonStreamingResult.timeToFirstMetric / streamingResult.timeToFirstMetric,
        perceivedSpeedup:
          nonStreamingResult.totalDuration / streamingResult.timeTo80Percent,
      },
    };

    // Print results
    printResults(comparison);

    // Exit with appropriate code
    const allRequirementsMet =
      streamingResult.timeToFirstMetric < 2000 &&
      streamingResult.timeTo80Percent < 5000 &&
      comparison.improvement.perceivedSpeedup >= 2;

    process.exit(allRequirementsMet ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error);
    process.exit(1);
  }
}

// Run benchmark
main();
