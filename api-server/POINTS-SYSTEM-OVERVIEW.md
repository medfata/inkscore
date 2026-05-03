# InkScore Points System - Complete Overview

## Total Maximum Points: ~17,000+

This document provides a complete overview of all point sources in the InkScore system.

---

## Native Metrics (Wallet-Level)

| Metric | Max Points | Description |
|--------|-----------|-------------|
| Wallet Age | 600 | Based on days since first transaction |
| Total Transactions | 600 | Total number of transactions |
| NFT Collections | 400 | Number of unique NFT collections held |
| Token Holdings | 400 | USD value of ERC-20 tokens (excluding meme coins) |
| Meme Coins | 300 | USD value of meme coin holdings |

**Native Total:** 2,300 points

---

## Platform-Specific Metrics

### High-Value Platforms (1,000+ points)

| Platform | Max Points | Metrics Tracked |
|----------|-----------|-----------------|
| **Templars of the Storm** ⭐ | **2,700** | NFT holdings (1/2/3+ tiers) |
| **OpenSea** ⭐ NEW | **2,500** | Buy/Sell/Mint activity (tiered) |
| **Tydro** | 2,500 | Supply (1,250) + Borrow (1,250) |
| **Nado Finance** | 2,500 | Deposits (1,250) + Volume (1,250) |

### Medium-Value Platforms (500-999 points)

| Platform | Max Points | Metrics Tracked |
|----------|-----------|-----------------|
| **Bridge In** | 500 | Bridged-in volume (USD) |
| **Bridge Out** | 500 | Bridged-out volume (USD) |
| **Swap** | 500 | Total swap volume (USD) |

### Standard Platforms (300-499 points)

| Platform | Max Points | Metrics Tracked |
|----------|-----------|-----------------|
| **InkyPump** | 400 | Token creation + trading volume |
| **Shellies** | 400 | Games played + NFTs staked + raffles |
| **NFT Trading** | 400 | Squid, Net Protocol, Mintique activity |
| **Copink** | 400 | Trading volume + subaccounts |
| **GM** | 400 | GM count |
| **ZNS** | 300 | Domains + contracts + GM activity |
| **NFT2Me** | 300 | Collections created + NFTs minted |
| **Marvk** | 300 | Cards minted + tokens locked/vested |

**Platform Total:** ~10,700 points

---

## Templars of the Storm - Detailed Breakdown ⭐ NEW

### Points Allocation

| Holding Status | Points | Tier | Bonus |
|----------------|--------|------|-------|
| 0 NFTs | 0 | None | - |
| 1 NFT | 1,500 | Base Tier | Core holder multiplier |
| 2 NFTs | 2,200 | Silver Tier | +700 loyalty bonus |
| 3+ NFTs | 2,700 | Gold/Whale Tier | Maximum points |

### Why Templars is High-Value

- **Highest single platform:** 2,700 points (more than Tydro or Nado)
- **Simple to earn:** Just hold NFTs (no complex DeFi interactions)
- **Tiered rewards:** Encourages holding multiple NFTs
- **Phase 2 multiplier:** Base tier unlocks future benefits

### Contract Details
- **Address:** `0x46625E7de9894D83fca49E79cB53B5C25550cE99`
- **Type:** ERC-721 NFT
- **Network:** Ink Mainnet

---

## Points Distribution by Category

```
Native Metrics:        2,300 pts (15.3%)
High-Value Platforms: 10,200 pts (68.0%)  ← Templars, OpenSea, Tydro, Nado
Medium-Value:          1,500 pts (10.0%)  ← Bridges, Swap
Standard Platforms:    1,000 pts ( 6.7%)  ← Other platforms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Maximum:        ~15,000 pts
```

---

## Ranking System

Points determine your rank in the InkScore system:

| Rank | Min Points | Description |
|------|-----------|-------------|
| Bronze | 0 | Starting rank |
| Silver | 1,000 | Active user |
| Gold | 3,000 | Power user |
| Platinum | 5,000 | Whale |
| Diamond | 10,000+ | Legendary |

*Note: Actual rank thresholds may vary based on database configuration*

---

## Strategy Guide

### Quick Wins (Easy Points)
1. **Hold 1 Templars NFT** → 1,500 points instantly
2. **Bridge to Ink** → Up to 500 points
3. **Make some swaps** → Up to 500 points
4. **Say GM daily** → Up to 400 points

### Power User Strategy (5,000+ points)
1. **Hold 3+ Templars NFTs** → 2,700 points
2. **Use Tydro (supply + borrow)** → 2,500 points
3. **Bridge in and out** → 1,000 points
4. **Active trading on Nado** → 2,500 points
5. **Native metrics** → 2,300 points

### Whale Strategy (10,000+ points)
- Max out all high-value platforms
- Maintain large token holdings
- Active across all platforms
- Long wallet age + high transaction count

---

## Recent Updates

### March 5, 2026 - OpenSea Integration ⭐ NEW
- ✅ Added OpenSea NFT activity points
- ✅ Implemented 3-tier reward system (Bronze/Silver/Gold)
- ✅ Tracks Buy, Sell, and Mint activities
- ✅ Created comprehensive test suite
- ✅ Integrated into wallet score calculation

### March 5, 2026 - Templars Integration ⭐
- ✅ Added Templars of the Storm NFT points
- ✅ Implemented 3-tier reward system
- ✅ Created comprehensive test suite
- ✅ Integrated into wallet score calculation

---

## API Endpoints

### Get Wallet Score
```bash
GET /api/wallet/:address/score
```

Returns complete breakdown including Templars points:
```json
{
  "total_points": 8500,
  "rank": { "name": "Platinum" },
  "breakdown": {
    "native": { ... },
    "platforms": {
      "templars": {
        "tx_count": 3,
        "points": 2700
      },
      ...
    }
  }
}
```

### Get Templars Balance
```bash
GET /api/analytics/:address/templars_nft_balance
```

Returns NFT balance from blockchain:
```json
{
  "value": 2,
  "total_count": 2,
  "name": "Templars of the Storm"
}
```

---

## Implementation Notes

### Caching
- Wallet scores: 5 minutes
- NFT balances: 5 minutes (blockchain reads)
- Rank data: 1 minute

### Performance
- All platform data fetched in parallel
- Efficient blockchain reads using viem
- In-memory caching for frequently accessed data

### Future Enhancements
- Historical point tracking
- Point multipliers for Phase 2
- Leaderboard system
- Achievement badges
- Referral bonuses

---

## Testing

Run the complete test suite:

```bash
cd api-server

# Test all calculations
npx ts-node scripts/test-templars-calculation.ts

# Test API integration
npx ts-node scripts/test-templars-integration.ts

# Test with real wallets
npx ts-node scripts/test-templars-points.ts
```

---

## Questions?

For more information:
- **Implementation:** See `TEMPLARS-IMPLEMENTATION.md`
- **Test Documentation:** See `scripts/README-TEMPLARS-TESTS.md`
- **Code:** `src/services/points-service-v2.ts`

---

**Last Updated:** March 5, 2026  
**Version:** 2.0 (Templars Integration)
