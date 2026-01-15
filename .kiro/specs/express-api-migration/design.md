# Design Document: Express API Migration

## Overview

This design describes the migration of dashboard-related API endpoints from Next.js serverless functions to a dedicated Express.js server. The primary goal is to solve PostgreSQL connection pool exhaustion by maintaining a single shared connection pool in a persistent Express process, rather than creating new connections per serverless function invocation.

The architecture introduces:
1. A new Express.js server (`api-server/`) with all dashboard API endpoints
2. Two consolidated Next.js endpoints that aggregate data from the Express server
3. Docker Compose integration for deployment alongside existing indexer services

## Architecture

```mermaid
graph TB
    subgraph "Frontend (Browser)"
        FE[React Dashboard]
    end
    
    subgraph "Next.js (Vercel)"
        NJ_DASH["/api/:wallet/dashboard"]
        NJ_NFT["/api/:wallet/nft"]
        NJ_ADMIN["/api/admin/*"]
    end
    
    subgraph "Express Server (Docker)"
        EX[Express.js :4000]
        POOL[(Connection Pool<br/>max: 20)]
    end
    
    subgraph "PostgreSQL"
        DB[(ink_analytics)]
    end
    
    FE -->|"1 request"| NJ_DASH
    FE -->|"1 request"| NJ_NFT
    FE --> NJ_ADMIN
    
    NJ_DASH -->|"~12 parallel calls"| EX
    NJ_NFT -->|"NFT calls"| EX
    
    EX --> POOL
    POOL --> DB
    NJ_ADMIN --> DB
```

### Request Flow

**Before (Current):**
- Dashboard load → 19+ parallel API calls → 19+ serverless functions → 19+ DB connections
- With 2 concurrent users: 38+ connections (exceeds pool limits)

**After (New):**
- Dashboard load → 1 API call to Next.js → Next.js aggregates from Express → 1 shared pool
- Express maintains ~20 connections regardless of concurrent users

## Components and Interfaces

### 1. Express Server (`api-server/`)

```
api-server/
├── src/
│   ├── index.ts              # Server entry point
│   ├── db.ts                 # PostgreSQL connection pool
│   ├── routes/
│   │   ├── wallet.ts         # /api/wallet/:address/* routes
│   │   ├── analytics.ts      # /api/analytics/:wallet/* routes
│   │   ├── dashboard.ts      # /api/dashboard/cards/:wallet route
│   │   └── marvk.ts          # /api/marvk/:wallet route
│   └── services/
│       ├── wallet-stats-service.ts
│       ├── analytics-service.ts
│       ├── metrics-service.ts
│       ├── price-service.ts
│       ├── points-service-v2.ts
│       └── assets-service.ts
├── package.json
├── tsconfig.json
└── Dockerfile
```

### 2. Database Connection Pool

```typescript
// api-server/src/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                    // Higher limit for persistent server
  min: 5,                     // Keep minimum connections warm
  idleTimeoutMillis: 30000,   // Close idle after 30s
  connectionTimeoutMillis: 5000,
});

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export { pool };
```

### 3. Response Caching Layer

The Express server implements a 30-second in-memory cache per wallet address to prevent redundant database queries when the same wallet is requested multiple times in quick succession.

```typescript
// api-server/src/cache.ts
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL = 30 * 1000; // 30 seconds

class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // Clean up expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}

export const responseCache = new ResponseCache();

// Run cleanup every minute
setInterval(() => responseCache.cleanup(), 60 * 1000);
```

**Cache Keys:**
- `/api/wallet/:address/stats` → `wallet:stats:{address}`
- `/api/wallet/:address/bridge` → `wallet:bridge:{address}`
- `/api/wallet/:address/swap` → `wallet:swap:{address}`
- `/api/wallet/:address/volume` → `wallet:volume:{address}`
- `/api/wallet/:address/score` → `wallet:score:{address}`
- `/api/analytics/:wallet` → `analytics:{wallet}`
- `/api/dashboard/cards/:wallet` → `dashboard:cards:{wallet}`
- `/api/marvk/:wallet` → `marvk:{wallet}`

**Cache Behavior:**
- First request for a wallet: Query database, cache result, return response
- Subsequent requests within 30s: Return cached response immediately
- After 30s: Cache expires, next request queries database again

### 4. Express Routes

Each route handler is a direct copy of the Next.js route logic, adapted for Express with caching:

```typescript
// api-server/src/routes/wallet.ts
import { Router } from 'express';
import { walletStatsService } from '../services/wallet-stats-service';
import { responseCache } from '../cache';

const router = Router();

// GET /api/wallet/:address/stats
router.get('/:address/stats', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    const cacheKey = `wallet:stats:${address.toLowerCase()}`;
    const cached = responseCache.get(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    
    const stats = await walletStatsService.getAllStats(address);
    responseCache.set(cacheKey, stats);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching wallet stats:', error);
    res.status(500).json({ error: 'Failed to fetch wallet stats' });
  }
});

// Similar handlers for: bridge, swap, volume, score, nft2me, tydro
```

### 4. Next.js Consolidated Endpoints

```typescript
// app/api/[wallet]/dashboard/route.ts
import { NextRequest, NextResponse } from 'next/server';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;
  
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  // Parallel fetch all dashboard data from Express server
  const [stats, bridge, swap, volume, score, analytics, cards, marvk, nft2me, tydro] = 
    await Promise.all([
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/stats`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/bridge`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/swap`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/volume`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/score`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/analytics/${wallet}`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/dashboard/cards/${wallet}`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/marvk/${wallet}`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/nft2me`).then(r => r.json()),
      fetch(`${API_SERVER_URL}/api/wallet/${wallet}/tydro`).then(r => r.json()),
    ]);

  return NextResponse.json({
    stats,
    bridge,
    swap,
    volume,
    score,
    analytics,
    cards,
    marvk,
    nft2me,
    tydro,
  });
}
```

## Data Models

The Express server uses the same data models as the existing Next.js implementation. Key response types:

### WalletStatsData
```typescript
interface WalletStatsData {
  balanceUsd: number;
  balanceEth: number;
  totalTxns: number;
  nftCount: number;
  ageDays: number;
  firstTxDate: string | null;
  nftCollections: NftCollectionHolding[];
  tokenHoldings: TokenHolding[];
}
```

### BridgeVolumeResponse
```typescript
interface BridgeVolumeResponse {
  totalEth: number;
  totalUsd: number;
  txCount: number;
  bridgedInUsd: number;
  bridgedInCount: number;
  bridgedOutUsd: number;
  bridgedOutCount: number;
  byPlatform: Array<{
    platform: string;
    ethValue: number;
    usdValue: number;
    txCount: number;
    logo: string;
    url: string;
  }>;
}
```

### Consolidated Dashboard Response
```typescript
interface DashboardResponse {
  stats: WalletStatsData;
  bridge: BridgeVolumeResponse;
  swap: SwapVolumeResponse;
  volume: TotalVolumeResponse;
  score: WalletScoreResponse;
  analytics: UserAnalyticsResponse;
  cards: { row3: DashboardCardData[]; row4: DashboardCardData[] };
  marvk: MarvkMetrics;
  nft2me: Nft2MeResponse;
  tydro: TydroResponse;
}
```

## Error Handling

### Express Server
- All route handlers wrapped in try-catch
- Return appropriate HTTP status codes (400 for validation, 500 for server errors)
- Log errors with context for debugging
- Return empty/default data on non-critical failures (matching existing behavior)

### Next.js Aggregator
- Use `Promise.allSettled` for resilient parallel fetching
- Return partial data if some endpoints fail
- Include error indicators in response for failed sub-requests

```typescript
const results = await Promise.allSettled([
  fetch(`${API_SERVER_URL}/api/wallet/${wallet}/stats`),
  // ... other fetches
]);

const response = {
  stats: results[0].status === 'fulfilled' ? await results[0].value.json() : null,
  // ... handle each result
  errors: results
    .map((r, i) => r.status === 'rejected' ? endpoints[i] : null)
    .filter(Boolean),
};
```

## Testing Strategy

### Unit Tests (Optional)
- Test individual service methods with mocked database
- Test route handlers with mocked services

### Integration Tests
- Test Express endpoints against test database
- Verify response formats match existing Next.js responses

### Manual Testing
- Compare responses between old Next.js endpoints and new Express endpoints
- Load test with concurrent users to verify connection pool behavior

## Docker Integration

### Dockerfile (`api-server/Dockerfile`)
```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

CMD ["node", "dist/index.js"]
```

### Docker Compose Addition (`indexer/docker-compose.yml`)
```yaml
api-server:
  build: ../api-server
  restart: always
  depends_on:
    postgres:
      condition: service_healthy
  environment:
    DATABASE_URL: postgres://ink:${DB_PASSWORD}@postgres:5432/ink_analytics
    PORT: 4000
  ports:
    - "4000:4000"
  healthcheck:
    test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:4000/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

## Migration Steps

1. **Create Express Server**: Set up `api-server/` with TypeScript, copy services and route handlers
2. **Test Express Endpoints**: Verify all endpoints return correct data
3. **Add Docker Configuration**: Create Dockerfile and add to docker-compose.yml
4. **Create Next.js Aggregators**: Implement `/api/:wallet/dashboard` and `/api/:wallet/nft`
5. **Update Frontend**: Modify dashboard to use new consolidated endpoints
6. **Remove Old Routes**: Delete original Next.js API route handlers
7. **Deploy**: Deploy Express server via Docker, update Next.js environment variables

## Environment Variables

### Express Server
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: Server port (default: 4000)
- `RPC_URL`: Ink chain RPC endpoint (for viem client)

### Next.js
- `API_SERVER_URL`: Express server URL (default: `http://localhost:4000`)
