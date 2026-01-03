/**
 * Reset TX indexer cursor for a specific contract
 * Usage: npx tsx scripts/reset-cursor.ts <contract_address>
 * 
 * Example: npx tsx scripts/reset-cursor.ts 0x1D74317d760f2c72A94386f50E8D10f2C902b899
 */
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function resetCursor(contractAddress: string) {
  const address = contractAddress.toLowerCase();
  
  console.log(`Resetting cursor for contract: ${address}`);
  
  // Reset the cursor
  const result = await pool.query(
    `UPDATE tx_indexer_cursors 
     SET last_next_token = NULL, total_indexed = 0, api_total_count = 0, is_complete = FALSE, updated_at = NOW()
     WHERE contract_address = $1
     RETURNING *`,
    [address]
  );
  
  if (result.rows.length === 0) {
    console.log('No cursor found for this contract.');
  } else {
    console.log('Cursor reset successfully:', result.rows[0]);
  }
  
  // Optionally delete the indexed transactions for this contract
  const deleteResult = await pool.query(
    `DELETE FROM transaction_details WHERE contract_address = $1`,
    [address]
  );
  console.log(`Deleted ${deleteResult.rowCount} transaction_details rows`);
  
  await pool.end();
}

const contractAddress = process.argv[2];
if (!contractAddress) {
  console.error('Usage: npx tsx scripts/reset-cursor.ts <contract_address>');
  console.error('Example: npx tsx scripts/reset-cursor.ts 0x1D74317d760f2c72A94386f50E8D10f2C902b899');
  process.exit(1);
}

resetCursor(contractAddress).catch(console.error);
