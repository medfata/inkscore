import 'dotenv/config';
import { OpenSeaService } from '../src/services/opensea-service';

const WALLET = '0xB6F28ae8f31D85dC27361852b986286113Bc588D';

async function main() {
  const service = new OpenSeaService();

  // Test 1: First call (cold - hits OpenSea API)
  console.log('=== CALL 1: Cold (no cache) ===');
  let start = Date.now();
  const counts1 = await service.getAllCounts(WALLET);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  console.log(`Buys: ${counts1.buys} | Sales: ${counts1.sales} | Mints: ${counts1.mints}`);

  // Test 2: Second call (should hit cache)
  console.log('\n=== CALL 2: Cached ===');
  start = Date.now();
  const counts2 = await service.getAllCounts(WALLET);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  console.log(`Buys: ${counts2.buys} | Sales: ${counts2.sales} | Mints: ${counts2.mints}`);

  // Test 3: Two parallel calls (should dedup to one fetch if cache is cleared)
  // But since cache is still warm, both should be instant
  console.log('\n=== CALL 3: Two parallel calls (both cached) ===');
  start = Date.now();
  const [counts3a, counts3b] = await Promise.all([
    service.getAllCounts(WALLET),
    service.getAllCounts(WALLET),
  ]);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(2)}s`);
  console.log(`Call A - Buys: ${counts3a.buys} | Sales: ${counts3a.sales} | Mints: ${counts3a.mints}`);
  console.log(`Call B - Buys: ${counts3b.buys} | Sales: ${counts3b.sales} | Mints: ${counts3b.mints}`);

  // Test 4: Simulate parallel cold calls by creating a fresh service
  console.log('\n=== CALL 4: Two parallel COLD calls (dedup test) ===');
  const freshService = new OpenSeaService();
  start = Date.now();
  const [counts4a, counts4b] = await Promise.all([
    freshService.getAllCounts(WALLET),
    freshService.getAllCounts(WALLET),
  ]);
  console.log(`Time: ${((Date.now() - start) / 1000).toFixed(2)}s (should be same as single cold call, NOT doubled)`);
  console.log(`Call A - Buys: ${counts4a.buys} | Sales: ${counts4a.sales} | Mints: ${counts4a.mints}`);
  console.log(`Call B - Buys: ${counts4b.buys} | Sales: ${counts4b.sales} | Mints: ${counts4b.mints}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });
