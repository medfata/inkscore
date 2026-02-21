import { NextRequest, NextResponse } from 'next/server';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchFromExpress<T>(endpoint: string): Promise<FetchResult<T>> {
  try {
    const response = await fetch(`${API_SERVER_URL}${endpoint}`);
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// GET /api/[wallet]/dashboard - Aggregated dashboard data from Express server
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const walletAddress = wallet.toLowerCase();

    // Parallel fetch all dashboard data from Express server
    const [
      statsResult,
      bridgeResult,
      swapResult,
      volumeResult,
      scoreResult,
      analyticsResult,
      cardsResult,
      marvkResult,
      nadoResult,
      copinkResult,
      nft2meResult,
      tydroResult,
      // Specific analytics metrics
      gmCountResult,
      inkypumpCreatedTokensResult,
      inkypumpBuyVolumeResult,
      inkypumpSellVolumeResult,
      nftTradedResult,
      znsResult,
      shelliesJoinedRafflesResult,
      shelliesPayToPlayResult,
      shelliesStakingResult,
      openseaBuyCountResult,
      mintCountResult,
      openseaSaleCountResult,
    ] = await Promise.all([
      fetchFromExpress(`/api/wallet/${walletAddress}/stats`),
      fetchFromExpress(`/api/wallet/${walletAddress}/bridge`),
      fetchFromExpress(`/api/wallet/${walletAddress}/swap`),
      fetchFromExpress(`/api/wallet/${walletAddress}/volume`),
      fetchFromExpress(`/api/wallet/${walletAddress}/score`),
      fetchFromExpress(`/api/analytics/${walletAddress}`),
      fetchFromExpress(`/api/dashboard/cards/${walletAddress}`),
      fetchFromExpress(`/api/marvk/${walletAddress}`),
      fetchFromExpress(`/api/nado/${walletAddress}`),
      fetchFromExpress(`/api/copink/${walletAddress}`),
      fetchFromExpress(`/api/wallet/${walletAddress}/nft2me`),
      fetchFromExpress(`/api/wallet/${walletAddress}/tydro`),
      // Specific analytics metrics
      fetchFromExpress(`/api/analytics/${walletAddress}/gm_count`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_created_tokens`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_buy_volume`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_sell_volume`),
      fetchFromExpress(`/api/analytics/${walletAddress}/nft_traded`),
      fetchFromExpress(`/api/analytics/${walletAddress}/zns`),
      fetchFromExpress(`/api/analytics/${walletAddress}/shellies_joined_raffles`),
      fetchFromExpress(`/api/analytics/${walletAddress}/shellies_pay_to_play`),
      fetchFromExpress(`/api/analytics/${walletAddress}/shellies_staking`),
      fetchFromExpress(`/api/analytics/${walletAddress}/opensea_buy_count`),
      fetchFromExpress(`/api/analytics/${walletAddress}/mint_count`),
      fetchFromExpress(`/api/analytics/${walletAddress}/opensea_sale_count`),
    ]);

    // Collect any errors (only log critical ones)
    const errors: string[] = [];
    if (statsResult.error) errors.push(`stats: ${statsResult.error}`);
    if (bridgeResult.error) errors.push(`bridge: ${bridgeResult.error}`);
    if (swapResult.error) errors.push(`swap: ${swapResult.error}`);
    if (volumeResult.error) errors.push(`volume: ${volumeResult.error}`);
    if (scoreResult.error) errors.push(`score: ${scoreResult.error}`);
    if (analyticsResult.error) errors.push(`analytics: ${analyticsResult.error}`);
    if (cardsResult.error) errors.push(`cards: ${cardsResult.error}`);
    if (marvkResult.error) errors.push(`marvk: ${marvkResult.error}`);
    if (nadoResult.error) errors.push(`nado: ${nadoResult.error}`);
    if (copinkResult.error) errors.push(`copink: ${copinkResult.error}`);
    if (nft2meResult.error) errors.push(`nft2me: ${nft2meResult.error}`);
    if (tydroResult.error) errors.push(`tydro: ${tydroResult.error}`);
    if (openseaBuyCountResult.error) errors.push(`openseaBuyCount: ${openseaBuyCountResult.error}`);
    if (mintCountResult.error) errors.push(`mintCount: ${mintCountResult.error}`);
    if (openseaSaleCountResult.error) errors.push(`openseaSaleCount: ${openseaSaleCountResult.error}`);

    const response = {
      stats: statsResult.data,
      bridge: bridgeResult.data,
      swap: swapResult.data,
      volume: volumeResult.data,
      score: scoreResult.data,
      analytics: analyticsResult.data,
      cards: cardsResult.data,
      marvk: marvkResult.data,
      nado: nadoResult.data,
      copink: copinkResult.data,
      nft2me: nft2meResult.data,
      tydro: tydroResult.data,
      // Specific analytics metrics
      gmCount: gmCountResult.data,
      inkypumpCreatedTokens: inkypumpCreatedTokensResult.data,
      inkypumpBuyVolume: inkypumpBuyVolumeResult.data,
      inkypumpSellVolume: inkypumpSellVolumeResult.data,
      nftTraded: nftTradedResult.data,
      zns: znsResult.data,
      shelliesJoinedRaffles: shelliesJoinedRafflesResult.data,
      shelliesPayToPlay: shelliesPayToPlayResult.data,
      shelliesStaking: shelliesStakingResult.data,
      openseaBuyCount: openseaBuyCountResult.data,
      mintCount: mintCountResult.data,
      openseaSaleCount: openseaSaleCountResult.data,
      ...(errors.length > 0 && { errors }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
