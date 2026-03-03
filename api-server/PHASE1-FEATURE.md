# InkScore Phase 1 Feature

## Overview

The InkScore Phase 1 feature allows users to check if their connected wallet is eligible for Phase 1 based on a CSV file containing wallet addresses and their corresponding scores.

## Implementation

### Backend Components

#### 1. Phase 1 Service (`src/services/phase1-service.ts`)
- Loads wallet addresses and scores from CSV file on first use
- Provides methods to check Phase 1 eligibility
- Caches data in memory for fast lookups
- Case-insensitive wallet address matching

**Key Methods:**
- `isPhase1Wallet(address)` - Returns boolean indicating Phase 1 eligibility
- `getWalletScore(address)` - Returns score or null if not eligible
- `getPhase1Status(address)` - Returns full status object with eligibility, score, and total count
- `getAllPhase1Wallets()` - Returns all Phase 1 wallets (admin use)

#### 2. API Routes (`src/routes/phase1.ts`)
- `GET /api/phase1/check/:wallet` - Check if a wallet is in Phase 1
- `GET /api/phase1/wallets` - Get all Phase 1 wallets (admin endpoint)

**Response Format:**
```json
{
  "isPhase1": true,
  "score": 7060,
  "totalPhase1Wallets": 2314
}
```

#### 3. Integration with Wallet Stats
The Phase 1 status is automatically included in the wallet stats response:

```typescript
interface WalletStatsData {
  // ... other fields
  phase1Status?: {
    isPhase1: boolean;
    score: number | null;
  };
}
```

### Frontend Components

#### Dashboard Display
The Phase 1 status is displayed in the top stats grid (Row 1) as a new card:

- **Label:** "InkScore Phase 1"
- **Value:** "✓ Eligible" or "✗ Not Eligible"
- **Sub-value:** Score (if eligible)
- **Color:** Green for eligible, Orange for not eligible

## Data Source

The Phase 1 wallet list is loaded from:
```
api-server/src/data/ink-score-export-2026-02-24.csv
```

**CSV Format:**
```csv
wallet_address,score
0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5,7060
0x27326Bd8E518183c5266B031Cf90734e17dc4800,6975
...
```

**Statistics:**
- Total Phase 1 wallets: 2,314
- Highest score: 7,060
- Lowest score: varies

## Caching

- **API Response Cache:** 1 hour (Phase 1 data is static)
- **In-Memory Cache:** Loaded once on first request, persists for application lifetime
- **Wallet Stats Cache:** 5 minutes (includes Phase 1 status)

## Testing

Run the test script to verify the service:

```bash
cd api-server
npx ts-node test-phase1-service.ts
```

## Usage Examples

### Check Phase 1 Status via API
```bash
curl http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5
```

### Get All Phase 1 Wallets
```bash
curl http://localhost:4000/api/phase1/wallets
```

### Frontend Integration
The Phase 1 status automatically appears in the dashboard when a wallet is connected. No additional configuration needed.

## Future Enhancements

Potential improvements:
1. Admin interface to upload new CSV files
2. Historical tracking of Phase 1 eligibility changes
3. Phase 2, Phase 3, etc. support
4. Detailed breakdown of score components
5. Leaderboard showing top Phase 1 wallets

## Notes

- Wallet addresses are normalized to lowercase for consistent matching
- The CSV file is loaded synchronously on first access
- Invalid CSV entries are skipped with console warnings
- The service is designed to be performant with thousands of wallet addresses
