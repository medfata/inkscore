# Enrichment Service - Real-Time Only

The enrichment service has been streamlined to handle **only real-time transactions**. Backlog processing is now handled by the dedicated gap enrichment script.

## 🎯 New Architecture

### Real-Time Enrichment Service
- **Purpose**: Enrich new transactions as they arrive (last 5 minutes)
- **Performance**: Batch API calls + batch DB inserts
- **Frequency**: Checks every 30 seconds
- **Scope**: Volume contracts only

### Gap Enrichment Script  
- **Purpose**: Handle historical backlogs and missed transactions
- **Performance**: 10x faster with batch processing
- **Usage**: Run manually or scheduled
- **Scope**: All missing transactions

## 📊 Performance Improvements

**Before (Old Service):**
- Complex backlog handling
- Individual DB inserts (1600ms per transaction)
- Expensive queries to find missing transactions
- Mixed real-time and backlog processing

**After (New Service):**
- Real-time only (last 5 minutes)
- Batch DB inserts (11ms per transaction)
- Simple timestamp-based queries
- Dedicated gap script for backlogs

## 🚀 Benefits

1. **Faster Real-Time Processing**: No backlog interference
2. **Better Resource Usage**: Lighter queries, batch operations
3. **Simpler Logic**: Single responsibility principle
4. **Scalable**: Gap script can handle any backlog size
5. **Reliable**: Real-time service won't get stuck on large backlogs

## 🔧 Usage

**Real-Time Service (Docker):**
```bash
docker-compose up indexer-enrichment
```

**Gap Processing (Manual):**
```bash
npm run gap-enrich -- --dry-run    # Check gaps
npm run gap-enrich                  # Process all gaps
npm run verify-gaps                 # Verify results
```