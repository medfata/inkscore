# Manual Points System Implementation

## Overview

The points system has been updated to use **manual, fixed scoring rules** instead of the previous dynamic admin-configurable system. All points are now calculated using hardcoded logic based on specific thresholds and ranges.

## Changes Made

### 1. Updated `lib/services/points-service.ts`

Replaced the dynamic `calculateWalletScore()` method with a new implementation that:
- Fetches all required data in parallel for performance
- Applies manual calculation rules for each metric
- Returns a breakdown of points by category

### 2. Updated `lib/types/platforms.ts`

Added `'meme_coins'` to the `NativeMetricKey` type to support separate meme coin scoring.

## Points Calculation Rules

### 1. NFT Collections (Shellies, Rekt Ink, etc.)
```
IF nft_count >= 1 AND nft_count <= 3    → 100 points
IF nft_count >= 4 AND nft_count <= 9    → 200 points
IF nft_count >= 10                      → 300 points
```

### 2. Token Holdings (Excluding Meme Coins)
```
FOR EACH token:
  IF balance_usd >= 1 AND balance_usd <= 99      → +100 points
  IF balance_usd >= 100 AND balance_usd <= 999   → +200 points
  IF balance_usd >= 1000                         → +300 points
```

### 3. Meme Coins (CAT, ANITA, PURPLE)
```
FOR EACH meme_token:
  IF balance_usd >= 1 AND balance_usd <= 10      → +50 points
  IF balance_usd >= 11 AND balance_usd <= 100    → +70 points
  IF balance_usd > 200                           → +100 points
```

**Meme Token Addresses:**
- ANITA: `0x0606fc632ee812ba970af72f8489baaa443c4b98`
- CAT: `0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5`
- PURPLE: `0xd642b49d10cc6e1bc1c6945725667c35e0875f22`
- ANDRU: `0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec`
- KRAK: `0x32bcb803f696c99eb263d60a05cafd8689026575`
- BERT: `0x62c99fac20b33b5423fdf9226179e973a8353e36`

### 4. Wallet Age
```
IF wallet_age_days <= 30     → 100 points
IF wallet_age_days <= 90     → 200 points
IF wallet_age_days <= 180    → 300 points
IF wallet_age_days <= 365    → 400 points
IF wallet_age_days <= 730    → 500 points
ELSE                         → 600 points
```

### 5. Total Transactions
```
IF tx_count >= 1 AND tx_count <= 100    → 100 points
IF tx_count <= 200                      → 200 points
IF tx_count <= 400                      → 300 points
IF tx_count <= 700                      → 400 points
IF tx_count <= 900                      → 500 points
ELSE                                    → 600 points
```

### 6. Bridge Volume (Bridged IN)
```
IF bridge_in_volume_usd >= 10 AND < 100     → 100 points
IF bridge_in_volume_usd < 500               → 200 points
IF bridge_in_volume_usd < 2000              → 300 points
IF bridge_in_volume_usd < 5000              → 400 points
IF bridge_in_volume_usd < 10000             → 500 points
IF bridge_in_volume_usd >= 10000            → 600 points
```

### 7. GM (Daily Check-ins)
```
IF gm_count >= 1 AND gm_count < 10     → 100 points
IF gm_count >= 10 AND gm_count <= 20   → 200 points
IF gm_count > 30                       → 300 points
```

### 8. InkyPump
```
IF user_creates_token    → +100 points
IF user_buys_token       → +100 points
IF user_sells_token      → +100 points
```
(Maximum: 300 points if all three actions performed)

### 9. Tydro (Lending/Borrowing)

**Supply Points:**
```
IF tydro_supply_usd >= 1 AND <= 99      → 250 points
IF tydro_supply_usd >= 100 AND <= 499   → 500 points
IF tydro_supply_usd >= 500 AND <= 999   → 700 points
IF tydro_supply_usd >= 1000             → 1000 points
```

**Borrow Points:**
```
IF tydro_borrow_usd >= 1 AND <= 99      → 250 points
IF tydro_borrow_usd >= 100 AND <= 499   → 500 points
IF tydro_borrow_usd >= 500 AND <= 999   → 700 points
IF tydro_borrow_usd >= 1000             → 1000 points
```
(Maximum: 2000 points if both supply and borrow at highest tier)

### 10. Swap Volume (DEX Trading)
```
IF swap_amount_usd >= 5 AND <= 50       → 100 points
IF swap_amount_usd >= 100 AND <= 500    → 250 points
IF swap_amount_usd > 500 AND <= 1000    → 500 points
IF swap_amount_usd > 1000               → 1000 points
```

### 11. Shellies
```
IF played_shellies_game    → +100 points
IF staked_nft              → +100 points
IF joined_raffle           → +100 points
```
(Maximum: 300 points if all three actions performed)

### 12. ZNS Connect
```
IF holds_zns_connect_domain    → 100 points
```

### 13. NFT2Me
```
IF nft_collection_created_on_inkchain    → +100 points
IF nft_minted_on_inkchain                → +100 points
```
(Maximum: 200 points if both actions performed)

### 14. NFT Trading
```
IF nft_trade_on_inkchain == TRUE AND marketplace IN SUPPORTED_MARKETPLACES
  → 100 points
```

**Supported Marketplaces:**
- Squid Market: `0x9ebf93fdba9f32accab3d6716322dccd617a78f3`
- Net Protocol: `0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5`
- Mintiq: `0xbd6a027b85fd5285b1623563bbef6fadbe396afb`

## Maximum Possible Score

| Category | Max Points |
|----------|------------|
| NFT Collections | 300 |
| Token Holdings | Unlimited (300 per token) |
| Meme Coins | Unlimited (100 per meme token) |
| Wallet Age | 600 |
| Total Transactions | 600 |
| Bridge Volume | 600 |
| GM | 300 |
| InkyPump | 300 |
| Tydro | 2000 |
| Swap Volume | 1000 |
| Shellies | 300 |
| ZNS | 100 |
| NFT2Me | 200 |
| NFT Trading | 100 |

**Theoretical Maximum:** 7,400+ points (excluding unlimited token holdings)

## Ranking Tiers

The existing rank system remains unchanged:

| Rank | Min Points | Max Points |
|------|------------|------------|
| New User | 0 | 99 |
| Active User | 100 | 499 |
| Power User | 500 | 1,999 |
| OG Member | 2,000 | 4,999 |
| Ink Legend | 5,000+ | ∞ |

## Performance

The new system:
- ✅ Fetches all data in parallel (14 concurrent queries)
- ✅ Uses optimized database queries with proper indexes
- ✅ Maintains the same caching strategy (5 min in-memory, 30 min DB)
- ✅ Returns results in the same format as before

## Testing

To test the new system:

1. **Refresh a wallet score:**
   ```
   GET /api/wallet/[address]/score?refresh=true
   ```

2. **Check the breakdown:**
   The response includes a detailed breakdown showing points earned for each category:
   ```json
   {
     "wallet_address": "0x...",
     "total_points": 1250,
     "rank": {
       "name": "Power User",
       "color": "#3b82f6"
     },
     "breakdown": {
       "native": {
         "nft_collections": { "value": 5, "points": 200 },
         "erc20_tokens": { "value": 1500, "points": 600 },
         "wallet_age": { "value": 120, "points": 200 }
       },
       "platforms": {
         "gm": { "tx_count": 15, "usd_volume": 0, "points": 200 },
         "tydro": { "tx_count": 10, "usd_volume": 250, "points": 500 }
       }
     }
   }
   ```

## Migration Notes

- ✅ No database migration required
- ✅ Existing cached scores will be recalculated on next refresh
- ✅ All existing API endpoints remain unchanged
- ✅ Dashboard display logic remains unchanged
- ✅ Admin panel for points rules is now deprecated (rules are hardcoded)

## Future Enhancements

To add more meme tokens, update the `MEME_TOKENS` array in `lib/services/points-service.ts`:

```typescript
private readonly MEME_TOKENS = [
  '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', // CAT
  '0x0606fc632ee812ba970af72f8489baaa443c4b98', // ANITA
  '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', // PURPLE
  // Add new meme tokens here
];
```
