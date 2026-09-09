import { NextRequest, NextResponse } from 'next/server';

// Use Node.js runtime - Edge Runtime blocks requests to IP addresses
// Node.js runtime still supports SSE streaming via ReadableStream
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';
const EXPRESS_TIMEOUT_MS = 15000;
const SCORE_TIMEOUT_MS = 30000;
const STREAM_TIMEOUT_MS = 45000;
// Cold bridge discovery walks 3 Blockscout histories + prices unlisted
// tokens via DeFi Llama — measured >20s on a fresh server. The 15s default
// aborts it while the handler is still computing (its result gets cached for
// the refresh instead), so the bridge card comes up empty on first load.
const BRIDGE_TIMEOUT_MS = 30000;

interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

// Verbose per-fetch logging: off by default (~60 lines per dashboard load,
// log I/O on warm invocations, drowns real warnings). Enable with DASHBOARD_DEBUG=true.
const DEBUG_LOGS = process.env.DASHBOARD_DEBUG === 'true';

async function fetchFromExpress<T>(endpoint: string, timeoutMs = EXPRESS_TIMEOUT_MS): Promise<FetchResult<T>> {
  try {
    if (DEBUG_LOGS) console.log(`[FETCH] Requesting: ${API_SERVER_URL}${endpoint}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${API_SERVER_URL}${endpoint}`, {
      headers: {
        'User-Agent': 'Vercel-Next.js',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (DEBUG_LOGS) console.log(`[FETCH] Response status: ${response.status} for ${endpoint}`);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      console.error(`[FETCH] Error response: ${errorText}`);
      return { data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    if (DEBUG_LOGS) console.log(`[FETCH] Response OK for ${endpoint}`);
    return { data, error: null };
  } catch (error) {
    console.error(`[FETCH] Exception for ${endpoint}:`, error);
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Slow routes (bridge discovery, 30-page outflow walks, first-ever swap/
// tydro/nft2me walks) can exceed a single fetch budget on a cold server.
// Aborting our fetch does NOT cancel the Express handler — it keeps
// computing and caches its result (responseCache / long caches / permanent
// per-tx caches), so a short-delay retry usually returns the warmed data
// instead of an empty card on first load.
const WARM_RETRY_DELAY_MS = 1500;
async function fetchWithWarmRetry<T>(
  endpoint: string,
  timeoutMs: number,
  budgetMs: number
): Promise<FetchResult<T>> {
  const start = Date.now();
  let result = await fetchFromExpress<T>(endpoint, timeoutMs);
  while (
    result.error &&
    !result.error.startsWith('HTTP') &&
    Date.now() - start < budgetMs - WARM_RETRY_DELAY_MS
  ) {
    await new Promise((resolve) => setTimeout(resolve, WARM_RETRY_DELAY_MS));
    const remaining = budgetMs - (Date.now() - start);
    result = await fetchFromExpress<T>(endpoint, Math.max(2000, Math.min(timeoutMs, remaining)));
  }
  return result;
}

// Streaming implementation for progressive dashboard loading
async function getStreamingDashboard(walletAddress: string, forceRefresh = false) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const startTime = Date.now();
      const TIMEOUT_MS = STREAM_TIMEOUT_MS;
      let timeoutId: NodeJS.Timeout | null = null;
      let isTimedOut = false;

      // Send immediate heartbeat to bypass Vercel proxy buffering
      controller.enqueue(encoder.encode(': ok\n\n'));

      // Endpoint fetcher bound to this request: propagates ?refresh=true to
      // Express (opens the cache-bypass window server-side) and applies the
      // warm-retry budget so slow cold computes still land. The retry budget
      // defaults to the per-call timeout; pass a wider budget for slow routes.
      const ef = (endpoint: string, timeoutMs = EXPRESS_TIMEOUT_MS, budgetMs = timeoutMs) =>
        fetchWithWarmRetry(
          forceRefresh ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}refresh=true` : endpoint,
          timeoutMs,
          budgetMs
        );

      // Define all metrics with IDs and endpoints.
      // OpenSea counts are served by Express from the official v2 API behind
      // memory + Postgres caches, so they're plain Express fetches like the rest.
      const metrics = [
        { id: 'stats', fetch: () => ef(`/api/wallet/${walletAddress}/stats`) },
        { id: 'bridge', fetch: () => ef(`/api/wallet/${walletAddress}/bridge`, BRIDGE_TIMEOUT_MS, 42000) },
        { id: 'swap', fetch: () => ef(`/api/wallet/${walletAddress}/swap`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'volume', fetch: () => ef(`/api/wallet/${walletAddress}/volume`, EXPRESS_TIMEOUT_MS, 42000) },
        { id: 'score', fetch: () => ef(`/api/wallet/${walletAddress}/score`, SCORE_TIMEOUT_MS) },
        { id: 'analytics', fetch: () => ef(`/api/analytics/${walletAddress}`) },
        { id: 'cards', fetch: () => ef(`/api/dashboard/cards/${walletAddress}`) },
        { id: 'nado', fetch: () => ef(`/api/nado/${walletAddress}`) },
        { id: 'otomate', fetch: () => ef(`/api/otomate/${walletAddress}`) },
        { id: 'cryptoclash', fetch: () => ef(`/api/cryptoclash/${walletAddress}`) },
        { id: 'nft2me', fetch: () => ef(`/api/wallet/${walletAddress}/nft2me`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'tydro', fetch: () => ef(`/api/wallet/${walletAddress}/tydro`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'gonefishin', fetch: () => ef(`/api/wallet/${walletAddress}/gonefishin`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'sentry', fetch: () => ef(`/api/wallet/${walletAddress}/sentry`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'hypercall', fetch: () => ef(`/api/wallet/${walletAddress}/hypercall`, EXPRESS_TIMEOUT_MS, 30000) },
        { id: 'gmCount', fetch: () => ef(`/api/analytics/${walletAddress}/gm_count`) },
        { id: 'inkypumpCreatedTokens', fetch: () => ef(`/api/analytics/${walletAddress}/inkypump_created_tokens`) },
        { id: 'inkypumpBuyVolume', fetch: () => ef(`/api/analytics/${walletAddress}/inkypump_buy_volume`) },
        { id: 'inkypumpSellVolume', fetch: () => ef(`/api/analytics/${walletAddress}/inkypump_sell_volume`) },
        { id: 'zns', fetch: () => ef(`/api/analytics/${walletAddress}/zns`) },
        { id: 'shelliesJoinedRaffles', fetch: () => ef(`/api/analytics/${walletAddress}/shellies_joined_raffles`) },
        { id: 'shelliesPayToPlay', fetch: () => ef(`/api/analytics/${walletAddress}/shellies_pay_to_play`) },
        { id: 'openseaBuyCount', fetch: () => ef(`/api/analytics/${walletAddress}/opensea_buy_count`) },
        { id: 'mintCount', fetch: () => ef(`/api/analytics/${walletAddress}/mint_count`) },
        { id: 'openseaSaleCount', fetch: () => ef(`/api/analytics/${walletAddress}/opensea_sale_count`) },
        { id: 'templarsNftBalance', fetch: () => ef(`/api/analytics/${walletAddress}/templars_nft_balance`) },
        { id: 'sweep', fetch: () => ef(`/api/analytics/${walletAddress}/sweep`) },
        { id: 'zenithNft', fetch: () => ef(`/api/analytics/${walletAddress}/zenith_nft_balance`) },
        { id: 'zenithStaking', fetch: () => ef(`/api/analytics/${walletAddress}/zenith_staking`) },
        { id: 'inkBrokers', fetch: () => ef(`/api/analytics/${walletAddress}/ink_brokers`) },
      ];

      // Sprint 2: bundle fast path — try ONE Express call for the whole
      // dashboard. On success, emit every metric event straight out of the
      // bundle (identical wire format: {type:'metric', id, data, error}) and
      // close: the client receives the full dashboard at once, which on a
      // snapshot is instant and on a live gather is ~5s — both faster than
      // the progressive per-endpoint fan-out below. On ANY bundle failure we
      // fall through to the original progressive fan-out, verbatim.
      const bundleStart = Date.now();
      try {
        const bundleResult = await fetchFromExpress<{
          captured_at: string;
          partial: boolean;
          from_snapshot: boolean;
          metrics: Record<string, unknown>;
        }>(
          `/api/dashboard/bundle/${walletAddress}${forceRefresh ? '?refresh=true' : ''}`,
          45000
        );
        if (bundleResult.data?.metrics) {
          const m = bundleResult.data.metrics;
          const bundleDuration = Date.now() - bundleStart;
          for (const metric of metrics) {
            const data = m[metric.id] ?? null;
            const message = `data: ${JSON.stringify({
              type: 'metric',
              id: metric.id,
              data,
              error: data == null ? 'missing from bundle' : null,
              duration: bundleDuration,
              timestamp: Date.now(),
            })}\n\n`;
            controller.enqueue(encoder.encode(message));
          }
          const doneEvent = `data: ${JSON.stringify({
            type: 'done',
            totalDuration: bundleDuration,
            timedOut: false,
            timestamp: Date.now(),
          })}\n\n`;
          controller.enqueue(encoder.encode(doneEvent));
          console.log(`[STREAM] bundle fast path: all ${metrics.length} metrics in ${bundleDuration}ms (from_snapshot=${bundleResult.data.from_snapshot})`);
          controller.close();
          return;
        }
        console.warn('[STREAM] bundle fast path unavailable (empty/failed), falling back to progressive fan-out');
      } catch (bundleErr) {
        console.warn('[STREAM] bundle fast path failed, falling back to progressive fan-out:', bundleErr instanceof Error ? bundleErr.message : bundleErr);
      }

      if (DEBUG_LOGS) console.log(`[STREAM] Started for wallet: ${walletAddress}`);

      // Set up stream timeout
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
      // An SSE stream is per-connection live data — it must never be cached.
      // (The previous 'private, s-maxage=30' here contradicted itself: a CDN
      // would have been allowed to cache/replay a stream.)
      'Cache-Control': 'no-store, no-transform',
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
    const forceRefresh = searchParams.get('refresh') === 'true';

    // Route to streaming implementation if requested
    if (enableStreaming) {
      return getStreamingDashboard(walletAddress, forceRefresh);
    }

    // Endpoint fetcher mirroring the streaming one: propagates ?refresh=true
    // and applies the warm-retry budget.
    const ef = (endpoint: string, timeoutMs = EXPRESS_TIMEOUT_MS, budgetMs = timeoutMs) =>
      fetchWithWarmRetry(
        forceRefresh ? `${endpoint}${endpoint.includes('?') ? '&' : '?'}refresh=true` : endpoint,
        timeoutMs,
        budgetMs
      );

    // Sprint 2 fast path: ONE Express call returns the whole dashboard
    // (responseCache -> dashboard snapshot -> live gather server-side).
    // Every entry is the exact payload the individual endpoint serves
    // (proven per-metric by api-server/scripts/check-bundle-parity.mjs).
    // The single response replaces ~26 fan-out fetches: one round trip,
    // no per-endpoint timeout roulette on the Next side.
    // On ANY bundle failure we fall through to the original fan-out below
    // (verbatim) — the fast path is an optimization, never a dependency.
    try {
      const bundleTimeoutMs = 45000; // bundle's internal caps bound it to ~30-45s cold; snapshot hits are instant
      const bundleResult = await fetchFromExpress<{
        captured_at: string;
        partial: boolean;
        from_snapshot: boolean;
        metrics: Record<string, unknown>;
      }>(
        `/api/dashboard/bundle/${walletAddress}${forceRefresh ? '?refresh=true' : ''}`,
        bundleTimeoutMs
      );
      if (bundleResult.data?.metrics) {
        const m = bundleResult.data.metrics;
        const start = Date.now();
        // Mirror the old fan-out's error reporting: a null entry is what an
        // errored per-endpoint fetch would have produced anyway.
        const errors: string[] = [];
        const trackedIds = ['stats', 'bridge', 'swap', 'volume', 'score', 'analytics', 'cards', 'nado', 'otomate', 'nft2me', 'tydro', 'gonefishin', 'sentry', 'hypercall', 'sweep', 'openseaBuyCount', 'mintCount', 'openseaSaleCount'] as const;
        for (const id of trackedIds) {
          if (m[id] == null) errors.push(`${id}: missing from bundle`);
        }
        if (DEBUG_LOGS) console.log(`[BUNDLE] fast path served from_snapshot=${bundleResult.data.from_snapshot} in ${Date.now() - start}ms`);
        return NextResponse.json(
          {
            stats: m.stats ?? null,
            bridge: m.bridge ?? null,
            swap: m.swap ?? null,
            volume: m.volume ?? null,
            score: m.score ?? null,
            analytics: m.analytics ?? null,
            cards: m.cards ?? null,
            nado: m.nado ?? null,
            otomate: (m.otomate ?? m.copink) ?? null,
            nft2me: m.nft2me ?? null,
            tydro: m.tydro ?? null,
            gonefishin: m.gonefishin ?? null,
            sentry: m.sentry ?? null,
            hypercall: m.hypercall ?? null,
            sweep: m.sweep ?? null,
            zenithNft: m.zenithNft ?? null,
            zenithStaking: m.zenithStaking ?? null,
            inkBrokers: m.inkBrokers ?? null,
            gmCount: m.gmCount ?? null,
            inkypumpCreatedTokens: m.inkypumpCreatedTokens ?? null,
            inkypumpBuyVolume: m.inkypumpBuyVolume ?? null,
            inkypumpSellVolume: m.inkypumpSellVolume ?? null,
            zns: m.zns ?? null,
            shelliesJoinedRaffles: m.shelliesJoinedRaffles ?? null,
            shelliesPayToPlay: m.shelliesPayToPlay ?? null,
            shelliesStaking: m.shelliesStaking ?? null,
            openseaBuyCount: m.openseaBuyCount ?? null,
            mintCount: m.mintCount ?? null,
            openseaSaleCount: m.openseaSaleCount ?? null,
            templarsNftBalance: m.templarsNftBalance ?? null,
            // The old non-streaming fan-out never filled cryptoclash (the
            // UI fetched it separately). The bundle has it — filling the
            // typed field is strictly closer to the declared contract.
            cryptoclash: m.cryptoclash ?? null,
            // Freshness + completeness metadata (optional, additive — old
            // clients ignore them). `partial` drives the UI's auto-heal:
            // a partial response schedules one silent refetch so the page
            // fills itself in as the background walks complete.
            from_snapshot: bundleResult.data.from_snapshot,
            captured_at: bundleResult.data.captured_at,
            partial: bundleResult.data.partial === true,
            ...(errors.length > 0 && { errors }),
          },
          {
            headers: {
              // Same policy as the fallback path below (30s CDN absorb).
              'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
            },
          }
        );
      }
      console.warn('[BUNDLE] fast path unavailable (empty/failed), falling back to per-endpoint fan-out');
    } catch (bundleErr) {
      console.warn('[BUNDLE] fast path failed, falling back to per-endpoint fan-out:', bundleErr instanceof Error ? bundleErr.message : bundleErr);
    }

    // Non-streaming implementation: fetch everything from Express in parallel
    const [
      statsResult,
      bridgeResult,
      swapResult,
      volumeResult,
      scoreResult,
      analyticsResult,
      cardsResult,
      nadoResult,
      otomateResult,
      nft2meResult,
      tydroResult,
      gonefishinResult,
      sentryResult,
      hypercallResult,
      sweepResult,
      zenithNftResult,
      zenithStakingResult,
      inkBrokersResult,
      // Specific analytics metrics
      gmCountResult,
      inkypumpCreatedTokensResult,
      inkypumpBuyVolumeResult,
      inkypumpSellVolumeResult,
      znsResult,
      shelliesJoinedRafflesResult,
      shelliesPayToPlayResult,
      openseaBuyCountResult,
      mintCountResult,
      openseaSaleCountResult,
      templarsNftBalanceResult,
    ] = await Promise.all([
      ef(`/api/wallet/${walletAddress}/stats`),
      ef(`/api/wallet/${walletAddress}/bridge`, BRIDGE_TIMEOUT_MS, 42000),
      ef(`/api/wallet/${walletAddress}/swap`, EXPRESS_TIMEOUT_MS, 30000),
      ef(`/api/wallet/${walletAddress}/volume`, EXPRESS_TIMEOUT_MS, 42000),
      ef(`/api/wallet/${walletAddress}/score`, SCORE_TIMEOUT_MS),
      ef(`/api/analytics/${walletAddress}`),
      ef(`/api/dashboard/cards/${walletAddress}`),
      ef(`/api/nado/${walletAddress}`),
      ef(`/api/otomate/${walletAddress}`),
      ef(`/api/wallet/${walletAddress}/nft2me`, EXPRESS_TIMEOUT_MS, 30000),
      ef(`/api/wallet/${walletAddress}/tydro`, EXPRESS_TIMEOUT_MS, 30000),
      ef(`/api/wallet/${walletAddress}/gonefishin`, EXPRESS_TIMEOUT_MS, 30000),
      ef(`/api/wallet/${walletAddress}/sentry`, EXPRESS_TIMEOUT_MS, 30000),
      ef(`/api/wallet/${walletAddress}/hypercall`, EXPRESS_TIMEOUT_MS, 30000),
      // Sweep from analytics (same source as the streaming path) so both
      // dashboard modes always agree; the old `/api/sweep/${w}` here was a
      // divergent second implementation of the same metric.
      ef(`/api/analytics/${walletAddress}/sweep`),
      ef(`/api/analytics/${walletAddress}/zenith_nft_balance`),
      ef(`/api/analytics/${walletAddress}/zenith_staking`),
      ef(`/api/analytics/${walletAddress}/ink_brokers`),
      // Specific analytics metrics
      ef(`/api/analytics/${walletAddress}/gm_count`),
      ef(`/api/analytics/${walletAddress}/inkypump_created_tokens`),
      ef(`/api/analytics/${walletAddress}/inkypump_buy_volume`),
      ef(`/api/analytics/${walletAddress}/inkypump_sell_volume`),
      ef(`/api/analytics/${walletAddress}/zns`),
      ef(`/api/analytics/${walletAddress}/shellies_joined_raffles`),
      ef(`/api/analytics/${walletAddress}/shellies_pay_to_play`),
      ef(`/api/analytics/${walletAddress}/opensea_buy_count`),
      ef(`/api/analytics/${walletAddress}/mint_count`),
      ef(`/api/analytics/${walletAddress}/opensea_sale_count`),
      ef(`/api/analytics/${walletAddress}/templars_nft_balance`),
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
    if (nadoResult.error) errors.push(`nado: ${nadoResult.error}`);
    if (otomateResult.error) errors.push(`otomate: ${otomateResult.error}`);
    if (nft2meResult.error) errors.push(`nft2me: ${nft2meResult.error}`);
    if (tydroResult.error) errors.push(`tydro: ${tydroResult.error}`);
    if (gonefishinResult.error) errors.push(`gonefishin: ${gonefishinResult.error}`);
    if (sentryResult.error) errors.push(`sentry: ${sentryResult.error}`);
    if (hypercallResult.error) errors.push(`hypercall: ${hypercallResult.error}`);
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
      nado: nadoResult.data,
      otomate: otomateResult.data,
      nft2me: nft2meResult.data,
      tydro: tydroResult.data,
      gonefishin: gonefishinResult.data,
      sentry: sentryResult.data,
      hypercall: hypercallResult.data,
      sweep: sweepResult.data,
      zenithNft: zenithNftResult.data,
      zenithStaking: zenithStakingResult.data,
      inkBrokers: inkBrokersResult.data,
      // Specific analytics metrics
      gmCount: gmCountResult.data,
      inkypumpCreatedTokens: inkypumpCreatedTokensResult.data,
      inkypumpBuyVolume: inkypumpBuyVolumeResult.data,
      inkypumpSellVolume: inkypumpSellVolumeResult.data,
      zns: znsResult.data,
      shelliesJoinedRaffles: shelliesJoinedRafflesResult.data,
      shelliesPayToPlay: shelliesPayToPlayResult.data,
      openseaBuyCount: openseaBuyCountResult.data,
      mintCount: mintCountResult.data,
      openseaSaleCount: openseaSaleCountResult.data,
      templarsNftBalance: templarsNftBalanceResult.data,
      ...(errors.length > 0 && { errors }),
    };

    return NextResponse.json(response, {
      headers: {
        // Wallet is in the URL (no per-user variance server-side), so a CDN
        // may absorb repeat loads for the same wallet. 30s staleness is
        // nothing against Express's 1h per-wallet cache. No-op when no CDN
        // sits in front (self-hosted direct).
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
