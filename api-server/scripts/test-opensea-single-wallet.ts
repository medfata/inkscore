import 'dotenv/config';
import { OpenSeaService } from '../src/services/opensea-service';

const WALLET = '0xB6F28ae8f31D85dC27361852b986286113Bc588D';

async function main() {
  const service = new OpenSeaService();

  console.log(`Wallet: ${WALLET}`);
  console.log(`Start: ${new Date().toISOString()}`);

  const start = Date.now();
  const counts = await service.getAllCounts(WALLET);
  const elapsed = Date.now() - start;

  console.log(`End: ${new Date().toISOString()}`);
  console.log(`Time: ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`Buys: ${counts.buys} | Sales: ${counts.sales} | Mints: ${counts.mints}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Fatal:', err); process.exit(1); });
