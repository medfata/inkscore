const TEST_WALLET = '0xf0246C84bB2dCB2C68A17047480a669D59E2F41C';
const COW_SWAP_API_BASE = 'https://api.cow.fi/ink/api/v1';
const METRIC_API_BASE = 'http://localhost:4000';
const PAGE_SIZE = 100;

const TOKEN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
  '0xd642b49d10cc6e1bc1c6945725667c35e0875f22': { symbol: 'PURPLE', decimals: 18 },
  '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5': { symbol: 'CAT', decimals: 18 },
  '0xca5f2ccbd9c40b32657df57c716de44237f80f05': { symbol: 'KRAKEN', decimals: 18 },
  '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT0', decimals: 6 },
  '0x53eb0098d09b8d1008f382bbd2a5d4f649111710': { symbol: 'WATCH', decimals: 18 },
  '0x0606fc632ee812ba970af72f8489baaa443c4b98': { symbol: 'ANITA', decimals: 18 },
  '0x0c5e2d1c98cd265c751e02f8f3293bc5764f9111': { symbol: 'SHROOMY', decimals: 18 },
  '0x62c99fac20b33b5423fdf9226179e973a8353e36': { symbol: 'BERT', decimals: 18 },
  '0xa802bccd14f7e78e48ffe0c9cf9ad0273c77d4b0': { symbol: 'INKEDUSDT', decimals: 6 },
  '0xc845b2894dbddd03858fd2d643b4ef725fe0849d': { symbol: 'NVDAX', decimals: 18 },
  '0x53ad50d3b6fcacb8965d3a49cb722917c7dae1f3': { symbol: 'ACRED', decimals: 6 },
  '0xc99f5c922dae05b6e2ff83463ce705ef7c91f077': { symbol: 'XSOLVBTC', decimals: 18 },
  '0x2416092f143378750bb29b79ed961ab195cceea5': { symbol: 'EZETH', decimals: 18 },
  '0xc3eacf0612346366db554c991d7858716db09f58': { symbol: 'RSETH', decimals: 18 },
  '0xf50258d3c1dd88946c567920b986a12e65b50dac': { symbol: 'XAUT0', decimals: 6 },
  '0x2d270e6886d130d724215a266106e6832161eaed': { symbol: 'USDC', decimals: 6 },
  '0xe343167631d89b6ffc58b88d6b7fb0228795491d': { symbol: 'USDG', decimals: 6 },
  '0x17906b1cd88aa8efaefc5e82891b52a22219bd45': { symbol: 'SUPR', decimals: 18 },
  '0x73e0c0d45e048d25fc26fa3159b0aa04bfa4db98': { symbol: 'KBTC', decimals: 8 },
  '0xae4efbc7736f963982aacb17efa37fcbab924cb3': { symbol: 'SOLVBTC', decimals: 18 },
  '0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189': { symbol: 'OUSDT', decimals: 6 },
  '0xa3d68b74bf0528fdd07263c60d6488749044914b': { symbol: 'WEETH', decimals: 18 },
  '0xf1815bd50389c46847f0bda824ec8da914045d14': { symbol: 'USDC.E', decimals: 6 },
  '0x71052bae71c25c78e37fd12e5ff1101a71d9018f': { symbol: 'LINK', decimals: 18 },
  '0x64445f0aecc51e94ad52d8ac56b7190e764e561a': { symbol: 'WFRAX', decimals: 18 },
  '0xfc421ad3c883bf9e7c4f42de845c4e4405799e73': { symbol: 'GHO', decimals: 18 },
  '0x80eede496655fb9047dd39d9f418d5483ed600df': { symbol: 'FRXUSD', decimals: 18 },
  '0x3d63825b0d8669307366e6c8202f656b9e91d368': { symbol: 'WGC', decimals: 6 },
  '0xa161132371c94299d215915d4cbc3b629e2059be': { symbol: 'BRBTC', decimals: 8 },
  '0x5bcf6b008bf80b9296238546bace1797657b05d6': { symbol: 'REUSD', decimals: 18 },
  '0xe8245188db1efc91aef32e7aa4cf346b9a5830cf': { symbol: 'LCAP', decimals: 18 },
  '0xd3c8da379d71a33bfee8875f87ac2748beb1d58d': { symbol: 'UNIBTC', decimals: 8 },
};

async function fetchRawCowSwapOrders(wallet: string): Promise<any[]> {
  console.log('\n📡 Fetching raw Cow Swap API data...');
  const allOrders: any[] = [];
  let offset = 0;
  let hasMorePages = true;

  while (hasMorePages) {
    const url = `${COW_SWAP_API_BASE}/account/${wallet.toLowerCase()}/orders?offset=${offset}&limit=${PAGE_SIZE}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Cow Swap API error: ${response.status}`);
    }

    const orders = await response.json();
    
    if (!Array.isArray(orders) || orders.length === 0) {
      hasMorePages = false;
      break;
    }

    allOrders.push(...orders);

    if (orders.length < PAGE_SIZE) {
      hasMorePages = false;
    } else {
      offset += PAGE_SIZE;
    }
  }

  console.log(`   ✓ Retrieved ${allOrders.length} total orders from raw API`);
  return allOrders;
}

async function fetchTokenPrices(tokenAddresses: Set<string>): Promise<Record<string, number>> {
  if (tokenAddresses.size === 0) return {};

  const addressList = Array.from(tokenAddresses)
    .map(addr => `ink:${addr}`)
    .join(',');
  
  const url = `https://coins.llama.fi/prices/current/${addressList}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    console.warn('   ⚠ DeFi Llama price API returned non-OK status:', response.status);
    return {};
  }

  const data = await response.json() as any;
  const prices: Record<string, number> = {};

  if (data.coins) {
    for (const [key, coinData] of Object.entries(data.coins)) {
      const address = key.replace('ink:', '').toLowerCase();
      prices[address] = (coinData as any).price || 0;
    }
  }

  console.log(`   ✓ Fetched prices for ${Object.keys(prices).length} tokens`);
  return prices;
}

async function fetchMetricEndpoint(wallet: string): Promise<any> {
  console.log('\n📊 Fetching metric endpoint...');
  const url = `${METRIC_API_BASE}/api/analytics/${wallet.toLowerCase()}/cowswap_swaps`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Metric endpoint error: ${response.status}`);
  }

  const data: any = await response.json();
  console.log(`   ✓ Retrieved metric: total_count=${data.total_count}, total_value=${data.total_value}`);
  return data;
}

function calculateMetricFromRaw(orders: any[], prices: Record<string, number>): {
  totalCount: number;
  totalUsdValue: number;
  tokenBreakdown: Record<string, { count: number; usdValue: number }>;
} {
  const validSwaps = orders.filter(order => 
    order.status === 'fulfilled' && order.invalidated === false
  );

  let totalUsdValue = 0;
  const tokenBreakdown: Record<string, { count: number; usdValue: number }> = {};

  for (const order of validSwaps) {
    const sellToken = order.sellToken?.toLowerCase();
    const buyToken = order.buyToken?.toLowerCase();
    
    const sellMeta = sellToken ? TOKEN_METADATA[sellToken] : null;
    const buyMeta = buyToken ? TOKEN_METADATA[buyToken] : null;

    let orderUsdValue = 0;
    let tokenSymbol = 'UNKNOWN';

    if (sellToken && sellMeta && order.executedSellAmount) {
      const rawAmount = BigInt(order.executedSellAmount);
      const normalizedAmount = Number(rawAmount) / Math.pow(10, sellMeta.decimals);
      const tokenPrice = prices[sellToken] || 0;
      orderUsdValue = normalizedAmount * tokenPrice;
      tokenSymbol = sellMeta.symbol;
    } else if (buyToken && buyMeta && order.executedBuyAmount) {
      const rawAmount = BigInt(order.executedBuyAmount);
      const normalizedAmount = Number(rawAmount) / Math.pow(10, buyMeta.decimals);
      const tokenPrice = prices[buyToken] || 0;
      orderUsdValue = normalizedAmount * tokenPrice;
      tokenSymbol = buyMeta.symbol;
    }

    totalUsdValue += orderUsdValue;

    if (tokenSymbol !== 'UNKNOWN') {
      if (!tokenBreakdown[tokenSymbol]) {
        tokenBreakdown[tokenSymbol] = { count: 0, usdValue: 0 };
      }
      tokenBreakdown[tokenSymbol].count += 1;
      tokenBreakdown[tokenSymbol].usdValue += orderUsdValue;
    }
  }

  return {
    totalCount: validSwaps.length,
    totalUsdValue,
    tokenBreakdown,
  };
}

function compareResults(
  rawOrders: any[],
  metricEndpoint: any,
  calculated: { totalCount: number; totalUsdValue: number; tokenBreakdown: Record<string, { count: number; usdValue: number }> }
) {
  console.log('\n' + '='.repeat(60));
  console.log('📋 COMPARISON RESULTS');
  console.log('='.repeat(60));

  const results: { test: string; expected: string; actual: string; status: string }[] = [];

  const rawValidCount = rawOrders.filter(o => o.status === 'fulfilled' && o.invalidated === false).length;
  
  results.push({
    test: 'Valid Swap Count',
    expected: `Raw API: ${rawValidCount}`,
    actual: `Metric: ${metricEndpoint.total_count}`,
    status: rawValidCount === metricEndpoint.total_count ? '✅ PASS' : '❌ FAIL',
  });

  results.push({
    test: 'Total USD Value',
    expected: `Calculated: $${calculated.totalUsdValue.toFixed(2)}`,
    actual: `Metric: $${metricEndpoint.total_value}`,
    status: Math.abs(calculated.totalUsdValue - parseFloat(metricEndpoint.total_value)) < 0.01 ? '✅ PASS' : '❌ FAIL',
  });

  console.log('\nTest'.padEnd(25) + ' | ' + 'Expected'.padEnd(30) + ' | ' + 'Actual'.padEnd(30) + ' | ' + 'Status');
  console.log('-'.repeat(100));

  for (const r of results) {
    console.log(r.test.padEnd(25) + ' | ' + r.expected.padEnd(30) + ' | ' + r.actual.padEnd(30) + ' | ' + r.status);
  }

  console.log('\n📊 Token Breakdown Comparison:');
  console.log('-'.repeat(60));

  const metricBreakdownMap = new Map<string, { token: string; usd_value: string; count: number }>(
    (metricEndpoint.sub_aggregates || []).map((t: any) => [t.token, t])
  );
  const calcBreakdown = calculated.tokenBreakdown;

  const allTokens = new Set([...metricBreakdownMap.keys(), ...Object.keys(calcBreakdown)]);
  
  for (const token of allTokens) {
    const metricToken = metricBreakdownMap.get(token);
    const calcToken = calcBreakdown[token];

    const metricCount = metricToken?.count ?? 0;
    const calcCount = calcToken?.count ?? 0;
    const metricUsd = metricToken ? parseFloat(metricToken.usd_value) : 0;
    const calcUsd = calcToken?.usdValue ?? 0;

    const countMatch = metricCount === calcCount;
    const usdMatch = Math.abs(metricUsd - calcUsd) < 0.01;

    console.log(`   ${token}:`);
    console.log(`      Count: metric=${metricCount}, calculated=${calcCount} ${countMatch ? '✅' : '❌'}`);
    console.log(`      USD:   metric=$${metricUsd.toFixed(2)}, calculated=$${calcUsd.toFixed(2)} ${usdMatch ? '✅' : '❌'}`);
  }

  const allPass = results.every(r => r.status.includes('PASS'));
  console.log('\n' + '='.repeat(60));
  console.log(allPass ? '🎉 ALL TESTS PASSED' : '⚠️  SOME TESTS FAILED');
  console.log('='.repeat(60));

  return allPass;
}

async function main() {
  console.log('🐄 Cow Swap Metric Test Script');
  console.log('='.repeat(60));
  console.log(`💼 wallet: ${TEST_WALLET}`);

  try {
    const rawOrders = await fetchRawCowSwapOrders(TEST_WALLET);
    
    const uniqueTokens = new Set<string>();
    const validSwaps = rawOrders.filter(o => o.status === 'fulfilled' && o.invalidated === false);
    
    for (const order of validSwaps) {
      if (order.sellToken) uniqueTokens.add(order.sellToken.toLowerCase());
      if (order.buyToken) uniqueTokens.add(order.buyToken.toLowerCase());
    }

    const prices = await fetchTokenPrices(uniqueTokens);
    const calculated = calculateMetricFromRaw(rawOrders, prices);
    const metricEndpoint = await fetchMetricEndpoint(TEST_WALLET);

    const passed = compareResults(rawOrders, metricEndpoint, calculated);
    
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('\n❌ Error running test:', error);
    process.exit(1);
  }
}

main();
