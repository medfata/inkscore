# InkScore NFT Contract

## Deployment via Remix IDE

### Prerequisites
1. Open [Remix IDE](https://remix.ethereum.org)
2. Connect your wallet to Ink Chain (Testnet or Mainnet)

### Ink Chain Network Details

**Testnet (Sepolia):**
- RPC URL: `https://rpc-gel-sepolia.inkonchain.com`
- Chain ID: `763373`

**Mainnet:**
- RPC URL: `https://rpc-gel.inkonchain.com`
- Chain ID: `57073`

### Deployment Steps

1. **Create the contract file**
   - In Remix, create a new file `InkScoreNFT.sol`
   - Copy the contents from `contracts/InkScoreNFT.sol`

2. **Compile**
   - Select Solidity compiler version `0.8.20`
   - Enable optimization (200 runs)
   - Click "Compile"

3. **Deploy**
   - Go to "Deploy & Run Transactions"
   - Select "Injected Provider" (MetaMask)
   - Ensure you're on Ink Chain network
   - Constructor parameters:
     - `baseURI`: Your API base URL (e.g., `https://inkscore.xyz`)
     - `_authorizedSigner`: The wallet address that will sign mint authorizations

4. **After Deployment**
   - Copy the deployed contract address
   - Copy the ABI from the "Compilation Details"
   - Provide both to integrate with the frontend

### Contract Functions

| Function | Description |
|----------|-------------|
| `mint(score, rank, expiry, signature)` | Mint NFT with backend authorization |
| `tokenURI(tokenId)` | Get metadata URI for a token |
| `hasNFT(wallet)` | Check if wallet has minted |
| `setBaseURI(uri)` | Update metadata base URI (owner only) |
| `setAuthorizedSigner(address)` | Update signer (owner only) |

---

# InkScore Staking Contract

`InkScoreStaking.sol` lets InkScore Zenith holders (`0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78`) stake/unstake their NFTs at any time. Fees are owner-configurable and paid in native ETH; an emergency path lets the owner return staked NFTs to their depositors without fees.

**Deployed (Ink mainnet, 2026-08-30):** [`0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6`](https://explorer.inkonchain.com/address/0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6) — tx `0x9fef56d8c2fffe3ec868e5449eed2d7115744852d83b4eced965a9fec46f4bd7`, owner `0x87051BC64293B9338351c829414fF29EB6ceA1a6`, fees `0/0`. Full ABI in `deployed-staking.json`.

## Deployment via Remix IDE

> The contract above was deployed programmatically with `scripts/deploy-staking.mjs` (solc 0.8.24, EVM cancun, optimizer 200 runs, key via `STAKING_PK` env var). The Remix instructions below remain for redeployments.

1. Open [Remix IDE](https://remix.ethereum.org), connect wallet to **Ink Chain mainnet** (Chain ID `57073`, RPC `https://rpc-gel.inkonchain.com`).
2. Create `InkScoreStaking.sol`, paste contents from `contracts/InkScoreStaking.sol`.
3. Compile with Solidity `0.8.20`, optimizer enabled (200 runs).
4. Deploy via "Injected Provider" (MetaMask) with constructor args:
   - `nftAddress`: `0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78`
   - `initialStakeFee`: `0` (recommended — set real fees after smoke testing)
   - `initialUnstakeFee`: `0`

## Post-deployment checklist

1. **Verify** the source on explorer.inkonchain.com (Flattened source via Remix "Contract Flattener" plugin works).
2. Smoke test from a wallet holding a Zenith NFT:
   - `isApprovedForAll(owner, staking)` → then `stake(tokenId)` with `{value: 0}`.
   - `stakedTokensOf(owner)`, `totalStaked()` reflect the change.
   - `unstake(tokenId)` returns the NFT; confirm ownership back in wallet.
   - Owner-only dry run of `emergencyUnstake(tokenId)`, `withdrawFees()` on a test stake.
3. Set production fees (from the **owner** wallet): `setFees(stakeFeeWei, unstakeFeeWei)`.
4. Copy the deployed address into **`lib/staking-contract.ts` → `STAKING_CONTRACT_ADDRESS`**, commit, redeploy the frontend (see `HETZNER_DEPLOY_RUNBOOK.md` Part 10).

## User functions

| Function | Payable | Notes |
|---|---|---|
| `stake(tokenId)` | yes (`msg.value >= stakeFee`) | Overpayment auto-refunded |
| `unstake(tokenId)` | yes (`msg.value >= unstakeFee`) | Only the depositor may unstake; overpayment auto-refunded |

## Owner functions

| Function | Purpose |
|---|---|
| `setFees(newStakeFee, newUnstakeFee)` | Update both fees atomically |
| `withdrawFees()` | Sweep full ETH balance to `owner()` |
| `emergencyUnstake(tokenId)` | Fee-less rescue returning NFT to its depositor |
| `emergencyUnstakeMany(uint256[])` | Batch rescue; skips unknown tokens instead of reverting |

## Read functions

| Function | Returns |
|---|---|
| `totalStaked()` | Count of all staked NFTs |
| `stakedCount(user)` | NFTs staked by one user |
| `stakedTokensOf(user)` | All token IDs staked by one user |
| `isStaked(tokenId)` | Staked-or-not flag |
| `stakeInfo(tokenId)` | `(depositor, stakedAt timestamp)` |
| `stakeFee()` / `unstakeFee()` | Current wei-denominated fees |

### Frontend ABI note

The frontend ships minimal human-readable ABIs (`lib/staking-contract.ts`). If you extend the contract's user-facing surface, keep that file in sync.
