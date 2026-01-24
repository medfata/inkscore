# Analytics System

This is the dynamic analytics system for InkScore. It allows admins to configure metrics that aggregate blockchain data for user wallets.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ADMIN PANEL                              │
│  /admin - Configure metrics, contracts, functions               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ANALYTICS METRICS                           │
│  - Bridge Volume (USD)                                          │
│  - GM Interactions (Count)                                      │
│  - Swap Volume (USD)                                            │
│  - InkyPump Activity (Count by Function)                        │
│  - Tydro DeFi (USD)                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SYNC WORKER                                │
│  Runs every 5-15 seconds, incrementally updates cache           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  USER ANALYTICS CACHE                           │
│  Pre-computed per-user per-metric aggregations                  │
│  Sub-aggregates by contract and function                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      USER API                                   │
│  GET /api/analytics/:wallet - Instant response (<50ms)          │
└─────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Environment Variables

Add to your `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host:5432/ink_analytics
CRON_SECRET=your-secret-key  # Optional: for securing cron endpoint
SYNC_INTERVAL_MS=15000       # Optional: sync interval in ms (default: 15000)
```

### 2. Run Database Migration

```bash
# Connect to your database and run:
psql -U ink -d ink_analytics -f lib/migrations/001_analytics_schema.sql
```

### 3. Sync Historical ETH Prices

```bash
curl -X POST http://localhost:3000/api/prices/eth/sync?days=90
```

### 4. Start the Sync Worker

Option A: Via API (for serverless/Vercel):
- Set up a cron job to call `GET /api/cron/sync` every 15 seconds

Option B: As a background process:
```bash
npx ts-node --esm lib/workers/sync-worker.ts
```

## API Endpoints

### Admin APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/contracts` | List all indexed contracts |
| GET | `/api/admin/contracts/:address` | Get contract details |
| GET | `/api/admin/contracts/:address/functions` | Get functions for contract |
| POST | `/api/admin/contracts` | Create/update contract |
| GET | `/api/admin/metrics` | List all metrics |
| GET | `/api/admin/metrics/:id` | Get metric details |
| POST | `/api/admin/metrics` | Create new metric |
| PUT | `/api/admin/metrics/:id` | Update metric |
| DELETE | `/api/admin/metrics/:id` | Delete metric |
| POST | `/api/admin/metrics/:id/rebuild` | Rebuild cache for metric |
| POST | `/api/admin/sync` | Trigger sync for all metrics |

### User APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/:wallet` | Get all metrics for wallet |
| GET | `/api/analytics/:wallet/:metric` | Get specific metric for wallet |

### Price APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prices/eth` | Get current ETH price |
| POST | `/api/prices/eth/sync` | Sync historical prices |

### Cron APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cron/sync` | Trigger sync (for cron jobs) |

## Creating a Metric

1. Go to `/admin`
2. Click "Create Metric"
3. Fill in:
   - **Slug**: Unique identifier (e.g., `bridge_volume`)
   - **Name**: Display name (e.g., `Bridge Volume (USD)`)
   - **Aggregation Type**:
     - `count`: Simple count of transactions
     - `sum_eth_value`: Sum ETH values and convert to USD
     - `count_by_function`: Count grouped by function name
   - **Currency**: `COUNT`, `ETH`, or `USD`
4. Select contracts to track
5. Select functions to filter (optional)
6. Save

## Example Metrics Configuration

### Bridge Volume (USD)
- Aggregation: `sum_eth_value`
- Currency: `USD`
- Contracts: RelayDepository, GasZipV2
- Functions: `deposit`

### GM Interactions
- Aggregation: `count`
- Currency: `COUNT`
- Contracts: DailyGM
- Functions: `gm`, `gmTo`

### InkyPump Activity
- Aggregation: `count_by_function`
- Currency: `COUNT`
- Contracts: InkyPump (ERC1967Proxy)
- Functions: `createToken`, `buyToken`, `sellToken`, `boost`

### Tydro DeFi (USD)
- Aggregation: `sum_eth_value`
- Currency: `USD`
- Contracts: WrappedTokenGatewayV3
- Functions: `depositETH`, `borrowETH`

## Response Format

```json
{
  "wallet_address": "0x...",
  "metrics": [
    {
      "slug": "bridge_volume",
      "name": "Bridge Volume (USD)",
      "icon": "bridge",
      "currency": "USD",
      "total_count": 12,
      "total_value": "15420.50",
      "sub_aggregates": [
        {
          "contract_address": "0x4cd00e387622c35bddb9b4c962c136462338bc31",
          "contract_name": "RelayDepository",
          "count": 10,
          "eth_value": "4.5",
          "usd_value": "15000.00",
          "by_function": {
            "deposit": {
              "count": 10,
              "eth_value": "4.5",
              "usd_value": "15000.00"
            }
          }
        }
      ],
      "last_updated": "2024-12-19T10:30:00Z"
    }
  ]
}
```

## Performance

- API response time: <50ms (cached data)
- Sync interval: 5-15 seconds (configurable)
- Full rebuild: ~5-10 minutes per metric (depends on data volume)
