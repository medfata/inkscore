# Requirements Document

## Introduction

This feature migrates API endpoints from Next.js serverless functions to a dedicated Express.js server to solve database connection pool exhaustion. The current architecture creates new database connections per serverless function invocation, causing PostgreSQL connection limits to be exceeded with just 2 concurrent users making ~19 DB calls per dashboard load. The Express server will maintain a single shared connection pool, dramatically improving connection efficiency.

## Glossary

- **Express_Server**: A Node.js Express.js application running as a persistent service that handles API requests with a shared database connection pool
- **Connection_Pool**: A PostgreSQL connection pool managed by the `pg` library that reuses database connections across requests
- **API_Proxy**: A mechanism in Next.js that forwards incoming `/api/*` requests to the Express server
- **Health_Check_Endpoint**: An HTTP endpoint that returns server status for Docker health monitoring

## Requirements

### Requirement 1: Express Server Setup

**User Story:** As a developer, I want a dedicated Express.js server with TypeScript support, so that API endpoints run in a persistent process with shared database connections.

#### Acceptance Criteria

1. WHEN the Express_Server starts, THE Express_Server SHALL initialize a single PostgreSQL Connection_Pool using the same configuration pattern as `lib/db.ts`.
2. WHEN the Express_Server receives a request, THE Express_Server SHALL use the shared Connection_Pool for all database queries.
3. THE Express_Server SHALL expose a Health_Check_Endpoint at `/health` that returns HTTP 200 when the server is operational.
4. THE Express_Server SHALL listen on port 4000 for incoming HTTP requests.
5. THE Express_Server SHALL use TypeScript with ts-node for development execution.

### Requirement 2: Wallet API Endpoints Migration

**User Story:** As a frontend developer, I want the wallet API endpoints available on the Express server, so that dashboard wallet data loads without exhausting database connections.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/wallet/:address/stats`, THE Express_Server SHALL return wallet statistics using the same logic as the Next.js route handler.
2. WHEN a GET request is made to `/api/wallet/:address/bridge`, THE Express_Server SHALL return bridge volume data using the same logic as the Next.js route handler.
3. WHEN a GET request is made to `/api/wallet/:address/swap`, THE Express_Server SHALL return swap volume data using the same logic as the Next.js route handler.
4. WHEN a GET request is made to `/api/wallet/:address/volume`, THE Express_Server SHALL return total volume data using the same logic as the Next.js route handler.
5. WHEN a GET request is made to `/api/wallet/:address/score`, THE Express_Server SHALL return wallet score data using the same logic as the Next.js route handler.
6. WHEN a GET request is made to `/api/wallet/:address/nft2me`, THE Express_Server SHALL return NFT2Me data using the same logic as the Next.js route handler.
7. WHEN a GET request is made to `/api/wallet/:address/tydro`, THE Express_Server SHALL return Tydro data using the same logic as the Next.js route handler.
8. WHEN an invalid wallet address format is provided, THE Express_Server SHALL return HTTP 400 with an error message.

### Requirement 3: Analytics API Endpoints Migration

**User Story:** As a frontend developer, I want the analytics API endpoints available on the Express server, so that wallet analytics load efficiently.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/analytics/:wallet`, THE Express_Server SHALL return all analytics for the wallet using the same logic as the Next.js route handler.
2. WHEN a GET request is made to `/api/analytics/:wallet/:metric`, THE Express_Server SHALL return the specific metric data using the same logic as the Next.js route handler.
3. WHEN a GET request is made to `/api/analytics/:wallet/zns`, THE Express_Server SHALL return ZNS analytics using the same logic as the Next.js route handler.

### Requirement 4: Dashboard API Endpoints Migration

**User Story:** As a frontend developer, I want the dashboard cards API available on the Express server, so that dashboard card data loads without connection issues.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/dashboard/cards/:wallet`, THE Express_Server SHALL return dashboard card data with metrics using the same logic as the Next.js route handler.
2. WHEN an invalid wallet address is provided, THE Express_Server SHALL return HTTP 400 with an error message.

### Requirement 5: Marvk API Endpoint Migration

**User Story:** As a frontend developer, I want the Marvk API endpoint available on the Express server, so that Marvk metrics load efficiently.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/marvk/:wallet`, THE Express_Server SHALL return Marvk transaction metrics using the same logic as the Next.js route handler.
2. WHEN an invalid wallet address is provided, THE Express_Server SHALL return HTTP 400 with an error message.

### Requirement 6: Service Layer Reuse

**User Story:** As a developer, I want the Express server to reuse existing service modules, so that business logic remains consistent and maintenance is simplified.

#### Acceptance Criteria

1. THE Express_Server SHALL include copies of service modules from `lib/services/` that are used by the migrated endpoints.
2. THE Express_Server SHALL use the same service method signatures and return types as the original Next.js implementation.

### Requirement 7: Docker Integration

**User Story:** As a DevOps engineer, I want the Express server added to the existing Docker Compose configuration, so that it runs alongside other indexer services.

#### Acceptance Criteria

1. WHEN Docker Compose starts, THE Express_Server service SHALL be built and started as a container named `api-server`.
2. THE Express_Server service SHALL connect to the same PostgreSQL service used by other indexer services.
3. THE Express_Server service SHALL expose port 4000 to the host machine.
4. THE Express_Server service SHALL include a health check that verifies the Health_Check_Endpoint responds with HTTP 200.
5. THE Express_Server service SHALL depend on the PostgreSQL service being healthy before starting.

### Requirement 8: Next.js API Consolidation

**User Story:** As a frontend developer, I want Next.js to expose consolidated API endpoints that aggregate data from the Express server, so that the frontend makes fewer HTTP requests and the codebase is simplified.

#### Acceptance Criteria

1. WHEN a GET request is made to `/api/:wallet/dashboard` on the Next.js server, THE Next.js server SHALL call multiple Express_Server endpoints and return aggregated dashboard data in a single response.
2. THE `/api/:wallet/dashboard` endpoint SHALL aggregate data from: wallet stats, bridge volume, swap volume, total volume, analytics, dashboard cards, and Marvk metrics.
3. WHEN a GET request is made to `/api/:wallet/nft` on the Next.js server, THE Next.js server SHALL call the Express_Server NFT-related endpoints and return NFT data.
4. THE Next.js server SHALL use environment variable `API_SERVER_URL` to determine the Express_Server address, defaulting to `http://localhost:4000`.
5. THE Next.js server SHALL remove the original 19+ individual API route handlers after migration is complete.

### Requirement 9: Frontend API Client Update

**User Story:** As a frontend developer, I want the frontend to call the new consolidated endpoints, so that dashboard loading is simplified to 2 API calls instead of 19+.

#### Acceptance Criteria

1. WHEN the dashboard page loads, THE frontend SHALL make a single request to `/api/:wallet/dashboard` to fetch all dashboard data.
2. WHEN NFT data is needed, THE frontend SHALL make a request to `/api/:wallet/nft` to fetch NFT-related data.
3. THE frontend SHALL handle the new aggregated response format from the consolidated endpoints.
