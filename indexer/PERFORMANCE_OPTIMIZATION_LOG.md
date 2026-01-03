# Database Performance Optimization - Hybrid Indexer

## Issue Identified
The hybrid indexer was getting stuck during CSV processing, specifically when saving large transaction datasets (500k+ transactions) to the `transaction_details` table. The bottleneck was in the database insertion process.

## Root Cause
The original `batchInsertTransactions` method was inserting transactions **one by one** in a loop, which is extremely inefficient for large datasets:

```typescript
// OLD - INEFFICIENT METHOD
for (const tx of transactions) {
  await client.query(insertQuery, [tx.tx_hash, tx.wallet_address, ...]);
}
```

For a CSV with 500,000 transactions, this meant 500,000 individual database queries!

## Performance Improvements Implemented

### 1. Bulk Insert Optimization
- **Before**: Individual INSERT queries (1 query per transaction)
- **After**: Bulk INSERT with VALUES clause (1 query per 1,000 transactions)
- **Improvement**: ~1000x reduction in database round trips

### 2. Batch Processing
- Process transactions in chunks of 1,000 to avoid memory issues
- Each batch is processed as a single bulk INSERT query
- Progress logging every batch for visibility

### 3. Enhanced Logging
Added comprehensive logging to track:
- **CSV Parsing Progress**: Log every 50k rows parsed
- **Database Insertion Progress**: Log each batch of 1k transactions
- **Memory Usage**: Track heap and RSS memory before/after processing
- **File Sizes**: Log ZIP and CSV file sizes
- **Performance Metrics**: Parse rate, insertion rate, batch timing

### 4. Memory Management
- Clean up CSV files after processing to save disk space
- Force garbage collection after each batch (if available)
- Memory usage monitoring to detect memory leaks

## Expected Performance Gains

### Database Insertion Speed
- **Before**: ~100-500 transactions/second (individual queries)
- **After**: ~5,000-15,000 transactions/second (bulk inserts)
- **Improvement**: 10-30x faster database insertion

### Memory Efficiency
- Batch processing prevents loading entire CSV into memory
- Automatic cleanup of temporary files
- Garbage collection after each batch

### Monitoring & Debugging
- Real-time progress tracking during CSV parsing
- Detailed timing for each processing stage
- Memory usage monitoring to identify bottlenecks
- File size logging to understand data volumes

## New Log Output Format

```
📊 [CSV] Starting to parse CSV file: csv_exports/abc123.csv
📈 [CSV] Parsed 50,000 rows (8,500 rows/s)
📈 [CSV] Parsed 100,000 rows (9,200 rows/s)
✅ [CSV] Parsed 269,348 transactions in 32.1s

💾 [DB] Starting database insertion of 269,348 transactions...
🔄 [DB] Processing 270 transactions in batches of 1,000...
📦 [DB] Processing batch 1/270 (1,000 transactions)...
✅ [DB] Batch 1/270 completed in 0.8s (1,250 tx/s)
📊 [DB] Progress: 0.4% (1,000/269,348)
...
🎉 [DB] Successfully processed 269,348 transactions
✅ [DB] Inserted 269,348 transactions in 45.2s (5,958 tx/s)
```

## Files Modified
- `indexer/src/services/BackfillService.ts`
  - Enhanced `parseAndStoreTransactions()` with progress logging
  - Completely rewrote `batchInsertTransactions()` for bulk operations
  - Added memory monitoring to `processBatch()`

## Next Steps
1. Run the optimized indexer and monitor the new logs
2. Analyze performance metrics to identify any remaining bottlenecks
3. Consider additional optimizations based on real-world performance data

## Testing
The optimized code has been compiled successfully. Ready for testing with the hybrid indexer.