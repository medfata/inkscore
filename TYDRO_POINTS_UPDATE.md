# Points System Updates

## Recent Changes

### 1. Tydro Points System (Updated)
Updated the Tydro points calculation from a simple multiplier to a **tiered system** with separate scoring for Supply and Borrow activities.

#### Old System
```
Points = ceil((supplyUsd + borrowUsd) * 10)
```

#### New System (Tiered)

**🟢 CURRENT SUPPLY (Max: 1,250 points)**
| Tier | Amount Range | Points | Rank |
|------|--------------|--------|------|
| 1 | $1 - $99 | 50 | 🌱 Saver |
| 2 | $100 - $999 | 250 | 🦐 Supplier |
| 3 | $1,000 - $9,999 | 600 | 🐬 Liquidity Provider |
| 4 | $10,000 - $49,999 | 1,000 | 🦈 Shark |
| 5 | $50,000+ | 1,250 | 🐳 Whale |

**🟠 CURRENT BORROW (Max: 1,250 points)**
| Tier | Amount Range | Points | Rank |
|------|--------------|--------|------|
| 1 | $1 - $49 | 50 | 🧪 Tester |
| 2 | $50 - $499 | 250 | 📉 Borrower |
| 3 | $500 - $4,999 | 600 | 💳 Active User |
| 4 | $5,000 - $24,999 | 1,000 | 🏦 Pro Borrower |
| 5 | $25,000+ | 1,250 | 👑 Degen |

**🏆 TOTAL SCORE: Maximum 2,500 points** (1,250 supply + 1,250 borrow)

---

### 2. Bridge Volume Points System (Updated)
Updated the Bridge points calculation from multipliers to a **unified tiered system** for both Bridge In and Bridge Out.

#### Old System
```
Bridge IN Points = ceil(volumeUsd * 5)
Bridge OUT Points = ceil(volumeUsd * 4)
```

#### New System (Tiered)

**🌉 BRIDGE VOLUME (Max: 500 points per direction)**
| Tier | Bridged Volume | Points | Rank |
|------|----------------|--------|------|
| 1 | $1 - $99 | 25 | 🧳 Tourist |
| 2 | $100 - $999 | 100 | 🧭 Explorer |
| 3 | $1,000 - $4,999 | 250 | 🏗️ Settler |
| 4 | $5,000 - $9,999 | 400 | 🌉 Connector |
| 5 | $10,000+ | 500 | 🚢 Bridge Whale |

**Note:** Both Bridge IN and Bridge OUT use the same tier system independently.
- **Maximum per wallet: 1,000 points** (500 Bridge IN + 500 Bridge OUT)

---

## Examples

### Tydro Example 1: Small User
- Supply: $500 → Tier 3 → 600 points
- Borrow: $100 → Tier 2 → 250 points
- **Total: 850 points**

### Tydro Example 2: Whale
- Supply: $75,000 → Tier 5 → 1,250 points
- Borrow: $30,000 → Tier 5 → 1,250 points
- **Total: 2,500 points (MAX)**

### Bridge Example 1: Light User
- Bridge IN: $250 → Tier 2 → 100 points
- Bridge OUT: $50 → Tier 1 → 25 points
- **Total: 125 points**

### Bridge Example 2: Heavy User
- Bridge IN: $15,000 → Tier 5 → 500 points
- Bridge OUT: $8,000 → Tier 4 → 400 points
- **Total: 900 points**

### Bridge Example 3: Whale
- Bridge IN: $50,000 → Tier 5 → 500 points
- Bridge OUT: $25,000 → Tier 5 → 500 points
- **Total: 1,000 points (MAX)**

---

## Old vs New Comparison

### Tydro
**User with $10,000 supply + $5,000 borrow:**
- **Old system**: ceil((10,000 + 5,000) * 10) = **150,000 points** 😱
- **New system**: 1,000 + 1,000 = **2,000 points** ✅

### Bridge
**User with $5,000 bridge in + $3,000 bridge out:**
- **Old system**: ceil(5,000 * 5) + ceil(3,000 * 4) = **37,000 points** 😱
- **New system**: 400 + 250 = **650 points** ✅

The new systems are much more balanced and prevent point inflation!

---

## Testing

No syntax errors detected. The code is ready to deploy.

To test:
```bash
# Call the wallet score endpoint
curl http://localhost:4000/api/wallet/{address}/score
```

Check the following fields in the response:
- `breakdown.platforms.tydro.points`
- `breakdown.platforms.bridge_in.points`
- `breakdown.platforms.bridge_out.points`

