# NFT Staking Card Implementation

## Overview
Implemented a new NFT Staking card that consolidates staking metrics from multiple NFT collections:
- Shellies (existing, migrated from Shellies card)
- INK Bunnies Staking (new collection)
- Boink Staking (new collection)

## Changes Made

### 1. API Server - Analytics Route (`api-server/src/routes/analytics.ts`)

#### Added Constants
```typescript
const INK_BUNNIES_STAKING_CONTRACT = '0x058413de8D9c4B76df94CCefC6617ACc5BFE7C57';
const INK_BUNNIES_STAKING_METHOD = '0x6f8d80f5';
const BOINK_STAKING_CONTRACT = '0x95a4c625e970D4BC07703F056e0599F45b50b8c9';
const BOINK_STAKING_METHOD = '0x90be1863'; // getStakedCounts
```

#### New Endpoint: `/api/analytics/:wallet/nft_staking`
- Fetches Shellies staked count from transaction history (StakeBatch transactions)
- Fetches INK Bunnies staked count via contract call using viem
- Fetches Boink staked count via contract call using viem
- Returns aggregated data with sub_aggregates showing breakdown by collection
- Contract call format: method selector + padded wallet address (64 hex chars)

#### Backward Compatibility
- Kept existing `/api/analytics/:wallet/shellies_staking` endpoint for backward compatibility with points service

### 2. Dashboard Route (`app/api/[wallet]/dashboard/route.ts`)

#### Streaming Metrics
- Replaced `shelliesStaking` with `nftStaking` in streaming metrics array
- Updated fetch endpoint from `shellies_staking` to `nft_staking`

#### Non-Streaming Response
- Updated Promise.all array to fetch `nft_staking` instead of `shellies_staking`
- Updated result variable from `shelliesStakingResult` to `nftStakingResult`
- Updated response object mapping

### 3. Dashboard Component (`app/components/Dashboard.tsx`)

#### Type Definitions
- Updated `ConsolidatedDashboardResponse` interface:
  - Removed: `shelliesStaking: { total_count?: number } | null`
  - Added: `nftStaking: { total_count?: number; sub_aggregates?: Array<{ label: string; value: string }> } | null`

#### State Management
- Removed: `const [shelliesStaking, setShelliesStaking] = useState<{ total_count: number } | null>(null)`
- Added: `const [nftStaking, setNftStaking] = useState<{ total_count: number; sub_aggregates?: Array<{ label: string; value: string }> } | null>(null)`

#### Data Processing
- Updated `processConsolidatedResponse` to handle `nftStaking` instead of `shelliesStaking`
- Updated streaming metric handler (case 'nftStaking')
- Updated state reset in refresh function

#### UI Changes

**Shellies Card (Updated)**
- Removed staking metric from the card
- Now only shows:
  - Joined Raffles
  - Pay to Play
- Total count calculation updated to exclude staking

**New NFT Staking Card**
- Color scheme: Amber (border-amber-500/20, bg-gradient-to-br from-amber-500/12 to-amber-900/5)
- Icon: 🔒
- Shows total staked NFTs across all collections
- Breakdown by collection in sub_aggregates:
  - Shellies Staked
  - INK Bunnies Staked
- Active indicator when user has staked NFTs

### 4. Test Script (`api-server/scripts/test-nft-staking.ts`)
Created test script to verify INK Bunnies contract call functionality:
- Uses viem to call the staking contract
- Tests the method `0x6f8d80f5` with a wallet address parameter
- Parses the hex response to get staked count

## Technical Details

### INK Bunnies Staking Contract
- **Contract Address**: `0x058413de8D9c4B76df94CCefC6617ACc5BFE7C57`
- **Method**: `0x6f8d80f5` (takes wallet address, returns uint256 staked count)
- **Call Format**: `0x6f8d80f5` + wallet address (padded to 64 hex chars)
- **Example**: `0x6f8d80f5000000000000000000000000b39a48d294e1530a271e712b7a19243679d320d0`

### Boink Staking Contract
- **Contract Address**: `0x95a4c625e970D4BC07703F056e0599F45b50b8c9`
- **Method**: `0x90be1863` (getStakedCounts - takes wallet address, returns uint256 staked count)
- **Call Format**: `0x90be1863` + wallet address (padded to 64 hex chars)
- **Example**: `0x90be1863000000000000000000000000db94499a6ff41e4ed7850c13b4ca2dcab3d40075`

### Shellies Staking
- **Contract Address**: `0xb39a48d294e1530a271e712b7a19243679d320d0`
- **Method**: Transaction count of StakeBatch calls
- **Functions**: `StakeBatch`, `stakeBatch`, `0x1e332260`

## API Response Format

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

Run the test script:
```bash
cd api-server
npx tsx scripts/test-nft-staking.ts
```

## Migration Notes

- The old `shellies_staking` endpoint is maintained for backward compatibility
- Points service continues to use the old endpoint
- Frontend now uses the new unified `nft_staking` endpoint
- No database migrations required (uses existing transaction_details table)

## Future Enhancements

To add more NFT staking collections:
1. Add contract address and method constants in `analytics.ts`
2. Add contract call logic in the `nft_staking` endpoint handler
3. Add new sub_aggregate entry with collection name
4. Update total_count calculation
