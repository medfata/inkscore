# Deprecated Indexer Files

This directory contains deprecated indexer implementations that have been replaced by the new Hybrid Indexing System.

## Deprecated on: December 29, 2025

## Replaced by:
- `hybrid-indexer.ts` - Main hybrid indexing orchestrator
- `services/BackfillService.ts` - Historical data backfill via CSV exports
- `services/VolumeEnrichmentService.ts` - Transaction enrichment for volume contracts
- `services/JobQueueService.ts` - Background job processing

## Old System Issues:
- Slow paginated API calls for historical data
- No batch processing for large datasets
- Inefficient transaction enrichment
- No job queue for background processing
- Mixed indexing strategies without clear separation

## New System Benefits:
- 500K transactions in ~87 seconds (vs hours with old system)
- Optimal batch processing (25 transactions/batch at 66 req/sec)
- Clear separation between count and volume contracts
- Background job processing with retry logic
- Hybrid approach: CSV exports for historical + paginated API for real-time

## Migration Notes:
- All existing data remains compatible
- New contracts should use the hybrid system
- Old indexer processes should be stopped before starting hybrid indexer

## Files Deprecated:
- All transaction indexers (txIndexer*.ts, volumeIndexer*.ts, etc.)
- Old benchmark and test files
- Legacy indexing entry points (index.ts, index-v2.ts, etc.)

**⚠️ DO NOT DELETE** - These files are kept for reference and potential rollback if needed.