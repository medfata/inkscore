# Platforms & Points System Implementation

## Overview

This implementation introduces a dynamic platform and points system that replaces the static contract configuration in `config.ts`. The admin can now:

1. **Manage Platforms** - Add/edit third-party dApps (Velodrome, Tydro, etc.)
2. **Manage Contracts** - Dynamically add contracts to be indexed
3. **View Indexing Progress** - See real-time indexing status per contract
4. **Configure Points Rules** - Define scoring rules for metrics
5. **Configure Ranks** - Define ranking tiers based on total points

## Database Schema

### New Tables

| Table | Purpose |
|-------|---------|
| `platforms` | Third-party dApps (name, logo, type) |
| `contracts` | Contracts to index (replaces config.ts) |
| `platform_contracts` | M:N junction (contracts can belong to multiple platforms) |
| `discovered_tokens` | Auto-discovered tokens from tx logs |
| `transaction_token_transfers` | Token transfers extracted from logs |
| `native_metrics` | Built-in metrics (wallet_age, nft_count, etc.) |
| `points_rules` | Admin-defined scoring rules |
| `ranks` | Ranking tiers based on points |
| `wallet_points_cache` | Pre-computed wallet scores |

### Preserved Tables (No Changes)

- `wallet_interactions` - All indexed transaction data ✅
- `transaction_details` - Detailed tx data ✅
- `indexer_ranges` - Backfill progress ✅
- `indexer_cursors` - Legacy cursors ✅
- `bridge_transfers` - Bridge data ✅

## Migration

Run the migration to create new tables and migrate existing data:

```bash
cd indexer
npm run build
npm run db:migrate:v2
```

This will:
1. Create all new tables
2. Migrate `contracts_metadata` → `platforms` + `contracts`
3. Preserve all existing indexed data
4. Seed default ranks and native metrics

## Running the Indexer

### Option 1: V2 Indexer (Database-Driven)

```bash
npm run start:v2
# or for development
npm run dev:v2
```

The V2 indexer:
- Reads contracts from the `contracts` table
- Falls back to `config.ts` if no contracts in database
- Updates indexing progress in real-time
- Supports dynamic contract addition via admin panel

### Option 2: Legacy Indexer

```bash
npm run start
```

Uses static `config.ts` (unchanged behavior).

## API Endpoints

### Admin APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/platforms` | GET, POST | List/create platforms |
| `/api/admin/platforms/[id]` | GET, PUT, DELETE | Manage single platform |
| `/api/admin/platforms/contracts` | GET, POST | List/create contracts |
| `/api/admin/platforms/contracts/[address]` | GET, PUT, DELETE | Manage single contract |
| `/api/admin/points/rules` | GET, POST | List/create points rules |
| `/api/admin/points/rules/[id]` | GET, PUT, DELETE | Manage single rule |
| `/api/admin/points/ranks` | GET, POST | List/create ranks |
| `/api/admin/points/ranks/[id]` | GET, PUT, DELETE | Manage single rank |
| `/api/admin/points/native-metrics` | GET | List native metrics |

### Wallet APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wallet/[address]/score` | GET | Get wallet score and rank |
| `/api/wallet/[address]/score?refresh=true` | GET | Force recalculate score |

## Points Calculation

### Native Metrics

| Metric | Source | Calculation |
|--------|--------|-------------|
| `wallet_age` | Routerscan API | Days since first tx |
| `total_tx` | Routerscan API | Total transaction count |
| `nft_collections` | Routerscan API | NFT count |
| `erc20_tokens` | Routerscan API | Total USD value of tokens |

### Platform Metrics

For each platform, points are calculated based on:
- Transaction count to platform contracts
- USD volume (if available)

### Calculation Modes

| Mode | Description | Example |
|------|-------------|---------|
| `range` | Fixed points for value in range | NFT count 1-3 → 100 pts |
| `per_item` | Points per item in range | Each token $100-999 → 200 pts |
| `threshold` | Points if value >= threshold | Age >= 30 days → 150 pts |
| `multiplier` | Points = value × multiplier | Volume × 0.01 |

### Example Points Rule

```json
{
  "metric_type": "native",
  "native_metric_id": 3,
  "name": "NFT Holdings Points",
  "calculation_mode": "range",
  "ranges": [
    { "min": 1, "max": 3, "points": 100 },
    { "min": 4, "max": 9, "points": 200 },
    { "min": 10, "max": null, "points": 300 }
  ]
}
```

## Default Ranks

| Rank | Min Points | Max Points | Color |
|------|------------|------------|-------|
| New User | 0 | 99 | Gray |
| Active User | 100 | 499 | Green |
| Power User | 500 | 1999 | Blue |
| OG Member | 2000 | 4999 | Purple |
| Ink Legend | 5000 | ∞ | Gold |

## Files Created

### Database
- `indexer/src/db/migrations/006_platforms_points_system.sql`
- `indexer/src/db/contracts.ts`
- `indexer/src/db/token-transfers.ts`
- `indexer/src/db/migrate-v2.ts`

### Types
- `lib/types/platforms.ts`

### Services
- `lib/services/platforms-service.ts`
- `lib/services/points-service.ts`
- `lib/services/tokens-service.ts`

### API Routes
- `app/api/admin/platforms/route.ts`
- `app/api/admin/platforms/[id]/route.ts`
- `app/api/admin/platforms/contracts/route.ts`
- `app/api/admin/platforms/contracts/[address]/route.ts`
- `app/api/admin/points/rules/route.ts`
- `app/api/admin/points/rules/[id]/route.ts`
- `app/api/admin/points/ranks/route.ts`
- `app/api/admin/points/ranks/[id]/route.ts`
- `app/api/admin/points/native-metrics/route.ts`
- `app/api/wallet/[address]/score/route.ts`

### Indexer
- `indexer/src/index-v2.ts`

## Next Steps

1. **Run Migration**: `npm run db:migrate:v2`
2. **Build Indexer**: `npm run build`
3. **Start V2 Indexer**: `npm run start:v2`
4. **Create Admin UI**: Build React components for platform/points management
5. **Add Points Rules**: Configure scoring via admin panel
6. **Test Wallet Scores**: Call `/api/wallet/{address}/score`
