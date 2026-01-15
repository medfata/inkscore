# Requirements Document

## Introduction

This feature enhances the bridge volume tracking system to accurately calculate USD volume for all bridge transactions, including those involving ERC20 tokens (not just ETH). Currently, the system has several critical gaps:

1. **Only handles ETH-based bridges** - Misses ERC20 token bridges (USDC, WETH, meme tokens)
2. **No distinction between swaps and bridges** - On-chain swaps via Bungee are incorrectly counted as bridge volume
3. **Missing token price calculation** - No mechanism to get USD prices for arbitrary ERC20 tokens
4. **No parsing of bridge-specific events** - SocketSwapTokens and SocketBridge events are not parsed

This feature will properly classify transactions, parse token transfer data, and calculate accurate USD values.

## Glossary

- **Bridge_Volume_System**: The existing system that tracks bridge transactions across platforms (Bungee, Relay, Ink Official, Native Bridge USDT0)
- **Transaction_Enrichment**: The database table storing enriched transaction data including logs, operations, and calculated values
- **Transaction_Logs**: All events emitted during a transaction's execution, including events from the main contract AND all contracts called during execution (ERC20 tokens, DEX pools, etc.)
- **Socket_Gateway**: Bungee's main contract (`0x3a23f943181408eac424116af7b7790c94cb97a5`) that handles token swaps and bridges
- **ERC20_Transfer_Event**: A token transfer event with signature `Transfer(address indexed from, address indexed to, uint256 value)` emitted by ERC20 token contracts
- **SocketSwapTokens_Event**: Bungee event emitted when tokens are swapped ON-CHAIN (not cross-chain), containing fromToken, toToken, buyAmount, sellAmount - this is NOT a bridge operation
- **SocketBridge_Event**: Bungee event emitted for CROSS-CHAIN bridge operations, contains destination chain ID
- **On_Chain_Swap**: A token swap that occurs entirely within Ink chain (e.g., CAT → ETH on Ink) - should NOT be counted as bridge volume
- **Cross_Chain_Bridge**: A transfer of assets from one blockchain to another (e.g., ETH from Ethereum to Ink) - should be counted as bridge volume
- **Token_Price_Service**: A service that provides USD prices for tokens based on their contract address
- **WETH**: Wrapped ETH contract at `0x4200000000000000000000000000000000000006`
- **Native_ETH_Address**: The special address `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` representing native ETH
- **Operations**: The internal call trace showing all contract calls made during transaction execution, including ETH value transfers

## Requirements

### Requirement 1: Distinguish Between On-Chain Swaps and Cross-Chain Bridges

**User Story:** As a wallet analytics user, I want only actual cross-chain bridge transactions to be counted in my bridge volume, so that on-chain swaps don't inflate my bridge metrics.

#### Acceptance Criteria

1. WHEN the Bridge_Volume_System processes a Bungee Socket Gateway transaction, THE Bridge_Volume_System SHALL check for the presence of SocketBridge_Event in the transaction logs.

2. WHEN a transaction contains SocketSwapTokens_Event but NO SocketBridge_Event, THE Bridge_Volume_System SHALL classify this as an On_Chain_Swap and exclude it from bridge volume calculations.

3. WHEN a transaction contains SocketBridge_Event, THE Bridge_Volume_System SHALL classify this as a Cross_Chain_Bridge and include it in bridge volume calculations.

4. THE Bridge_Volume_System SHALL parse the SocketBridge_Event to extract the destination chain ID and verify it differs from Ink chain ID (57073).

5. WHEN processing legacy Socket Gateway transactions without clear event classification, THE Bridge_Volume_System SHALL use the presence of cross-chain indicators (destination chain, bridge route name) to determine if it's a bridge.

### Requirement 2: Parse ERC20 Token Transfers from Bridge Transaction Logs

**User Story:** As a wallet analytics user, I want bridge transactions involving ERC20 tokens to be properly tracked, so that my total bridge volume accurately reflects all bridged assets.

#### Acceptance Criteria

1. WHEN the Bridge_Volume_System processes a transaction with logs containing ERC20_Transfer_Event, THE Bridge_Volume_System SHALL extract the token address, from address, to address, and amount from each Transfer event.

2. WHEN the Bridge_Volume_System encounters a SocketBridge_Event in transaction logs, THE Bridge_Volume_System SHALL parse the token address, amount, and destination chain from the event data.

3. WHILE processing bridge transactions, THE Bridge_Volume_System SHALL identify the user's wallet address and determine whether tokens were received (bridge IN) or sent (bridge OUT) based on Transfer event from/to addresses.

4. THE Bridge_Volume_System SHALL correlate ERC20_Transfer_Event with the user's wallet to identify the actual bridged token and amount.

### Requirement 3: Calculate USD Value for ERC20 Token Transfers

**User Story:** As a wallet analytics user, I want the USD value of my bridged ERC20 tokens to be calculated accurately, so that I can see the true dollar value of my bridge activity.

#### Acceptance Criteria

1. WHEN the Bridge_Volume_System calculates USD value for a token transfer, THE Bridge_Volume_System SHALL query the Token_Price_Service for the token's current USD price.

2. WHEN the token is a known stablecoin (USDT, USDC, USDG, GHO, axlUSDC), THE Bridge_Volume_System SHALL use a USD price of 1.00 without querying external price services.

3. WHEN the token is WETH or Native_ETH_Address, THE Bridge_Volume_System SHALL use the current ETH price from the eth_prices table.

4. WHEN the token price is unavailable, THE Bridge_Volume_System SHALL fall back to using the ETH value of the transaction multiplied by ETH price, or zero if no ETH value exists.

5. THE Bridge_Volume_System SHALL calculate token USD value using the formula: `(token_amount / 10^decimals) * token_price_usd`.

### Requirement 4: Support Multiple Token Types in Bridge Transactions

**User Story:** As a wallet analytics user, I want all types of tokens I bridge to be tracked, so that my bridge volume includes meme tokens, stablecoins, and other ERC20 tokens.

#### Acceptance Criteria

1. WHEN processing a Bungee bridge transaction, THE Bridge_Volume_System SHALL handle transactions where the user bridges ERC20 tokens (not just ETH).

2. WHEN a bridge transaction involves multiple token transfers, THE Bridge_Volume_System SHALL identify the primary bridged token by analyzing the SocketBridge event or the final transfer to/from the user.

3. WHERE a token's decimals are unknown, THE Bridge_Volume_System SHALL default to 18 decimals for ERC20 tokens.

4. THE Bridge_Volume_System SHALL maintain a mapping of known token addresses to their decimals and price sources.

### Requirement 5: Aggregate Bridge Volume by Direction

**User Story:** As a wallet analytics user, I want to see my bridge volume separated by direction (IN vs OUT), so that I can understand my cross-chain fund flows.

#### Acceptance Criteria

1. WHEN calculating bridge volume, THE Bridge_Volume_System SHALL separately track bridgedInUsd and bridgedOutUsd totals.

2. WHEN a user receives tokens via a bridge fulfillment transaction (from another chain TO Ink), THE Bridge_Volume_System SHALL classify the USD value as bridgedInUsd.

3. WHEN a user sends tokens via a bridge request transaction (from Ink TO another chain), THE Bridge_Volume_System SHALL classify the USD value as bridgedOutUsd.

4. THE Bridge_Volume_System SHALL include both bridgedInCount and bridgedOutCount transaction counts in the response.

### Requirement 6: Store Parsed Token Data for Performance

**User Story:** As a system administrator, I want parsed token transfer data to be stored in the database, so that bridge volume queries are fast and don't require re-parsing logs on every request.

#### Acceptance Criteria

1. WHEN the enrichment service processes a bridge transaction, THE Transaction_Enrichment table SHALL store parsed token transfer data in the tokens_in_raw and tokens_out_raw columns.

2. THE tokens_in_raw column SHALL contain a JSON array of objects with token_address, amount, decimals, and usd_value for each token received.

3. THE tokens_out_raw column SHALL contain a JSON array of objects with token_address, amount, decimals, and usd_value for each token sent.

4. WHEN querying bridge volume, THE Bridge_Volume_System SHALL use pre-calculated tokens_in_usd_total and tokens_out_usd_total values when available.

5. IF pre-calculated values are not available, THEN THE Bridge_Volume_System SHALL fall back to parsing logs in real-time.
