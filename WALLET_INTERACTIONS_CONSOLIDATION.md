# Wallet Interactions Consolidation

## Overview
This consolidation removes the `wallet_interactions` table and uses `transaction_details` as the single source of truth for all transaction data, eliminating data duplication between the two tables.

## Problem Solved
- **Data Duplication**: Both tables stored the same core transaction data (tx_hash, wallet_address, contract_address, function_selector, function_name, block_number, block_timestamp, status, chain_id)
- **Query Complexity**: Services had to decide which table to use and sometimes JOIN between them
- **Storage Waste**: Duplicate data across two tables
- **Maintenance Overhead**: Two tables to manage, index, and optimize

## Solution
Use `transaction_details` as the single source of truth:
- **COUNT_TX contracts** (event-based): Store basic data with financial fields as NULL/0
- **USD_VOLUME contracts**: Store complete data including financial information
- **Unified queries**: All services use the same table
- **Better performance**: Single table with optimized indexes

## Files Modified

### Services (lib/services/)
- ✅ `analytics-service.ts` - Removed table selection logic, uses only transaction_details
- ✅ `points-service.ts` - Updated platform points query to use transaction_details
- ✅ `platforms-service.ts` - Updated wallet stats query to use transaction_details  
- ✅ `contracts-service.ts` - Updated contract stats query to use transaction_details
- ✅ `metrics-service.ts` - Updated function discovery to use only transaction_details

### Indexers (indexer/src/)
- ✅ `txIndexer.ts` - Removed wallet_interactions inserts, uses only transaction_details
- ✅ `manual-index.ts` - Updated to insert directly into transaction_details
- ✅ `db/migrate.ts` - Updated to create only transaction_details table with optimized indexes
- ✅ `scripts/reset-cursor.ts` - Removed wallet_interactions cleanup

### Database
- ✅ `migrations/011_consolidate_wallet_interactions.sql` - Migration script to consolidate data
- ✅ `scripts/run-consolidation-migration.ts` - Script to execute the migration

## Migration Process

### 1. Run the Migration
```bash
cd indexer
npx tsx scripts/run-consolidation-migration.ts
```

### 2. What the Migration Does
1. **Data Migration**: Moves all wallet_interactions data to transaction_details where it doesn't exist
2. **Data Enrichment**: Updates missing wallet_address and function data in transaction_details
3. **Index Optimization**: Creates optimized indexes for both count and volume queries
4. **Cleanup**: Drops wallet_interactions table and related indexes

### 3. New Indexes Created
- `idx_td_wallet_contract_status` - Primary query pattern
- `idx_td_contract_status` - Platform stats
- `idx_td_wallet_contract_function` - Function-specific queries
- `idx_td_contract_block` - Indexer progress tracking
- `idx_td_function_name` - Function discovery
- `idx_td_contract_function_name` - Contract function analysis

## Query Changes

### Before (Analytics Service)
```sql
-- Had to choose table and sometimes JOIN
SELECT COUNT(*) FROM wallet_interactions WHERE ...
-- OR
SELECT SUM(eth_value) FROM transaction_details WHERE ...
-- OR
SELECT COUNT(*) FROM wallet_interactions wi 
LEFT JOIN transaction_details td ON td.tx_hash = wi.tx_hash WHERE ...
```

### After (Analytics Service)
```sql
-- Single table for everything
SELECT COUNT(*) FROM transaction_details WHERE ...
-- OR  
SELECT SUM(CAST(eth_value AS NUMERIC) / 1e18) FROM transaction_details WHERE ...
```

## Benefits

### Performance
- **Faster queries**: No more JOINs between wallet_interactions and transaction_details
- **Better indexes**: Optimized for both count and volume queries
- **Reduced storage**: Eliminated duplicate data

### Maintainability  
- **Single source of truth**: All transaction data in one place
- **Simplified logic**: No more table selection in services
- **Easier debugging**: One table to check for transaction data

### Scalability
- **Future-proof**: Can handle any new requirements without schema changes
- **Consistent data**: No risk of data inconsistency between tables
- **Unified analytics**: All metrics calculated from the same dataset

## Verification

After migration, verify:

1. **Row counts match**: transaction_details should have all data from both tables
2. **Services work**: All API endpoints return correct data
3. **Indexes exist**: New optimized indexes are created
4. **Performance**: Queries are as fast or faster than before

## Rollback Plan

If needed, the migration can be rolled back by:
1. Recreating wallet_interactions table
2. Populating it from transaction_details
3. Reverting service code changes

However, this should not be necessary as the consolidation is backwards compatible and improves performance.