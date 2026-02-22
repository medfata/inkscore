# InkDCA Metric Implementation

## Overview
Added a new metric for tracking DCA (Dollar Cost Averaging) runs on the InkDCA platform with a dashboard card display.

## Details
- **Platform**: InkDCA
- **Logo**: https://inkdca.com/ink_dca_logo.png
- **Website**: https://inkdca.com
- **Contract Address**: 0x4286643d9612515F487c2F3272845bc53Ca80705
- **Function Name**: runDCA
- **Metric Type**: Count-based (tracks number of DCA executions)

## Files Modified

### 1. api-server/src/routes/analytics.ts
- Added InkDCA contract address and function constants
- Added special handler for `inkdca_run_dca` metric
- Queries `transaction_details` table for transactions matching the contract and function

### 2. app/api/[wallet]/dashboard/route.ts
- Added InkDCA metric to consolidated dashboard API
- Fetches data from `/api/analytics/${walletAddress}/inkdca_run_dca`
- Returns data in `inkdcaRunDca` field

### 3. app/components/Dashboard.tsx
- Added `inkdcaRunDca` to `ConsolidatedDashboardResponse` interface
- Added state variable for InkDCA metric
- Added processing logic in `processConsolidatedResponse`
- Added state clearing in `refreshAllData`
- Added InkDCA to `PLATFORM_URLS` constant
- **Added InkDCA dashboard card in Row 5** with:
  - Emerald color theme
  - Platform logo from inkdca.com
  - Display of total DCA runs
  - Breakdown showing "Dollar Cost Averaging" status and "Automated Buys" count
  - "Smart DCA Investor" badge when runs > 0
  - Loading skeleton UI
  - Demo mode support

## Dashboard Card Features

The InkDCA card displays:
- **Main Metric**: Total number of DCA runs executed
- **Strategy Section**: Shows DCA status (Active/Inactive) and automated buy count
- **Badge**: "Smart DCA Investor" badge appears when user has executed DCA runs
- **Styling**: Emerald theme (border-emerald-500/20, bg-emerald-500/5)
- **Animation**: Fade-in animation with 1.05s delay
- **Responsive**: Part of the 4-column grid layout in Row 5

## How It Works

1. **Data Collection**: The indexer collects transactions from the InkDCA contract (0x4286643d9612515F487c2F3272845bc53Ca80705)

2. **Metric Calculation**: The analytics API counts all successful transactions where:
   - Contract address matches InkDCA contract
   - Function name is "runDCA"
   - Transaction status is 1 (successful)
   - Wallet address matches the queried wallet

3. **API Response**: Returns a count of DCA runs with this structure:
   ```json
   {
     "slug": "inkdca_run_dca",
     "name": "DCA Runs",
     "icon": "https://inkdca.com/ink_dca_logo.png",
     "currency": "COUNT",
     "total_count": 5,
     "total_value": "5",
     "sub_aggregates": [],
     "last_updated": "2024-01-01T00:00:00.000Z"
   }
   ```

4. **Dashboard Display**: The metric is displayed in a dedicated card in Row 5 of the dashboard, showing:
   - Total DCA runs count
   - Strategy status (Active when runs > 0)
   - Automated buys count
   - Smart investor badge

## Testing

Test the metric by calling:
```
GET /api/analytics/{wallet_address}/inkdca_run_dca
```

Or view it in the consolidated dashboard:
```
GET /api/{wallet_address}/dashboard
```

The card will automatically appear on the dashboard for all users and will show real data when the wallet has executed DCA runs on InkDCA.
