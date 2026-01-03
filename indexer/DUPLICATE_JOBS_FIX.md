# Duplicate Jobs Issue - Analysis & Fix

## Problem Identified
The hybrid indexer was creating duplicate backfill jobs for the same contracts, causing:
- Unnecessary resource consumption
- Multiple jobs processing the same data simultaneously
- Potential database conflicts and inefficiency

## Evidence from Logs
Multiple duplicate jobs were observed:
- **Contract 383**: Job 1533 and Job 122
- **Contract 387**: Job 1557 and Job 133  
- **Contract 15**: Job 104 and Job 142
- **Contract 79**: Job 1091 and Job 14

## Root Causes

### 1. Race Condition
- Multiple sync cycles could create jobs before the first job updates contract status
- The 15-second poll interval allowed multiple job creation attempts

### 2. Incomplete Status Checking
- Only checked for existing jobs in `'pending'` or `'processing'` status
- Didn't account for contracts already in `'in_progress'` status
- Gap between job creation and contract status update

### 3. No Duplicate Prevention
- No mechanism to clean up existing duplicates
- No proactive duplicate detection

## Fixes Implemented

### 1. Enhanced Duplicate Detection
```typescript
// BEFORE: Only checked job queue
const existingJob = await pool.query(`
  SELECT id FROM job_queue 
  WHERE job_type = 'backfill' AND contract_id = $1 AND status IN ('pending', 'processing')
`);

// AFTER: Check both job queue AND contract status
const existingJob = await pool.query(`...`);
const contractInProgress = await pool.query(`
  SELECT id FROM contracts 
  WHERE id = $1 AND backfill_status = 'in_progress'
`);
```

### 2. Proactive Cleanup
- Added `cleanupDuplicateJobs()` method that runs before each sync cycle
- Uses SQL window functions to identify and cancel duplicate jobs
- Keeps the oldest job for each contract (most likely to be valid)

### 3. Better Logging
- Added skip messages when duplicates are detected
- Shows which jobs are being skipped and why

## Database Cleanup

### Manual Cleanup (One-time)
Run the provided SQL script to clean up existing duplicates:
```bash
psql -d your_database -f cleanup-duplicate-jobs.sql
```

### Automatic Cleanup (Ongoing)
The enhanced indexer now automatically cleans up duplicates on each sync cycle.

## Expected Results

### Immediate Benefits
- No more duplicate jobs being created
- Existing duplicates will be cleaned up automatically
- Reduced resource consumption

### Performance Improvements
- Faster job processing (no competing jobs)
- Cleaner job queue monitoring
- More accurate progress reporting

### Monitoring
- Clear log messages when duplicates are detected and cleaned
- Better visibility into job creation decisions

## Files Modified
- `indexer/src/hybrid-indexer.ts`
  - Enhanced duplicate detection logic
  - Added `cleanupDuplicateJobs()` method
  - Improved logging for job creation decisions

## Testing
1. The enhanced code has been compiled successfully
2. Run the indexer and monitor logs for duplicate cleanup messages
3. Verify that only one job exists per contract in the job queue
4. Check that backfill progress is more consistent and efficient

## Monitoring Commands
```sql
-- Check for remaining duplicates
SELECT contract_id, COUNT(*) as job_count
FROM job_queue 
WHERE job_type = 'backfill' AND status IN ('pending', 'processing')
GROUP BY contract_id
HAVING COUNT(*) > 1;

-- Monitor job queue status
SELECT status, COUNT(*) as count
FROM job_queue 
WHERE job_type = 'backfill'
GROUP BY status;
```