import 'dotenv/config';
import { OpenSeaService } from '../src/services/opensea-service';

/**
 * Validation test: calls OpenSea GraphQL API directly via opensea-service
 * to verify buy/sale/mint counts for a specific wallet.
 *
 * Usage: npx ts-node scripts/test-opensea-service-validation.ts
 */

const WALLET = '0x1a1e4708fce01d805d6ea468e3c1ef9d1106b1b5';

async function main() {
  const service = new OpenSeaService();

  console.log('='.repeat(80));
  console.log('OPENSEA SERVICE VALIDATION TEST');
  console.log('='.repeat(80));
  console.log(`Wallet: ${WALLET}`);
  console.log();

  // Fetch all activity (SALE + MINT) from OpenSea GraphQL API
  console.log('Fetching activity from OpenSea GraphQL API...');
  const allActivities = await service.fetchWalletActivity(WALLET, ['SALE', 'MINT'], 'ink', true);
  console.log(`Total activities fetched: ${allActivities.length}`);
  console.log();

  // Calculate counts
  const counts = service.calculateActivityCounts(allActivities, WALLET);

  console.log('='.repeat(80));
  console.log('RESULTS FROM OPENSEA GRAPHQL API');
  console.log('='.repeat(80));
  console.log(`  Buys:  ${counts.buys}`);
  console.log(`  Sales: ${counts.sales}`);
  console.log(`  Mints: ${counts.mints}`);
  console.log();

  // Print detailed breakdown of each activity
  console.log('='.repeat(80));
  console.log('DETAILED ACTIVITY LOG');
  console.log('='.repeat(80));
  console.log();

  const normalizedWallet = WALLET.toLowerCase();

  for (const activity of allActivities) {
    const from = activity.from?.address?.toLowerCase() || 'N/A';
    const to = activity.to?.address?.toLowerCase() || 'N/A';

    let direction = '';
    if (activity.type === 'SALE') {
      if (to === normalizedWallet) direction = 'BUY';
      else if (from === normalizedWallet) direction = 'SALE';
      else direction = 'OTHER';
    } else if (activity.type === 'MINT') {
      direction = 'MINT';
    } else {
      direction = activity.type;
    }

    const price = activity.price
      ? `${activity.price.token.unit} ${activity.price.token.symbol} ($${activity.price.usd.toFixed(2)})`
      : 'N/A';

    console.log(`[${direction.padEnd(5)}] tx: ${activity.transactionHash}`);
    console.log(`        type: ${activity.type} | from: ${from.slice(0, 10)}... | to: ${to.slice(0, 10)}... | price: ${price}`);
    console.log();
  }

  // Compare with current InkScore API values (if server is running)
  const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
  console.log('='.repeat(80));
  console.log('COMPARISON WITH CURRENT INKSCORE API');
  console.log('='.repeat(80));
  console.log(`API Base URL: ${API_BASE_URL}`);
  console.log();

  try {
    const [buyRes, saleRes, mintRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/analytics/${WALLET}/opensea_buy_count`),
      fetch(`${API_BASE_URL}/api/analytics/${WALLET}/opensea_sale_count`),
      fetch(`${API_BASE_URL}/api/analytics/${WALLET}/mint_count`),
    ]);

    const buyData = buyRes.ok ? (await buyRes.json()) as any : null;
    const saleData = saleRes.ok ? (await saleRes.json()) as any : null;
    const mintData = mintRes.ok ? (await mintRes.json()) as any : null;

    const apiBuys = buyData?.total_count ?? 'ERROR';
    const apiSales = saleData?.total_count ?? 'ERROR';
    const apiMints = mintData?.total_count ?? 'ERROR';

    console.log('                  OpenSea API    InkScore DB    Match?');
    console.log('  ──────────────────────────────────────────────────────');
    console.log(`  Buys:           ${String(counts.buys).padEnd(15)}${String(apiBuys).padEnd(15)}${counts.buys === apiBuys ? 'YES' : 'NO <<<'}`);
    console.log(`  Sales:          ${String(counts.sales).padEnd(15)}${String(apiSales).padEnd(15)}${counts.sales === apiSales ? 'YES' : 'NO <<<'}`);
    console.log(`  Mints:          ${String(counts.mints).padEnd(15)}${String(apiMints).padEnd(15)}${counts.mints === apiMints ? 'YES' : 'NO <<<'}`);
    console.log();

    if (counts.buys !== apiBuys || counts.sales !== apiSales || counts.mints !== apiMints) {
      console.log('MISMATCH DETECTED - The InkScore DB queries return different values than OpenSea API.');
    } else {
      console.log('All values match.');
    }
  } catch (err) {
    console.log('Could not reach InkScore API (is the server running?)');
    console.log('Skipping comparison. OpenSea API results above are the source of truth.');
  }

  console.log();
  console.log('='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
