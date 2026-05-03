# Templars of the Storm NFT Points - Test Suite

This directory contains test scripts to verify the Templars of the Storm NFT points calculation.

## Points Allocation

| Holding Status | Points | Reward Tier | Description |
|----------------|--------|-------------|-------------|
| 1 Templars NFT | 1,500 pts | Base Tier | Unlocks the core holder multiplier for Phase 2 |
| 2 Templars NFTs | 2,200 pts | Silver Tier | Adds a +700 pts loyalty bonus to your score |
| 3+ Templars NFTs | 2,700 pts | Gold/Whale Tier | Maximum points reached for the holding category |

## Test Scripts

### 1. Unit Test (Calculation Logic)
**File:** `test-templars-calculation.ts`

Tests the points calculation logic directly without making any API calls.

```bash
cd api-server
npx ts-node scripts/test-templars-calculation.ts
```

**What it tests:**
- 0 NFTs → 0 points
- 1 NFT → 1,500 points (Base Tier)
- 2 NFTs → 2,200 points (Silver Tier)
- 3+ NFTs → 2,700 points (Gold/Whale Tier)

**Expected output:** All tests should pass ✅

---

### 2. Integration Test (API Endpoints)
**File:** `test-templars-integration.ts`

Tests the complete flow by making actual API calls to verify:
1. The Templars NFT balance endpoint (`/api/analytics/:wallet/templars_nft_balance`)
2. The wallet score endpoint (`/api/wallet/:wallet/score`)
3. The points calculation in the breakdown

```bash
cd api-server
npx ts-node scripts/test-templars-integration.ts
```

**Prerequisites:**
- API server must be running
- Database must be accessible
- Valid wallet address (default: `0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5`)

**What it tests:**
- Fetches actual NFT balance from blockchain
- Calculates expected points based on balance
- Verifies points appear correctly in wallet score breakdown
- Displays all platform points for comparison

---

### 3. Full Wallet Test (Real Data)
**File:** `test-templars-points.ts`

Tests multiple wallet addresses with different NFT balances to verify the complete scoring system.

```bash
cd api-server
npx ts-node scripts/test-templars-points.ts
```

**What it tests:**
- Multiple wallets with different NFT holdings
- Complete wallet score calculation
- Rank assignment based on total points
- Points breakdown across all platforms

**Note:** Update the wallet addresses in the script to test with real wallets that hold Templars NFTs.

---

## Implementation Details

### Contract Address
```
Templars of the Storm NFT: 0x46625E7de9894D83fca49E79cB53B5C25550cE99
```

### Code Location
- **Points Service:** `api-server/src/services/points-service-v2.ts`
- **Calculation Method:** `calculateTemplarsPoints(nftBalance: number)`
- **Integration:** Added to `calculateWalletScore()` method

### API Endpoints Used
1. `GET /api/analytics/:wallet/templars_nft_balance` - Fetches NFT balance from blockchain
2. `GET /api/wallet/:wallet/score` - Returns complete wallet score with breakdown

### Breakdown Structure
```typescript
{
  "breakdown": {
    "platforms": {
      "templars": {
        "tx_count": 2,        // NFT balance
        "usd_volume": 0,      // Not applicable for NFTs
        "points": 2200        // Calculated points
      }
    }
  }
}
```

---

## Troubleshooting

### Test fails with "Contract does not exist"
- Verify the contract address is correct
- Ensure you're connected to Ink mainnet (Chain ID: 57073)
- Check if the RPC endpoint is accessible

### Test fails with "API server not running"
- Start the API server: `npm run dev` in the `api-server` directory
- Verify the API_BASE_URL environment variable

### Points calculation is incorrect
- Run the unit test first to verify the logic
- Check if the NFT balance is being fetched correctly
- Review the `calculateTemplarsPoints()` method in `points-service-v2.ts`

### Templars data not in breakdown
- Verify the wallet actually holds Templars NFTs
- Check if the API endpoint is returning data
- Ensure the points service is fetching from the correct endpoint

---

## Next Steps

After successful testing:
1. ✅ Verify calculation logic (unit test)
2. ✅ Test API integration (integration test)
3. ✅ Test with real wallets (full wallet test)
4. 🔄 Deploy to production
5. 🔄 Update frontend to display Templars points
6. 🔄 Add Templars card to dashboard

---

## Questions?

If you encounter any issues or have questions about the implementation, please check:
- The main points service: `api-server/src/services/points-service-v2.ts`
- The analytics routes: `api-server/src/routes/analytics.ts`
- The test scripts in this directory
