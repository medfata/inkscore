import { query } from '../db';
import { assetsService } from './assets-service';
import {
  Rank,
  WalletPointsBreakdown,
  WalletScoreResponse,
} from '../types/platforms';

// Cache for ranks (1 minute TTL)
interface RanksCache {
  ranks: Rank[];
  timestamp: number;
}
let ranksCache: RanksCache | null = null;
const RANKS_CACHE_TTL = 60 * 1000;

// Cache for meme token addresses (5 minute TTL)
interface MemeTokensCache {
  addresses: Set<string>;
  timestamp: number;
}
let memeTokensCache: MemeTokensCache | null = null;
const MEME_TOKENS_CACHE_TTL = 5 * 60 * 1000;

export class PointsServiceV2 {
  // Get meme token addresses from database
  private async getMemeTokenAddresses(): Promise<Set<string>> {
    if (memeTokensCache && Date.now() - memeTokensCache.timestamp < MEME_TOKENS_CACHE_TTL) {
      return memeTokensCache.addresses;
    }

    try {
      const memeCoins = await assetsService.getMemeCoins();
      const addresses = new Set(memeCoins.map(coin => coin.address.toLowerCase()));

      memeTokensCache = { addresses, timestamp: Date.now() };
      return addresses;
    } catch (error) {
      console.error('Failed to fetch meme token addresses:', error);
      // Fallback to hardcoded addresses if database fails
      return new Set([
        '0x0606fc632ee812ba970af72f8489baaa443c4b98', // ANITA
        '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', // CAT
        '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', // PURPLE
        '0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec', // ANDRU (AK47)
        '0x32bcb803f696c99eb263d60a05cafd8689026575', // KRAK (KRAKMASK)
        '0x62c99fac20b33b5423fdf9226179e973a8353e36', // BERT
      ]);
    }
  }

  private async isMemeToken(address: string): Promise<boolean> {
    const memeTokens = await this.getMemeTokenAddresses();
    return memeTokens.has(address.toLowerCase());
  }

  private async getCachedRanks(): Promise<Rank[]> {
    if (ranksCache && Date.now() - ranksCache.timestamp < RANKS_CACHE_TTL) {
      return ranksCache.ranks;
    }

    try {
      const rawRanks = await query<{
        id: number;
        name: string;
        min_points: string | number;
        max_points: string | number | null;
        logo_url: string | null;
        color: string | null;
        description: string | null;
        display_order: number;
        is_active: boolean;
      }>(`
        SELECT id, name, min_points, max_points, logo_url, color, description, display_order, is_active
        FROM ranks 
        WHERE is_active = true 
        ORDER BY min_points ASC
      `);

      // Parse numeric values (PostgreSQL may return them as strings)
      const ranks: Rank[] = rawRanks.map(r => ({
        ...r,
        min_points: typeof r.min_points === 'string' ? parseInt(r.min_points, 10) : r.min_points,
        max_points: r.max_points === null ? null : (typeof r.max_points === 'string' ? parseInt(r.max_points, 10) : r.max_points),
        created_at: new Date(),
        updated_at: new Date(),
      }));

      console.log(`[Ranks] Fetched ${ranks.length} active ranks from database`);
      if (ranks.length > 0) {
        ranks.forEach(r => console.log(`  - ${r.name}: ${r.min_points} - ${r.max_points ?? '∞'} (color: ${r.color})`));
      }

      ranksCache = { ranks, timestamp: Date.now() };
      return ranks;
    } catch (error) {
      console.error('[Ranks] Failed to fetch ranks from database:', error);
      return [];
    }
  }

  private getRankForPoints(ranks: Rank[], totalPoints: number): Rank | null {
    // Find the rank where totalPoints falls within min_points and max_points range
    for (const rank of ranks) {
      const minOk = totalPoints >= rank.min_points;
      const maxOk = rank.max_points === null || totalPoints <= rank.max_points;
      if (minOk && maxOk) {
        console.log(`[Ranks] Points ${totalPoints} matched rank "${rank.name}" (${rank.min_points} - ${rank.max_points ?? '∞'})`);
        return rank;
      }
    }
    console.log(`[Ranks] No rank found for ${totalPoints} points`);
    return null;
  }

  // Manual points calculation methods
  private calculateNftCollectionsPoints(nftCount: number): number {
    if (nftCount >= 1 && nftCount <= 3) return 100;
    if (nftCount >= 4 && nftCount <= 9) return 200;
    if (nftCount >= 10) return 300;
    return 0;
  }

  private async calculateTokenHoldingsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    const memeTokens = await this.getMemeTokenAddresses();
    const totalUsd = tokenHoldings
      .filter(token => !memeTokens.has(token.address.toLowerCase()))
      .reduce((sum, token) => sum + (Number(token.usdValue) || 0), 0);
    if (isNaN(totalUsd)) return 0;
    return Math.ceil(totalUsd * 1.5);
  }

  private async calculateMemeCoinsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    const memeTokens = await this.getMemeTokenAddresses();
    const totalUsd = tokenHoldings
      .filter(token => memeTokens.has(token.address.toLowerCase()))
      .reduce((sum, token) => sum + (Number(token.usdValue) || 0), 0);
    if (isNaN(totalUsd)) return 0;
    return Math.ceil(totalUsd * 1.2);
  }


  private calculateWalletAgePoints(ageDays: number): number {
    if (ageDays <= 0) return 0;
    if (ageDays <= 30) return 100;
    if (ageDays <= 90) return 200;
    if (ageDays <= 180) return 300;
    if (ageDays <= 365) return 400;
    if (ageDays <= 730) return 500;
    return 600;
  }

  private calculateTotalTxPoints(txCount: number): number {
    if (txCount <= 0) return 0;
    if (txCount <= 100) return 100;
    if (txCount <= 200) return 200;
    if (txCount <= 400) return 300;
    if (txCount <= 700) return 400;
    if (txCount <= 900) return 500;
    return 600;
  }

  private calculateBridgeInPoints(bridgeInVolumeUsd: number): number {
    return Math.ceil(bridgeInVolumeUsd * 5);
  }

  private calculateBridgeOutPoints(bridgeOutVolumeUsd: number): number {
    return Math.ceil(bridgeOutVolumeUsd * 4);
  }

  private calculateGmPoints(gmCount: number): number {
    return gmCount * 10;
  }

  private calculateInkyPumpPoints(createdCount: number, buyVolumeUsd: number, sellVolumeUsd: number): number {
    let points = 0;
    points += createdCount * 50;
    points += Math.ceil((buyVolumeUsd + sellVolumeUsd) * 2);
    return points;
  }

  private calculateTydroPoints(supplyUsd: number, borrowUsd: number): number {
    return Math.ceil((supplyUsd + borrowUsd) * 10);
  }

  private calculateSwapVolumePoints(swapAmountUsd: number): number {
    return Math.ceil(swapAmountUsd * 4);
  }

  private calculateShelliesPoints(playedGameCount: number, stakedNftCount: number, joinedRaffleCount: number): number {
    let points = 0;
    points += playedGameCount * 10;
    points += stakedNftCount * 100;
    points += joinedRaffleCount * 25;
    return points;
  }

  private calculateZnsPoints(deployCount: number, saidGmCount: number, registerCount: number): number {
    let points = 0;
    points += deployCount * 10;
    points += saidGmCount * 5;
    points += registerCount * 100;
    return points;
  }

  private calculateMarvkPoints(cardMintedCount: number, lockTokenCount: number, vestTokenCount: number): number {
    let points = 0;
    points += cardMintedCount * 50;
    points += Math.ceil((lockTokenCount + vestTokenCount) * 1.5);
    return points;
  }

  private calculateNadoPoints(totalDeposits: number, totalVolume: number): number {
    const depositsPoints = totalDeposits * 5;
    const volumePoints = totalVolume * 0.1;
    return Math.ceil(depositsPoints + volumePoints);
  }

  private calculateCopinkPoints(subaccountsFound: number, totalVolume: number): number {
    const subaccountsPoints = subaccountsFound * 50;
    const volumePoints = totalVolume * 2;
    return Math.ceil(subaccountsPoints + volumePoints);
  }

  private calculateNft2mePoints(collectionCreatedCount: number, nftMintedCount: number): number {
    let points = 0;
    points += collectionCreatedCount * 25;
    points += nftMintedCount * 10;
    return points;
  }

  // NFT marketplace contract addresses
  private readonly NFT_CONTRACTS = {
    squid: '0x9ebf93fdba9f32accab3d6716322dccd617a78f3',
    netProtocol: '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5',
    mintique: '0xbd6a027b85fd5285b1623563bbef6fadbe396afb',
  };

  private calculateNftTradingPoints(squidCount: number, netProtocolCount: number, mintiqueCount: number): number {
    let points = 0;
    points += squidCount * 50;
    points += netProtocolCount * 25;
    points += mintiqueCount * 10;
    return points;
  }


  async calculateWalletScore(walletAddress: string): Promise<WalletScoreResponse> {
    const wallet = walletAddress.toLowerCase();
    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    let totalPoints = 0;

    console.log(`\n========== CALCULATING SCORE FOR ${wallet} ==========`);

    try {
      // Use the same endpoints as the dashboard
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

      const [
        walletStatsRes,
        bridgeRes,
        swapRes,
        tydroRes,
        gmRes,
        inkyPumpCreatedRes,
        inkyPumpBuyRes,
        inkyPumpSellRes,
        shelliesRafflesRes,
        shelliesPayToPlayRes,
        shelliesStakingRes,
        znsRes,
        nft2meRes,
        nftTradingRes,
        marvkRes,
        nadoRes,
        copinkRes
      ] = await Promise.all([
        fetch(`${baseUrl}/api/wallet/${wallet}/stats`),
        fetch(`${baseUrl}/api/wallet/${wallet}/bridge`),
        fetch(`${baseUrl}/api/wallet/${wallet}/swap`),
        fetch(`${baseUrl}/api/wallet/${wallet}/tydro`),
        fetch(`${baseUrl}/api/analytics/${wallet}/gm_count`),
        fetch(`${baseUrl}/api/analytics/${wallet}/inkypump_created_tokens`),
        fetch(`${baseUrl}/api/analytics/${wallet}/inkypump_buy_volume`),
        fetch(`${baseUrl}/api/analytics/${wallet}/inkypump_sell_volume`),
        fetch(`${baseUrl}/api/analytics/${wallet}/shellies_joined_raffles`),
        fetch(`${baseUrl}/api/analytics/${wallet}/shellies_pay_to_play`),
        fetch(`${baseUrl}/api/analytics/${wallet}/shellies_staking`),
        fetch(`${baseUrl}/api/analytics/${wallet}/zns`),
        fetch(`${baseUrl}/api/wallet/${wallet}/nft2me`),
        fetch(`${baseUrl}/api/analytics/${wallet}/nft_traded`),
        fetch(`${baseUrl}/api/marvk/${wallet}`),
        fetch(`${baseUrl}/api/nado/${wallet}`),
        fetch(`${baseUrl}/api/copink/${wallet}`)
      ]);

      // Type definitions for API responses
      interface WalletStatsResponse {
        nftCollections?: Array<{ count?: number }>;
        tokenHoldings?: Array<{ address: string; symbol?: string; usdValue: number }>;
        balanceUsd?: number;
        ageDays?: number;
        totalTxns?: number;
      }
      interface BridgeResponse { bridgedInUsd?: number; bridgedInCount?: number; bridgedOutUsd?: number; bridgedOutCount?: number; }
      interface SwapResponse { totalUsd?: number; txCount?: number; }
      interface TydroResponse { currentSupplyUsd?: number; currentBorrowUsd?: number; depositCount?: number; borrowCount?: number; }
      interface CountResponse { total_count?: number; total_value?: string; }
      interface ZnsResponse {
        total_count?: number;
        deploy_count?: number;
        say_gm_count?: number;
        register_domain_count?: number;
      }
      interface Nft2meResponse { collectionsCreated?: number; nftsMinted?: number; totalTransactions?: number; }
      interface NftTradingResponse {
        total_count?: number;
        by_contract?: Array<{ contract_address: string; count: number }>;
      }
      interface MarvkResponse {
        lockTokenCount?: number;
        vestTokenCount?: number;
        cardMintedCount?: number;
        totalTransactions?: number;
      }
      interface NadoResponse {
        totalDeposits?: number;
        totalTransactions?: number;
        nadoVolumeUSD?: number;
      }
      interface CopinkResponse {
        totalVolume?: number;
        subaccountsFound?: number;
      }

      const walletStats = walletStatsRes.ok ? await walletStatsRes.json() as WalletStatsResponse : null;
      const bridgeData = bridgeRes.ok ? await bridgeRes.json() as BridgeResponse : null;
      const swapData = swapRes.ok ? await swapRes.json() as SwapResponse : null;
      const tydroData = tydroRes.ok ? await tydroRes.json() as TydroResponse : null;
      const gmData = gmRes.ok ? await gmRes.json() as CountResponse : null;
      const inkyPumpCreated = inkyPumpCreatedRes.ok ? await inkyPumpCreatedRes.json() as CountResponse : null;
      const inkyPumpBuy = inkyPumpBuyRes.ok ? await inkyPumpBuyRes.json() as CountResponse : null;
      const inkyPumpSell = inkyPumpSellRes.ok ? await inkyPumpSellRes.json() as CountResponse : null;
      const shelliesRaffles = shelliesRafflesRes.ok ? await shelliesRafflesRes.json() as CountResponse : null;
      const shelliesPayToPlay = shelliesPayToPlayRes.ok ? await shelliesPayToPlayRes.json() as CountResponse : null;
      const shelliesStaking = shelliesStakingRes.ok ? await shelliesStakingRes.json() as CountResponse : null;
      const znsData = znsRes.ok ? await znsRes.json() as ZnsResponse : null;
      const nft2meData = nft2meRes.ok ? await nft2meRes.json() as Nft2meResponse : null;
      const nftTradingData = nftTradingRes.ok ? await nftTradingRes.json() as NftTradingResponse : null;
      const marvkData = marvkRes.ok ? await marvkRes.json() as MarvkResponse : null;
      const nadoData = nadoRes.ok ? await nadoRes.json() as NadoResponse : null;
      const copinkData = copinkRes.ok ? await copinkRes.json() as CopinkResponse : null;

      if (!walletStats) throw new Error('Failed to fetch wallet stats');

      // Calculate points using dashboard data
      const supportedNftCount = (walletStats.nftCollections || []).reduce((sum: number, col: { count?: number }) => sum + (col.count || 0), 0);
      const nftPoints = this.calculateNftCollectionsPoints(supportedNftCount);
      breakdown.native['nft_collections'] = { value: supportedNftCount, points: nftPoints };
      totalPoints += nftPoints;
      console.log(`1. NFT Collections: ${supportedNftCount} NFTs → ${nftPoints} points`);

      const tokenHoldings = walletStats.tokenHoldings || [];
      const nativeEthUsd = Number(walletStats.balanceUsd) || 0;

      const allHoldings = [
        ...tokenHoldings,
        { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', usdValue: nativeEthUsd }
      ];

      const tokenPoints = await this.calculateTokenHoldingsPoints(allHoldings);
      const totalTokenValue = allHoldings.reduce((sum: number, t: { usdValue?: number }) => sum + (Number(t.usdValue) || 0), 0);
      breakdown.native['erc20_tokens'] = { value: totalTokenValue, points: tokenPoints };
      totalPoints += tokenPoints;
      console.log(`2. Token Holdings: ${totalTokenValue.toFixed(2)} → ${tokenPoints} points`);

      const memePoints = await this.calculateMemeCoinsPoints(tokenHoldings);
      const memeTokens = await this.getMemeTokenAddresses();
      const memeTokenCount = tokenHoldings.filter((t: { address: string }) => memeTokens.has(t.address.toLowerCase())).length;
      breakdown.native['meme_coins'] = { value: memeTokenCount, points: memePoints };
      totalPoints += memePoints;
      console.log(`3. Meme Coins: ${memeTokenCount} tokens → ${memePoints} points`);

      const agePoints = this.calculateWalletAgePoints(walletStats.ageDays || 0);
      breakdown.native['wallet_age'] = { value: walletStats.ageDays || 0, points: agePoints };
      totalPoints += agePoints;
      console.log(`4. Wallet Age: ${walletStats.ageDays || 0} days → ${agePoints} points`);

      const txPoints = this.calculateTotalTxPoints(walletStats.totalTxns || 0);
      breakdown.native['total_tx'] = { value: walletStats.totalTxns || 0, points: txPoints };
      totalPoints += txPoints;
      console.log(`5. Total Transactions: ${walletStats.totalTxns || 0} txs → ${txPoints} points`);

      const bridgeInUsd = bridgeData?.bridgedInUsd || 0;
      const bridgeOutUsd = bridgeData?.bridgedOutUsd || 0;
      const bridgeInPoints = this.calculateBridgeInPoints(bridgeInUsd);
      const bridgeOutPoints = this.calculateBridgeOutPoints(bridgeOutUsd);
      breakdown.platforms['bridge_in'] = { tx_count: bridgeData?.bridgedInCount || 0, usd_volume: bridgeInUsd, points: bridgeInPoints };
      breakdown.platforms['bridge_out'] = { tx_count: bridgeData?.bridgedOutCount || 0, usd_volume: bridgeOutUsd, points: bridgeOutPoints };
      totalPoints += bridgeInPoints + bridgeOutPoints;
      console.log(`6. Bridge IN Volume: ${bridgeInUsd.toFixed(2)} → ${bridgeInPoints} points`);
      console.log(`6b. Bridge OUT Volume: ${bridgeOutUsd.toFixed(2)} → ${bridgeOutPoints} points`);

      const gmCount = gmData?.total_count || 0;
      const gmPoints = this.calculateGmPoints(gmCount);
      breakdown.platforms['gm'] = { tx_count: gmCount, usd_volume: 0, points: gmPoints };
      totalPoints += gmPoints;
      console.log(`7. GM: ${gmCount} interactions → ${gmPoints} points`);

      const inkyPumpCreatedCount = inkyPumpCreated?.total_count || 0;
      const inkyPumpBuyUsd = parseFloat(inkyPumpBuy?.total_value || '0');
      const inkyPumpSellUsd = parseFloat(inkyPumpSell?.total_value || '0');
      const inkyPumpPoints = this.calculateInkyPumpPoints(inkyPumpCreatedCount, inkyPumpBuyUsd, inkyPumpSellUsd);
      const inkyPumpTotalUsd = inkyPumpBuyUsd + inkyPumpSellUsd;
      breakdown.platforms['inkypump'] = { tx_count: inkyPumpCreatedCount + (inkyPumpBuy?.total_count || 0) + (inkyPumpSell?.total_count || 0), usd_volume: inkyPumpTotalUsd, points: inkyPumpPoints };
      totalPoints += inkyPumpPoints;
      console.log(`8. InkyPump: created=${inkyPumpCreatedCount}, buyUsd=${inkyPumpBuyUsd.toFixed(2)}, sellUsd=${inkyPumpSellUsd.toFixed(2)} → ${inkyPumpPoints} points`);

      const tydroSupplyUsd = tydroData?.currentSupplyUsd || 0;
      const tydroBorrowUsd = tydroData?.currentBorrowUsd || 0;
      const tydroPoints = this.calculateTydroPoints(tydroSupplyUsd, tydroBorrowUsd);
      breakdown.platforms['tydro'] = { tx_count: (tydroData?.depositCount || 0) + (tydroData?.borrowCount || 0), usd_volume: tydroSupplyUsd + tydroBorrowUsd, points: tydroPoints };
      totalPoints += tydroPoints;
      console.log(`9. Tydro: → ${tydroPoints} points`);

      const swapUsd = swapData?.totalUsd || 0;
      const swapPoints = this.calculateSwapVolumePoints(swapUsd);
      breakdown.platforms['swap'] = { tx_count: swapData?.txCount || 0, usd_volume: swapUsd, points: swapPoints };
      totalPoints += swapPoints;
      console.log(`10. Swap Volume: ${swapUsd.toFixed(2)} → ${swapPoints} points`);

      const shelliesPlayedCount = shelliesPayToPlay?.total_count || 0;
      const shelliesStakedCount = shelliesStaking?.total_count || 0;
      const shelliesRafflesCount = shelliesRaffles?.total_count || 0;
      const shelliesPoints = this.calculateShelliesPoints(shelliesPlayedCount, shelliesStakedCount, shelliesRafflesCount);
      breakdown.platforms['shellies'] = { tx_count: shelliesPlayedCount + shelliesStakedCount + shelliesRafflesCount, usd_volume: 0, points: shelliesPoints };
      totalPoints += shelliesPoints;
      console.log(`11. Shellies: played=${shelliesPlayedCount}, staked=${shelliesStakedCount}, raffles=${shelliesRafflesCount} → ${shelliesPoints} points`);

      const znsDeployCount = znsData?.deploy_count || 0;
      const znsSaidGmCount = znsData?.say_gm_count || 0;
      const znsRegisterCount = znsData?.register_domain_count || 0;
      const znsPoints = this.calculateZnsPoints(znsDeployCount, znsSaidGmCount, znsRegisterCount);
      breakdown.platforms['zns'] = { tx_count: znsData?.total_count || 0, usd_volume: 0, points: znsPoints };
      totalPoints += znsPoints;
      console.log(`12. ZNS: deploy=${znsDeployCount}, gm=${znsSaidGmCount}, register=${znsRegisterCount} → ${znsPoints} points`);

      const nft2meCollectionsCount = nft2meData?.collectionsCreated || 0;
      const nft2meMintedCount = nft2meData?.nftsMinted || 0;
      const nft2mePoints = this.calculateNft2mePoints(nft2meCollectionsCount, nft2meMintedCount);
      breakdown.platforms['nft2me'] = { tx_count: nft2meData?.totalTransactions || 0, usd_volume: 0, points: nft2mePoints };
      totalPoints += nft2mePoints;
      console.log(`13. NFT2Me: collections=${nft2meCollectionsCount}, minted=${nft2meMintedCount} → ${nft2mePoints} points`);

      // Parse NFT trading by contract
      const byContract = nftTradingData?.by_contract || [];
      const squidCount = byContract.find(c => c.contract_address === this.NFT_CONTRACTS.squid)?.count || 0;
      const netProtocolCount = byContract.find(c => c.contract_address === this.NFT_CONTRACTS.netProtocol)?.count || 0;
      const mintiqueCount = byContract.find(c => c.contract_address === this.NFT_CONTRACTS.mintique)?.count || 0;
      const nftTradingPoints = this.calculateNftTradingPoints(squidCount, netProtocolCount, mintiqueCount);
      breakdown.platforms['nft_trading'] = { tx_count: nftTradingData?.total_count || 0, usd_volume: 0, points: nftTradingPoints };
      totalPoints += nftTradingPoints;
      console.log(`14. NFT Trading: squid=${squidCount}, netProtocol=${netProtocolCount}, mintique=${mintiqueCount} → ${nftTradingPoints} points`);

      // Marvk points
      const marvkCardMinted = marvkData?.cardMintedCount || 0; // Placeholder until API is implemented
      const marvkLockCount = marvkData?.lockTokenCount || 0;
      const marvkVestCount = marvkData?.vestTokenCount || 0;
      const marvkPoints = this.calculateMarvkPoints(marvkCardMinted, marvkLockCount, marvkVestCount);
      breakdown.platforms['marvk'] = { tx_count: marvkData?.totalTransactions || 0, usd_volume: 0, points: marvkPoints };
      totalPoints += marvkPoints;
      console.log(`15. Marvk: cardMinted=${marvkCardMinted}, lock=${marvkLockCount}, vest=${marvkVestCount} → ${marvkPoints} points`);

      // Nado points
      const nadoTotalDeposits = nadoData?.totalDeposits || 0;
      const nadoTotalVolume = nadoData?.nadoVolumeUSD || 0;
      const nadoPoints = this.calculateNadoPoints(nadoTotalDeposits, nadoTotalVolume);
      breakdown.platforms['nado'] = { tx_count: nadoData?.totalTransactions || 0, usd_volume: nadoTotalVolume, points: nadoPoints };
      totalPoints += nadoPoints;
      console.log(`16. Nado: deposits=${nadoTotalDeposits.toFixed(2)}, volume=${nadoTotalVolume.toFixed(2)} → ${nadoPoints} points`);

      // Copink points
      const copinkSubaccounts = copinkData?.subaccountsFound || 0;
      const copinkVolume = copinkData?.totalVolume || 0;
      const copinkPoints = this.calculateCopinkPoints(copinkSubaccounts, copinkVolume);
      breakdown.platforms['copink'] = { tx_count: copinkSubaccounts, usd_volume: copinkVolume, points: copinkPoints };
      totalPoints += copinkPoints;
      console.log(`17. Copink: subaccounts=${copinkSubaccounts}, volume=${copinkVolume.toFixed(2)} → ${copinkPoints} points`);

      // Verification logs - check formula correctness
      console.log(`\n--- VERIFICATION ---`);
      console.log(`2. Token Holdings: ${totalTokenValue.toFixed(2)} * 1.5 = ${Math.ceil(totalTokenValue * 1.5)} (got ${tokenPoints}) ${tokenPoints === Math.ceil(totalTokenValue * 1.5) ? '✓' : '✗'}`);
      console.log(`6. Bridge IN: ${bridgeInUsd.toFixed(2)} * 5 = ${Math.ceil(bridgeInUsd * 5)} (got ${bridgeInPoints}) ${bridgeInPoints === Math.ceil(bridgeInUsd * 5) ? '✓' : '✗'}`);
      console.log(`6b. Bridge OUT: ${bridgeOutUsd.toFixed(2)} * 4 = ${Math.ceil(bridgeOutUsd * 4)} (got ${bridgeOutPoints}) ${bridgeOutPoints === Math.ceil(bridgeOutUsd * 4) ? '✓' : '✗'}`);
      console.log(`7. GM: ${gmCount} * 10 = ${gmCount * 10} (got ${gmPoints}) ${gmPoints === gmCount * 10 ? '✓' : '✗'}`);
      console.log(`8. InkyPump: ${inkyPumpCreatedCount}*50 + ceil((${inkyPumpBuyUsd.toFixed(2)}+${inkyPumpSellUsd.toFixed(2)})*2) = ${inkyPumpCreatedCount * 50 + Math.ceil((inkyPumpBuyUsd + inkyPumpSellUsd) * 2)} (got ${inkyPumpPoints}) ${inkyPumpPoints === inkyPumpCreatedCount * 50 + Math.ceil((inkyPumpBuyUsd + inkyPumpSellUsd) * 2) ? '✓' : '✗'}`);
      console.log(`9. Tydro: ceil((${tydroSupplyUsd.toFixed(2)}+${tydroBorrowUsd.toFixed(2)})*10) = ${Math.ceil((tydroSupplyUsd + tydroBorrowUsd) * 10)} (got ${tydroPoints}) ${tydroPoints === Math.ceil((tydroSupplyUsd + tydroBorrowUsd) * 10) ? '✓' : '✗'}`);
      console.log(`10. Swap: ceil(${swapUsd.toFixed(2)}*4) = ${Math.ceil(swapUsd * 4)} (got ${swapPoints}) ${swapPoints === Math.ceil(swapUsd * 4) ? '✓' : '✗'}`);
      console.log(`11. Shellies: ${shelliesPlayedCount}*10 + ${shelliesStakedCount}*100 + ${shelliesRafflesCount}*25 = ${shelliesPlayedCount * 10 + shelliesStakedCount * 100 + shelliesRafflesCount * 25} (got ${shelliesPoints}) ${shelliesPoints === shelliesPlayedCount * 10 + shelliesStakedCount * 100 + shelliesRafflesCount * 25 ? '✓' : '✗'}`);
      console.log(`12. ZNS: ${znsDeployCount}*10 + ${znsSaidGmCount}*5 + ${znsRegisterCount}*100 = ${znsDeployCount * 10 + znsSaidGmCount * 5 + znsRegisterCount * 100} (got ${znsPoints}) ${znsPoints === znsDeployCount * 10 + znsSaidGmCount * 5 + znsRegisterCount * 100 ? '✓' : '✗'}`);
      console.log(`13. NFT2Me: ${nft2meCollectionsCount}*25 + ${nft2meMintedCount}*10 = ${nft2meCollectionsCount * 25 + nft2meMintedCount * 10} (got ${nft2mePoints}) ${nft2mePoints === nft2meCollectionsCount * 25 + nft2meMintedCount * 10 ? '✓' : '✗'}`);
      console.log(`14. NFT Trading: ${squidCount}*50 + ${netProtocolCount}*25 + ${mintiqueCount}*10 = ${squidCount * 50 + netProtocolCount * 25 + mintiqueCount * 10} (got ${nftTradingPoints}) ${nftTradingPoints === squidCount * 50 + netProtocolCount * 25 + mintiqueCount * 10 ? '✓' : '✗'}`);
      console.log(`15. Marvk: ${marvkCardMinted}*50 + ceil((${marvkLockCount}+${marvkVestCount})*1.5) = ${marvkCardMinted * 50 + Math.ceil((marvkLockCount + marvkVestCount) * 1.5)} (got ${marvkPoints}) ${marvkPoints === marvkCardMinted * 50 + Math.ceil((marvkLockCount + marvkVestCount) * 1.5) ? '✓' : '✗'}`);
      console.log(`16. Nado: ceil(${nadoTotalDeposits.toFixed(2)}*5 + ${nadoTotalVolume.toFixed(2)}*0.1) = ${Math.ceil(nadoTotalDeposits * 5 + nadoTotalVolume * 0.1)} (got ${nadoPoints}) ${nadoPoints === Math.ceil(nadoTotalDeposits * 5 + nadoTotalVolume * 0.1) ? '✓' : '✗'}`);
      console.log(`17. Copink: ceil(${copinkSubaccounts}*50 + ${copinkVolume.toFixed(2)}*2) = ${Math.ceil(copinkSubaccounts * 50 + copinkVolume * 2)} (got ${copinkPoints}) ${copinkPoints === Math.ceil(copinkSubaccounts * 50 + copinkVolume * 2) ? '✓' : '✗'}`);

      console.log(`\n========== TOTAL SCORE: ${totalPoints} points ==========\n`);

      const ranks = await this.getCachedRanks();
      const rank = this.getRankForPoints(ranks, totalPoints);

      return {
        wallet_address: wallet,
        total_points: totalPoints,
        rank: rank ? { name: rank.name, color: rank.color, logo_url: rank.logo_url } : null,
        breakdown,
        last_updated: new Date(),
      };
    } catch (error) {
      console.error('Error calculating wallet score:', error);
      throw error;
    }
  }
}

export const pointsServiceV2 = new PointsServiceV2();
