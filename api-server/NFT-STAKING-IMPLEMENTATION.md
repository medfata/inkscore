# NFT Staking Points Implementation

## Overview
Implemented the NFT Staking points system for InkScore, which rewards users for staking NFTs across three collections: Shellies, INK Bunnies, and Boink.

## Points Structure

### Maximum Points: 500

The points are distributed across three NFT collections with a tiered system:

| Collection | Tier 1 (Bronze) | Tier 2 (Silver) | Tier 3 (Gold) | Max Points |
|------------|-----------------|-----------------|---------------|------------|
| **Shellies** | 1 NFT: 50 pts | 2-5 NFTs: 100 pts | 6+ NFTs: 166 pts | 166 |
| **INK Bunnies** | 1 NFT: 50 pts | 2-5 NFTs: 100 pts | 6+ NFTs: 167 pts | 167 |
| **Boink** | 1 NFT: 50 pts | 2-5 NFTs: 100 pts | 6+ NFTs: 167 pts | 167 |
| **TOTAL** | | | | **500** |

## Implementation Details

### 1. Points Calculation Method
Added `calculateNftStakingPoints()` method in `points-service-v2.ts`:
- Takes three parameters: `shelliesCount`, `inkBunniesCount`, `boinkCount`
- Calculates points for each collection independently based on tier thresholds
- Returns the sum of all three collections' points

### 2. Data Fetching
- Added fetch call to `/api/analytics/${wallet}/nft_staking` endpoint
- This endpoint returns aggregated data with sub_aggregates for each collection
- Parses the sub_aggregates to extract individual collection counts

### 3. Integration in calculateWalletScore
- Added `nftStakingRes` to the Promise.all fetch array
- Created `NftStakingResponse` interface for type safety
- Extracts individual collection counts from sub_aggregates
- Calculates points using `calculateNftStakingPoints()`
- Adds to breakdown under `platforms['nft_staking']`

## Code Changes

### Files Modified
1. `api-server/src/services/points-service-v2.ts`
   - Added `calculateNftStakingPoints()` method
   - Added NFT staking data fetch in `calculateWalletScore()`
   - Added `NftStakingResponse` interface
   - Integrated points calculation into total score

### Files Created
1. `api-server/scripts/test-nft-staking-points-calculation.ts`
   - Comprehensive test suite for points calculation logic
   - Tests all tier combinations and edge cases
   - All 9 test cases passing ✅

## Testing

Run the test script:
```bash
cd api-server
npx tsx scripts/test-nft-staking-points-calculation.ts
```

### Test Results
- ✅ All 9 test cases passed
- Verified tier thresholds (1, 2-5, 6+)
- Verified max points (500)
- Verified mixed tier scenarios
- Verified zero staking scenario

## API Endpoint Used

**Endpoint:** `/api/analytics/${wallet}/nft_staking`

**Response Structure:**
```json
{
  "slug": "nft_staking",
  "name": "NFT Staking",
  "total_count": 15,
  "total_value": "15",
  "sub_aggregates": [
    { "label": "Shellies Staked", "value": "5" },
    { "label": "INK Bunnies Staked", "value": "3" },
    { "label": "Boink Staked", "value": "7" }
  ]
}
```

## Example Calculations

1. **Bronze Tier (1 NFT each):** 50 + 50 + 50 = 150 points
2. **Silver Tier (3 NFTs each):** 100 + 100 + 100 = 300 points
3. **Gold Tier (6+ NFTs each):** 166 + 167 + 167 = 500 points (MAX)
4. **Mixed Tiers (1, 3, 7 NFTs):** 50 + 100 + 167 = 317 points

## Notes

- The implementation follows the same pattern as other platform metrics (Sweep, OpenSea, etc.)
- Points are calculated independently for each collection
- The system is additive - users can earn points from multiple collections
- Maximum achievable points: 500 (when all three collections are at Gold tier)
