#!/bin/bash

# Hybrid Indexer Startup Script
# Ensures proper initialization and migration before starting

set -e

echo "🚀 Starting Hybrid Indexer..."

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL environment variable is required"
    exit 1
fi

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
until pg_isready -d "$DATABASE_URL" > /dev/null 2>&1; do
    echo "   Database not ready, waiting..."
    sleep 2
done

echo "✅ Database connection established"

# Check if hybrid migration has been run
echo "🔍 Checking migration status..."
MIGRATION_CHECK=$(psql "$DATABASE_URL" -t -c "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_queue');" 2>/dev/null || echo "f")

if [ "$MIGRATION_CHECK" = " f" ]; then
    echo "📋 Running hybrid migration..."
    psql "$DATABASE_URL" -f /app/src/db/migrate-hybrid.sql
    echo "✅ Migration completed"
else
    echo "✅ Migration already applied"
fi

# Create CSV exports directory
mkdir -p /app/csv_exports
echo "📁 CSV exports directory ready"

# Start the hybrid indexer
echo "🎯 Starting Hybrid Indexer..."
exec node dist/hybrid-indexer.js