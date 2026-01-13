# Concurrent Gap Enrichment

High-performance concurrent transaction enrichment using multiple CPU cores for maximum throughput.

## 🚀 Architecture

### Multi-Process Design
- **Main Process**: Coordinates work distribution and monitors workers
- **Worker Processes**: Each handles batches of transactions independently  
- **Batch Distribution**: Ensures no overlap between workers
- **Auto-Scaling**: Uses 75% of available CPU cores (2-8 workers)

### Your System
- **CPU Cores**: 8 cores detected
- **Workers**: 6 concurrent processes (75% utilization)
- **Expected Speedup**: ~6x faster than sequential processing

## 📊 Performance Comparison

| Method | Speed | Use Case |
|--------|-------|----------|
| **Sequential** | 2.8 tx/s | Small gaps (<1K transactions) |
| **Batch Optimized** | 11.3 tx/s | Medium gaps (1K-10K transactions) |
| **Concurrent** | ~68 tx/s | Large gaps (10K+ transactions) |

### Expected Processing Times
- **68K transactions** (Relay Bridging): ~17 minutes (vs 6+ hours sequential)
- **1K transactions**: ~15 seconds
- **10K transactions**: ~2.5 minutes

## 🔧 Usage

### Quick Start
```bash
# Check what will be processed
npm run concurrent-enrich -- --dry-run

# Process all contracts with concurrent workers
npm run concurrent-enrich

# Process specific contract
npm run concurrent-enrich -- --contract=0xf70da97812cb96acdf810712aa562db8dfa3dbef

# Use custom number of workers
npm run concurrent-enrich -- --workers=4
```

### Advanced Options
```bash
# Dry run for specific contract
npm run concurrent-enrich -- --contract=0xef684c38f94f48775959ecf2012d7e864ffb9dd4 --dry-run

# Maximum performance (use all cores)
npm run concurrent-enrich -- --workers=8

# Conservative (use fewer resources)
npm run concurrent-enrich -- --workers=2
```

## 🎯 How It Works

### 1. Work Distribution
```
Contract: 68,173 missing transactions
├── Batch 1: Offset 0-499    → Worker 1
├── Batch 2: Offset 500-999  → Worker 2  
├── Batch 3: Offset 1000-1499 → Worker 3
├── Batch 4: Offset 1500-1999 → Worker 4
├── Batch 5: Offset 2000-2499 → Worker 5
└── Batch 6: Offset 2500-2999 → Worker 6
```

### 2. Worker Lifecycle
1. **Spawn**: Main process creates worker processes
2. **Assign**: Each worker gets a batch of 500 transactions
3. **Process**: Worker fetches from API and inserts to DB
4. **Report**: Worker sends results back to main process
5. **Reassign**: Worker gets next batch or terminates

### 3. Coordination
- **No Conflicts**: Each worker processes different transaction ranges
- **Progress Tracking**: Main process monitors all workers
- **Fault Tolerance**: Failed workers are restarted automatically
- **Graceful Shutdown**: All workers terminate cleanly on Ctrl+C

## 📈 Performance Features

### Optimizations
- **Batch API Calls**: 25 transactions per API batch per worker
- **Batch DB Inserts**: Single INSERT for entire worker batch
- **Rate Limiting**: 150ms delays to respect API limits
- **Retry Logic**: 3 attempts with exponential backoff
- **Connection Pooling**: Each worker has its own DB connection

### Monitoring
```
📈 Progress: 45/137 batches (32.8%), 6 active workers
✅ [Worker-1] Batch 12 complete: +487 success, 13 failed
✅ [Worker-2] Batch 15 complete: +500 success, 0 failed
📦 [Worker-3] Assigned batch 46: offset 22500, size 500
```

## 🛡️ Safety Features

### Worker Management
- **Timeout Detection**: Workers that take >5 minutes are restarted
- **Error Handling**: Failed batches are retried with new workers
- **Resource Cleanup**: All processes terminate cleanly
- **Database Safety**: Uses `ON CONFLICT` to handle duplicates

### Graceful Shutdown
- **SIGINT/SIGTERM**: Handles Ctrl+C and system shutdown
- **Worker Termination**: Sends SIGTERM, then SIGKILL if needed
- **Database Cleanup**: Closes all connections properly
- **Progress Preservation**: Completed work is saved

## 🔍 Monitoring & Debugging

### Real-Time Progress
The script shows detailed progress information:
- Batch completion rates
- Worker assignments
- Processing speeds per worker
- Overall progress percentage

### Log Analysis
```bash
# Worker output format
[Worker-1] Processing batch 5 (offset 2000)
✅ [Worker-1] Batch 5 complete: +487 success, 13 failed

# Progress updates
📈 Progress: 25/137 batches (18.2%), 6 active workers

# Final summary
📊 Concurrent Processing Complete
   Workers: 6 concurrent processes
   Processed: 68,173 transactions
   Duration: 17.2 minutes
   Rate: 66.1 tx/s
   Speedup: ~6x vs sequential
```

## 🚨 Troubleshooting

### Common Issues

**Workers not starting:**
```bash
# Check if TypeScript is compiled
npm run build

# Verify worker script exists
ls dist/scripts/gap-enrichment-worker.js
```

**Slow performance:**
- Check database indexes on `tx_hash` and `contract_address`
- Monitor API rate limiting (429 errors)
- Reduce worker count if system is overloaded

**Memory issues:**
- Reduce batch size in worker (default: 500)
- Use fewer workers (`--workers=2`)
- Monitor system memory usage

### Performance Tuning

**For faster processing:**
```bash
# Use more workers (if system can handle it)
npm run concurrent-enrich -- --workers=8

# Increase batch size (edit worker script)
# Change apiBatchSize from 25 to 50
```

**For system stability:**
```bash
# Use fewer workers
npm run concurrent-enrich -- --workers=2

# Increase delays (edit worker script)
# Change rateLimitDelay from 150 to 300
```

## 📋 Comparison with Other Methods

| Feature | Sequential | Batch | Concurrent |
|---------|------------|-------|------------|
| **Speed** | 2.8 tx/s | 11.3 tx/s | ~68 tx/s |
| **CPU Usage** | Single core | Single core | Multi-core |
| **Memory** | Low | Low | Medium |
| **Complexity** | Simple | Medium | High |
| **Best For** | Small gaps | Medium gaps | Large gaps |
| **Fault Tolerance** | Basic | Good | Excellent |

## 🎉 Expected Results

For your **71,641 missing transactions**:

**Sequential (old method):**
- Time: ~7 hours
- CPU: 12.5% (1 core)
- Rate: 2.8 tx/s

**Concurrent (new method):**
- Time: ~18 minutes  
- CPU: 75% (6 cores)
- Rate: ~66 tx/s
- **Speedup: 23x faster!**

The concurrent approach will complete your entire backlog in under 20 minutes instead of 7+ hours!