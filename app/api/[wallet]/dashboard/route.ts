import { NextRequest, NextResponse } from 'next/server';

// Use Node.js runtime - Edge Runtime blocks requests to IP addresses
// Node.js runtime still supports SSE streaming via ReadableStream
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchFromExpress<T>(endpoint: string): Promise<FetchResult<T>> {
  try {
    console.log(`[FETCH] Requesting: ${API_SERVER_URL}${endpoint}`);
    const response = await fetch(`${API_SERVER_URL}${endpoint}`, {
      headers: {
        'User-Agent': 'Vercel-Next.js',
        'Accept': 'application/json',
      }
    });
    console.log(`[FETCH] Response status: ${response.status} for ${endpoint}`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[FETCH] Error response: ${errorText}`);
      return { data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    console.error(`[FETCH] Exception for ${endpoint}:`, error);
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Streaming implementation for progressive dashboard loading
async function getStreamingDashboard(walletAddress: string) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const TIMEOUT_MS = 30000; // 30 seconds
      let timeoutId: NodeJS.Timeout | null = null;
      let isTimedOut = false;

      // Send immediate heartbeat to bypass Vercel proxy buffering
      controller.enqueue(encoder.encode(': ok\n\n'));

      // Define all metrics with IDs and endpoints
      const metrics = [
        { id: 'stats', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/stats`) },
        { id: 'bridge', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/bridge`) },
        { id: 'swap', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/swap`) },
        { id: 'volume', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/volume`) },
        { id: 'score', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/score`) },
        { id: 'analytics', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}`) },
        { id: 'cards', fetch: () => fetchFromExpress(`/api/dashboard/cards/${walletAddress}`) },
        { id: 'marvk', fetch: () => fetchFromExpress(`/api/marvk/${walletAddress}`) },
        { id: 'nado', fetch: () => fetchFromExpress(`/api/nado/${walletAddress}`) },
        { id: 'copink', fetch: () => fetchFromExpress(`/api/copink/${walletAddress}`) },
        { id: 'nft2me', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/nft2me`) },
        { id: 'tydro', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/tydro`) },
        { id: 'gmCount', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/gm_count`) },
        { id: 'inkypumpCreatedTokens', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_created_tokens`) },
        { id: 'inkypumpBuyVolume', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_buy_volume`) },
        { id: 'inkypumpSellVolume', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_sell_volume`) },
        { id: 'nftTraded', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/nft_traded`) },
        { id: 'zns', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/zns`) },
        { id: 'shelliesJoinedRaffles', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/shellies_joined_raffles`) },
        { id: 'shelliesPayToPlay', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/shellies_pay_to_play`) },
        { id: 'shelliesStaking', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/shellies_staking`) },
        { id: 'openseaBuyCount', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/opensea_buy_count`) },
        { id: 'mintCount', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/mint_count`) },
        { id: 'openseaSaleCount', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/opensea_sale_count`) },
        { id: 'inkdcaRunDca', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/inkdca_run_dca`) },
        { id: 'templarsNftBalance', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/templars_nft_balance`) },
        { id: 'cowswapSwaps', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/cowswap_swaps`) },
      ];

      console.log(`[STREAM] Started for wallet: ${walletAddress}`);

      // Set up 30s timeout
      const timeoutPromise = new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          isTimedOut = true;
          console.warn(`[STREAM] Timeout reached (${TIMEOUT_MS}ms) for wallet: ${walletAddress}`);
          resolve();
        }, TIMEOUT_MS);
      });

      // Start all fetches and stream each as it completes
      const promises = metrics.map(async (metric) => {
        const metricStartTime = Date.now();

        try {
          const result = await metric.fetch();
          const duration = Date.now() - metricStartTime;

          // Don't stream if we've timed out
          if (isTimedOut) {
            console.log(`[STREAM] Skipping metric ${metric.id} - stream timed out`);
            return;
          }

          // Stream this metric immediately
          const event = {
            type: 'metric',
            id: metric.id,
            data: result.data,
            error: result.error,
            duration,
            timestamp: Date.now(),
          };

          const message = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(message));

          console.log(`[STREAM] Metric ${metric.id} completed in ${duration}ms`);
        } catch (error) {
          // Don't stream if we've timed out
          if (isTimedOut) {
            console.log(`[STREAM] Skipping error for metric ${metric.id} - stream timed out`);
            return;
          }

          // Stream error for this metric
          const errorEvent = {
            type: 'error',
            id: metric.id,
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: Date.now(),
          };

          const message = `data: ${JSON.stringify(errorEvent)}\n\n`;
          controller.enqueue(encoder.encode(message));

          console.error(`[STREAM] Metric ${metric.id} failed:`, error);
        }
      });

      // Wait for all to complete or timeout
      await Promise.race([
        Promise.allSettled(promises),
        timeoutPromise
      ]);

      // Clear timeout if it hasn't fired
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const totalDuration = Date.now() - startTime;

      // Send completion event
      const doneEvent = `data: ${JSON.stringify({ 
        type: 'done', 
        totalDuration,
        timedOut: isTimedOut,
        timestamp: Date.now() 
      })}\n\n`;
      controller.enqueue(encoder.encode(doneEvent));

      console.log(`[STREAM] ${isTimedOut ? 'Timed out' : 'All metrics completed'} in ${totalDuration}ms`);

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
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

    // Check if streaming is requested
    const { searchParams } = new URL(request.url);
    const enableStreaming = searchParams.get('stream') === 'true';

    // Route to streaming implementation if requested
    if (enableStreaming) {
      return getStreamingDashboard(walletAddress);
    }

    // Continue with existing non-streaming implementation

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
      inkdcaRunDcaResult,
      templarsNftBalanceResult,
      cowswapSwapsResult,
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
      fetchFromExpress(`/api/analytics/${walletAddress}/inkdca_run_dca`),
      fetchFromExpress(`/api/analytics/${walletAddress}/templars_nft_balance`),
      fetchFromExpress(`/api/analytics/${walletAddress}/cowswap_swaps`),
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
      inkdcaRunDca: inkdcaRunDcaResult.data,
      templarsNftBalance: templarsNftBalanceResult.data,
      cowswapSwaps: cowswapSwapsResult.data,
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
