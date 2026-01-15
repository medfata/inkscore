# Implementation Plan

- [x] 1. Set up Express server project structure





  - [x] 1.1 Create `api-server/` directory with TypeScript configuration

    - Create `api-server/package.json` with express, pg, typescript, ts-node dependencies
    - Create `api-server/tsconfig.json` with Node.js TypeScript settings
    - Create `api-server/.env.example` with required environment variables
    - _Requirements: 1.1, 1.4, 1.5_











  - [x] 1.2 Implement database connection pool and cache modules







    - Create `api-server/src/db.ts` with PostgreSQL pool (max: 20 connections)

    - Create `api-server/src/cache.ts` with 30-second TTL response cache


    - _Requirements: 1.1, 1.2_

  - [x] 1.3 Create Express server entry point with health check






    - Create `api-server/src/index.ts` with Express app setup

    - Implement `/health` endpoint returning HTTP 200
    - Configure CORS and JSON middleware
    - _Requirements: 1.3, 1.4_

- [x] 2. Copy and adapt service modules



  - [x] 2.1 Copy core services from `lib/services/` to Express server

    - Copy `wallet-stats-service.ts` and adapt imports
    - Copy `analytics-service.ts` and adapt imports
    - Copy `metrics-service.ts` and adapt imports
    - Copy `price-service.ts` and adapt imports
    - Copy `points-service-v2.ts` and adapt imports
    - Copy `assets-service.ts` and adapt imports
    - _Requirements: 6.1, 6.2_

  - [x] 2.2 Copy required type definitions





    - Copy relevant types

 from `lib/types/` to `api-server/src/types/`
    - _Requirements: 6.2_
- [x] 3. Implement wallet API routes










- [ ] 3. Implement wallet API routes

  - [x] 3.1 Create wallet stats route handler


    - Create `api-server/src/routes/wallet.ts`
    - Implement GET `/api/wallet/:address/stats` with caching
    - _Requirements: 2.1, 2.8_

  - [x] 3.2 Implement bridge volume route handler

    - Add GET `/api/wallet/:address/bridge` to wallet routes
    - Copy bridge calculation logic from Next.js route
    - _Requirements: 2.2_


  - [x] 3.3 Implement swap volume route handler






    - Add GET `/api/wallet/:address/swap` to wallet routes
    - Copy swap calculation logic from Next.js route
    - _Requirements: 2.3_


  - [x] 3.4 Implement total volume route handler


    - Add GET `/api/wallet/:address/volume` to wallet routes
    - Copy volume calculation logic from Next.js route
    - _Requirements: 2.4_

  - [x] 3.5 Implement wallet score route handler

    - Add GET `/api/wallet/:address/score` to wallet routes
    - Use points-service-v2 for score calculation
    - _Requirements: 2.5_


  - [x] 3.6 Implement NFT2Me route handler


    - Add GET `/api/wallet/:address/nft2me` to wallet routes
    - Copy NFT2Me query logic from Next.js route
    - _Requirements: 2.6_



  - [x] 3.7 Implement Tydro route handler

    - Add GET `/api/wallet/:address/tydro` to wallet 
routes
    - Copy Tydro calculation logic from Next.js route
    - _Requirements: 2.7_

- [x] 4. Implement analytics API routes






  - [x] 4.1 Create analytics routes file


    - Create `api-server/src/routes/analytics.ts`
    - Implement GET `/api/analytics/:wallet` with caching
    - _Requirements: 3.1_


  - [x] 4.2 Implement metric-specific route handler

    - Add GET `/api/analytics/:wallet/:metric` to analytics routes

    - Copy metric calculation logic including special metrics (gm_count, inkypump, shellies, nft_traded)

    - _Requirements: 3.2_

  - [x] 4.3 Implement ZNS analytics route handler

    - Add GET `/api/analytics/:wallet/zns` to analytics routes
    - Copy ZNS query logic from Next.js route
    - _Requirements: 3.3_

- [x] 5. Implement dashboard and marvk API routes






  - [x] 5.1 Create dashboard cards route


    - Create `api-server/src/routes/dashboard.ts`

    - Implement GET `/api/dash
board/cards/:wallet` with caching
    - Copy dashboard cards query logic from Next.js route
    - _Requirements: 4.1, 4.2_

  - [x] 5.2 Create marvk route


    - Create `api-server/src/routes/marvk.ts`
    - Implement GET `/api/marvk/:wallet` with caching
    - Copy Marvk metrics query logic from Next.js route
    - _Requirements: 5.1, 5.2_

/indexer/dist- [x] 6. Docker integration

  - [x] 6.1 Create Dockerfile for Express server
    - Create `api-server/Dockerfile` with Node.js 20 Alpine base

  - [x] 6.2 Add api-server service to docker-compose.yml

    - Add `api-server` service to `indexer/docker-compose.yml`
    - Configure port 4000 exposure
    - Set DATABASE_URL environment variable
    - Add health check configuration
    - Add dependency on postgres service
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_



- [x] 7. Create Next.js consolidated endpoints







  - [x] 7.1 Create dashboard aggregator endpoint

    - Create `app/api/[wallet]/dashboard/route.ts`
    - Implement parallel fetching from Express server endpoints
    - Aggregate stats, bridge, swap, volume, score, analytics, cards, marvk, nft2me, tydro
    - Use API_SERVER_URL environment variable
    - _Requirements: 8.1, 8.2, 8.4_



  - [x] 7.2 Create NFT ag


gregator endpoint
    - Create `app/api/[wallet]/nft/route.ts`
    - Implement fetching NFT-related data from Express server
    - _Requirements: 8.3_

- [x] 8. Update frontend to use consolidated endpoints





  - [x] 8.1 Update dashboard data fetching


    - Modify dashboard page to call `/api/:wallet/dashboard` instead of individual endpoints
    - Update data handling to use aggregated response format
    - _Requirements: 9.1, 9.3_

  - [x] 8.2 Update NFT data fetching


    - Modify NFT-related components to call `/api/:wallet/nft`
    - _Requirements: 9.2_

- [x] 9. Cleanup old Next.js API routes







  - [x] 9.1 Remove migrated API route handlers

    - Delete `app/api/wallet/[address]/` directory
    - Delete `app/api/analytics/[wallet]/` directory
    - Delete `app/api/dashboard/cards/[wallet]/` directory
    - Delete `app/api/marvk/[wallet]/` directory
    - _Requirements: 8.5_
