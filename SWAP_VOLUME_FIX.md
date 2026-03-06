# Swap Volume Calculation Fix

## Problem
The swap endpoint was not properly tracking different ERC20 tokens with varying decimals, leading to incorrect USD volume calculations. The system was missing many stablecoin swaps because it didn't recognize tokens like USDT0, USDG, etc.

## Solution
Updated the `parseSwapVolumeFromLogs` function in `api-server/src/routes/backup_wallet.ts` to:

1. **Expanded Token Registry**: Added comprehensive token information including:
   - USDT0 (6 decimals, USD-pegged)
   - USDG (18 decimals, USD-pegged)
   - GHO (18 decimals, USD-pegged)
   - USDC (6 decimals, USD-pegged)
   - axlUSDC (6 decimals, USD-pegged)
   - WETH (18 decimals, ETH-priced)

2. **Proper Decimal Handling**: Each token now uses its correct decimal places:
   - 6 decimals for USDT, USDC variants
   - 18 decimals for USDG, GHO, WETH

3. **USD Conversion Logic**:
   - USD-pegged stablecoins: Direct 1:1 conversion
   - ETH-based tokens: Multiply by current ETH price
   - Unknown tokens: Assume 18 decimals and ETH price (fallback)

4. **First Transfer Event Priority**: The function now correctly extracts the swap amount from the first Transfer event in the logs array, which represents the token being swapped.

## Example Transaction
Transaction: `0x7092223cd423547fe152b07110dc6f0f5db12818396d3bf99c7a3839f2e00913`

**Before Fix**: Would have missed or miscalculated the USDT0 swap

**After Fix**: 
- Correctly identifies USDT0 token (0x0200C29006150606B650577BBE7B6248F58470c1)
- Parses amount: 99,996,730 (raw) → 99.99673 (with 6 decimals)
- Converts to USD: $100.00 (USD-pegged stablecoin)

## Code Changes

### Token Registry
```typescript
const SWAP_TOKEN_INFO: Record<string, { decimals: number; usdPegged?: boolean; symbol?: string }> = {
    '0x0200c29006150606b650577bbe7b6248f58470c1': { decimals: 6, usdPegged: true, symbol: 'USDT0' },
    '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { decimals: 18, usdPegged: true, symbol: 'USDG' },
    // ... more tokens
};
```

### Enhanced Parsing Logic
```typescript
function parseSwapVolumeFromLogs(logs: SwapLog[], ethPriceUsd: number = 3500): number {
    // 1. Find Transfer events
    // 2. Get token address and amount from log data
    // 3. Look up token info (decimals, USD-pegged status)
    // 4. Convert to USD based on token type
    // 5. Return maximum USD value found
}
```

## Adding New Tokens
To add support for a new token, simply add it to the `SWAP_TOKEN_INFO` object:

```typescript
'0xTOKEN_ADDRESS_HERE': { 
    decimals: 18,           // Token decimals (6 or 18 typically)
    usdPegged: true,        // true for stablecoins, omit for ETH-based tokens
    symbol: 'TOKEN_SYMBOL'  // Optional, for logging
}
```

## Impact
- ✅ Accurate swap volume tracking for all supported tokens
- ✅ Proper handling of different decimal places (6 vs 18)
- ✅ Correct USD conversion for stablecoins
- ✅ Better logging for debugging
- ✅ Fallback handling for unknown tokens
- ✅ Simple, maintainable code without external API dependencies

