# Dashboard Card + Metric Implementation Guide

This guide walks through implementing a new dashboard card with a custom metric across the full stack.

## Architecture Overview

The dashboard card system consists of:

1. **Database Layer**: PostgreSQL tables storing card definitions, metrics, and cached user data
2. **Backend API (api-server)**: Express.js server that calculates and serves metric data
3. **Frontend Admin**: Next.js admin panel for managing cards and metrics
4. **Frontend Display**: React components that render cards on the user dashboard

## Data Flow

```
User Wallet → Analytics Service → User Analytics Cache → Dashboard API → Frontend Cards
                     ↓
              Metrics Service (defines what to track)
                     ↓
              Transaction Details (raw blockchain data)
```

## Database Schema

### Core Tables

**dashboard_cards** - Card definitions
- `id`, `row` (row3/row4), `card_type` (aggregate/single)
- `title`, `subtitle`, `color`, `display_order`, `is_active`

**dashboard_card_metrics** - Links cards to metrics (many-to-many)
- `card_id`, `metric_id`, `display_order`

**dashboard_card_platforms** - Links cards to platforms for logos (many-to-many)
- `card_id`, `platform_id`, `display_order`

**analytics_metrics** - Metric definitions
- `slug`, `name`, `description`, `aggregation_type`, `currency`
- `value_field`, `is_active`, `display_order`, `icon`

**analytics_metric_contracts** - Which contracts to track for a metric
- `metric_id`, `contract_address`, `include_mode` (include/exclude)

**analytics_metric_functions** - Which functions to track for a metric
- `metric_id`, `function_name`, `function_selector`, `include_mode`

**user_analytics_cache** - Pre-computed user metrics
- `wallet_address`, `metric_id`
- `total_count`, `total_eth_value`, `total_usd_value`
- `sub_aggregates` (JSONB with per-contract/function breakdown)

## Step-by-Step Implementation

### Step 1: Define the Metric (Admin Panel)

Navigate to `/admin` → "Metrics" tab

1. **Create Metric**:
   - Slug: `my-new-metric` (unique identifier)
   - Name: "My New Metric" (display name)
   - Description: What this metric tracks
   - Aggregation Type:
     - `sum_eth_value`: Sum ETH values from transactions
     - `count`: Count number of transactions
     - `count_by_function`: Count by specific function calls
   - Currency: USD, ETH, or COUNT
   - Icon: Optional emoji or icon name

2. **Link Contracts**:
   - Add contract addresses to track
   - Include mode: "include" (track these) or "exclude" (track all except these)

3. **Link Functions** (optional):
   - Add specific function names to track
   - Include mode: "include" or "exclude"
   - Leave empty to track all functions on the contracts

**Example**: Track bridge volume
- Slug: `bridge-volume`
- Name: "Bridge Volume"
- Aggregation: `sum_eth_value`
- Currency: USD
- Contracts: `0x4cd00e387622c35bddb9b4c962c136462338bc31` (RelayDepository)
- Functions: Leave empty (track all)

### Step 2: Backfill User Data (Admin Panel)

Navigate to `/admin` → "Backfill" tab

1. Click "Create Backfill Job"
2. Select your new metric
3. Choose wallet addresses (or leave empty for all)
4. Click "Start Backfill"

This processes historical transactions and populates `user_analytics_cache` table.

### Step 3: Create Dashboard Card (Admin Panel)

Navigate to `/admin` → "Dashboard Cards" tab

1. **Click "+ Add Card"**

2. **Select Row**:
   - Row 3: Large aggregate cards (multi-platform)
   - Row 4: Smaller single-platform cards

3. **Fill Details**:
   - Title: "Bridge Volume"
   - Subtitle: "Total Bridged To Ink Chain" (optional)
   - Color: Choose from purple, cyan, yellow, pink, emerald, blue, orange

4. **Select Platforms**:
   - Choose platforms for logo display
   - Example: Relay, GasZip

5. **Select Metrics**:
   - Choose your new metric (and any others to combine)
   - Multiple metrics will be aggregated together

6. **Save**

The card will appear in the selected row with drag-to-reorder support.

### Step 4: Verify Frontend Display

The card should now appear on the user dashboard at `/` when viewing a wallet.

## API Endpoints

### Public Endpoints

**GET /api/dashboard/cards/:wallet**
- Returns dashboard cards with calculated values for a wallet
- Response: `{ row3: DashboardCardData[], row4: DashboardCardData[] }`
- Cached for performance

### Admin Endpoints

**GET /api/admin/dashboard/cards**
- List all cards with relations

**POST /api/admin/dashboard/cards**
- Create new card
- Body: `{ row, card_type, title, subtitle, color, metric_ids[], platform_ids[] }`

**PUT /api/admin/dashboard/cards/:id**
- Update card
- Body: Same as POST, all fields optional

**DELETE /api/admin/dashboard/cards/:id**
- Delete card

**POST /api/admin/dashboard/cards/reorder**
- Reorder cards within a row
- Body: `{ row, card_ids[] }`

## Backend Services

### MetricsService (`api-server/src/services/metrics-service.ts`)

Manages metric definitions:
- `getAllMetrics()` - Get all metrics with contracts/functions
- `getMetric(idOrSlug)` - Get single metric
- `createMetric(data)` - Create new metric
- `updateMetric(id, data)` - Update metric
- `deleteMetric(id)` - Delete metric
- `getContractFunctions(address)` - Get available functions for a contract

### AnalyticsService (`api-server/src/services/analytics-service.ts`)

Calculates user metrics:
- `getWalletAnalytics(wallet)` - Get all metrics for a wallet
- `getWalletMetric(wallet, slug)` - Get specific metric for a wallet
- Queries `user_analytics_cache` table
- Falls back to real-time calculation if cache miss

### Dashboard Route (`api-server/src/routes/dashboard.ts`)

**GET /api/dashboard/cards/:wallet**
- Fetches active cards
- Loads metrics and platforms for each card
- Queries `user_analytics_cache` for user data
- Aggregates values across multiple metrics
- Calculates per-platform breakdown
- Returns structured response with totals

## Frontend Components

### Admin Components

**DashboardCardsTab** (`app/admin/DashboardCardsTab.tsx`)
- Lists all cards grouped by row
- Drag-and-drop reordering
- Create/edit/delete cards
- Toggle active status

**DashboardCardModal**
- Form for creating/editing cards
- Select row, title, subtitle, color
- Multi-select platforms and metrics

### Display Components

**DynamicDashboardCards** (`app/components/DynamicDashboardCards.tsx`)
- `DynamicCardsCarouselRow3` - Carousel for large cards
- `DynamicCardsCarouselRow4` - Carousel for small cards
- `DashboardCardLarge` - Large card component
- `SmallDashboardCard` - Small card component

**Dashboard** (`app/components/Dashboard.tsx`)
- Main dashboard page
- Fetches cards from API
- Renders carousels for each row

## TypeScript Types

### Dashboard Types (`api-server/src/types/dashboard.ts`)

```typescript
export type DashboardCardRow = 'row3' | 'row4';
export type DashboardCardType = 'aggregate' | 'single';

export interface DashboardCard {
  id: number;
  row: DashboardCardRow;
  card_type: DashboardCardType;
  title: string;
  subtitle: string | null;
  color: string;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardCardData extends DashboardCardWithRelations {
  totalValue: number;
  totalCount: number;
  byPlatform: Array<{
    platform: { id: number; name: string; logo_url: string | null };
    value: number;
    count: number;
  }>;
}
```

### Analytics Types (`api-server/src/types/analytics.ts`)

```typescript
export interface AnalyticsMetric {
  id: number;
  slug: string;
  name: string;
  aggregation_type: 'sum_eth_value' | 'count' | 'count_by_function';
  currency: 'USD' | 'ETH' | 'COUNT';
  // ... other fields
}

export interface UserAnalyticsCache {
  wallet_address: string;
  metric_id: number;
  total_count: number;
  total_eth_value: string;
  total_usd_value: string;
  sub_aggregates: Record<string, SubAggregate>;
}
```

## Advanced: Custom Metric Calculation

If you need custom logic beyond the standard aggregation types:

1. **Extend AnalyticsService**:
   - Add new aggregation type to `analytics_metrics.aggregation_type` enum
   - Implement calculation logic in `queryMetricForWallet()`

2. **Update Database**:
   ```sql
   ALTER TABLE analytics_metrics 
   DROP CONSTRAINT IF EXISTS analytics_metrics_aggregation_type_check;
   
   ALTER TABLE analytics_metrics 
   ADD CONSTRAINT analytics_metrics_aggregation_type_check 
   CHECK (aggregation_type IN ('sum_eth_value', 'count', 'count_by_function', 'your_new_type'));
   ```

3. **Implement Calculation**:
   ```typescript
   case 'your_new_type':
     // Custom query logic
     const result = await query(`
       SELECT ... FROM transaction_details
       WHERE wallet_address = $1 AND ...
     `, [walletAddress]);
     // Process and return
   ```

## Performance Considerations

1. **Caching**:
   - `user_analytics_cache` table stores pre-computed values
   - API responses are cached with `responseCache`
   - Metrics service caches metric definitions

2. **Indexing**:
   - Indexes on `wallet_address`, `metric_id`, `contract_address`
   - Composite indexes for common query patterns

3. **Backfilling**:
   - Run backfill jobs during off-peak hours
   - Process in batches to avoid memory issues
   - Monitor `analytics_sync_cursors` for progress

## Troubleshooting

**Card not showing data**:
- Check if metric is active (`is_active = true`)
- Verify backfill job completed successfully
- Check `user_analytics_cache` for wallet + metric
- Look for errors in API server logs

**Incorrect values**:
- Verify contract addresses are correct (lowercase)
- Check function names match exactly
- Review include/exclude modes
- Re-run backfill if data changed

**Performance issues**:
- Check database indexes
- Monitor cache hit rates
- Consider adding more specific indexes
- Optimize metric queries

## Example: Complete Implementation

Let's create a "DEX Swap Count" metric and card:

### 1. Create Metric (Admin Panel)
- Slug: `dex-swaps`
- Name: "DEX Swaps"
- Aggregation: `count`
- Currency: COUNT
- Contracts: 
  - `0x9b17690de96fcfa80a3acaefe11d936629cd7a77` (DyorSwap)
  - `0x551134e92e537ceaa217c2ef63210af3ce96a065` (InkySwap)
- Functions: `swap`, `swapExactTokensForTokens`, etc.

### 2. Backfill Data
- Create backfill job for `dex-swaps` metric
- Wait for completion

### 3. Create Card
- Row: Row 4 (small card)
- Title: "DEX Swaps"
- Subtitle: "Total Swap Transactions"
- Color: Cyan
- Platforms: DyorSwap, InkySwap
- Metrics: `dex-swaps`

### 4. Verify
- Visit dashboard with a wallet that has swap transactions
- Card should show total count and breakdown by platform

## Next Steps

- Add more metrics for different protocols
- Create aggregate cards combining multiple metrics
- Implement real-time updates via WebSocket
- Add historical charts for metric trends
- Export metric data to CSV

## Resources

- Admin Panel: `/admin`
- API Docs: See route files in `api-server/src/routes/`
- Database Schema: `indexer/src/db/migrations/`
- Frontend Components: `app/components/`
