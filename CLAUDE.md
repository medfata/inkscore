# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InkScore is an on-chain reputation and analytics platform for InkChain. It aggregates wallet activity across 100+ smart contracts (DEXes, DeFi, NFTs, gaming) into a unified score with an ERC721 NFT badge.

## Architecture

Three independently running services share a PostgreSQL database:

1. **Next.js Frontend + API** (root `/`) - App Router pages, API routes under `/app/api/`, and service layer under `/lib/services/`. Runs on Vercel.
2. **Express API Server** (`/api-server/`) - Secondary backend on port 4000 for dashboard data aggregation. The Next.js API routes fetch from this server.
3. **Block Indexer** (`/indexer/`) - On-demand blockchain indexer that processes backfill jobs from a PostgreSQL job queue and enriches transaction data.

### Data Flow

Frontend -> Next.js API routes -> Express API server -> PostgreSQL (with pre-computed `user_analytics_cache`)
Indexer polls `job_queue` table -> fetches blockchain data via RPC -> writes to `transactions`/`token_transfers` tables -> enriches and caches metrics

### Key Patterns

- **Singleton services**: All services in `/lib/services/` export singleton instances (e.g., `export const analyticsService = new AnalyticsService()`)
- **SSE streaming**: Dashboard endpoint (`/app/api/[wallet]/dashboard/`) uses Server-Sent Events for progressive loading of 80+ metrics
- **Database pool**: Singleton pool pattern with max 5 connections, optimized for serverless (10s idle timeout, 5s connect timeout) in `/lib/db.ts`
- **ESM modules**: The indexer uses `"type": "module"` (ESM), while root and api-server use CommonJS

## Commands

### Root (Next.js frontend)
```bash
npm run dev          # Next.js dev server
npm run build        # Production build (uses --webpack flag)
npm run lint         # ESLint
npm test             # Vitest (watch mode)
npm run test:coverage
```

### API Server (`api-server/`)
```bash
cd api-server
npm run dev          # ts-node dev server
npm run build        # tsc compile
npm start            # Run compiled JS
```

### Indexer (`indexer/`)
```bash
cd indexer
npm run dev          # tsx watch hybrid-indexer
npm run dev:realtime # Real-time event streaming
npm run dev:enrichment # Data enrichment
npm run db:migrate   # Run migrations
npm run status       # Check backfill status
npm test             # Node native test runner (not Vitest)
```

### Running a single test
```bash
npx vitest run path/to/test.ts          # Root project (Vitest)
cd indexer && node --import tsx --test src/services/__tests__/BackfillService.test.ts  # Indexer (Node native)
```

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind CSS 4, Recharts, Wagmi 2 + Viem 2 (Web3), Reown AppKit (wallet connect)
- **Backend**: Express 4.18, PostgreSQL (pg), Redis (ioredis for leaderboard caching)
- **Indexer**: tsx for dev, Viem for RPC calls, PostgreSQL job queue
- **Testing**: Vitest (root), Node native test runner (indexer)
- **Contract**: Solidity ERC721 in `/contracts/InkScoreNFT.sol`

## Environment Variables

Required: `DATABASE_URL`, `API_SERVER_URL` (default localhost:4000), `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `ADMIN_WALLETS` (comma-separated addresses), `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`, `REDIS_URL`, `CRON_SECRET`

## Important Conventions

- Admin API routes are under `/app/api/admin/` and require wallet-based auth verification
- Dynamic wallet routes use `[wallet]` param: `/app/api/[wallet]/dashboard`, `/app/api/[wallet]/nft`
- Contract ABIs live in `/lib/abis/` and the massive config in `/indexer/src/config.ts`
- Database migrations are SQL files in `/migrations/` (root) and `/indexer/src/db/` (indexer-specific)
- The api-server has its own duplicated service layer (`/api-server/src/services/`) separate from `/lib/services/`
