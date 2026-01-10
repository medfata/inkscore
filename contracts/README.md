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
