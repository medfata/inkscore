# InkScore Phase 1 - Architecture Diagram

## System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER DASHBOARD                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Row 1: Top Stats Grid (6 columns)                       │  │
│  │  ┌────────┬────────┬────────┬────────┬────────┬────────┐ │  │
│  │  │Net Worth│ Txns  │ Volume │  NFTs  │  Age   │Phase 1 │ │  │
│  │  │  $XXX  │  XXX  │  $XXX  │  XXX   │ XX Days│✓/✗     │ │  │
│  │  └────────┴────────┴────────┴────────┴────────┴────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Wallet Connected
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND (Next.js)                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Dashboard.tsx                                            │  │
│  │  - Fetches wallet stats                                   │  │
│  │  - Displays Phase 1 status in stats grid                 │  │
│  │  - Shows ✓ Eligible or ✗ Not Eligible                    │  │
│  │  - Displays score if eligible                            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ GET /api/wallet/:address/stats
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND API (Express)                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Wallet Stats Service                                     │  │
│  │  - getAllStats(walletAddress)                            │  │
│  │  - Calls phase1Service.getPhase1Status()                 │  │
│  │  - Returns stats with phase1Status included              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Phase 1 Service                                          │  │
│  │  - Loads CSV on first request                            │  │
│  │  - Checks wallet eligibility                             │  │
│  │  - Returns { isPhase1, score, totalPhase1Wallets }      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  In-Memory Cache (Map)                                    │  │
│  │  Key: wallet_address (lowercase)                         │  │
│  │  Value: score                                            │  │
│  │  Size: 2,314 entries                                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Loaded from
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         DATA SOURCE                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ink-score-export-2026-02-24.csv                         │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ wallet_address,score                                │  │  │
│  │  │ 0x1A1E...1B5,7060                                  │  │  │
│  │  │ 0x2732...4800,6975                                 │  │  │
│  │  │ 0x4efd...0Ba3,6600                                 │  │  │
│  │  │ ... (2,314 total entries)                          │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## API Endpoints

### Primary Endpoint (Integrated)
```
GET /api/wallet/:address/stats
Response includes phase1Status in WalletStatsData
```

### Direct Phase 1 Endpoints
```
GET /api/phase1/check/:wallet
├─ Returns: { isPhase1, score, totalPhase1Wallets }
└─ Cache: 1 hour

GET /api/phase1/wallets
├─ Returns: { total, wallets: [{ address, score }] }
└─ Admin endpoint
```

## Data Flow Sequence

```
1. User connects wallet (0x1A1E...1B5)
   │
2. Dashboard requests wallet stats
   │
3. API: walletStatsService.getAllStats()
   │
4. API: phase1Service.getPhase1Status()
   │
   ├─ First call: Load CSV into memory
   │  └─ Parse 2,314 entries
   │     └─ Store in Map<address, score>
   │
   ├─ Normalize address to lowercase
   │
   ├─ Lookup in Map
   │  └─ Found: return { isPhase1: true, score: 7060 }
   │  └─ Not found: return { isPhase1: false, score: null }
   │
5. Return complete stats with phase1Status
   │
6. Dashboard displays Phase 1 card
   └─ Green "✓ Eligible" + Score: 7,060
```

## Component Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                    Phase 1 Feature                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Services Layer                                              │
│  ┌────────────────────┐      ┌──────────────────────┐      │
│  │ Phase1Service      │◄─────│ WalletStatsService   │      │
│  │ - Load CSV         │      │ - Get all stats      │      │
│  │ - Check eligibility│      │ - Include Phase 1    │      │
│  │ - Get score        │      └──────────────────────┘      │
│  └────────────────────┘                                     │
│           ▲                                                  │
│           │                                                  │
│  Routes Layer                                                │
│  ┌────────────────────┐                                     │
│  │ Phase1Routes       │                                     │
│  │ - /check/:wallet   │                                     │
│  │ - /wallets         │                                     │
│  └────────────────────┘                                     │
│           ▲                                                  │
│           │                                                  │
│  Frontend Layer                                              │
│  ┌────────────────────┐                                     │
│  │ Dashboard.tsx      │                                     │
│  │ - Display status   │                                     │
│  │ - Show score       │                                     │
│  └────────────────────┘                                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Caching Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      Cache Layers                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Level 1: In-Memory CSV Data                                │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Map<address, score>                                 │    │
│  │ TTL: Application lifetime                          │    │
│  │ Size: ~200KB (2,314 entries)                       │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  Level 2: API Response Cache                                │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Key: "phase1:check:{address}"                      │    │
│  │ TTL: 1 hour (static data)                          │    │
│  │ Storage: responseCache                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  Level 3: Wallet Stats Cache                                │
│  ┌────────────────────────────────────────────────────┐    │
│  │ Key: wallet address                                 │    │
│  │ TTL: 5 minutes                                      │    │
│  │ Includes: phase1Status                             │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Performance Characteristics

- **CSV Load Time:** ~50ms (one-time, 2,314 entries)
- **Lookup Time:** O(1) - Map.get() operation
- **Memory Usage:** ~200KB for all Phase 1 data
- **API Response:** <10ms (cached lookups)
- **Concurrent Requests:** Thread-safe (read-only after load)

## Error Handling

```
┌─────────────────────────────────────────────────────────────┐
│                    Error Scenarios                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. CSV File Not Found                                       │
│     └─ Log error, mark as loaded, return empty results      │
│                                                              │
│  2. Invalid CSV Format                                       │
│     └─ Skip invalid lines, continue processing              │
│                                                              │
│  3. Invalid Wallet Address                                   │
│     └─ Return 400 Bad Request                               │
│                                                              │
│  4. Service Unavailable                                      │
│     └─ Return 500 with error message                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```
