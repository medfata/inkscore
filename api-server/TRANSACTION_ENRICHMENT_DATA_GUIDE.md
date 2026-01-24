# Transaction Enrichment Data Guide

This document explains the `logs` and `operations` fields in the `transaction_enrichment` table, which are critical for parsing bridge transactions and calculating USD volumes.

## Overview

When a transaction is enriched via the Routescan API, we store two key JSON fields:

- **`logs`**: All events emitted during the transaction (from ALL contracts involved)
- **`operations`**: The internal call trace showing contract interactions and ETH transfers

---

## Logs Field

The `logs` field contains an array of all events emitted during transaction execution. This includes events from:
- The main contract being called (e.g., Bungee Socket Gateway)
- ERC20 token contracts (Transfer, Approval events)
- DEX pools (Swap, Sync events)
- Any other contracts called during execution

### Log Entry Structure

```typescript
interface LogEntry {
  index: number;           // Position in the logs array
  address: {
    id: string;            // Contract address that emitted the event
    alias?: string;        // Human-readable name (e.g., "Cat Call Agent")
    tags?: string[];       // Contract tags (e.g., ["meme"], ["liquidity_pool"])
    icon?: string;         // Token icon URL
    dapp?: {
      alias: string;       // DApp name (e.g., "Bungee", "InkySwap")
      tags: string[];
    };
  };
  topics: string[];        // Event signature (topic[0]) and indexed parameters
  data: string;            // Non-indexed event parameters (hex encoded)
  event?: string;          // Decoded event signature (e.g., "Transfer(address indexed _from, address indexed _to, uint256 _value)")
  removed: boolean;        // Whether the log was removed (reorg)
  contractVerified: boolean;
}
```

### Common Event Signatures (topic[0])

| Event | Signature (topic[0]) | Description |
|-------|---------------------|-------------|
| ERC20 Transfer | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | Token transfer between addresses |
| ERC20 Approval | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` | Token approval for spender |
| Uniswap V2 Swap | `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822` | DEX swap event |
| Uniswap V2 Sync | `0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1` | Pool reserves sync |
| WETH Withdrawal | `0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65` | WETH unwrap to ETH |
| SocketSwapTokens | `0xb346a959ba6c0f1c7ba5426b10fd84fe4064e392a0dfcf6609e9640a0dd260d3` | Bungee on-chain swap |
| SocketBridge | `0x74594da9e31ee4068e17809037db37db496702bf7d8d63afe6f97949277d1609` | Bungee cross-chain bridge |
| OFTSent | `0x85496b760a4b7f8d66384b9df21b381f5d1b1e79f229a47aaf4c232edc2fe59a` | LayerZero OFT sent |
| OFTReceived | `0xefed6d3500546b29533b128a29e3a94d70788727f0507505ac12eaf2e578fd9c` | LayerZero OFT received |

### Parsing ERC20 Transfer Events

```typescript
// ERC20 Transfer event structure:
// topics[0] = event signature
// topics[1] = from address (indexed, padded to 32 bytes)
// topics[2] = to address (indexed, padded to 32 bytes)
// data = amount (uint256, 32 bytes hex)

function parseERC20Transfer(log: LogEntry) {
  const from = '0x' + log.topics[1].slice(-40).toLowerCase();
  const to = '0x' + log.topics[2].slice(-40).toLowerCase();
  const amount = BigInt(log.data);
  const tokenAddress = log.address.id.toLowerCase();
  
  return { tokenAddress, from, to, amount };
}
```

### Parsing SocketSwapTokens Event (Bungee On-Chain Swap)

This event indicates an **on-chain swap** (NOT a cross-chain bridge).

```typescript
// SocketSwapTokens event data layout (each field is 32 bytes):
// [0-64]    fromToken address
// [64-128]  toToken address (0xeeee... = native ETH)
// [128-192] buyAmount (amount received)
// [192-256] sellAmount (amount sent)
// [256-320] routeName (bytes32)
// [320-384] receiver address
// [384-448] metadata (bytes32)

function parseSocketSwapTokens(data: string) {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  
  return {
    fromToken: '0x' + cleanData.slice(24, 64).toLowerCase(),
    toToken: '0x' + cleanData.slice(88, 128).toLowerCase(),
    buyAmount: BigInt('0x' + cleanData.slice(128, 192)),
    sellAmount: BigInt('0x' + cleanData.slice(192, 256)),
    receiver: '0x' + cleanData.slice(344, 384).toLowerCase(),
  };
}
```

### Parsing SocketBridge Event (Bungee Cross-Chain Bridge)

This event indicates an actual **cross-chain bridge** operation.

```typescript
// SocketBridge event data layout:
// [0-64]    amount
// [64-128]  token address
// [128-192] toChainId (destination chain)
// [192-256] bridgeName (bytes32)
// [256-320] sender address
// [320-384] receiver address
// [384-448] metadata (bytes32)

function parseSocketBridge(data: string) {
  const cleanData = data.startsWith('0x') ? data.slice(2) : data;
  
  return {
    amount: BigInt('0x' + cleanData.slice(0, 64)),
    token: '0x' + cleanData.slice(88, 128).toLowerCase(),
    toChainId: Number(BigInt('0x' + cleanData.slice(128, 192))),
    sender: '0x' + cleanData.slice(280, 320).toLowerCase(),
    receiver: '0x' + cleanData.slice(344, 384).toLowerCase(),
  };
}
```

---

## Operations Field

The `operations` field contains the internal call trace, showing all contract calls made during transaction execution. This is useful for:
- Tracking ETH transfers between contracts
- Understanding the execution flow
- Identifying which contracts were called

### Operation Entry Structure

```typescript
interface Operation {
  index: number;           // Position in call trace
  type: string;            // Call type: "CALL", "DELEGATECALL", "STATICCALL"
  from: {
    id: string;            // Caller address
    alias?: string;
    isContract: boolean;
  };
  to: {
    id: string;            // Called contract address
    alias?: string;
    isContract: boolean;
    dapp?: { alias: string };
  };
  value: string;           // ETH value transferred (in wei)
  gas: string;             // Gas provided
  gasUsed: string;         // Gas actually used
  methodId: string;        // Function selector (first 4 bytes of calldata)
  status: boolean;         // Whether the call succeeded
}
```

### Finding ETH Transfers to User

```typescript
function findEthTransferToUser(operations: Operation[], userWallet: string): bigint {
  for (const op of operations) {
    if (
      op.to?.id?.toLowerCase() === userWallet.toLowerCase() &&
      op.value &&
      BigInt(op.value) > 0n &&
      op.status === true
    ) {
      return BigInt(op.value);
    }
  }
  return 0n;
}
```

### Common Method IDs

| Method ID | Function | Description |
|-----------|----------|-------------|
| `0x23b872dd` | transferFrom | ERC20 transferFrom |
| `0xa9059cbb` | transfer | ERC20 transfer |
| `0x095ea7b3` | approve | ERC20 approve |
| `0x70a08231` | balanceOf | ERC20 balance query |
| `0x2e1a7d4d` | withdraw | WETH unwrap |
| `0x38ed1739` | swapExactTokensForTokens | Uniswap V2 swap |
| `0x022c0d9f` | swap | Uniswap V2 pool swap |

---

## Example: Analyzing a Bungee Swap Transaction

Given the transaction `0x9538315d0160229140ab3dd0515f7f3602c80006d4ad3e7df52265c78c5592a0`:

### Key Logs Analysis

1. **Log Index 0-6**: ERC20 Transfer events for CAT token moving through various contracts
2. **Log Index 7**: WETH Transfer from pool to swap router
3. **Log Index 9**: Uniswap V2 Swap event showing CAT → WETH swap
4. **Log Index 10**: WETH Withdrawal (unwrap to ETH)
5. **Log Index 13**: **SocketSwapTokens** event (KEY EVENT)

### SocketSwapTokens Event (Log Index 13)

```json
{
  "event": "SocketSwapTokens(address fromToken, address toToken, uint256 buyAmount, uint256 sellAmount, bytes32 routeName, address receiver, bytes32 metadata)",
  "data": "0x00000000000000000000000020c69c12abf2b6f8d8ca33604dd25c700c7e70a5000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee000000000000000000000000000000000000000000000000000061c966a71c8d000000000000000000000000000000000000000000000008b03bd0ab87f3f123..."
}
```

Parsed:
- **fromToken**: `0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5` (CAT token)
- **toToken**: `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` (Native ETH)
- **buyAmount**: `107517638548621` wei ≈ 0.0001075 ETH
- **sellAmount**: `161,000,000,000,000,000,000` (161 CAT tokens with 18 decimals)

### Classification

- **Has SocketSwapTokens**: ✅ YES
- **Has SocketBridge**: ❌ NO
- **Classification**: **ON-CHAIN SWAP** (not a bridge)

This transaction should NOT be counted as bridge volume because it's a swap within Ink chain, not a cross-chain transfer.

---

## Bridge vs Swap Detection Logic

```typescript
function classifyBungeeTransaction(logs: LogEntry[]): 'bridge' | 'swap' | 'unknown' {
  let hasSocketBridge = false;
  let hasSocketSwapTokens = false;
  
  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase();
    
    if (topic0 === '0x74594da9e31ee4068e17809037db37db496702bf7d8d63afe6f97949277d1609') {
      hasSocketBridge = true;
    }
    if (topic0 === '0xb346a959ba6c0f1c7ba5426b10fd84fe4064e392a0dfcf6609e9640a0dd260d3') {
      hasSocketSwapTokens = true;
    }
  }
  
  // SocketBridge = cross-chain bridge
  if (hasSocketBridge) return 'bridge';
  
  // SocketSwapTokens without SocketBridge = on-chain swap
  if (hasSocketSwapTokens) return 'swap';
  
  return 'unknown';
}
```

---

## Special Addresses

| Address | Description |
|---------|-------------|
| `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` | Native ETH (used in events) |
| `0x4200000000000000000000000000000000000006` | WETH on Ink chain |
| `0x3a23f943181408eac424116af7b7790c94cb97a5` | Bungee Socket Gateway |
| `0x26d8da52e56de71194950689ccf74cd309761324` | Bungee Fulfillment (Bridge IN) |
| `0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc` | Bungee Request (Bridge OUT) |

---

## Related Files

- `api-server/src/routes/wallet.ts` - Bridge volume API endpoint
- `indexer/src/services/VolumeEnrichmentService.ts` - Transaction enrichment
- `.kiro/specs/bridge-usd-volume-metrics/` - Spec for improved bridge tracking
