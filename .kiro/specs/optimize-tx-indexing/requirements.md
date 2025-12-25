# Requirements Document

## Introduction

This document specifies the requirements for optimizing the transaction indexing system for Ink Chain (EVM-compatible, chain ID 57073). The current implementation achieves approximately 14 transactions per second using a combination of Routescan API for transaction lists and individual RPC calls for input data. The goal is to achieve 100+ transactions per second while capturing full input_data (calldata) for all transactions, using only free public infrastructure.

## Glossary

- **Transaction_Indexer**: The system component responsible for fetching, processing, and storing blockchain transaction data from Ink Chain
- **Input_Data**: The calldata field of a transaction containing the encoded function call and parameters (also known as `input` in RPC responses)
- **Routescan_API**: A block explorer API service that provides transaction lists for Ink Chain but does not include input_data in list responses
- **RPC_Endpoint**: A JSON-RPC endpoint that provides direct blockchain access for Ink Chain (rate-limited to 20 requests/second per endpoint)
- **Batch_JSON_RPC**: A JSON-RPC feature allowing multiple requests to be sent in a single HTTP call, reducing network overhead
- **Block_Based_Indexing**: An indexing strategy that fetches entire blocks with all transactions instead of individual transactions
- **Viem**: The TypeScript library used for Ethereum/EVM blockchain interactions

## Requirements

### Requirement 1: Implement JSON-RPC Batch Requests

**User Story:** As a system operator, I want the indexer to use true JSON-RPC batching, so that multiple transaction fetches are combined into single HTTP requests to maximize throughput within rate limits.

#### Acceptance Criteria

1. WHEN the Transaction_Indexer needs to fetch input_data for multiple transactions, THE Transaction_Indexer SHALL send them as a single Batch JSON-RPC HTTP request containing up to 100 individual `eth_getTransactionByHash` calls.

2. THE Transaction_Indexer SHALL configure viem's HTTP transport with `batch: true` and a `batchSize` of 100 to enable automatic request batching.

3. WHILE processing a batch of transactions, THE Transaction_Indexer SHALL wait no more than 50 milliseconds before sending the accumulated batch request.

4. IF a Batch JSON-RPC request fails, THEN THE Transaction_Indexer SHALL retry individual failed requests up to 3 times with exponential backoff starting at 500 milliseconds.

### Requirement 2: Implement Block-Based Indexing Strategy

**User Story:** As a system operator, I want the indexer to fetch entire blocks with full transaction data, so that I can retrieve input_data for all transactions in a block with a single RPC call.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL support a block-based indexing mode that uses `eth_getBlockByNumber` with `includeTransactions: true` to fetch all transactions with their input_data in a single call.

2. WHEN indexing a block range, THE Transaction_Indexer SHALL process blocks in parallel using up to 4 concurrent workers distributed across available RPC endpoints.

3. THE Transaction_Indexer SHALL extract and store the input_data field from each transaction returned by the block fetch operation.

4. WHILE using block-based indexing, THE Transaction_Indexer SHALL filter transactions to only store those interacting with configured contract addresses.

5. IF a block contains more than 500 transactions, THEN THE Transaction_Indexer SHALL process transactions in chunks of 500 to prevent memory exhaustion.

### Requirement 3: Implement Hybrid Indexing Approach

**User Story:** As a system operator, I want the indexer to combine Routescan API for transaction discovery with optimized RPC batching for input_data, so that I can leverage the strengths of both data sources.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL use Routescan API to discover transaction hashes and metadata for target contracts at a rate of up to 10 requests per second.

2. WHEN Routescan returns a batch of transactions, THE Transaction_Indexer SHALL immediately queue the transaction hashes for batch RPC fetching of input_data.

3. THE Transaction_Indexer SHALL maintain separate rate limiters for Routescan API (10 req/sec) and each RPC endpoint (20 req/sec).

4. THE Transaction_Indexer SHALL process Routescan pagination and RPC batch fetching concurrently to maximize throughput.

### Requirement 4: Implement Multi-Endpoint Load Balancing

**User Story:** As a system operator, I want the indexer to distribute requests across multiple RPC endpoints, so that I can achieve higher aggregate throughput than a single endpoint allows.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL distribute batch requests across all configured RPC endpoints using round-robin load balancing.

2. THE Transaction_Indexer SHALL track request counts per endpoint and respect the 20 requests per second limit for each endpoint independently.

3. IF an RPC endpoint returns an error or times out, THEN THE Transaction_Indexer SHALL temporarily remove that endpoint from the rotation for 30 seconds before retrying.

4. THE Transaction_Indexer SHALL support configuration of additional RPC endpoints without code changes through environment variables.

### Requirement 5: Achieve Target Performance

**User Story:** As a system operator, I want the indexer to achieve at least 100 transactions per second throughput, so that I can index 165,000 transactions in under 30 minutes instead of 3 hours.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL achieve a sustained throughput of at least 100 transactions per second when indexing historical transactions with input_data.

2. THE Transaction_Indexer SHALL log performance metrics including transactions per second, total processed, and estimated time remaining every 10 seconds during indexing.

3. THE Transaction_Indexer SHALL complete indexing of 165,000 transactions with full input_data in less than 30 minutes under normal network conditions.

4. WHILE indexing, THE Transaction_Indexer SHALL maintain a memory footprint below 512 MB to prevent out-of-memory errors.

### Requirement 6: Maintain Data Integrity

**User Story:** As a system operator, I want the indexer to ensure all transactions have complete and accurate input_data, so that downstream analysis can rely on the data quality.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL verify that fetched input_data matches the expected transaction hash before storing.

2. IF input_data cannot be fetched for a transaction after 3 retry attempts, THEN THE Transaction_Indexer SHALL mark the transaction as requiring backfill and continue processing.

3. THE Transaction_Indexer SHALL provide a backfill command that identifies and fills missing input_data for previously indexed transactions.

4. THE Transaction_Indexer SHALL store input_data exactly as received from the RPC without modification or truncation.

### Requirement 7: Support Resumable Indexing

**User Story:** As a system operator, I want the indexer to resume from where it left off after interruption, so that I don't lose progress on long-running indexing jobs.

#### Acceptance Criteria

1. THE Transaction_Indexer SHALL persist indexing progress (last processed block or cursor) to the database after each batch of transactions.

2. WHEN the Transaction_Indexer starts, THE Transaction_Indexer SHALL check for existing progress and resume from the last saved position.

3. THE Transaction_Indexer SHALL support a `--reset` flag to clear progress and start indexing from the beginning.

4. IF the indexer is interrupted during a batch, THEN THE Transaction_Indexer SHALL re-process that batch on restart to ensure no transactions are missed.
