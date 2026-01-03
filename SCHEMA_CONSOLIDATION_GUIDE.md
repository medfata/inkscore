# Schema Consolidation Guide

This guide walks you through consolidating your confusing database schema into a clean, maintainable structure.

## 🎯 Overview

Your current schema has **multiple duplicate and confusing tables**:

### Contract Models (4 → 1)
- ✅ `contracts` (Main)
- ❌ `contracts_metadata` → **MERGE**
- ❌ `contracts_to_index` → **MERGE**  
- ❌ Static `CONTRACTS_TO_INDEX` → **MIGRATE**

### Transaction Models (4 → 1)
- ✅ `transaction_details` (Main - most important)
- ❌ `transactions` → **MERGE**
- ❌ `volume_transactions` → **MERGE**
- ❌ `benchmark_transactions` → **MERGE**

### Indexer Cursor Models (7 → 1)
- ✅ `tx_indexer_cursors` (Main)
- ❌ `fast_tx_indexer_cursors` → **MERGE**
- ❌ `hybrid_tx_indexer_cursors` → **MERGE**
- ❌ `indexer_cursors` → **MERGE**
- ❌ `indexer_ranges` → **MERGE**
- ❌ `tx_indexer_ranges` → **MERGE**
- ❌ `volume_indexer_ranges` → **MERGE**

## 🚀 Migration Process

### Phase 1: Contract Consolidation
```bash
# Consolidates all contract tables into unified contracts table
tsx indexer/scripts/run-consolidation-migration.ts --phase=1
```

**What it does:**
- Adds missing columns to `contracts` table
- Migrates data from `contracts_metadata` and `contracts_to_index`
- Migrates static contracts from `config.ts`
- Updates indexing progress from cursor tables
- Preserves all data integrity

### Phase 2: Transaction Consolidation
```bash
# Consolidates all transaction tables into transaction_details
tsx indexer/scripts/run-consolidation-migration.ts --phase=2
```

**What it does:**
- Migrates unique data from `transactions`, `volume_transactions`, `benchmark_transactions`
- Updates `transaction_details` with more complete data where available
- Creates compatibility views for backward compatibility
- Preserves all transaction data

### Phase 3: Cursor Consolidation
```bash
# Consolidates all cursor/range tables into tx_indexer_cursors
tsx indexer/scripts/run-consolidation-migration.ts --phase=3
```

**What it does:**
- Migrates cursor data from experimental indexer tables
- Consolidates range progress into `contracts` table
- Updates final progress state
- Creates compatibility views

### Phase 4: Final Cleanup (DESTRUCTIVE)
```bash
# ⚠️ WARNING: This drops all deprecated tables permanently
tsx indexer/scripts/run-consolidation-migration.ts --phase=4
```

**What it does:**
- Drops all deprecated tables
- Removes compatibility views
- Cleans up orphaned sequences
- Optimizes remaining tables

## 🛡️ Safety Features

### Dry Run Mode
```bash
# See what would happen without making changes
tsx indexer/scripts/run-consolidation-migration.ts --dry-run
```

### Backup Recommendation
Before running Phase 4, create a backup:
```bash
pg_dump $DATABASE_URL > consolidation_backup.sql
```

### Rollback Plan
If something goes wrong:
```bash
# Restore from backup
psql $DATABASE_URL < consolidation_backup.sql
```

## 📝 Code Updates Required

After running the migrations, update your code:

### 1. Replace Contract Service
```bash
# Replace the old service
mv lib/services/contracts-service.ts lib/services/contracts-service-old.ts
mv lib/services/contracts-service-updated.ts lib/services/contracts-service.ts
```

### 2. Replace Indexer Contract Functions
```bash
# Replace the old indexer functions
mv indexer/src/db/contracts.ts indexer/src/db/contracts-old.ts
mv indexer/src/db/contracts-updated.ts indexer/src/db/contracts.ts
```

### 3. Replace Admin API Routes
```bash
# Replace the old admin routes
mv app/api/admin/contracts/route.ts app/api/admin/contracts/route-old.ts
mv app/api/admin/contracts/route-updated.ts app/api/admin/contracts/route.ts
```

### 4. Update Indexer References
Remove references to old tables in:
- `indexer/src/index-v2.ts` (already uses consolidated approach)
- Any custom queries in your services
- Admin dashboard components

## 🧪 Testing Checklist

After consolidation, test these areas:

### ✅ Contract Management
- [ ] Admin can view all contracts
- [ ] Admin can create new contracts
- [ ] Admin can update contract metadata
- [ ] Indexing status displays correctly
- [ ] Contract categories work

### ✅ Transaction Data
- [ ] Transaction details display correctly
- [ ] Analytics queries work
- [ ] Wallet stats calculate properly
- [ ] USD volume calculations work

### ✅ Indexer Operations
- [ ] Indexer can start/stop contracts
- [ ] Progress tracking works
- [ ] Cursor management functions
- [ ] Error handling works

### ✅ Admin Dashboard
- [ ] Contract list loads
- [ ] Indexing progress displays
- [ ] Statistics are accurate
- [ ] Platform associations work

## 📊 Expected Results

### Before Consolidation
```
📊 Current Schema: ~40 tables
❌ 4 contract tables (confusing)
❌ 4 transaction tables (duplicate data)
❌ 7 cursor tables (experimental mess)
❌ Multiple sources of truth
❌ Inconsistent APIs
```

### After Consolidation
```
✅ Clean Schema: ~25 tables
✅ 1 contract table (unified)
✅ 1 transaction table (complete)
✅ 1 cursor table (reliable)
✅ Single source of truth
✅ Consistent APIs
```

## 🚨 Troubleshooting

### Migration Fails
1. Check database permissions
2. Ensure no active connections during Phase 4
3. Verify backup exists before Phase 4
4. Check logs for specific error details

### Data Missing After Migration
1. Check if migration completed successfully
2. Verify data in main tables (`contracts`, `transaction_details`)
3. Check compatibility views if old code still running
4. Restore from backup if needed

### Performance Issues
1. Run `ANALYZE` on main tables
2. Check if indexes were created properly
3. Monitor query performance
4. Add additional indexes if needed

## 🎉 Benefits After Consolidation

1. **Simplified Development**: One table per concept
2. **Better Performance**: No more complex JOINs across duplicate tables
3. **Easier Maintenance**: Clear data ownership
4. **Consistent APIs**: All services use same data source
5. **Better Admin UI**: Single interface for contract management
6. **Reduced Confusion**: No more "which table should I use?"

## 📞 Support

If you encounter issues:
1. Check the migration logs
2. Verify your backup exists
3. Test with `--dry-run` first
4. Run phases incrementally
5. Keep the old service files until fully tested

---

**Ready to clean up your schema? Start with Phase 1! 🚀**