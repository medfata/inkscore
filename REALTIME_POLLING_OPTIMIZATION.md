# Realtime Service Polling Optimization

## Problem Analysis

Based on the realtime service logs, the previous configuration had inefficient polling intervals:

- **10-minute maximum interval** was too long for most contracts
- **Binary approach** (15s active vs 10min inactive) didn't account for medium activity levels
- **DailyGM contract** was getting 15s intervals but only processing 4-16 transactions, could be optimized

## Activity Pattern Analysis

### High Activity Contracts (15s optimal)
- **DailyGM**: 4-16 transactions per poll - very consistent activity
- Contracts with 5+ transactions per poll should stay at 15s

### Medium Activity Contracts (30s optimal)  
- **Usdt0 OFT adapter**: 1 transaction per poll consistently
- **Relay Bridging Wallet server**: 1-7 transactions per poll
- **UniversalRouter (Velodrome)**: 1-5 transactions per poll
- Contracts with 1-4 transactions per poll can use 30s intervals

### Low Activity Contracts (1-2min optimal)
- **Bungee Cross bridgin**: 2-8 transactions every 4-10 minutes
- **TydroPool**: 1 transaction every 8 minutes  
- **Inkypump**: 1 transaction every 10 minutes
- **RelayDepository**: 1 transaction every 2-8 minutes

## Optimization Changes

### New Interval Strategy
1. **15 seconds**: High activity (5+ transactions per poll)
2. **30 seconds**: Medium activity (1-4 transactions per poll)  
3. **60 seconds**: Low activity (0 transactions, first empty poll)
4. **120 seconds**: Maximum interval (multiple consecutive empty polls)

### Benefits
- **Reduced maximum interval**: From 10 minutes to 2 minutes
- **Better resource utilization**: Medium activity contracts get appropriate intervals
- **Faster detection**: Low activity contracts checked every 1-2 minutes instead of 10
- **Maintained performance**: High activity contracts keep 15s intervals

### Expected Impact
- **DailyGM**: May move to 30s intervals (still very responsive)
- **Bridge contracts**: Will be checked every 1-2 minutes instead of 10
- **Overall**: More balanced resource usage across all contracts

## Configuration Details

```typescript
BASE_INTERVAL_MS = 15_000      // 15s for high activity (5+ tx)
MEDIUM_ACTIVITY_INTERVAL = 30_000  // 30s for medium activity (1-4 tx)  
LOW_ACTIVITY_INTERVAL = 60_000     // 1min for first empty poll
MAX_INTERVAL_MS = 120_000          // 2min maximum (down from 10min)
HIGH_ACTIVITY_THRESHOLD = 5        // 5+ transactions = high activity
```

This optimization provides better responsiveness for all contract types while maintaining efficient resource usage.