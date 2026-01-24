# Deployment Files Checklist

Complete list of files that need to be copied to your remote server for the new enrichment architecture.

## 🔧 **Core Service Files (Required)**

```bash
# Main service files
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\services\PureEventDrivenEnrichmentService.ts root@77.42.41.78:/root/indexer/src/services/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\event-driven-enrichment-service.ts root@77.42.41.78:/root/indexer/src/

# Database setup
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\db\setup-enrichment-triggers.sql root@77.42.41.78:/root/indexer/src/db/

# Docker configuration
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\docker-compose.yml root@77.42.41.78:/root/indexer/

# Package configuration
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\package.json root@77.42.41.78:/root/indexer/
```

## 📊 **Gap Enrichment Scripts (Optional but Recommended)**

```bash
# Concurrent gap enrichment (for large backlogs)
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\scripts\concurrent-gap-enrichment.ts root@77.42.41.78:/root/indexer/src/scripts/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\scripts\gap-enrichment-worker.ts root@77.42.41.78:/root/indexer/src/scripts/

# Improved gap enrichment (single-threaded)
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\scripts\enrich-missing-transactions.ts root@77.42.41.78:/root/indexer/src/scripts/

# Verification script
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\scripts\verify-enrichment-gaps.ts root@77.42.41.78:/root/indexer/src/scripts/
```

## 🔄 **Updated Core Services (If You Want Them)**

```bash
# Streamlined real-time service (optional - old one still works)
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\services\VolumeEnrichmentService.ts root@77.42.41.78:/root/indexer/src/services/

# Updated test files (optional)
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\services\__tests__\EnrichmentService.functional.test.ts root@77.42.41.78:/root/indexer/src/services/__tests__/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\services\__tests__\VolumeEnrichmentService.test.ts root@77.42.41.78:/root/indexer/src/services/__tests__/
```

## 📚 **Documentation (Optional)**

```bash
# Documentation files
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\OPTIMIZED_ENRICHMENT.md root@77.42.41.78:/root/indexer/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\CONCURRENT_ENRICHMENT.md root@77.42.41.78:/root/indexer/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\DEPLOYMENT_GUIDE.md root@77.42.41.78:/root/indexer/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\GAP_ENRICHMENT.md root@77.42.41.78:/root/indexer/
```

## 🎯 **Minimal Deployment (Just the Essentials)**

If you want to deploy just the core changes:

```bash
# Essential files only
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\services\PureEventDrivenEnrichmentService.ts root@77.42.41.78:/root/indexer/src/services/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\event-driven-enrichment-service.ts root@77.42.41.78:/root/indexer/src/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\src\db\setup-enrichment-triggers.sql root@77.42.41.78:/root/indexer/src/db/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\docker-compose.yml root@77.42.41.78:/root/indexer/
scp -i C:\Users\medfa\.ssh\id_ed25519 .\indexer\package.json root@77.42.41.78:/root/indexer/
```

## 🚀 **Deployment Steps After File Copy**

```bash
# SSH into your server
ssh -i C:\Users\medfa\.ssh\id_ed25519 root@77.42.41.78

# Navigate to indexer directory
cd /root/indexer

# Install database triggers (one-time setup)
psql $DATABASE_URL -f src/db/setup-enrichment-triggers.sql

# Build the new code
npm run build

# Stop old enrichment service
docker-compose stop indexer-enrichment

# Start new event-driven service
docker-compose up -d indexer-enrichment

# Monitor logs
docker-compose logs -f indexer-enrichment
```

## ⚠️ **Important Notes**

1. **Database Triggers**: Must be installed once with the SQL file
2. **Docker Service**: Will automatically use the new event-driven service
3. **Backward Compatibility**: Old services still work if you don't want to update
4. **Gap Processing**: Use concurrent script for any existing backlogs

## 🔍 **Verification Commands**

```bash
# Check if triggers are installed
psql $DATABASE_URL -c "SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_new_volume_transaction';"

# Check service status
docker-compose ps indexer-enrichment

# Check for any gaps
npm run verify-gaps

# Process any large backlogs (if needed)
npm run concurrent-enrich
```