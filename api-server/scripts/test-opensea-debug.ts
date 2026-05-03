import 'dotenv/config';
import { OpenSeaService } from '../src/services/opensea-service';

const WALLETS = [
  { label: 'BROKEN1', address: '0x00ec18A3436af2eB4a9450FA50D42A951d2ADf9c' },
  { label: 'BROKEN2', address: '0x73107D5EcCcF6F698223e589D2FB3472041eB40A' },
  { label: 'BROKEN3', address: '0xae6f9c8DbC2514cb7B1FdD6E9E5f92226d5F1e41' },
  { label: 'WORKS  ', address: '0xB6F28ae8f31D85dC27361852b986286113Bc588D' },
];

async function main() {
  // Use a fresh service for each wallet to avoid cache interference
  for (const w of WALLETS) {
    const service = new OpenSeaService();
    console.log(`\n[${w.label}] ${w.address}`);
    const start = Date.now();
    try {
      const counts = await service.getAllCounts(w.address);
      const elapsed = Date.now() - start;
      console.log(`  Time: ${(elapsed / 1000).toFixed(2)}s`);
      console.log(`  Buys: ${counts.buys} | Sales: ${counts.sales} | Mints: ${counts.mints}`);
    } catch (err: any) {
      const elapsed = Date.now() - start;
      console.log(`  FAILED after ${(elapsed / 1000).toFixed(2)}s`);
      console.log(`  Error: ${err.message || err}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });
