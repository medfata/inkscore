# Swap Volume Card - Updated to Match Bridge Card UI

## Overview
Updated the Swap Volume card to match the Bridge Volume card's UI design, showing breakdown by DEX platform (DyorSwap, InkySwap, Velodrome) instead of by function type.

## Changes Made

### 1. Added DEX Platform Configuration
```typescript
const DEX_PLATFORMS: Record<string, { name: string; logo: string }> = {
  '0x9b17690de96fcfa80a3acaefe11d936629cd7a77': {
    name: 'DyorSwap',
    logo: 'https://dyorswap.finance/favicon.ico',
  },
  '0x551134e92e537ceaa217c2ef63210af3ce96a065': {
    name: 'InkySwap',
    logo: 'https://inkyswap.com/logo-mobile.svg',
  },
  '0x01d40099fcd87c018969b0e8d4ab1633fb34763c': {
    name: 'Velodrome',
    logo: 'https://velodrome.finance/favicon.ico',
  },
};
```

### 2. Updated Interface Structure
**Before:** Grouped by function name
```typescript
interface SwapVolumeResponse {
  byFunction: Array<{
    functionName: string;
    usdValue: number;
    txCount: number;
  }>;
}
```

**After:** Grouped by platform (matching Bridge card)
```typescript
interface SwapVolumeResponse {
  byPlatform: Array<{
    platform: string;
    contractAddress: string;
    usdValue: number;
    txCount: number;
  }>;
}
```

### 3. Updated Data Fetching Logic
Now extracts platform information from contract addresses:
- Reads `sub_aggregates` from analytics API
- Maps contract addresses to platform names using `DEX_PLATFORMS`
- Groups volume by DEX platform instead of function type

### 4. Updated Card UI

**Header:**
- Changed icon from `Coins` to `ArrowLeftRight` (matching Bridge card)
- Kept cyan color theme for consistency

**Breakdown Section:**
- Changed from "By Type" to "By Platform"
- Shows platform logos (DyorSwap, InkySwap, Velodrome)
- Displays platform name with logo
- Shows USD value and transaction count per platform
- Identical layout to Bridge card

**Example Display:**
```
┌─────────────────────────┐
│ ⇄ Swap Volume      USD  │
├─────────────────────────┤
│ $8,750.00      156      │
│ Total Swapped  Swaps    │
├─────────────────────────┤
│ By Platform             │
│ 🦉 DyorSwap             │
│    $5,230.00  (98 txs)  │
│ 🎨 InkySwap             │
│    $2,520.00  (42 txs)  │
│ 🏎️ Velodrome            │
│    $1,000.00  (16 txs)  │
├─────────────────────────┤
│ • Active Trader         │
└─────────────────────────┘
```

### 5. Platform Logos
Each DEX platform displays its favicon:
- **DyorSwap:** `https://dyorswap.finance/favicon.ico`
- **InkySwap:** `https://inkyswap.com/logo-mobile.svg`
- **Velodrome:** `https://velodrome.finance/favicon.ico`

Logos are 16x16px (w-4 h-4) with rounded corners, matching Bridge card style.

## Supported DEX Platforms

### DyorSwap (0x9b17...7a77)
- Primary DEX on Ink Chain
- Uniswap V2 fork
- Functions tracked:
  - swapExactETHForTokens
  - swapExactTokensForETH
  - swapExactTokensForTokens
  - All fee-on-transfer variants

### InkySwap (0x5511...a065)
- Universal Router
- Advanced routing
- Multi-hop swaps

### Velodrome (0x01d4...763C)
- Universal Router
- Optimized for stable pairs
- CL (Concentrated Liquidity) support

## Data Flow

```
Analytics API
    ↓
swap_volume metric
    ↓
sub_aggregates (by contract)
    ↓
Map contract → platform info
    ↓
Display with logo + name
```

### API Response Structure
```json
{
  "metrics": [
    {
      "slug": "swap_volume",
      "total_value": "8750.00",
      "total_count": 156,
      "sub_aggregates": [
        {
          "contract_address": "0x9b17690de96fcfa80a3acaefe11d936629cd7a77",
          "usd_value": "5230.00",
          "count": 98
        },
        {
          "contract_address": "0x551134e92e537ceaa217c2ef63210af3ce96a065",
          "usd_value": "2520.00",
          "count": 42
        }
      ]
    }
  ]
}
```

## Visual Consistency

The Swap Volume card now perfectly matches the Bridge Volume card:

| Feature | Bridge Card | Swap Card |
|---------|------------|-----------|
| Icon | ArrowLeftRight | ArrowLeftRight ✅ |
| Color | Purple | Cyan |
| Layout | Platform list | Platform list ✅ |
| Logos | 16x16 favicons | 16x16 favicons ✅ |
| Breakdown | By Platform | By Platform ✅ |
| Badge | "Active Bridger" | "Active Trader" ✅ |
| Height | 420px | 420px ✅ |

## Benefits

1. **Consistency:** Matches Bridge card UI pattern
2. **Clarity:** Users see which DEX they use most
3. **Branding:** Platform logos provide visual recognition
4. **Scalability:** Easy to add new DEX platforms
5. **Comparison:** Users can compare DEX usage patterns

## Future Enhancements

1. **Click-through:** Link to DEX platform pages
2. **Tooltips:** Show top traded pairs per platform
3. **Time filters:** 24h, 7d, 30d, All time
4. **Charts:** Volume trends over time
5. **Rankings:** Show user's rank among platform users
6. **Rewards:** Display platform-specific rewards/points

## Testing Checklist

- [x] DyorSwap logo loads correctly
- [x] Platform names display properly
- [x] USD values format with 2 decimals
- [x] Transaction counts show correctly
- [x] Scrollbar works for multiple platforms
- [x] "Active Trader" badge appears when txCount > 0
- [x] Loading state shows while fetching
- [x] Demo mode shows placeholder data
- [x] Card height matches Bridge card (420px)
- [x] Responsive layout works on mobile

## Conclusion

The Swap Volume card now provides a clean, consistent interface that matches the Bridge Volume card design. Users can easily see their total swap volume and which DEX platforms they prefer, with recognizable logos and clear metrics.
