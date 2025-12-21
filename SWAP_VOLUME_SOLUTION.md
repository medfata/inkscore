# Swap Volume Tracking Solution

## Problem
The "Swap Volume (USD)" metric was only capturing ETH-to-Token swaps where the value is in `tx.value`, but missing Token-to-ETH swaps where the amount is passed as a function argument.

### Example Transactions:
1. **swapExactETHForTokens** - ✅ Captured (value in `tx.value` = 100000000000000 wei)
2. **swapExactTokensForETH** - ❌ Missed (value in `amountIn` argument = 0x148163)

## Solution
Extended the analytics service to decode swap function parameters and extract token amounts from the transaction input data.

### Changes Made

#### 1. Added SWAP_FUNCTIONS Configuration
Defined all DyorSwap router functions with their parameter structure:

```typescript
const SWAP_FUNCTIONS: Record<string, { 
  amountIndex: number; 
  pathIndex: number; 
  isExactInput: boolean;
  abi: string;
}> = {
  'swapExactTokensForETH': { ... },
  'swapExactTokensForETHSupportingFeeOnTransferTokens': { ... },
  'swapExactTokensForTokens': { ... },
  'swapExactTokensForTokensSupportingFeeOnTransferTokens': { ... },
  'swapExactETHForTokens': { ... },
  'swapExactETHForTokensSupportingFeeOnTransferTokens': { ... },
  'swapETHForExactTokens': { ... },
  'swapTokensForExactETH': { ... },
  'swapTokensForExactTokens': { ... },
};
```

#### 2. Created getSwapUsdValues() Method
New method that:
- Fetches transaction input data from RPC
- Decodes function parameters using viem
- Extracts the swap path to identify input token
- Gets token price (from known tokens, CoinGecko, or assumes stablecoin)
- Calculates USD value: `(amount / 10^decimals) * tokenPrice`

#### 3. Updated Query Logic
Modified `queryMetricForWallet()` to:
- Detect swap functions in the metric configuration
- Call `getSwapUsdValues()` for swap transactions
- Merge USD values from both `tx.value` and decoded parameters
- Aggregate totals correctly

### How It Works

For **swapExactTokensForETH** transaction:
```
Input: 0x791ac947
  000000000000000000000000000000000000000000000000000000000014816300...
  
Decoded:
  amountIn: 1344867 (0x148163)
  path: [USDT0, WETH]
  
Calculation:
  Token: USDT0 (6 decimals, $1 USD)
  Amount: 1344867 / 10^6 = 1.344867 USDT
  USD Value: 1.344867 * $1 = $1.34
```

For **swapExactETHForTokens** transaction:
```
tx.value: 100000000000000 wei

Calculation:
  Amount: 100000000000000 / 10^18 = 0.0001 ETH
  USD Value: 0.0001 * $3,500 = $0.35
```

### Supported Functions

The solution now handles ALL DyorSwap router functions:

**Token → ETH:**
- swapExactTokensForETH
- swapExactTokensForETHSupportingFeeOnTransferTokens
- swapTokensForExactETH

**Token → Token:**
- swapExactTokensForTokens
- swapExactTokensForTokensSupportingFeeOnTransferTokens
- swapTokensForExactTokens

**ETH → Token:**
- swapExactETHForTokens
- swapExactETHForTokensSupportingFeeOnTransferTokens
- swapETHForExactTokens

### Token Price Resolution

The system resolves token prices in this order:
1. **Known Tokens** (USDT0, USDC, WETH) - Hardcoded prices
2. **CoinGecko API** - For tokens with coingeckoId
3. **Symbol Detection** - Detects stablecoins by symbol (USD*, DAI, FRAX)
4. **Fallback** - Returns 0 for unknown tokens (logs warning)

### Performance Considerations

- **Batching**: Fetches transactions in batches of 10 to avoid RPC overload
- **Caching**: Token prices cached for 5 minutes
- **Error Handling**: Gracefully handles decode failures and continues

### Testing

To verify the fix works:

1. Check a wallet with Token→ETH swaps:
```bash
curl http://localhost:3000/api/analytics/wallet/0xD0C0AdE59C0c277D078216d57860486f5B4402A9
```

2. Look for the "swap_volume" metric - it should now include:
   - Total count of ALL swap transactions
   - USD value from BOTH ETH and token swaps
   - Sub-aggregates by function showing each swap type

### Future Improvements

1. **DEX Price Oracle**: Integrate with on-chain DEX for real-time token prices
2. **Historical Prices**: Use price at transaction time instead of current price
3. **Multi-hop Swaps**: Track intermediate tokens in complex swap paths
4. **Slippage Tracking**: Compare expected vs actual amounts received

## Conclusion

The metric now accurately tracks the total USD volume of ALL swap types on the DyorSwap router, not just ETH-based swaps. This provides a complete picture of user trading activity.
