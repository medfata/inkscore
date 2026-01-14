# Platform → Contracts Map

This document maps each platform shown in the dashboard to its corresponding contracts in the indexer.

## Summary

| Platform | Contracts Used | Status |
|----------|---------------|--------|
| GM | 1 | ✅ Used |
| Tydro | 2 | ✅ Used |
| InkySwap | 1 | ✅ Used |
| Velodrome | 1 | ✅ Used |
| DyorSwap | 1 | ✅ Used |
| Curve | 1 | ✅ Used |
| InkyPump | 1 | ✅ Used |
| Native Bridge (USDT0) | 2 | ✅ Used |
| Relay / Ink Official | 2 | ✅ Used |
| Bungee | 3 | ✅ Used |
| NFT Marketplaces | 3 | ✅ Used |
| ZNS | 3 | ✅ Used |
| NFT2Me | 2 | ✅ Used |
| Marvk | 1 | ✅ Used |
| Shellies | 3 | ✅ Used |
| Gas.zip | 1 | ⚠️ Bridge Hot Wallet |
| Owlto | 2 | ⚠️ Bridge Hot Wallet + Contract |
| Orbiter | 1 | ⚠️ Bridge Hot Wallet |

---

## DEX Platforms (Swap Volume Card)

### DyorSwap
- **Contract**: `0x9b17690dE96FcFA80a3acaEFE11d936629cd7a77`
- **Name**: DyorRouterV2
- **Website**: https://dyorswap.finance

### InkySwap
- **Contract**: `0x551134e92e537cEAa217c2ef63210Af3CE96a065`
- **Name**: UniversalRouter
- **Website**: https://inkyswap.com

### Velodrome
- **Contract**: `0x01D40099fCD87C018969B0e8D4aB1633Fb34763C`
- **Name**: UniversalRouter
- **Website**: https://velodrome.finance

### Curve
- **Contract**: `0xd7E72f3615aa65b92A4DBdC211E296a35512988B`
- **Name**: CurveRouter
- **Website**: https://curve.fi

---

## DeFi Platforms

### Tydro (Lending/Borrowing)
- **Contract 1**: `0xDe090EfCD6ef4b86792e2D84E55a5fa8d49D25D2`
  - Name: WrappedTokenGatewayV3
  - Functions: depositETH, borrowETH, withdrawETH, repayETH
- **Contract 2**: `0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA`
  - Name: TydroPool
- **Website**: https://app.tydro.com

---

## Bridge Platforms (Bridge Volume Card)

### Native Bridge (USDT0)
- **Contract 1**: `0x1cb6de532588fca4a21b7209de7c456af8434a65`
  - Name: OFT Adapter (Bridge OUT)
- **Contract 2**: `0xfebcf17b11376c724ab5a5229803c6e838b6eae5`
  - Name: LayerZero Executor (Bridge IN)
- **Website**: https://usdt0.to

### Relay / Ink Official Bridge
- **Contract**: `0x4cD00E387622C35bDDB9b4c962C136462338BC31`
  - Name: RelayDepository
- **Hot Wallet**: `0xf70da97812CB96acDF810712Aa562db8dfA3dbEF`
  - Method Selectors:
    - `0x0c6d9703` → Ink Official
    - `0x5819bf3d` → Ink Official (Bridge IN)
    - `0xce033e52` → Relay
    - `0xc9b9bfcc` → Relay
- **Website**: https://relay.link / https://inkonchain.com/bridge

### Bungee
- **Contract 1**: `0x3a23f943181408eac424116af7b7790c94cb97a5`
  - Name: Socket Gateway
- **Contract 2**: `0x26d8da52e56de71194950689ccf74cd309761324`
  - Name: Fulfillment Contract (Bridge IN - PerformFulfilment)
- **Contract 3**: `0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc`
  - Name: Request Contract (Bridge OUT - CreateRequest)
- **Website**: https://www.bungee.exchange

### Bridge Hot Wallets (Transfer tracking only)
| Platform | Hot Wallet Address |
|----------|-------------------|
| Owlto | `0x74F665BE90ffcd9ce9dcA68cB5875570B711CEca` |
| Orbiter | `0x3bDB03ad7363152DFBc185Ee23eBC93F0CF93fd1` |
| Gas.zip | `0x8C826F795466E39acbfF1BB4eEeB759609377ba1` |

---

## Social/Activity Platforms

### GM (Daily GM)
- **Contract**: `0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F`
- **Name**: DailyGM
- **Website**: https://gm.inkonchain.com

### InkyPump
- **Contract**: `0x1D74317d760f2c72A94386f50E8D10f2C902b899`
- **Name**: ERC1967Proxy
- **Website**: https://www.inkypump.com

---

## NFT Marketplaces (NFT Trading Card)

### Squid Market
- **Contract**: `0x9eBf93fdBA9F32aCCAb3D6716322dcCd617a78F3`
- **Name**: squidmarket
- **Website**: https://www.squidmarket.xyz

### Net Protocol
- **Contract**: `0xD00C96804e9fF35f10C7D2a92239C351Ff3F94e5`
- **Name**: Seaport
- **Website**: https://www.netprotocol.app

### Mintiq
- **Contract**: `0xBd6A027b85fD5285b1623563BBEf6fADbe396afB`
- **Name**: mintiq.market
- **Website**: https://mintiq.market

---

## Domain/Identity Platforms

### ZNS Connect
- **Contract 1**: `0x63c489d31a2c3de0638360931f47ff066282473f`
  - Function: Deploy
- **Contract 2**: `0x3033d7ded400547d6442c55159da5c61f2721633`
  - Function: SayGM
- **Contract 3**: (Register Domain - address in ZNS_CONFIG)
- **Website**: https://zns.bio

---

## NFT Creation Platforms

### NFT2Me
- **Contract 1**: `0x00000000001594c61dd8a6804da9ab58ed2483ce`
  - Name: Factory (Collections Created)
- **Contract 2**: `0x00000000009a1e02f00e280dcfa4c81c55724212`
  - Name: Minter (NFTs Minted)
- **Website**: https://nft2me.com

---

## Token Utilities

### Marvk (Token Locking/Vesting)
- **Contract**: `0x9496ff7a7be0a91f582baa96ac12a0a36300750c`
- **Functions**: lockToken, vestToken
- **Website**: https://marvk.io

---

## Gaming/NFT Utilities

### Shellies
- **Raffle Contracts**:
  - `0x47a27a42525fff2b7264b342f74216e37a831332`
  - `0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de`
  - Function: JoinRaffle
- **Pay to Play Contract**: `0x57d287dc46cb0782c4bce1e4e964cc52083bb358`
  - Function: PayToPlay
- **Staking Contract**: `0xb39a48d294e1530a271e712b7a19243679d320d0`
  - Function: StakeBatch
- **Website**: https://shellies.xyz

---

## Other Indexed Contracts (May not be displayed in dashboard)

### Gas.zip
- **Contract**: `0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762`
- **Name**: GasZipV2
- **Website**: https://www.gas.zip

### Owlto
- **Contract**: `0x7CFE8Aa0d8E92CCbBDfB12b95AEB7a54ec40f0F5`
- **Name**: Owlto
- **Website**: https://owlto.finance

---

## Contracts to Keep in Indexer

Based on dashboard usage, these contracts are **actively used**:

```
# DEX
0x9b17690dE96FcFA80a3acaEFE11d936629cd7a77  # DyorSwap
0x551134e92e537cEAa217c2ef63210Af3CE96a065  # InkySwap
0x01D40099fCD87C018969B0e8D4aB1633Fb34763C  # Velodrome
0xd7E72f3615aa65b92A4DBdC211E296a35512988B  # Curve

# DeFi
0xDe090EfCD6ef4b86792e2D84E55a5fa8d49D25D2  # Tydro Gateway
0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA  # Tydro Pool

# Bridges
0x1cb6de532588fca4a21b7209de7c456af8434a65  # USDT0 OFT Adapter
0xfebcf17b11376c724ab5a5229803c6e838b6eae5  # LayerZero Executor
0x4cD00E387622C35bDDB9b4c962C136462338BC31  # Relay Depository
0x3a23f943181408eac424116af7b7790c94cb97a5  # Bungee Socket Gateway
0x26d8da52e56de71194950689ccf74cd309761324  # Bungee Fulfillment
0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc  # Bungee Request

# Social/Activity
0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F  # GM
0x1D74317d760f2c72A94386f50E8D10f2C902b899  # InkyPump

# NFT Marketplaces
0x9eBf93fdBA9F32aCCAb3D6716322dcCd617a78F3  # Squid Market
0xD00C96804e9fF35f10C7D2a92239C351Ff3F94e5  # Net Protocol
0xBd6A027b85fD5285b1623563BBEf6fADbe396afB  # Mintiq

# ZNS
0x63c489d31a2c3de0638360931f47ff066282473f  # ZNS Deploy
0x3033d7ded400547d6442c55159da5c61f2721633  # ZNS SayGM

# NFT2Me
0x00000000001594c61dd8a6804da9ab58ed2483ce  # NFT2Me Factory
0x00000000009a1e02f00e280dcfa4c81c55724212  # NFT2Me Minter

# Marvk
0x9496ff7a7be0a91f582baa96ac12a0a36300750c  # Marvk

# Shellies
0x47a27a42525fff2b7264b342f74216e37a831332  # Shellies Raffle 1
0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de  # Shellies Raffle 2
0x57d287dc46cb0782c4bce1e4e964cc52083bb358  # Shellies Pay to Play
0xb39a48d294e1530a271e712b7a19243679d320d0  # Shellies Staking
```

## Contracts that may be removable

Review these contracts - they may not be actively displayed in the dashboard:

```
0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762  # Gas.zip (only hot wallet used)
0x7CFE8Aa0d8E92CCbBDfB12b95AEB7a54ec40f0F5  # Owlto (only hot wallet used)
```

## Bridge Hot Wallets (Keep for transfer tracking)

```
0x74F665BE90ffcd9ce9dcA68cB5875570B711CEca  # Owlto
0x3bDB03ad7363152DFBc185Ee23eBC93F0CF93fd1  # Orbiter
0x8C826F795466E39acbfF1BB4eEeB759609377ba1  # Gas.zip
0xf70da97812CB96acDF810712Aa562db8dfA3dbEF  # Relay/Ink Official
```
