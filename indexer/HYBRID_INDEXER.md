# Hybrid Indexer

The new optimized indexing system that combines fast CSV-based historical backfill with real-time transaction sync.

## 🚀 Quick Start

### Using Docker (Recommended)

1. **Start the database:**
   ```bash
   docker-compose up -d postgres
   ```

2. **Run migration (first time only):**
   ```bash
   docker-compose --profile setup run migrate-hybrid
   ```

3. **Start the hybrid indexer:**
   ```bash
   docker-compose up -d indexer
   ```

4. **Check logs:**
   ```bash
   docker-compose logs -f indexer
   ```

### Manual Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the project:**
   ```bash
   npm run build
   ```

3. **Run migration:**
   ```bash
   npm run db:migrate:hybrid
   ```

4. **Start the indexer:**
   ```bash
   npm run start
   ```

## 📊 Performance

- **Historical Backfill**: 500K transactions in ~87 seconds
- **Volume Enrichment**: 25 transactions/batch at 66 req/sec
- **Real-time Sync**: Paginated API for new transactions

## 🏗️ Architecture

### Contract Types
- **Count Contracts**: Simple transaction counting, fast indexing
- **Volume Contracts**: Full enrichment with USD values, token amounts

### Services
- **BackfillService**: CSV export-based historical data import
- **VolumeEnrichmentService**: Transaction enrichment with optimal batching
- **JobQueueService**: Background job processing with retry logic

### Job Types
- `backfill`: Historical data import via CSV exports
- `enrich`: Volume data enrichment for detailed metrics
- `realtime_sync`: Real-time transaction synchronization

## 🔧 Configuration

Environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `RPC_URL`: Blockchain RPC endpoint
- `POLL_INTERVAL_MS`: Polling interval (default: 15000)

## 📈 Monitoring

### Job Queue Status
```sql
SELECT job_type, status, COUNT(*) 
FROM job_queue 
GROUP BY job_type, status;
```

### Contract Status
```sql
SELECT contract_type, backfill_status, enrichment_status, COUNT(*) 
FROM contracts 
GROUP BY contract_type, backfill_status, enrichment_status;
```

### Progress Tracking
```sql
SELECT name, backfill_progress, enrichment_progress, 
       indexed_transactions, total_transactions
FROM contracts 
WHERE fetch_transactions = true;
```

## 🔄 Migration from Old Indexer

1. **Stop old indexer:**
   ```bash
   docker-compose --profile legacy down
   ```

2. **Run hybrid migration:**
   ```bash
   docker-compose --profile setup run migrate-hybrid
   ```

3. **Start new indexer:**
   ```bash
   docker-compose up -d indexer
   ```

## 🐛 Troubleshooting

### Check indexer logs:
```bash
docker-compose logs -f indexer
```

### Check database connection:
```bash
docker-compose exec postgres psql -U ink -d ink_analytics -c "SELECT NOW();"
```

### Restart services:
```bash
docker-compose restart indexer
```

### Reset job queue (if needed):
```sql
TRUNCATE job_queue RESTART IDENTITY;
```

## 📝 Adding New Contracts

Use the enhanced contract creation form in the admin panel:

1. Select contract type (Count or Volume)
2. Enter contract creation date
3. System will estimate transaction count and backfill time
4. Backfill job will be automatically queued

## ⚡ Performance Tuning

### Batch Sizes
- **CSV Export**: 500K transactions per batch (API limit)
- **Enrichment**: 25 transactions per batch (optimal for your machine)
- **Rate Limiting**: 100ms delay between enrichment batches

### Job Priorities
- `realtime_sync`: Priority 1 (highest)
- `enrich`: Priority 3 (medium)
- `backfill`: Priority 5 (normal)

## 🔒 Security

- All API calls use proper headers and rate limiting
- Database connections use connection pooling
- Job queue includes retry logic with exponential backoff
- CSV files are stored in isolated volume