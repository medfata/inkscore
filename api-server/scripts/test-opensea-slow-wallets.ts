import 'dotenv/config';

const OPENSEA_GRAPHQL_URL = 'https://gql.opensea.io/graphql';

const WALLETS = [
  '0xB6F28ae8f31D85dC27361852b986286113Bc588D',
  '0x73107D5EcCcF6F698223e589D2FB3472041eB40A',
  '0xae6f9c8DbC2514cb7B1FdD6E9E5f92226d5F1e41',
];

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

async function testWallet(wallet: string) {
  const label = wallet.slice(0, 8) + '...';
  console.log(`\n[${ label}] Starting fetch...`);

  const MIN_INTERVAL = 500;
  let lastRequestTime = 0;
  let cursor: string | null = null;
  let hasMore = true;
  let page = 0;
  let totalItems = 0;
  let total429s = 0;
  let totalThrottleMs = 0;
  const overallStart = Date.now();

  const normalizedWallet = wallet.toLowerCase();
  let buys = 0, sales = 0, mints = 0;
  const mintTxs = new Set<string>();

  while (hasMore) {
    page++;

    // Self-throttle
    const now = Date.now();
    const gap = now - lastRequestTime;
    if (lastRequestTime > 0 && gap < MIN_INTERVAL) {
      const wait = MIN_INTERVAL - gap;
      totalThrottleMs += wait;
      await new Promise(r => setTimeout(r, wait));
    }

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
            addresses: [normalizedWallet],
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

      const fetchMs = Date.now() - fetchStart;

      if (response.status === 429) {
        total429s++;
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
        console.log(`  [${label}] page ${page} - 429 RATE LIMITED, waiting ${waitTime}ms (total 429s: ${total429s})`);
        totalThrottleMs += waitTime;
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      if (!response.ok) {
        console.log(`  [${label}] page ${page} - ERROR ${response.status}`);
        hasMore = false;
        success = true;
        break;
      }

      const data = await response.json() as any;
      const items = data.data?.userActivity?.items || [];
      totalItems += items.length;

      // Count buys/sales/mints
      for (const item of items) {
        const from = item.from?.address?.toLowerCase();
        const to = item.to?.address?.toLowerCase();
        if (item.type === 'SALE') {
          if (to === normalizedWallet) buys++;
          else if (from === normalizedWallet) sales++;
        } else if (item.type === 'MINT') {
          if (to === normalizedWallet) mintTxs.add(item.transactionHash);
        }
      }

      cursor = data.data?.userActivity?.nextPageCursor;
      hasMore = cursor !== null && items.length > 0;
      success = true;

      console.log(`  [${label}] page ${page} - ${items.length} items in ${fetchMs}ms (running total: ${totalItems})`);
    }
  }

  const totalMs = Date.now() - overallStart;
  mints = mintTxs.size;

  console.log(`\n  [${label}] DONE`);
  console.log(`  Pages: ${page} | Items: ${totalItems} | Time: ${(totalMs / 1000).toFixed(2)}s`);
  console.log(`  429 rate limits: ${total429s} | Throttle time: ${(totalThrottleMs / 1000).toFixed(2)}s`);
  console.log(`  Buys: ${buys} | Sales: ${sales} | Mints: ${mints}`);

  return { wallet: label, pages: page, totalItems, totalMs, total429s, totalThrottleMs, buys, sales, mints };
}

async function main() {
  console.log('='.repeat(80));
  console.log('OPENSEA SLOW WALLET PERFORMANCE TEST');
  console.log('='.repeat(80));

  // Run sequentially to avoid cross-wallet rate limiting interference
  const results = [];
  for (const wallet of WALLETS) {
    results.push(await testWallet(wallet));
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\n  Wallet       | Pages | Items | Time(s)  | 429s | Buys | Sales | Mints');
  console.log('  ─────────────┼───────┼───────┼──────────┼──────┼──────┼───────┼──────');
  for (const r of results) {
    console.log(
      `  ${r.wallet.padEnd(13)}| ${String(r.pages).padStart(5)} | ${String(r.totalItems).padStart(5)} | ${(r.totalMs / 1000).toFixed(2).padStart(8)} | ${String(r.total429s).padStart(4)} | ${String(r.buys).padStart(4)} | ${String(r.sales).padStart(5)} | ${String(r.mints).padStart(5)}`
    );
  }

  const totalTime = results.reduce((s, r) => s + r.totalMs, 0);
  const total429s = results.reduce((s, r) => s + r.total429s, 0);
  console.log(`\n  Total time for all 3 wallets: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`  Total 429 rate limits: ${total429s}`);
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });
