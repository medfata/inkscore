import { NextRequest, NextResponse } from 'next/server';

// Use Node.js runtime - Edge Runtime blocks requests to IP addresses
// Node.js runtime still supports SSE streaming via ReadableStream
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

const OPENSEA_GRAPHQL_URL = 'https://gql.opensea.io/graphql';
const OPENSEA_ACTIVITY_QUERY = `
query UseProfileActivityQuery($addresses: [Address!], $filter: ProfileActivityFilterInput, $cursor: String, $limit: Int!) {
  userActivity(addresses: $addresses, filter: $filter, cursor: $cursor, limit: $limit) {
    items { id type transactionHash from { address } to { address } }
    nextPageCursor
  }
}`;

/**
 * Fetch OpenSea buy/sale/mint counts directly from OpenSea GraphQL API (runs on Vercel).
 * Bypasses Express server which can't reliably reach OpenSea from datacenter IP.
 */
async function fetchOpenSeaCounts(walletAddress: string): Promise<{ buys: number; sales: number; mints: number }> {
  const normalized = walletAddress.toLowerCase();
  const allItems: Array<{ type: string; from?: { address: string }; to?: { address: string }; transactionHash: string }> = [];
  let cursor: string | null = null;
  let hasMore = true;
  let page = 0;
  const start = Date.now();

  while (hasMore && page < 30) {
    page++;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(OPENSEA_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          operationName: 'UseProfileActivityQuery',
          query: OPENSEA_ACTIVITY_QUERY,
          variables: {
            addresses: [normalized],
            filter: { activityTypes: ['SALE', 'MINT'], chains: ['ink'], collectionSlugs: [], markets: ['opensea'] },
            cursor,
            limit: 50,
          },
        }),
      });
      clearTimeout(timeout);

      if (res.status === 429) {
        const wait = parseInt(res.headers.get('Retry-After') || '3') * 1000;
        console.warn(`[OpenSea-Vercel] page ${page} rate limited, waiting ${wait}ms`);
        await new Promise(r => setTimeout(r, wait));
        page--;
        continue;
      }
      if (!res.ok) { console.error(`[OpenSea-Vercel] page ${page} error: ${res.status}`); break; }

      const data = await res.json() as any;
      const items = data.data?.userActivity?.items || [];
      allItems.push(...items);
      cursor = data.data?.userActivity?.nextPageCursor;
      hasMore = cursor !== null && items.length > 0;
      console.log(`[OpenSea-Vercel] page ${page}: ${items.length} items (total: ${allItems.length}) in ${Date.now() - start}ms`);
    } catch (err: any) {
      console.error(`[OpenSea-Vercel] page ${page} failed:`, err.message);
      break;
    }
  }

  let buys = 0, sales = 0;
  const mintTxs = new Set<string>();
  for (const item of allItems) {
    const from = item.from?.address?.toLowerCase();
    const to = item.to?.address?.toLowerCase();
    if (item.type === 'SALE') {
      if (to === normalized) buys++;
      else if (from === normalized) sales++;
    } else if (item.type === 'MINT' && to === normalized) {
      mintTxs.add(item.transactionHash);
    }
  }

  console.log(`[OpenSea-Vercel] ${walletAddress.slice(0, 10)}: buys=${buys} sales=${sales} mints=${mintTxs.size} in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  return { buys, sales, mints: mintTxs.size };
}

interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchFromExpress<T>(endpoint: string): Promise<FetchResult<T>> {
  try {
    console.log(`[FETCH] Requesting: ${API_SERVER_URL}${endpoint}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50000); // 50s per-metric timeout
    const response = await fetch(`${API_SERVER_URL}${endpoint}`, {
      headers: {
        'User-Agent': 'Vercel-Next.js',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    console.log(`[FETCH] Response status: ${response.status} for ${endpoint}`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[FETCH] Error response: ${errorText}`);
      return { data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    console.log(`[FETCH] Response OK for ${endpoint}`);
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
      const TIMEOUT_MS = 60000; // 60 seconds
      let timeoutId: NodeJS.Timeout | null = null;
      let isTimedOut = false;

      // Send immediate heartbeat to bypass Vercel proxy buffering
      controller.enqueue(encoder.encode(': ok\n\n'));

      // Shared OpenSea fetch — both buy and sale metrics reuse this single promise.
      // Also pushes counts to Express cache so the score endpoint can use them.
      const openSeaCountsPromise = fetchOpenSeaCounts(walletAddress).then(async (counts) => {
        // Push to Express cache so score endpoint doesn't need to call OpenSea API
        try {
          await fetch(`${API_SERVER_URL}/api/analytics/${walletAddress}/opensea-cache`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ buys: counts.buys, sales: counts.sales, mints: counts.mints }),
          });
          console.log(`[OpenSea-Vercel] Pushed counts to Express cache for ${walletAddress.slice(0, 10)}`);
        } catch (err) {
          console.warn(`[OpenSea-Vercel] Failed to push cache to Express:`, err);
        }
        return counts;
      });

      // Define all metrics with IDs and endpoints
      const metrics = [
        { id: 'stats', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/stats`) },
        { id: 'bridge', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/bridge`) },
        { id: 'swap', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/swap`) },
        { id: 'volume', fetch: () => fetchFromExpress(`/api/wallet/${walletAddress}/volume`) },
        // Score waits for OpenSea cache to be populated first, so Express has the counts ready
        { id: 'score', fetch: async () => { await openSeaCountsPromise; return fetchFromExpress(`/api/wallet/${walletAddress}/score`); } },
        { id: 'analytics', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}`) },
        { id: 'cards', fetch: () => fetchFromExpress(`/api/dashboard/cards/${walletAddress}`) },
        { id: 'marvk', fetch: () => fetchFromExpress(`/api/marvk/${walletAddress}`) },
        { id: 'nado', fetch: () => fetchFromExpress(`/api/nado/${walletAddress}`) },
        { id: 'copink', fetch: () => fetchFromExpress(`/api/copink/${walletAddress}`) },
        { id: 'cryptoclash', fetch: () => fetchFromExpress(`/api/cryptoclash/${walletAddress}`) },
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
        { id: 'nftStaking', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/nft_staking`) },
        // OpenSea metrics: fetched directly from OpenSea GraphQL on Vercel (bypasses Express server
        // which can't reliably reach OpenSea from datacenter IP)
        { id: 'openseaBuyCount', fetch: async () => {
          const counts = await openSeaCountsPromise;
          return { data: { slug: 'opensea_buy_count', name: 'OpenSea Buys', icon: 'https://opensea.io/favicon.ico', currency: 'COUNT', total_count: counts.buys, total_value: counts.buys.toString(), sub_aggregates: [], last_updated: new Date() }, error: null };
        }},
        { id: 'mintCount', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/mint_count`) },
        { id: 'openseaSaleCount', fetch: async () => {
          const counts = await openSeaCountsPromise;
          return { data: { slug: 'opensea_sale_count', name: 'OpenSea Sales', icon: 'https://opensea.io/favicon.ico', currency: 'COUNT', total_count: counts.sales, total_value: counts.sales.toString(), sub_aggregates: [], last_updated: new Date() }, error: null };
        }},
        { id: 'inkdcaRunDca', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/inkdca_run_dca`) },
        { id: 'templarsNftBalance', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/templars_nft_balance`) },
        { id: 'cowswapSwaps', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/cowswap_swaps`) },
        { id: 'sweep', fetch: () => fetchFromExpress(`/api/analytics/${walletAddress}/sweep`) },
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

    // Step 1: Fetch OpenSea counts from Vercel + push to Express cache + fetch non-score metrics in parallel
    const openSeaPromise = fetchOpenSeaCounts(walletAddress).then(async (counts) => {
      try {
        await fetch(`${API_SERVER_URL}/api/analytics/${walletAddress}/opensea-cache`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ buys: counts.buys, sales: counts.sales, mints: counts.mints }),
        });
      } catch (err) { /* cache push is best-effort */ }
      return counts;
    });

    const [
      statsResult,
      bridgeResult,
      swapResult,
      volumeResult,
      analyticsResult,
      cardsResult,
      marvkResult,
      nadoResult,
      copinkResult,
      nft2meResult,
      tydroResult,
      sweepResult,
      // Specific analytics metrics
      gmCountResult,
      inkypumpCreatedTokensResult,
      inkypumpBuyVolumeResult,
      inkypumpSellVolumeResult,
      nftTradedResult,
      znsResult,
      shelliesJoinedRafflesResult,
      shelliesPayToPlayResult,
      nftStakingResult,
      mintCountResult,
      inkdcaRunDcaResult,
      templarsNftBalanceResult,
      cowswapSwapsResult,
      openSeaCounts,
    ] = await Promise.all([
      fetchFromExpress(`/api/wallet/${walletAddress}/stats`),
      fetchFromExpress(`/api/wallet/${walletAddress}/bridge`),
      fetchFromExpress(`/api/wallet/${walletAddress}/swap`),
      fetchFromExpress(`/api/wallet/${walletAddress}/volume`),
      fetchFromExpress(`/api/analytics/${walletAddress}`),
      fetchFromExpress(`/api/dashboard/cards/${walletAddress}`),
      fetchFromExpress(`/api/marvk/${walletAddress}`),
      fetchFromExpress(`/api/nado/${walletAddress}`),
      fetchFromExpress(`/api/copink/${walletAddress}`),
      fetchFromExpress(`/api/wallet/${walletAddress}/nft2me`),
      fetchFromExpress(`/api/wallet/${walletAddress}/tydro`),
      fetchFromExpress(`/api/sweep/${walletAddress}`),
      // Specific analytics metrics
      fetchFromExpress(`/api/analytics/${walletAddress}/gm_count`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_created_tokens`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_buy_volume`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkypump_sell_volume`),
      fetchFromExpress(`/api/analytics/${walletAddress}/nft_traded`),
      fetchFromExpress(`/api/analytics/${walletAddress}/zns`),
      fetchFromExpress(`/api/analytics/${walletAddress}/shellies_joined_raffles`),
      fetchFromExpress(`/api/analytics/${walletAddress}/shellies_pay_to_play`),
      fetchFromExpress(`/api/analytics/${walletAddress}/nft_staking`),
      fetchFromExpress(`/api/analytics/${walletAddress}/mint_count`),
      fetchFromExpress(`/api/analytics/${walletAddress}/inkdca_run_dca`),
      fetchFromExpress(`/api/analytics/${walletAddress}/templars_nft_balance`),
      fetchFromExpress(`/api/analytics/${walletAddress}/cowswap_swaps`),
      openSeaPromise,
    ]);

    // Step 2: Now that OpenSea cache is populated on Express, fetch the score
    const scoreResult = await fetchFromExpress(`/api/wallet/${walletAddress}/score`);

    const openseaBuyCountResult: FetchResult<any> = {
      data: { slug: 'opensea_buy_count', name: 'OpenSea Buys', icon: 'https://opensea.io/favicon.ico', currency: 'COUNT', total_count: openSeaCounts.buys, total_value: openSeaCounts.buys.toString(), sub_aggregates: [], last_updated: new Date() },
      error: null,
    };
    const openseaSaleCountResult: FetchResult<any> = {
      data: { slug: 'opensea_sale_count', name: 'OpenSea Sales', icon: 'https://opensea.io/favicon.ico', currency: 'COUNT', total_count: openSeaCounts.sales, total_value: openSeaCounts.sales.toString(), sub_aggregates: [], last_updated: new Date() },
      error: null,
    };

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
    if (sweepResult.error) errors.push(`sweep: ${sweepResult.error}`);
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
      sweep: sweepResult.data,
      // Specific analytics metrics
      gmCount: gmCountResult.data,
      inkypumpCreatedTokens: inkypumpCreatedTokensResult.data,
      inkypumpBuyVolume: inkypumpBuyVolumeResult.data,
      inkypumpSellVolume: inkypumpSellVolumeResult.data,
      nftTraded: nftTradedResult.data,
      zns: znsResult.data,
      shelliesJoinedRaffles: shelliesJoinedRafflesResult.data,
      shelliesPayToPlay: shelliesPayToPlayResult.data,
      nftStaking: nftStakingResult.data,
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
