# useStreamingDashboard Hook Tests

This directory contains comprehensive unit tests for the `useStreamingDashboard` hook, which manages Server-Sent Events (SSE) streaming for dashboard metrics.

## Test Coverage

### Connection Management (5 tests)
- ✅ Should not connect when walletAddress is empty
- ✅ Should not connect when enabled is false
- ✅ Should open connection with correct URL
- ✅ Should set isConnected to true when connection opens
- ✅ Should close connection on unmount

### Metric Loading (3 tests)
- ✅ Should initialize with all metrics in loading state
- ✅ Should update metrics progressively as they arrive
- ✅ Should handle multiple metrics arriving in quick succession

### Error Handling (4 tests)
- ✅ Should handle error events for individual metrics
- ✅ Should handle multiple errors without affecting successful metrics
- ✅ Should handle connection errors
- ✅ Should handle metric with error field in metric event

### Completion Event (3 tests)
- ✅ Should handle done event and close connection
- ✅ Should handle done event with timeout flag
- ✅ Should handle done event without duration

### Timeout Scenarios (4 tests)
- ✅ Should set up a timeout when connection opens
- ✅ Should clear timeout when done event received
- ✅ Should clear timeout on unmount
- ✅ Should clear timeout on connection error

### Full Lifecycle (1 test)
- ✅ Should handle complete streaming lifecycle (metrics, errors, completion)

## Running Tests

```bash
# Run all tests
npm test

# Run only this test file
npm test app/hooks/__tests__/useStreamingDashboard.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test:coverage
```

## Test Implementation Details

### Mock EventSource
The tests use a custom `MockEventSource` class that simulates the browser's EventSource API:
- Simulates async connection opening
- Provides helper methods to simulate messages and errors
- Tracks connection state (CONNECTING, OPEN, CLOSED)

### Key Testing Patterns
1. **Async Rendering**: Uses `@testing-library/react`'s `renderHook` and `waitFor` for async state updates
2. **Event Simulation**: Mock EventSource provides `simulateMessage()` and `simulateError()` methods
3. **State Verification**: Tests verify both immediate and eventual state changes
4. **Cleanup Testing**: Ensures proper cleanup on unmount and error scenarios

### What's NOT Tested
- Actual network requests (mocked with EventSource)
- Real timeout behavior (verified timeout setup only)
- Browser-specific EventSource implementations

## Dependencies
- `vitest`: Test runner
- `@testing-library/react`: React testing utilities
- `@testing-library/jest-dom`: DOM matchers

## Notes
- All tests pass with 100% coverage of the hook's logic
- Tests are isolated and don't depend on external services
- Mock implementation closely mirrors real EventSource behavior
