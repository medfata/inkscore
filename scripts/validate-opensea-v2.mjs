// Validates the official OpenSea v2 events API against our use case:
// per-wallet buy/sale/mint counts on the Ink chain, compared side-by-side
// with the unofficial GraphQL endpoint the dashboard currently uses.
//
// Usage:
//   OPENSEA_API_KEY=<key> node scripts/validate-opensea-v2.mjs [wallet]
// (PowerShell: $env:OPENSEA_API_KEY = '<key>'; node scripts/validate-opensea-v2.mjs)
//
// Get a key: opensea.io -> profile -> Settings -> Developer -> API Keys (instant key)

const API_KEY = process.env.OPENSEA_API_KEY;
const WALLET = (process.argv[2] || '0xe44f5F41d11d142ed428930bB7fBC5B162E7efE2').toLowerCase();

if (!API_KEY) {
  console.error('Missing OPENSEA_API_KEY env var.');
  process.exit(1);
}

// ---------- Official v2 REST API ----------

async function fetchV2Events() {
  const events = [];
  let next = null;
  let page = 0;
  let retries5xx = 0;

  do {
    page++;
    const params = new URLSearchParams({ chain: 'ink', limit: '50' });
    params.append('event_type', 'sale');
    params.append('event_type', 'mint');
    if (next) params.set('next', next);

    const url = `https://api.opensea.io/api/v2/events/accounts/${WALLET}?${params}`;
    const res = await fetch(url, { headers: { 'x-api-key': API_KEY, Accept: 'application/json' } });

    if (res.status === 429 || res.status >= 500) {
      if (++retries5xx > 4) {
        console.warn(`[v2] giving up after ${retries5xx - 1} retries (HTTP ${res.status}), returning partial results`);
        break;
      }
      console.warn(`[v2] page ${page} HTTP ${res.status}, retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      page--;
      continue;
    }
    if (!res.ok) {
      console.error(`[v2] HTTP ${res.status}: ${await res.text()}`);
      process.exit(1);
    }

    const data = await res.json();
    const items = data.asset_events || [];
    events.push(...items);
    next = data.next || null;
    console.log(`[v2] page ${page}: ${items.length} events (total ${events.length})`);
  } while (next && page < 20);

  return events;
}

function countV2(events) {
  let buys = 0, sales = 0;
  const mintTxs = new Set();
  const protocols = new Set();

  for (const e of events) {
    if (e.event_type === 'sale') {
      if (e.protocol_address) protocols.add(e.protocol_address.toLowerCase());
      if (e.buyer?.toLowerCase() === WALLET) buys++;
      else if (e.seller?.toLowerCase() === WALLET) sales++;
    } else if (e.event_type === 'mint' || (e.event_type === 'transfer' && e.transfer_type === 'mint')) {
      if (e.to_address?.toLowerCase() === WALLET && e.transaction) mintTxs.add(e.transaction);
    }
  }
  return { buys, sales, mints: mintTxs.size, protocols: [...protocols] };
}

// ---------- Unofficial GraphQL (current implementation, for comparison) ----------

const GQL_QUERY = `
query UseProfileActivityQuery($addresses: [Address!], $filter: ProfileActivityFilterInput, $cursor: String, $limit: Int!) {
  userActivity(addresses: $addresses, filter: $filter, cursor: $cursor, limit: $limit) {
    items { id type transactionHash from { address } to { address } }
    nextPageCursor
  }
}`;

async function fetchGqlCounts() {
  const allItems = [];
  let cursor = null;
  let hasMore = true;
  let page = 0;
  let retries = 0;

  while (hasMore && page < 8) {
    page++;
    const res = await fetch('https://gql.opensea.io/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'UseProfileActivityQuery',
        query: GQL_QUERY,
        variables: {
          addresses: [WALLET],
          filter: { activityTypes: ['SALE', 'MINT'], chains: ['ink'], collectionSlugs: [], markets: ['opensea'] },
          cursor,
          limit: 50,
        },
      }),
    });
    if (res.status === 429) {
      if (++retries > 2) { console.warn('[gql] rate limited, giving up (partial counts)'); break; }
      await new Promise((r) => setTimeout(r, 3000));
      page--;
      continue;
    }
    if (!res.ok) { console.warn(`[gql] HTTP ${res.status}, skipping comparison`); return null; }
    const data = await res.json();
    const items = data.data?.userActivity?.items || [];
    allItems.push(...items);
    cursor = data.data?.userActivity?.nextPageCursor;
    hasMore = cursor !== null && items.length > 0;
    console.log(`[gql] page ${page}: ${items.length} items (total ${allItems.length})`);
  }

  let buys = 0, sales = 0;
  const mintTxs = new Set();
  for (const item of allItems) {
    const from = item.from?.address?.toLowerCase();
    const to = item.to?.address?.toLowerCase();
    if (item.type === 'SALE') {
      if (to === WALLET) buys++;
      else if (from === WALLET) sales++;
    } else if (item.type === 'MINT' && to === WALLET) {
      mintTxs.add(item.transactionHash);
    }
  }
  return { buys, sales, mints: mintTxs.size };
}

// ---------- Run ----------

console.log(`Wallet: ${WALLET}\n`);

const v2Events = await fetchV2Events();
const v2 = countV2(v2Events);

const sampleSale = v2Events.find((e) => e.event_type === 'sale');
const sampleMint = v2Events.find((e) => e.event_type === 'mint' || e.transfer_type === 'mint');
if (sampleSale) console.log('\nSample sale event:\n', JSON.stringify(sampleSale, null, 2));
if (sampleMint) console.log('\nSample mint event:\n', JSON.stringify(sampleMint, null, 2));
if (!sampleSale && !sampleMint) console.log('\nNo sale/mint events returned — try a wallet with known OpenSea activity on Ink.');

console.log('\nSale protocol addresses seen (Seaport 1.6 = 0x0000000000000068f116a894984e2db1123eb395):');
console.log(' ', v2.protocols.length ? v2.protocols.join('\n  ') : '(none)');

console.log('\nFetching same counts from unofficial GraphQL for comparison...');
const gql = await fetchGqlCounts();

console.log('\n================ RESULTS ================');
console.log(`v2 REST:  buys=${v2.buys} sales=${v2.sales} mints=${v2.mints} (${v2Events.length} raw events)`);
if (gql) {
  console.log(`GraphQL:  buys=${gql.buys} sales=${gql.sales} mints=${gql.mints}`);
  const match = gql.buys === v2.buys && gql.sales === v2.sales && gql.mints === v2.mints;
  console.log(match ? '\n✓ Counts MATCH — v2 API covers the use case.' : '\n✗ Counts DIFFER — inspect sample events above (marketplace filter / quantity semantics).');
} else {
  console.log('GraphQL:  unavailable (rate limited/blocked) — v2 counts above are standalone.');
}
