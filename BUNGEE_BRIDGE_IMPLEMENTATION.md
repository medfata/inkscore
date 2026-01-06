# Bungee Bridge Volume Implementation

## Overview
Added Bungee Socket Gateway bridge volume tracking to the existing bridge analytics system. This implementation analyzes transactions through the Socket Gateway contract (`0x3a23F943181408EAC424116Af7b7790c94Cb97a5`) and calculates USD volume for both cross-chain bridging and token swaps.

## Transaction Analysis
Based on the provided transaction examples:

### Transaction 1 (bungee_bridge_in_ink.json)
- **Type**: Token swap (CAT → ETH) via Bungee
- **Amount**: 10T CAT tokens → ~0.0001 ETH
- **Event**: `SocketSwapTokens` 
- **Purpose**: Meme token liquidation through aggregated DEX routing

### Transaction 2 (bungee_bridge_in_ink_tx2.json)
- **Type**: Cross-chain bridge (ETH from Ink to Base)
- **Amount**: 0.00018 ETH
- **Event**: `SocketBridge`
- **Purpose**: Moving ETH between chains via Across V3

## Implementation Details

### 1. Event Parsing Functions
Added parsing for two key Bungee events:

```typescript
// SocketBridge: Cross-chain bridging
function parseSocketBridgeEvent(data: string): { 
  amount: bigint; 
  token: string; 
  toChainId: bigint 
}

// SocketSwapTokens: Token swaps (often precedes bridging)
function parseSocketSwapTokensEvent(data: string): { 
  fromToken: string; 
  toToken: string; 
  buyAmount: bigint; 
  sellAmount: bigint 
}
```

### 2. Database Query Integration
Extended the existing bridge volume API (`/api/wallet/[address]/bridge`) to include Bungee transactions:

```sql
SELECT tx_hash, logs, eth_value_decimal, total_usd_volume, value
FROM transaction_enrichment
WHERE contract_address = '0x3a23f943181408eac424116af7b7790c94cb97a5'
  AND wallet_address = $1
  AND logs IS NOT NULL
```

### 3. USD Volume Calculation
Implements a fallback hierarchy for USD value calculation:

1. **Primary**: Use `total_usd_volume` from transaction enrichment
2. **Secondary**: Use `eth_value_decimal * eth_price`
3. **Tertiary**: Use raw transaction `value` (wei) converted to USD
4. **Fallback**: Parse event data to extract amounts
5. **Last Resort**: Use minimal placeholder value ($0.01) to count transactions

### 4. Event Type Handling

#### SocketBridge Events
- Identifies cross-chain bridge transactions
- Extracts amount, token address, and destination chain
- Handles native ETH (`0xeeee...`) and other tokens differently

#### SocketSwapTokens Events  
- Identifies token swap transactions within Bungee
- Often precedes bridging (swap then bridge pattern)
- Extracts buy/sell amounts and token addresses

### 5. Platform Integration
Adds Bungee to the `byPlatform` array in bridge volume response:

```typescript
{
  platform: 'Bungee',
  subPlatform: 'Socket Gateway',
  ethValue: 0, // USD tracking only
  usdValue: bungeeUsd,
  txCount: bungeeTxCount,
}
```

## Testing
Created comprehensive test script (`indexer/scripts/test-bungee-bridge-volume.ts`) that:

- Tests event parsing functions with real transaction data
- Queries database for Bungee transactions
- Validates USD volume calculations
- Provides detailed transaction analysis

## Key Features

### Robust Error Handling
- Continues processing if Bungee queries fail
- Graceful fallbacks for missing enrichment data
- Detailed error logging for debugging

### Multi-Token Support
- Native ETH handling via `0xeeee...` address
- Token-specific decimal handling
- Placeholder values for unknown tokens

### Transaction Classification
- Distinguishes between bridge and swap operations
- Counts both types toward total bridge volume
- Maintains separate metrics for analysis

## Integration Points

### Database Schema
Uses existing `transaction_enrichment` table:
- `contract_address`: Socket Gateway address
- `wallet_address`: User wallet
- `logs`: JSON event data
- `total_usd_volume`: Pre-calculated USD value
- `eth_value_decimal`: ETH amount
- `value`: Raw transaction value

### API Response
Extends existing `BridgeVolumeResponse` interface:
- Adds Bungee USD volume to `totalUsd`
- Includes Bungee transactions in `txCount`
- Lists Bungee as separate platform in `byPlatform`

### Dashboard Integration
Automatically appears in existing Bridge Volume card:
- Shows alongside Native Bridge (USDT0) and other bridges
- Displays USD volume and transaction count
- Maintains consistent UI/UX with other bridge platforms

## Usage
The implementation is automatically active once deployed. Users will see their Bungee bridge volume included in:

1. **Total Bridge Volume**: Combined USD value across all bridges
2. **Transaction Count**: Total bridge transactions including Bungee
3. **By Platform Breakdown**: Separate Bungee entry with volume and count

## Future Enhancements
1. **Token Price Integration**: Add real-time token pricing for non-ETH swaps
2. **Chain-Specific Metrics**: Track volume by destination chain
3. **Bridge Direction**: Distinguish between bridge IN/OUT for Bungee
4. **Historical Tracking**: Time-series analysis of Bungee usage
5. **Gas Optimization**: Batch queries for better performance

## Conclusion
This implementation provides comprehensive Bungee bridge volume tracking that integrates seamlessly with the existing bridge analytics system. It handles both the swap-then-bridge pattern (like the CAT token example) and direct cross-chain bridging (like the ETH to Base example), giving users complete visibility into their Bungee usage across the Ink ecosystem.