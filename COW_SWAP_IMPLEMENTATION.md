# Cow Swap Metric Implementation

## Overview
Successfully implemented the Cow Swap metric with USD conversion following the established pattern for InkScore dashboard metrics.

## Implementation Details

### 1. Backend (api-server/src/routes/analytics.ts)

#### Added Configuration
- Hardcoded token metadata for all 33 tokens on Ink chain (from CoinGecko)
- Configuration includes: symbol, decimals, and name for each token
- API base URL: `https://api.cow.fi/ink/api/v1`
- Page size: 100 orders per request

#### Handler Logic (`cowswap_swaps` metric)
The handler implements the following workflow:

1. **Pagination Loop**
   - Fetches orders from Cow Swap API with offset/limit pagination
   - Continues until receiving less than 100 orders (indicating last page)
   - Accumulates all orders across pages

2. **Filtering Valid Swaps**
   - Filters orders where `status === "fulfilled"`
   - Filters orders where `invalidated === false`

3. **Price Fetching from DeFi Llama**
   - Collects unique token addresses from all valid swaps
   - Fetches current USD prices from DeFi Llama API (batch query):
     - Endpoint: `https://coins.llama.fi/prices/current/{coins}`
     - Format: `ink:0xaddress1,ink:0xaddress2,...`
     - Returns: `{ coins: { "ink:0xaddress": { price: number } } }`
   - Maps prices to lowercase addresses for lookup
   - DeFi Llama is used instead of CoinGecko for better Ink chain support

4. **USD Conversion Formula**
   For each order:
   ```
   USD Value = (executedAmount / 10^decimals) × tokenPrice
   ```
   
   Where:
   - `executedAmount`: Raw BigInt from order (executedSellAmount or executedBuyAmount)
   - `decimals`: Token decimals from hardcoded metadata
   - `tokenPrice`: Current USD price from CoinGecko API

5. **Decimal Normalization & USD Calculation**
   - For each valid swap, extracts sell token and buy token addresses
   - Looks up token metadata from hardcoded configuration
   - Prioritizes sell token amount (`executedSellAmount`)
   - Falls back to buy token amount (`executedBuyAmount`) if sell token unavailable
   - Normalizes raw BigInt amounts using token decimals: `amount / 10^decimals`
   - Multiplies normalized amount by token's USD price from DeFi Llama
   - Handles missing prices gracefully (defaults to $0)

6. **Aggregation**
   - Calculates total USD value across all swaps
   - Creates breakdown by token symbol with:
     - Token symbol
     - Total USD value (2 decimal precision)
     - Number of swaps per token
   - Sorts breakdown by USD value (descending)

7. **Response Format**
```typescript
{
  slug: 'cowswap_swaps',
  name: 'Cow Swap',
  icon: 'https://swap.cow.fi/favicon-dark-mode.png',
  currency: 'USD',
  total_count: number,        // Total number of valid swaps
  total_value: string,        // Total USD value (2 decimals)
  sub_aggregates: [           // Breakdown by token
    {
      token: string,          // Token symbol
      usd_value: string,      // USD value (2 decimals)
      count: number           // Number of swaps
    }
  ],
  last_updated: Date
}
```

8. **Caching**
   - Results are cached using the existing `responseCache` mechanism
   - Cache key: `analytics:cowswap_swaps:{wallet_address}`

9. **Error Handling**
   - Returns empty result ($0.00) on API errors
   - Logs errors to console for debugging
   - Gracefully handles missing token metadata
   - Handles DeFi Llama API failures (uses $0 for missing prices)

### 2. Consolidated Dashboard API (app/api/[wallet]/dashboard/route.ts)

Added Cow Swap to the parallel fetch array:
- Fetches from `/api/analytics/${walletAddress}/cowswap_swaps`
- Included in `Promise.all` for optimal performance
- Added to response object as `cowswapSwaps`

### 3. Frontend (app/components/Dashboard.tsx)

#### TypeScript Interface
Added to `ConsolidatedDashboardResponse`:
```typescript
cowswapSwaps: { 
  total_count?: number; 
  total_value?: string;
  sub_aggregates?: Array<{
    token: string;
    usd_value: string;
    count: number;
  }>;
} | null;
```

#### State Management
- Added `cowswapSwaps` state variable
- Added to `processConsolidatedResponse` function
- Added to `refreshAllData` function (clears state on refresh)

#### Platform URL
- Added `'cowswap': 'https://swap.cow.fi'` to `PLATFORM_URLS`

#### Dashboard Card
Created a new card with:
- **Header**: Cow Swap logo (dark mode) with link to swap.cow.fi
- **Main Metric**: Total USD value with $ prefix and 2 decimal formatting
- **Breakdown Section**: 
  - Shows top 5 tokens by USD value
  - Displays USD value with $ prefix and 2 decimal precision
  - Shows swap count per token
  - Scrollable if more than 5 tokens
- **Active Badge**: "Active Swapper" when swaps > 0
- **Loading State**: Skeleton UI while fetching
- **Demo Mode**: Shows $0.00 placeholder
- **Styling**: Blue theme (`border-blue-500/20`, `bg-blue-500/5`)
- **Animation**: Fade-in with 1.15s delay

## Key Features

### USD Conversion
1. **Real-time Pricing**: Fetches current token prices from DeFi Llama API
2. **Accurate Calculation**: Properly normalizes decimals before price multiplication
3. **Multi-token Support**: Handles all 33 tokens on Ink chain
4. **Batch Queries**: Single API call to get all token prices
5. **Fallback Handling**: Uses $0 for tokens without available prices

### Performance Optimizations
1. **Hardcoded Token Metadata**: Eliminates need to fetch from CoinGecko on every request
2. **Batch Price Fetching**: Single API call to get all token prices from DeFi Llama
3. **Response Caching**: Reduces API calls to both Cow Swap and DeFi Llama
4. **Parallel Fetching**: Dashboard loads all metrics simultaneously
5. **Pagination Handling**: Efficiently fetches all orders regardless of count

### Data Accuracy
1. **Decimal Normalization**: Correctly handles different token decimals (6, 8, 18)
2. **Status Filtering**: Only counts fulfilled, non-invalidated swaps
3. **Token Fallback**: Uses buy token if sell token unavailable
4. **Current Prices**: Uses live market prices for accurate USD values

### User Experience
1. **USD Display**: Clear monetary value instead of raw token amounts
2. **Token Breakdown**: Shows which tokens were swapped and their USD values
3. **Scrollable List**: Handles many tokens gracefully
4. **Loading States**: Clear feedback during data fetch
5. **Error Resilience**: Gracefully handles API failures

## Testing

Build completed successfully:
```
✓ API Server TypeScript: No errors
✓ Next.js build: Compiled with warnings in 15.6s
✓ Finished TypeScript in 29.1s
✓ Generating static pages using 7 workers (38/38) in 8.0s
```

No TypeScript errors or build failures related to the implementation.

## Files Modified

1. `api-server/src/routes/analytics.ts` - Added Cow Swap handler with USD conversion
2. `app/api/[wallet]/dashboard/route.ts` - Added to consolidated API
3. `app/components/Dashboard.tsx` - Added UI card with USD display and state management

## API Endpoints

- **Metric Endpoint**: `GET /api/analytics/:wallet/cowswap_swaps`
- **Dashboard Endpoint**: `GET /api/:wallet/dashboard` (includes cowswapSwaps)
- **DeFi Llama Price API**: `GET https://coins.llama.fi/prices/current/{coins}`

## External Dependencies

- **Cow Swap API**: `https://api.cow.fi/ink/api/v1` - Order data
- **DeFi Llama API**: `https://coins.llama.fi` - Token prices (better Ink chain support than CoinGecko)

## Next Steps

To deploy:
1. Ensure API server has network access to both `api.cow.fi` and `coins.llama.fi`
2. Test with real wallet addresses that have Cow Swap activity
3. Monitor API response times and adjust caching if needed
4. Consider implementing price caching to reduce DeFi Llama API calls
5. DeFi Llama has no strict rate limits (more reliable than CoinGecko)
