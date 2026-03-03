# Boink Staking Addition to NFT Staking Card

## Summary
Added Boink staking collection to the existing NFT Staking card, which now tracks staking across three collections:
1. Shellies
2. INK Bunnies
3. Boink (NEW)

## Changes Made

### 1. API Server - Analytics Route (`api-server/src/routes/analytics.ts`)

#### Added Constants
```typescript
const BOINK_STAKING_CONTRACT = '0x95a4c625e970D4BC07703F056e0599F45b50b8c9';
const BOINK_STAKING_METHOD = '0x90be1863'; // getStakedCounts
```

#### Updated `/api/analytics/:wallet/nft_staking` Endpoint
- Added Boink staking contract call using viem
- Updated total count calculation to include Boink staked NFTs
- Added "Boink Staked" to sub_aggregates array

### 2. Test Script (`api-server/scripts/test-nft-staking.ts`)
- Added `testBoinkStaking()` function
- Updated to test both INK Bunnies and Boink contracts in parallel
- Shows combined results

## Boink Staking Contract Details

- **Contract Address**: `0x95a4c625e970D4BC07703F056e0599F45b50b8c9`
- **Method Name**: `getStakedCounts`
- **Method Selector**: `0x90be1863`
- **Parameters**: wallet address (address type)
- **Returns**: uint256 (number of staked NFTs)

### Contract Call Format
```
0x90be1863 + [wallet_address_padded_to_64_hex_chars]
```

### Example Call
```javascript
// For wallet: 0xdb94499a6ff41e4ed7850c13b4ca2dcab3d40075
{
  "data": "0x90be1863000000000000000000000000db94499a6ff41e4ed7850c13b4ca2dcab3d40075",
  "to": "0x95a4c625e970D4BC07703F056e0599F45b50b8c9"
}
```

### Example Response
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": "0x0000000000000000000000000000000000000000000000000000000000000002"
}
```
This indicates 2 NFTs are staked (hex `0x02` = decimal `2`).

## API Response Format (Updated)

```json
{
  "slug": "nft_staking",
  "name": "NFT Staking",
  "icon": "🔒",
  "currency": "COUNT",
  "total_count": 8,
  "total_value": "8",
  "sub_aggregates": [
    { "label": "Shellies Staked", "value": "3" },
    { "label": "INK Bunnies Staked", "value": "2" },
    { "label": "Boink Staked", "value": "3" }
  ],
  "last_updated": "2026-03-03T..."
}
```

## Testing

Run the updated test script to verify all three collections:
```bash
cd api-server
npx tsx scripts/test-nft-staking.ts
```

Expected output:
```
Testing INK Bunnies Staking for wallet: 0x...
============================================================
Contract: 0x058413de8D9c4B76df94CCefC6617ACc5BFE7C57
Method: 0x6f8d80f5
...
Staked NFTs: X

Testing Boink Staking for wallet: 0x...
============================================================
Contract: 0x95a4c625e970D4BC07703F056e0599F45b50b8c9
Method: 0x90be1863 (getStakedCounts)
...
Staked NFTs: Y

============================================================
✅ All tests completed
INK Bunnies Staked: X
Boink Staked: Y
Total: X+Y
```

## Implementation Notes

- No frontend changes required - the card automatically displays all sub_aggregates
- No database changes required - uses contract calls via viem
- Backward compatible - existing endpoints continue to work
- Error handling in place - if Boink contract call fails, it returns 0 and logs the error

## Adding More Collections in the Future

To add another NFT staking collection:

1. Add contract constants in `api-server/src/routes/analytics.ts`:
   ```typescript
   const NEW_COLLECTION_CONTRACT = '0x...';
   const NEW_COLLECTION_METHOD = '0x...';
   ```

2. Add contract call in the `nft_staking` endpoint handler:
   ```typescript
   let newCollectionCount = 0;
   try {
     const data = await publicClient.call({
       to: NEW_COLLECTION_CONTRACT as `0x${string}`,
       data: `${NEW_COLLECTION_METHOD}${wallet.slice(2).padStart(64, '0')}` as `0x${string}`,
     });
     if (data && data.data) {
       newCollectionCount = parseInt(data.data, 16);
     }
   } catch (error) {
     console.error('Error fetching New Collection staking:', error);
   }
   ```

3. Update total count and sub_aggregates:
   ```typescript
   const totalCount = shelliesCount + inkBunniesCount + boinkCount + newCollectionCount;
   
   sub_aggregates: [
     { label: 'Shellies Staked', value: shelliesCount.toString() },
     { label: 'INK Bunnies Staked', value: inkBunniesCount.toString() },
     { label: 'Boink Staked', value: boinkCount.toString() },
     { label: 'New Collection Staked', value: newCollectionCount.toString() }
   ]
   ```

4. Add test function in `test-nft-staking.ts` (optional but recommended)
