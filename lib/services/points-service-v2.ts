import { query, queryOne } from '../db';
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

export class PointsServiceV2 {
  // Meme token addresses
  private readonly MEME_TOKENS = [
    '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', // CAT
    '0x0606fc632ee812ba970af72f8489baaa443c4b98', // ANITA
    '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', // PURPLE
    '0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec', // ANDRU
    '0x62c99fac20b33b5423fdf9226179e973a8353e36', // BERT
    '0x32bcb803f696c99eb263d60a05cafd8689026575', // KRAK
  ];

  private isMemeToken(address: string): boolean {
    return this.MEME_TOKENS.includes(address.toLowerCase());
  }

  private async getCachedRanks(): Promise<Rank[]> {
    if (ranksCache && Date.now() - ranksCache.timestamp < RANKS_CACHE_TTL) {
      return ranksCache.ranks;
    }

    const ranks = await query<Rank>(`
      SELECT * FROM ranks WHERE is_active = true ORDER BY min_points ASC
    `);

    ranksCache = { ranks, timestamp: Date.now() };
    return ranks;
  }

  // Manual points calculation methods
  private calculateNftCollectionsPoints(nftCount: number): number {
    if (nftCount >= 1 && nftCount <= 3) return 100;
    if (nftCount >= 4 && nftCount <= 9) return 200;
    if (nftCount >= 10) return 300;
    return 0;
  }

  private calculateTokenHoldingsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): number {
    let points = 0;
    for (const token of tokenHoldings) {
      if (this.isMemeToken(token.address)) continue;
      const balanceUsd = token.usdValue;
      if (balanceUsd >= 1 && balanceUsd <= 99) points += 100;
      else if (balanceUsd >= 100 && balanceUsd <= 999) points += 200;
      else if (balanceUsd >= 1000) points += 300;
    }
    return points;
  }

  private calculateMemeCoinsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): number {
    let points = 0;
    for (const token of tokenHoldings) {
      if (!this.isMemeToken(token.address)) continue;
      const balanceUsd = token.usdValue;
      if (balanceUsd >= 1 && balanceUsd <= 10) points += 50;
      else if (balanceUsd >= 11 && balanceUsd <= 100) points += 70;
      else if (balanceUsd > 200) points += 100;
    }
    return points;
  }

  private calculateWalletAgePoints(ageDays: number): number {
    if (ageDays <= 30) return 100;
    if (ageDays <= 90) return 200;
    if (ageDays <= 180) return 300;
    if (ageDays <= 365) return 400;
    if (ageDays <= 730) return 500;
    return 600;
  }

  private calculateTotalTxPoints(txCount: number): number {
    if (txCount >= 1 && txCount <= 100) return 100;
    if (txCount <= 200) return 200;
    if (txCount <= 400) return 300;
    if (txCount <= 700) return 400;
    if (txCount <= 900) return 500;
    return 600;
  }

  private calculateBridgeVolumePoints(bridgeInVolumeUsd: number): number {
    if (bridgeInVolumeUsd >= 10 && bridgeInVolumeUsd < 100) return 100;
    if (bridgeInVolumeUsd < 500) return 200;
    if (bridgeInVolumeUsd < 2000) return 300;
    if (bridgeInVolumeUsd < 5000) return 400;
    if (bridgeInVolumeUsd < 10000) return 500;
    if (bridgeInVolumeUsd >= 10000) return 600;
    return 0;
  }

  private calculateGmPoints(gmCount: number): number {
    if (gmCount >= 1 && gmCount < 10) return 100;
    if (gmCount >= 10 && gmCount <= 20) return 200;
    if (gmCount > 30) return 300;
    return 0;
  }

  private calculateInkyPumpPoints(createdCount: number, boughtCount: number, soldCount: number): number {
    let points = 0;
    points += createdCount * 100; // 100 points per token created
    points += boughtCount * 100;  // 100 points per buy transaction
    points += soldCount * 100;    // 100 points per sell transaction
    return points;
  }

  private calculateTydroPoints(supplyUsd: number, borrowUsd: number): number {
    let points = 0;
    if (supplyUsd >= 1 && supplyUsd <= 99) points += 250;
    else if (supplyUsd >= 100 && supplyUsd <= 499) points += 500;
    else if (supplyUsd >= 500 && supplyUsd <= 999) points += 700;
    else if (supplyUsd >= 1000) points += 1000;

    if (borrowUsd >= 1 && borrowUsd <= 99) points += 250;
    else if (borrowUsd >= 100 && borrowUsd <= 499) points += 500;
    else if (borrowUsd >= 500 && borrowUsd <= 999) points += 700;
    else if (borrowUsd >= 1000) points += 1000;

    return points;
  }

  private calculateSwapVolumePoints(swapAmountUsd: number): number {
    if (swapAmountUsd >= 5 && swapAmountUsd <= 50) return 100;
    if (swapAmountUsd >= 100 && swapAmountUsd <= 500) return 250;
    if (swapAmountUsd > 500 && swapAmountUsd <= 1000) return 500;
    if (swapAmountUsd > 1000) return 1000;
    return 0;
  }

  private calculateShelliesPoints(playedGame: boolean, stakedNft: boolean, joinedRaffle: boolean): number {
    let points = 0;
    if (playedGame) points += 100;
    if (stakedNft) points += 100;
    if (joinedRaffle) points += 100;
    return points;
  }

  private calculateZnsPoints(hasZnsDomain: boolean): number {
    return hasZnsDomain ? 100 : 0;
  }

  private calculateNft2mePoints(collectionCreated: boolean, nftMinted: boolean): number {
    let points = 0;
    if (collectionCreated) points += 100;
    if (nftMinted) points += 100;
    return points;
  }

  private calculateNftTradingPoints(hasTraded: boolean): number {
    return hasTraded ? 100 : 0;
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
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      
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
        nftTradingRes
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
        fetch(`${baseUrl}/api/analytics/${wallet}/nft_traded`)
      ]);

      const walletStats = walletStatsRes.ok ? await walletStatsRes.json() : null;
      const bridgeData = bridgeRes.ok ? await bridgeRes.json() : null;
      const swapData = swapRes.ok ? await swapRes.json() : null;
      const tydroData = tydroRes.ok ? await tydroRes.json() : null;
      const gmData = gmRes.ok ? await gmRes.json() : null;
      const inkyPumpCreated = inkyPumpCreatedRes.ok ? await inkyPumpCreatedRes.json() : null;
      const inkyPumpBuy = inkyPumpBuyRes.ok ? await inkyPumpBuyRes.json() : null;
      const inkyPumpSell = inkyPumpSellRes.ok ? await inkyPumpSellRes.json() : null;
      const shelliesRaffles = shelliesRafflesRes.ok ? await shelliesRafflesRes.json() : null;
      const shelliesPayToPlay = shelliesPayToPlayRes.ok ? await shelliesPayToPlayRes.json() : null;
      const shelliesStaking = shelliesStakingRes.ok ? await shelliesStakingRes.json() : null;
      const znsData = znsRes.ok ? await znsRes.json() : null;
      const nft2meData = nft2meRes.ok ? await nft2meRes.json() : null;
      const nftTradingData = nftTradingRes.ok ? await nftTradingRes.json() : null;

      if (!walletStats) throw new Error('Failed to fetch wallet stats');

      // Calculate points using dashboard data
      const supportedNftCount = (walletStats.nftCollections || []).reduce((sum: number, col: any) => sum + (col.count || 0), 0);
      const nftPoints = this.calculateNftCollectionsPoints(supportedNftCount);
      breakdown.native['nft_collections'] = { value: supportedNftCount, points: nftPoints };
      totalPoints += nftPoints;
      console.log(`1. NFT Collections: ${supportedNftCount} NFTs → ${nftPoints} points`);

      // Token Holdings includes ERC-20 tokens + native ETH balance
      const tokenHoldings = walletStats.tokenHoldings || [];
      const nativeEthUsd = Number(walletStats.balanceUsd) || 0; // Native ETH balance in USD
      
      // Add native ETH to token holdings for points calculation
      const allHoldings = [
        ...tokenHoldings,
        { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', usdValue: nativeEthUsd }
      ];
      
      const tokenPoints = this.calculateTokenHoldingsPoints(allHoldings);
      const totalTokenValue = allHoldings.reduce((sum: number, t: any) => sum + (Number(t.usdValue) || 0), 0);
      breakdown.native['erc20_tokens'] = { value: totalTokenValue, points: tokenPoints };
      totalPoints += tokenPoints;
      console.log(`2. Token Holdings: $${totalTokenValue.toFixed(2)} (incl. ETH: $${nativeEthUsd.toFixed(2)}) → ${tokenPoints} points`);

      const memePoints = this.calculateMemeCoinsPoints(tokenHoldings);
      const memeTokens = tokenHoldings.filter((t: any) => this.isMemeToken(t.address));
      breakdown.native['meme_coins'] = { value: memeTokens.length, points: memePoints };
      totalPoints += memePoints;
      console.log(`3. Meme Coins: ${memeTokens.length} tokens → ${memePoints} points`);

      const agePoints = this.calculateWalletAgePoints(walletStats.ageDays || 0);
      breakdown.native['wallet_age'] = { value: walletStats.ageDays || 0, points: agePoints };
      totalPoints += agePoints;
      console.log(`4. Wallet Age: ${walletStats.ageDays || 0} days → ${agePoints} points`);

      const txPoints = this.calculateTotalTxPoints(walletStats.totalTxns || 0);
      breakdown.native['total_tx'] = { value: walletStats.totalTxns || 0, points: txPoints };
      totalPoints += txPoints;
      console.log(`5. Total Transactions: ${walletStats.totalTxns || 0} txs → ${txPoints} points`);

      const bridgeInUsd = bridgeData?.bridgedInUsd || 0;
      const bridgePoints = this.calculateBridgeVolumePoints(bridgeInUsd);
      breakdown.platforms['bridge_in'] = { 
        tx_count: bridgeData?.bridgedInCount || 0, 
        usd_volume: bridgeInUsd, 
        points: bridgePoints 
      };
      totalPoints += bridgePoints;
      console.log(`6. Bridge IN Volume: $${bridgeInUsd.toFixed(2)} (${bridgeData?.bridgedInCount || 0} txs) → ${bridgePoints} points`);

      const gmCount = gmData?.total_count || 0;
      const gmPoints = this.calculateGmPoints(gmCount);
      breakdown.platforms['gm'] = { tx_count: gmCount, usd_volume: 0, points: gmPoints };
      totalPoints += gmPoints;
      console.log(`7. GM: ${gmCount} interactions → ${gmPoints} points`);

      const inkyPumpPoints = this.calculateInkyPumpPoints(
        inkyPumpCreated?.total_count || 0,
        inkyPumpBuy?.total_count || 0,
        inkyPumpSell?.total_count || 0
      );
      breakdown.platforms['inkypump'] = { tx_count: (inkyPumpCreated?.total_count || 0) + (inkyPumpBuy?.total_count || 0) + (inkyPumpSell?.total_count || 0), usd_volume: 0, points: inkyPumpPoints };
      totalPoints += inkyPumpPoints;
      console.log(`8. InkyPump: Created=${inkyPumpCreated?.total_count || 0} (${(inkyPumpCreated?.total_count || 0) * 100}pts), Buy=${inkyPumpBuy?.total_count || 0} (${(inkyPumpBuy?.total_count || 0) * 100}pts), Sell=${inkyPumpSell?.total_count || 0} (${(inkyPumpSell?.total_count || 0) * 100}pts) → ${inkyPumpPoints} points`);

      const tydroSupplyUsd = tydroData?.currentSupplyUsd || 0;
      const tydroBorrowUsd = tydroData?.currentBorrowUsd || 0;
      const tydroPoints = this.calculateTydroPoints(tydroSupplyUsd, tydroBorrowUsd);
      breakdown.platforms['tydro'] = { tx_count: (tydroData?.depositCount || 0) + (tydroData?.borrowCount || 0), usd_volume: tydroSupplyUsd + tydroBorrowUsd, points: tydroPoints };
      totalPoints += tydroPoints;
      console.log(`9. Tydro: Supply=$${tydroSupplyUsd.toFixed(2)}, Borrow=$${tydroBorrowUsd.toFixed(2)} → ${tydroPoints} points`);

      const swapUsd = swapData?.totalUsd || 0;
      const swapPoints = this.calculateSwapVolumePoints(swapUsd);
      breakdown.platforms['swap'] = { tx_count: swapData?.txCount || 0, usd_volume: swapUsd, points: swapPoints };
      totalPoints += swapPoints;
      console.log(`10. Swap Volume: $${swapUsd.toFixed(2)} → ${swapPoints} points`);

      const shelliesPoints = this.calculateShelliesPoints(
        (shelliesPayToPlay?.total_count || 0) > 0,
        (shelliesStaking?.total_count || 0) > 0,
        (shelliesRaffles?.total_count || 0) > 0
      );
      breakdown.platforms['shellies'] = { tx_count: (shelliesRaffles?.total_count || 0) + (shelliesPayToPlay?.total_count || 0) + (shelliesStaking?.total_count || 0), usd_volume: 0, points: shelliesPoints };
      totalPoints += shelliesPoints;
      console.log(`11. Shellies: Game=${shelliesPayToPlay?.total_count || 0}, Staking=${shelliesStaking?.total_count || 0}, Raffles=${shelliesRaffles?.total_count || 0} → ${shelliesPoints} points`);

      const znsCount = znsData?.total_count || 0;
      const znsPoints = this.calculateZnsPoints(znsCount > 0);
      breakdown.platforms['zns'] = { tx_count: znsCount, usd_volume: 0, points: znsPoints };
      totalPoints += znsPoints;
      console.log(`12. ZNS: ${znsCount} interactions → ${znsPoints} points`);

      const nft2mePoints = this.calculateNft2mePoints(
        (nft2meData?.collectionsCreated || 0) > 0,
        (nft2meData?.nftsMinted || 0) > 0
      );
      breakdown.platforms['nft2me'] = { tx_count: nft2meData?.totalTransactions || 0, usd_volume: 0, points: nft2mePoints };
      totalPoints += nft2mePoints;
      console.log(`13. NFT2Me: Collections=${nft2meData?.collectionsCreated || 0}, Minted=${nft2meData?.nftsMinted || 0} → ${nft2mePoints} points`);

      const nftTradingPoints = this.calculateNftTradingPoints((nftTradingData?.total_count || 0) > 0);
      breakdown.platforms['nft_trading'] = { tx_count: nftTradingData?.total_count || 0, usd_volume: 0, points: nftTradingPoints };
      totalPoints += nftTradingPoints;
      console.log(`14. NFT Trading: ${nftTradingData?.total_count || 0} trades → ${nftTradingPoints} points`);

      console.log(`\n========== TOTAL SCORE: ${totalPoints} points ==========\n`);

      const ranks = await this.getCachedRanks();
      const rank = ranks.find(r => r.min_points <= totalPoints && (r.max_points === null || r.max_points >= totalPoints)) || null;

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
