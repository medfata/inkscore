# Admin Mint Scores

Mint custom InkScore NFTs for wallets using a CSV file.

## Prerequisites

- **Node.js 18+** installed ([download here](https://nodejs.org/))
- Access to the InkScore database
- The `NFT_SIGNER_PRIVATE_KEY` from the server

## Setup

### 1. Install dependencies

```bash
npm install
```

This installs: `ethers`, `csv-parse`, `pg`, `dotenv`

### 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env` with these values:

```
NFT_SIGNER_PRIVATE_KEY=0x...        # Backend signer private key
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=0x... # NFT contract address
DATABASE_URL=postgresql://...        # PostgreSQL connection string
```

**To get these values from the server:**
```bash
ssh root@77.42.41.78
grep -E 'NFT_SIGNER_PRIVATE_KEY|NEXT_PUBLIC_NFT_CONTRACT_ADDRESS|DATABASE_URL' /root/inkscore-web.env /root/indexer/.env
```

## Usage

### 1. Prepare your CSV

Edit `mint.csv` with wallets to mint:

```csv
private_key,score,rank
0xabc123...,8750,The Kraken
0xdef456...,9500,
```

- **private_key**: Wallet's private key (0x + 64 hex chars)
- **score**: Custom score (any positive number)
- **rank**: Optional - auto-calculated if empty

**Auto-rank thresholds:**
- 10000+ → Ink God
- 8500+ → The Kraken
- 7000+ → Abyss Lord
- 5000+ → Commander
- 3500+ → Captain
- 2000+ → Deep Diver
- 1000+ → Explorer
- 500+ → Little Squid
- <500 → Ink Drop

### 2. Run the script

```bash
node admin-mint-scores.js mint.csv
```

The script will:
1. Validate your CSV and environment
2. Test database and RPC connections
3. Show a preview of what will be minted
4. Ask for confirmation before proceeding
5. Mint each NFT and update the database
6. Show a summary with success/failure details

## Example Output

```
=== InkScore Admin Mint Tool ===

✓ Loaded 2 wallet(s) from mint.csv
ℹ Testing database connection...
✓ Database connection OK
ℹ Testing RPC connection...
✓ Connected to network: ink (chain 57073)

--- Preview ---
  1. 0x1234...5678 → Score: 8750 (The Kraken)
  2. 0xabcd...efgh → Score: 9500 (The Kraken)

About to mint 2 NFT(s). Continue? (y/n): y

--- Minting ---

ℹ [1/2] Minting score 8750 (The Kraken) for 0x1234...5678
ℹ Waiting for confirmation...
✓ Success! TX: 0xabc...

ℹ [2/2] Minting score 9500 (The Kraken) for 0xabcd...efgh
ℹ Waiting for confirmation...
✓ Success! TX: 0xdef...

=== Summary ===
Total: 2
Success: 2
Failed: 0
```

## Troubleshooting

**"Missing NEXT_PUBLIC_NFT_CONTRACT_ADDRESS in .env"**
→ Copy the values from the server (see Setup step 2)

**"Failed to connect to database"**
→ Check DATABASE_URL is correct and you have network access to the database

**"Low balance: 0.0001 ETH"**
→ The wallet needs at least 0.001 ETH on InkChain for gas fees

**"This wallet already has an NFT with this score"**
→ The wallet was already minted with these exact parameters
