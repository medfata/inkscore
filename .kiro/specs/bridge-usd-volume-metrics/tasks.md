# Implementation Plan

- [x] 1. Create Bridge Event Parser Module





  - [ ] 1.1 Create event signature constants and known token configuration



    - Define EVENT_SIGNATURES object with SocketBridge, SocketSwapTokens, ERC20_TRANSFER topics
    - Define KNOWN_TOKENS mapping with symbol, decimals, and priceType for stablecoins and ETH-pegged tokens
    - Add INK_CHAIN_ID constant (57073)
    - _Requirements: 1.1, 1.4, 4.4_



  - [x] 1.2 Implement SocketSwapTokens event parser

    - Create `parseSocketSwapTokensEvent()` function to decode event data
    - Extract fromToken, toToken, buyAmount, sellAmount, routeName, receiver from data field
    - Handle hex string parsing and BigInt conversion
    - _Requirements: 1.2, 2.1_


  - [x] 1.3 Implement SocketBridge event parser


    - Create `parseSocketBridgeEvent()` function to decode event data
    - Extract amount, token, toChainId, bridgeName, sender, receiver from data field
    - Validate toChainId differs from INK_CHAIN_ID for cross-chain detection

    - _Requirements: 1.1, 1.4, 2.2_

  - [x] 1.4 Implement ERC20 Transfer event parser


    - Create `parseERC20Transfers()` function to extract all Transfer events from logs
    - Extract tokenAddress from log.address, from/to from topics, amount from data
    - Return array of ERC20TransferEvent objects

    - _Requirements: 2.1, 2.4_


  - [ ] 1.5 Implement transaction classification logic


    - Create `classifyTransaction()` function that determines if transaction is bridge or swap
    - Check for SocketBridge event first (cross-chain bridge)
    - Check for SocketSwapTokens without SocketBridge (on-chain swap - exclude)
    - Return classification type and parsed events
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

  - [ ]* 1.6 Write unit tests for event parsers
    - Test SocketSwapTokens parsing with real transaction data
    - Test SocketBridge parsing with bridge transaction data
    - Test ERC20 Transfer parsing
    - Test classification logic for swap vs bridge
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Create Token Price Service
  - [ ] 2.1 Implement token price lookup
    - Create `getTokenPrice()` function that returns price and decimals for a token
    - Return $1.00 for known stablecoins (USDT, USDC, USDG, GHO, axlUSDC)
    - Return ETH price for WETH and native ETH address
    - Return 0 with fallback source for unknown tokens
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ] 2.2 Implement USD value calculation
    - Create `calculateUsdValue()` function that computes USD value from token amount
    - Apply correct decimals based on token configuration
    - Use formula: (amount / 10^decimals) * priceUsd
    - _Requirements: 3.5_

  - [ ]* 2.3 Write unit tests for token price service
    - Test stablecoin price returns $1.00
    - Test ETH-pegged token uses ETH price
    - Test unknown token returns fallback
    - Test USD calculation with various decimals
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Update Bridge Volume API Endpoint
  - [ ] 3.1 Add event parser integration to Bungee Socket Gateway processing
    - Import and instantiate BridgeEventParser in wallet.ts bridge route
    - Parse logs for each Socket Gateway transaction
    - Use classification to determine if transaction should be included
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 3.2 Implement ERC20 token bridge volume calculation
    - For cross-chain bridge transactions, extract token and amount from SocketBridge event
    - Calculate USD value using TokenPriceService
    - Add to platform totals (bridgedInUsd or bridgedOutUsd based on direction)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.5_

  - [ ] 3.3 Filter out on-chain swaps from bridge volume
    - Check classification type before adding to bridge totals
    - Skip transactions classified as 'on_chain_swap'
    - Log skipped transactions for debugging
    - _Requirements: 1.2, 1.3_

  - [ ] 3.4 Update bridge direction tracking for token bridges
    - Determine direction from SocketBridge sender/receiver vs wallet address
    - For bridge IN: receiver matches wallet
    - For bridge OUT: sender matches wallet
    - Update bridgedInUsd/bridgedOutUsd and counts accordingly
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 3.5 Write integration tests for bridge volume API
    - Test with cross-chain ETH bridge transaction
    - Test with cross-chain ERC20 bridge transaction
    - Test that on-chain swap is excluded
    - Verify USD values are calculated correctly
    - _Requirements: 1.1, 1.2, 2.1, 3.1, 5.1_

- [ ] 4. Update Enrichment Service for Token Data Storage
  - [ ] 4.1 Add token transfer parsing to enrichment pipeline
    - Parse ERC20 Transfer events during transaction enrichment
    - Identify tokens sent by wallet (tokens_out) and received by wallet (tokens_in)
    - Store parsed data in tokens_in_raw and tokens_out_raw columns
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 4.2 Calculate and store USD totals during enrichment
    - Calculate USD value for each token transfer using TokenPriceService
    - Sum values and store in tokens_in_usd_total and tokens_out_usd_total
    - Handle errors gracefully (store null if calculation fails)
    - _Requirements: 6.4_

  - [ ] 4.3 Update bridge volume API to use pre-calculated values
    - Check if tokens_in_usd_total/tokens_out_usd_total are available
    - Use pre-calculated values when available for better performance
    - Fall back to real-time parsing if pre-calculated values are null
    - _Requirements: 6.4, 6.5_

  - [ ]* 4.4 Write tests for enrichment token parsing
    - Test token transfer extraction from logs
    - Test USD calculation and storage
    - Test fallback behavior when pre-calculated values missing
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
