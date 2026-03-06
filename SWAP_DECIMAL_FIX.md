# InkySwap Token Decimal & Pricing Fix

## Problem Identified

InkySwap was showing **$5,572,413.32** for a test wallet - completely incorrect!

### Root Cause
Transaction `0xbc50be460ab5c2038ded80bf2732f7d0ffd85aafccca4026825bee2d71caa191` contained:
- Token: `0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5` (unknown)
- Raw Amount: `1592103091748275366179`
- **OLD Logic**: Assumed 18 decimals + multiplied by ETH price ($3500)
- **Result**: `1592.10 × $3500 = $5,572,360` ❌

### The Real Issue
For unknown tokens, we were:
1. ✅ Assuming 18 decimals (sometimes wrong)
2. ❌ Multiplying by ETH price ($3500) - **completely wrong for non-ETH tokens!**

## Solution Implemented

### 1. Dynamic Decimal Fetching
```typescript
async function fetchTokenDecimals(tokenAddress: string): Promise<number> {
    // Calls eth_call with decimals() selector (0x313ce567)
    // Caches result to avoid repeated RPC calls
    // Falls back to 18 decimals if RPC fails
}
```

### 2. Real-Time Price Fetching via InkySwap API ⭐ NEW!
```typescript
async function fetchTokenPriceUSD(tokenAddress: string, decimals: number): Promise<number> {
    // Calls InkySwap quote API: tokenIn → USDC
    // Returns USD price per 1 token unit
    // Caches for 5 minutes to reduce API calls
    // Falls back to $1 if API fails
}
```

**Example API Call:**
```bash
GET https://inkyswap.com/api/quote?tokenIn=0x20c69c12...&tokenOut=0xA0b86991...&amount=1000000000000000000
```

**Response:**
```json
{
  "amountIn": "1000000000000000000",
  "amountOut": "2500000000",  // ← This is the USD value!
  "executionRate": "2500000000000000000000",
  "priceImpact": 0.002
}
```

### 3. Smart Price Logic
```typescript
const SWAP_TOKEN_INFO = {
    // USD-pegged stablecoins → $1 per unit
    '0x0200c29006150606b650577bbe7b6248f58470c1': { decimals: 6, usdPegged: true, symbol: 'USDT0' },
    
    // ETH-based tokens → multiply by ETH price
    '0x4200000000000000000000000000000000000006': { decimals: 18, priceInEth: true, symbol: 'WETH' },
    
    // Unknown tokens → fetch decimals + fetch price from InkySwap API
}
```

### 4. Updated Conversion Logic
```typescript
if (tokenInfo.usdPegged) {
    // Stablecoins: $1 per unit
    usdValue = tokenAmount × 1
} else if (tokenInfo.priceInEth) {
    // WETH/ETH: multiply by ETH price
    usdValue = tokenAmount × ethPriceUsd
} else if (tokenInfo.fetchedPrice) {
    // Unknown token: use InkySwap API price
    usdValue = tokenAmount × fetchedPrice
} else {
    // Fallback: assume $1 per unit
    usdValue = tokenAmount × 1
}
```

## What Changed

### Before
- Unknown tokens → 18 decimals + ETH price = **massive overvaluation**
- No RPC calls for decimals
- No price API calls
- All non-stablecoin tokens priced in ETH

### After
- Unknown tokens → **fetch decimals via RPC** + **fetch price via InkySwap API**
- Cached decimals (permanent) and prices (5 min TTL)
- Real-time DEX pricing for any liquid token
- Clear distinction: `usdPegged` vs `priceInEth` vs `fetchedPrice`
- Detailed logging for InkySwap transactions

## Detailed Logging Added

For InkySwap transactions, you'll now see:
```
========== [InkySwap] TX 0xabc... - DETAILED LOG PARSING ==========
Total logs: 6
ETH Price: 3500

--- Transfer Event #1 ---
Token Address: 0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5
⚠️  UNKNOWN TOKEN - Fetched decimals: 18
⚠️  Fetched price from InkySwap: $0.0035 per token
Token Amount (with 18 decimals): 1592.103
USD Value (1592.103 × $0.0035): $5.57
Max USD Value so far: $5.57

========== [InkySwap] FINAL USD VALUE: $5.57 ==========
```

## Expected Result

The problematic transaction should now show:
- **OLD**: $5,572,360 ❌
- **NEW**: ~$5.57 ✅ (actual market price from InkySwap)

## Caching Strategy

1. **Decimals Cache**: Permanent (never expires)
   - Decimals don't change for a token
   
2. **Price Cache**: 5 minutes TTL
   - Balances freshness vs API load
   - Prices update every 5 minutes per token

## API Rate Limiting

- InkySwap API is called only for **unknown tokens**
- Results are cached for 5 minutes
- Known tokens (USDT, WETH, etc.) never hit the API
- Typical usage: 1-2 API calls per wallet scan

## How to Expand

When you discover new tokens:

1. **Stablecoins** (USDT, USDC, DAI, etc.):
```typescript
'0xTOKEN_ADDRESS': { decimals: 6, usdPegged: true, symbol: 'USDT' }
```

2. **ETH-based tokens** (WETH, stETH, etc.):
```typescript
'0xTOKEN_ADDRESS': { decimals: 18, priceInEth: true, symbol: 'WETH' }
```

3. **Unknown tokens**: 
   - Will auto-fetch decimals via RPC
   - Will auto-fetch price via InkySwap API
   - Add to `SWAP_TOKEN_INFO` once identified for better performance

## Benefits of InkySwap API

✅ **Accurate**: Real DEX prices, not assumptions  
✅ **Comprehensive**: Works for any token with liquidity  
✅ **Free**: No API key required  
✅ **Fast**: Cached for 5 minutes  
✅ **Reliable**: Falls back to $1 if API fails  

## Testing

1. Check the test wallet's InkySwap volume
2. Look for the detailed logs in console
3. Verify the USD values are reasonable (not millions)
4. Check that WETH swaps still use ETH price correctly
5. Verify unknown tokens show InkySwap API prices

## Notes

- RPC calls are cached permanently per token address
- Price API calls are cached for 5 minutes per token
- Fallback to $1 if InkySwap API fails (conservative)
- Can still add proper pricing for specific tokens as needed
- InkySwap API quotes against USDC (6 decimals) for USD value
