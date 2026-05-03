# INKDCA Points Implementation

## Overview
Implemented the INKDCA points system for InkScore, which rewards users for using the InkDCA platform to create and execute Dollar Cost Averaging (DCA) strategies.

## Points Structure

### Maximum Points: 500

The points are distributed across two activity types with a tiered system:

| Activity Type | Tier 1 (Bronze) | Tier 2 (Silver) | Tier 3 (Gold/Max) | Max Points |
|---------------|-----------------|-----------------|-------------------|------------|
| **Total Spent ($)** | $10-$100: 100 pts | $101-$500: 250 pts | $500+: 400 pts | 400 |
| **Total Registered** | 1 DCA: 25 pts | 2-5 DCAs: 50 pts | 6+ DCAs: 100 pts | 100 |
| **TOTAL** | | | | **500** |

## Implementation Details

### 1. Points Calculation Method
Added `calculateInkDcaPoints()` method in `points-service-v2.ts`:
- Takes two parameters: `totalSpentUsd`, `totalRegisteredDcas`
- Calculates points for spending activity (max 400 points)
- Calculates points for registered DCAs (max 100 points)
- Returns the sum of both activities

### 2. Data Fetching
- Added fetch call to `/api/analytics/${wallet}/inkdca_run_dca` endpoint
- This endpoint returns data from the InkDCA service which fetches from InkDCA API
- Parses the sub_aggregates to extract total spent USD
- Uses total_count for registered DCAs

### 3. Integration in calculateWalletScore
- Added `inkDcaRes` to the Promise.all fetch array
- Created `InkDcaResponse` interface for type safety
- Extracts total spent from sub_aggregates (parses "$X.XX" format)
- Extracts total registered DCAs from total_count
- Calculates points using `calculateInkDcaPoints()`
- Adds to breakdown under `platforms['inkdca']`

## Code Changes

### Files Modified
1. `api-server/src/services/points-service-v2.ts`
   - Added `calculateInkDcaPoints()` method
   - Added INKDCA data fetch in `calculateWalletScore()`
   - Added `InkDcaResponse` interface
   - Integrated points calculation into total score

### Files Created
1. `api-server/scripts/test-inkdca-points-calculation.ts`
   - Comprehensive test suite for points calculation logic
   - Tests all tier combinations and edge cases
   - All 18 test cases passing ✅

## Testing

Run the test script:
```bash
cd api-server
npx tsx scripts/test-inkdca-points-calculation.ts
```

### Test Results
- ✅ All 18 test cases passed
- Verified spending tier thresholds ($10, $101, $500)
- Verified DCA registration tier thresholds (1, 2, 6)
- Verified max points (500)
- Verified mixed tier scenarios
- Verified edge cases (no activity, below threshold, etc.)

## API Endpoint Used

**Endpoint:** `/api/analytics/${wallet}/inkdca_run_dca`

**Response Structure:**
```json
{
  "slug": "inkdca_run_dca",
  "name": "Registered DCAs",
  "total_count": 5,
  "total_value": "5",
  "sub_aggregates": [
    { "label": "Total Spent", "value": "$250.50" }
  ]
}
```

## Example Calculations

1. **Bronze Tier:** $50 spent, 1 DCA = 100 + 25 = 125 points
2. **Silver Tier:** $250 spent, 3 DCAs = 250 + 50 = 300 points
3. **Gold Tier:** $1000 spent, 10 DCAs = 400 + 100 = 500 points (MAX)
4. **Mixed Tiers:** $500 spent, 1 DCA = 400 + 25 = 425 points

## Tier Thresholds

### Total Spent ($)
- **Bronze (Tier 1):** $10 - $100 → 100 points
- **Silver (Tier 2):** $101 - $500 → 250 points
- **Gold (Tier 3):** $500+ → 400 points

### Total Registered DCAs
- **Bronze (Tier 1):** 1 DCA → 25 points
- **Silver (Tier 2):** 2-5 DCAs → 50 points
- **Gold (Tier 3):** 6+ DCAs → 100 points

## Notes

- The implementation follows the same pattern as other platform metrics (NFT Staking, Sweep, etc.)
- Points are calculated independently for spending and DCA registration
- The system is additive - users earn points from both activities
- Maximum achievable points: 500 (400 from spending + 100 from registrations)
- The InkDCA service fetches data from the InkDCA API and caches it for 5 minutes
- Total spent is calculated by summing all DCA purchases in USD
