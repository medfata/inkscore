# Dashboard Streaming Performance Tests

This directory contains comprehensive performance tests for the dashboard streaming implementation.

## Test Files

### 1. `streaming.performance.test.ts`
Vitest-based performance tests that measure:
- **Time to first metric** (< 2s requirement)
- **Time to 80% of metrics** (< 5s requirement)
- **Streaming vs non-streaming comparison**
- **Memory leak detection** (EventSource cleanup)
- **Slow network conditions**
- **Buffering issues**

### 2. `streaming.integration.test.ts`
Integration tests for the full streaming lifecycle.

## Running Tests

### Run All Performance Tests
```bash
npm run test:performance
```

### Run Specific Test
```bash
npx vitest run app/api/[wallet]/dashboard/__tests__/streaming.performance.test.ts -t "should receive first metric"
```

### Run with UI
```bash
npm run test:ui
```

## Standalone Scripts

### Performance Benchmark
Comprehensive benchmark comparing streaming vs non-streaming:
```bash
npm run benchmark:streaming

# With custom wallet
npm run benchmark:streaming 0xYourWalletAddress
```

**Output:**
- Time to first metric
- Time to 80% of metrics
- Total duration comparison
- Performance improvement metrics
- Requirements validation

### Memory Leak Detection
Tests for memory leaks over multiple connections:
```bash
npm run test:memory-leaks

# With custom wallet
npm run test:memory-leaks 0xYourWalletAddress
```

**Output:**
- Memory snapshots per iteration
- Heap usage growth
- Memory leak detection
- Growth trend analysis

**Note:** For best results, run with garbage collection exposed:
```bash
node --expose-gc --loader tsx scripts/test-memory-leaks.ts
```

### Slow Network Test
Tests streaming behavior under slow network conditions:
```bash
npm run test:slow-network

# With custom wallet
npm run test:slow-network 0xYourWalletAddress
```

**Output:**
- Progressive delivery verification
- Timing distribution analysis
- Anti-buffering header checks
- Quartile analysis

## Performance Requirements

Based on the spec requirements:

| Metric | Requirement | Test |
|--------|-------------|------|
| Time to first metric | < 2 seconds | ✓ |
| Time to 80% of metrics | < 5 seconds | ✓ |
| Perceived performance | 50%+ improvement | ✓ |
| Memory leaks | No significant leaks | ✓ |
| Progressive delivery | No buffering | ✓ |

## Test Environment

### Prerequisites
1. **Next.js dev server running:**
   ```bash
   npm run dev
   ```

2. **Express API server running:**
   ```bash
   # In express-api directory
   npm start
   ```

3. **Valid test wallet:**
   - Default: `0x1234567890123456789012345678901234567890`
   - Or provide your own wallet address

### Environment Variables
```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
API_SERVER_URL=http://localhost:4000
```

## Interpreting Results

### Time to First Metric
- **Good:** < 1000ms
- **Acceptable:** 1000-2000ms
- **Poor:** > 2000ms

### Time to 80% Metrics
- **Good:** < 3000ms
- **Acceptable:** 3000-5000ms
- **Poor:** > 5000ms

### Memory Growth
- **Good:** < 20MB total growth
- **Acceptable:** 20-50MB total growth
- **Poor:** > 50MB total growth

### Progressive Delivery
- **Good:** Metrics spread over > 1000ms
- **Acceptable:** Metrics spread over 500-1000ms
- **Poor:** All metrics arrive in < 500ms (buffered)

## Troubleshooting

### Tests Timeout
- Increase timeout in test file
- Check if servers are running
- Verify network connectivity

### Memory Tests Fail
- Run with `--expose-gc` flag
- Close other applications
- Increase iteration count for better accuracy

### Slow Network Tests Fail
- Check anti-buffering headers
- Verify no reverse proxy buffering
- Test with actual network throttling tools

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run Performance Tests
  run: |
    npm run dev &
    sleep 10
    npm run test:performance
    npm run benchmark:streaming
```

### Performance Regression Detection
Monitor these metrics over time:
- Time to first metric (P50, P95, P99)
- Time to 80% metrics (P50, P95, P99)
- Memory growth per connection
- Total duration comparison

## Advanced Testing

### Network Throttling
Use browser DevTools or proxy tools for realistic network conditions:

**Chrome DevTools:**
1. Open DevTools → Network tab
2. Select "Slow 3G" or "Fast 3G"
3. Run tests manually

**Proxy Tools:**
- Charles Proxy
- Fiddler
- Network Link Conditioner (macOS)

### Load Testing
Test with multiple concurrent connections:
```bash
# Run 10 concurrent benchmarks
for i in {1..10}; do
  npm run benchmark:streaming &
done
wait
```

### Browser Compatibility
Test in different browsers:
- Chrome/Edge (Chromium)
- Firefox
- Safari
- Mobile browsers

## Metrics Collection

### Logging
All tests log detailed metrics to console:
- Timing information
- Memory snapshots
- Error counts
- Progressive delivery analysis

### Export Results
Redirect output to file for analysis:
```bash
npm run benchmark:streaming > results.txt
npm run test:memory-leaks > memory-results.txt
```

## Contributing

When adding new performance tests:
1. Follow existing test structure
2. Include clear requirements
3. Add timeout handling
4. Document expected results
5. Update this README

## References

- [Spec Requirements](.kiro/specs/dashboard-streaming/requirements.md)
- [Technical Design](.kiro/specs/dashboard-streaming/design.md)
- [Implementation Tasks](.kiro/specs/dashboard-streaming/tasks.md)
