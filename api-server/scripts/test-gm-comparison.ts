// Test: Compare GM Activity count between external API and DB query approaches
//
// API approach (current):  https://gm.inkonchain.com/api/gm-data?address=<wallet>
//                          reads data.userGms[wallet]
//
// Query approach (old):    SELECT count(tx_hash) FROM transaction_details
//                          WHERE contract_address = GM_CONTRACT AND wallet_address = wallet

import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const GM_CONTRACT_ADDRESS = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f';
const GM_EXTERNAL_API = 'https://gm.inkonchain.com/api/gm-data';

const TEST_WALLETS = [
  '0x2EBa0a5d03b07af80e4E4ACe3bBFFE3A7d956bcB',
  '0xB54a298a399D6B58EFe0E5356950DFc5B39f074D',
  '0x1649b26eae366218F774286C38a167c1C69AFeCA',
  '0x9f271e88Ed7C0366BCa13c79b8BD45a6c822FE46',
  '0xCbac7E254D2e026E52183322E1b8882aAb4Bf9a0',
  '0xe1bF20E13fC55476B7F0f559990cE5F28e48FB79',
  '0xDB94499A6fF41E4ed7850C13b4CA2dCAb3D40075',
  '0x9D292255ddc87532974EF5b13CB5d8C44BFcab23',
  '0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5',
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fetchApiGmCount(wallet: string): Promise<number> {
  const url = `${GM_EXTERNAL_API}?address=${wallet.toLowerCase()}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`External GM API error: ${response.status}`);
  const data = await response.json() as { userGms: Record<string, number> };
  return data.userGms[wallet.toLowerCase()] || 0;
}

async function fetchDbGmCount(wallet: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(tx_hash) as count
     FROM transaction_details
     WHERE contract_address = $1
       AND wallet_address = lower($2)`,
    [GM_CONTRACT_ADDRESS, wallet],
  );
  return parseInt(result.rows[0]?.count || '0', 10);
}

async function main() {
  console.log('🌅 GM Activity: External API vs DB Query');
  console.log('='.repeat(60));

  for (const wallet of TEST_WALLETS) {
    console.log(`\nWallet: ${wallet}`);
    try {
      const apiCount = await fetchApiGmCount(wallet);
      console.log(`  API (gm.inkonchain.com): ${apiCount}`);
    } catch (err: any) {
      console.log(`  API error: ${err?.message ?? err}`);
    }
    try {
      const dbCount = await fetchDbGmCount(wallet);
      console.log(`  DB  (transaction_details): ${dbCount}`);
    } catch (err: any) {
      console.log(`  DB error: ${err?.message ?? err}`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
