# INKSCORE

> Your Reputation on InkChain, Scored.

INKSCORE is the definitive on-chain credit score for the InkChain ecosystem. Analyze your wallet activity, DeFi participation, and NFT holdings to prove your worth in the ecosystem.

## What is INKSCORE?

INKSCORE is a comprehensive reputation scoring system that quantifies your on-chain behavior and consistency across the InkChain network. Your score is calculated based on your wallet's activity across five key dimensions:

- **DeFi Usage (30%)** - Liquidity provision, staking duration, and swap volume
- **Asset Holdings (25%)** - Quality of tokens and NFTs held in the wallet
- **Activity & Age (20%)** - Transaction frequency and wallet longevity
- **Ecosystem Loyalty (25%)** - Interaction with native InkChain dApps and governance

## Key Features

- **Reputation Score** - A quantitative measure of your on-chain behavior and consistency
- **Ink Native** - Built specifically for the InkChain ecosystem and its unique protocols
- **Non-Custodial** - Read-only access. We calculate scores without touching your assets
- **Dynamic Updates** - Your score evolves in real-time as you interact with the chain
- **Score NFT** - Mint an on-chain NFT that represents your INKSCORE achievement

## How Points Are Calculated

### Wallet Metrics

#### Token Holdings
- **Formula**: Total USD Value × 1.5
- Includes native ETH and all ERC-20 tokens
- Meme tokens (ANITA, CAT, PURPLE, ANDRU, KRAK, BERT) are excluded

#### Meme Coins
- **Formula**: Total USD Value × 1.2
- Supported: ANITA, CAT, PURPLE, ANDRU, KRAK, BERT

#### NFT Collections
- **Formula**: Tiered by count
  - 1-3 NFTs: 100 points
  - 4-9 NFTs: 200 points
  - 10+ NFTs: 300 points

#### Wallet Age
- **Formula**: Tiered by days
  - 1-30 days: 100 points
  - 31-90 days: 200 points
  - 91-180 days: 300 points
  - 181-365 days: 400 points
  - 366-730 days: 500 points
  - 730+ days: 600 points

#### Total Transactions
- **Formula**: Tiered by count
  - 1-100 txs: 100 points
  - 101-200 txs: 200 points
  - 201-400 txs: 300 points
  - 401-700 txs: 400 points
  - 701-900 txs: 500 points
  - 900+ txs: 600 points

### Platform Activities

#### Bridge IN
- **Formula**: USD Volume × 5
- Supported: Relay, Ink Official, Bungee, USDT0
- Higher multiplier rewards bringing liquidity to InkChain

#### Bridge OUT
- **Formula**: USD Volume × 4
- Supported: Relay, Ink Official, Bungee, USDT0

#### GM
- **Formula**: GM Count × 10
- Each GM interaction earns 10 points

#### Swap Volume
- **Formula**: USD Volume × 4
- Supported DEXes: InkySwap, DyorSwap, Velodrome, Curve

#### Tydro (Lending)
- **Formula**: (Supply USD + Borrow USD) × 10
- Both supply and borrow positions earn points

#### InkyPump
- **Formula**: Created × 50 + (Buy USD + Sell USD) × 2
- Creating a token: 50 points each
- Trading volume: 2 points per USD

#### Shellies
- **Formula**: Played × 10 + Staked × 100 + Raffles × 25
- Pay to Play games: 10 points each
- Staked NFTs: 100 points each
- Joined Raffles: 25 points each

#### ZNS Connect
- **Formula**: Deploy × 10 + GM × 5 + Register × 100
- Deploy smart contract: 10 points each
- Say GM: 5 points each
- Register domain: 100 points each

#### NFT2Me
- **Formula**: Collections × 25 + Minted × 10
- Create collection: 25 points each
- Mint NFT: 10 points each

#### NFT Trading
- **Formula**: Squid × 50 + Net Protocol × 25 + Mintiq × 10
- Squid Market trades: 50 points each
- Net Protocol trades: 25 points each
- Mintiq trades: 10 points each

#### Marvk
- **Formula**: Cards × 50 + (Lock + Vest) × 1.5
- Card minted: 50 points each
- Lock/Vest tokens: 1.5 points per action

#### Nado Finance
- **Formula**: Deposits × 5 + Volume × 0.1
- Total Deposits (USD): 5 points per dollar
- Total Volume (USD): 0.1 points per dollar

#### Copink
- **Formula**: Subaccounts × 50 + Volume × 2
- Subaccounts found: 50 points each
- Total Volume (USD): 2 points per dollar

## Score NFT

The INKSCORE NFT is a dynamic on-chain representation of your wallet's reputation score. It displays your current score and rank, and can be updated anytime your score changes.

### Features
- One NFT per wallet - updates replace the old one
- Shows your score and rank tier
- Free to mint (only gas fees)
- Secured with cryptographic signatures to prevent fake scores

### Contract Details
- **Contract Address**: `0x071E4CBEa9820d2De6Ad53BCb8e2d02ab30238A6`
- **Network**: InkChain Mainnet
- **Token Standard**: ERC-721
- **Token Name**: InkScore Achievement (INKSCORE)

## Architecture

INKSCORE uses a multi-layer architecture to collect, process, and serve wallet analytics data:

1. **Data Sources** - Ink RPCs, Third-Party APIs, Price Feeds
2. **Indexer** - Real-time block sync, transaction enrichment, metrics updates
3. **PostgreSQL Database** - Stores transactions, wallet stats, and cached scores
4. **API Server** - REST endpoints, score calculation, NFT signatures, caching layer
5. **Consumers** - Web App and Smart Contracts

## Tech Stack

- **Frontend**: Next.js, React, TypeScript, TailwindCSS
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL
- **Blockchain**: InkChain (EVM-compatible)
- **Indexer**: Hybrid indexer with CSV-based backfill and real-time sync
- **Deployment**: Docker, Docker Compose

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL
- An InkChain RPC endpoint

### Installation

```bash
# Clone the repository
git clone https://github.com/inkchainscore-ship-it/inkscore.git
cd inkscore

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run migrate

# Start the indexer
cd indexer
npm install
npm run dev

# Start the API server
cd api-server
npm install
npm run dev

# Start the web app
npm run dev
```

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/inkscore

# InkChain RPC
INK_RPC_URL=https://rpc-gel-sepolia.inkonchain.com

# API Server
API_URL=http://localhost:3001

# Contract
INKSCORE_NFT_CONTRACT=0x071E4CBEa9820d2De6Ad53BCb8e2d02ab30238A6
```

## Indexer

The INKSCORE indexer is a high-performance hybrid system that combines fast CSV-based historical backfill with real-time transaction synchronization.

### Features

- **Hybrid Architecture**: CSV export-based backfill + real-time sync
- **Event-Driven Enrichment**: Database triggers for instant transaction processing
- **Job Queue System**: Background processing with retry logic and priorities
- **Performance**: 500K transactions in ~87 seconds, 25 tx/batch enrichment at 66 req/sec
- **Smart Resume**: Automatic gap detection and recovery
- **Docker Support**: Easy deployment with Docker Compose

### Contract Types

- **Count Contracts**: Simple transaction counting for fast indexing
- **Volume Contracts**: Full enrichment with USD values and token amounts

### Quick Start (Docker)

```bash
# Start database
docker-compose up -d postgres

# Run migration (first time only)
docker-compose --profile setup run migrate-hybrid

# Start indexer
docker-compose up -d indexer

# Check logs
docker-compose logs -f indexer
```

### Manual Setup

```bash
cd indexer

# Install dependencies
npm install

# Build the project
npm run build

# Run migration
npm run db:migrate:hybrid

# Start the indexer
npm run start
```

### Monitoring

```bash
# Check job queue status
psql $DATABASE_URL -c "SELECT job_type, status, COUNT(*) FROM job_queue GROUP BY job_type, status;"

# Check contract status
psql $DATABASE_URL -c "SELECT contract_type, backfill_status, enrichment_status, COUNT(*) FROM contracts GROUP BY contract_type, backfill_status, enrichment_status;"

# View indexer logs
docker-compose logs -f indexer
```

### Performance Optimization

The indexer uses several optimization techniques:

- **CSV Export**: 500K transactions per batch (API limit)
- **Enrichment Batching**: 25 transactions per batch (optimal)
- **Rate Limiting**: 100ms delay between enrichment batches
- **Job Priorities**: Real-time sync (1), Enrichment (3), Backfill (5)
- **Event-Driven**: Database triggers for instant processing (<1 second)
- **Resource Efficiency**: 90% reduction in CPU usage, 95% fewer database queries

For more details, see the [indexer documentation](./indexer/).

## Project Structure

```
inkscore/
├── app/                    # Next.js app directory
│   ├── components/         # React components
│   ├── contexts/           # React contexts
│   ├── api/               # API routes
│   └── how-it-works/      # How it works page
├── api-server/            # Express API server
├── indexer/               # Blockchain indexer
│   ├── src/               # Indexer source code
│   ├── scripts/           # Utility scripts
│   ├── csv_exports/       # CSV export storage
│   └── *.md               # Indexer documentation
├── contracts/             # Smart contracts
├── lib/                   # Shared utilities
├── migrations/            # Database migrations
└── public/                # Static assets
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Links

- [Website](https://inkscore.xyz)
- [InkChain](https://inkonchain.com)
- [Explorer](https://explorer.inkonchain.com)

---

Built with ❤️ for the InkChain ecosystem
