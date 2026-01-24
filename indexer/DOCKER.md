# Docker Setup for Ink Indexer

## Quick Start

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file with your settings:**
   ```bash
   # Set your database password
   DB_PASSWORD=your_secure_password_here
   ```

3. **Start both database and indexer:**
   ```bash
   docker-compose up -d
   ```

4. **Check logs:**
   ```bash
   # View indexer logs
   docker-compose logs -f indexer
   
   # View database logs
   docker-compose logs -f postgres
   ```

5. **Stop services:**
   ```bash
   docker-compose down
   ```

## Services

- **postgres**: PostgreSQL 16 database on port 5432
- **indexer**: Hybrid indexer with CSV backfill + real-time sync

## Volumes

- **postgres_data**: Database storage (persistent)
- **csv_exports**: CSV export files (persistent)

## Environment Variables

- `DB_PASSWORD`: PostgreSQL password (required)
- `RPC_URL`: Ink chain RPC endpoint (optional)
- `POLL_INTERVAL_MS`: Polling interval in milliseconds (default: 15000)

## Notes

- Database migrations should be run locally before using Docker
- The indexer will automatically connect to the database once it's ready
- CSV exports are stored in a persistent volume
- Both services will restart automatically if they crash