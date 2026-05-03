import 'dotenv/config';

/**
 * Performance test for OpenSea GraphQL API
 * Instruments each paginated request to measure timing, rate-limit delays, etc.
 *
 * Usage: npx ts-node scripts/test-opensea-performance.ts
 */

const OPENSEA_GRAPHQL_URL = 'https://gql.opensea.io/graphql';
const WALLET = '0x1a1e4708fce01d805d6ea468e3c1ef9d1106b1b5';

const USER_ACTIVITY_QUERY = `
query UseProfileActivityQuery($addresses: [Address!], $filter: ProfileActivityFilterInput, $cursor: String, $limit: Int!) {
  userActivity(
    addresses: $addresses
    filter: $filter
    cursor: $cursor
    limit: $limit
  ) {
    items {
      id
      eventTime
      type
      transactionHash
      from { address }
      to { address }
      ... on Sale {
        saleType
        price { token { unit symbol } usd }
      }
      ... on Mint { quantity }
    }
    nextPageCursor
  }
}
`;

interface PageTiming {
  page: number;
  itemsReturned: number;
  rateLimitWaitMs: number;
  fetchMs: number;
  parseMs: number;
  totalMs: number;
  was429: boolean;
  retryCount: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('OPENSEA GRAPHQL API - PERFORMANCE TEST');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log(`Endpoint: ${OPENSEA_GRAPHQL_URL}`);
  console.log();

  const MIN_INTERVAL = 500; // matches opensea-service.ts
  let lastRequestTime = 0;
  let cursor: string | null = null;
  let hasMore = true;
  let page = 0;
  let totalItems = 0;
  const timings: PageTiming[] = [];
  const overallStart = Date.now();

  while (hasMore) {
    page++;
    const pageStart = Date.now();
    let rateLimitWaitMs = 0;
    let fetchMs = 0;
    let parseMs = 0;
    let was429 = false;
    let retryCount = 0;
    let itemsReturned = 0;

    // Rate-limit delay
    const now = Date.now();
    const timeSinceLast = now - lastRequestTime;
    if (lastRequestTime > 0 && timeSinceLast < MIN_INTERVAL) {
      const wait = MIN_INTERVAL - timeSinceLast;
      rateLimitWaitMs = wait;
      console.log(`  [page ${page}] Self-throttle wait: ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }

    // Retry loop for 429s
    let success = false;
    while (!success) {
      const fetchStart = Date.now();
      lastRequestTime = Date.now();

      const response = await fetch(OPENSEA_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'UseProfileActivityQuery',
          query: USER_ACTIVITY_QUERY,
          variables: {
            addresses: [WALLET.toLowerCase()],
            filter: {
              activityTypes: ['SALE', 'MINT'],
              chains: ['ink'],
              collectionSlugs: [],
              markets: ['opensea'],
            },
            cursor,
            limit: 50,
          },
        }),
      });

      fetchMs += Date.now() - fetchStart;

      if (response.status === 429) {
        was429 = true;
        retryCount++;
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
        console.log(`  [page ${page}] GOT 429 - waiting ${waitTime}ms (retry #${retryCount})`);
        rateLimitWaitMs += waitTime;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        console.log(`  [page ${page}] ERROR: ${response.status} ${response.statusText}`);
        hasMore = false;
        success = true;
        break;
      }

      const parseStart = Date.now();
      const data = await response.json() as any;
      parseMs = Date.now() - parseStart;

      const items = data.data?.userActivity?.items || [];
      itemsReturned = items.length;
      totalItems += itemsReturned;

      cursor = data.data?.userActivity?.nextPageCursor;
      hasMore = cursor !== null && items.length > 0;
      success = true;
    }

    const totalMs = Date.now() - pageStart;

    const timing: PageTiming = {
      page,
      itemsReturned,
      rateLimitWaitMs,
      fetchMs,
      parseMs,
      totalMs,
      was429,
      retryCount,
    };
    timings.push(timing);

    console.log(
      `  [page ${page}] items: ${itemsReturned} | fetch: ${fetchMs}ms | parse: ${parseMs}ms | throttle: ${rateLimitWaitMs}ms | total: ${totalMs}ms${was429 ? ` | 429 retries: ${retryCount}` : ''}`
    );
  }

  const overallMs = Date.now() - overallStart;

  console.log();
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`  Total pages:          ${page}`);
  console.log(`  Total items:          ${totalItems}`);
  console.log(`  Total time:           ${overallMs}ms (${(overallMs / 1000).toFixed(2)}s)`);
  console.log();

  const totalFetch = timings.reduce((s, t) => s + t.fetchMs, 0);
  const totalThrottle = timings.reduce((s, t) => s + t.rateLimitWaitMs, 0);
  const totalParse = timings.reduce((s, t) => s + t.parseMs, 0);
  const total429 = timings.filter(t => t.was429).length;

  console.log('  Time breakdown:');
  console.log(`    Network (fetch):    ${totalFetch}ms (${((totalFetch / overallMs) * 100).toFixed(1)}%)`);
  console.log(`    Self-throttle:      ${totalThrottle}ms (${((totalThrottle / overallMs) * 100).toFixed(1)}%)`);
  console.log(`    JSON parse:         ${totalParse}ms (${((totalParse / overallMs) * 100).toFixed(1)}%)`);
  console.log(`    Other overhead:     ${overallMs - totalFetch - totalThrottle - totalParse}ms`);
  console.log();
  console.log(`  429 rate limits hit:  ${total429} pages`);
  console.log(`  Avg fetch per page:   ${(totalFetch / page).toFixed(0)}ms`);
  console.log(`  Avg items per page:   ${(totalItems / page).toFixed(1)}`);
  console.log();

  // Show per-page table
  console.log('  Page | Items | Fetch(ms) | Throttle(ms) | Total(ms) | 429?');
  console.log('  ─────┼───────┼───────────┼──────────────┼───────────┼─────');
  for (const t of timings) {
    console.log(
      `  ${String(t.page).padStart(4)} | ${String(t.itemsReturned).padStart(5)} | ${String(t.fetchMs).padStart(9)} | ${String(t.rateLimitWaitMs).padStart(12)} | ${String(t.totalMs).padStart(9)} | ${t.was429 ? `YES (${t.retryCount}x)` : 'no'}`
    );
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
