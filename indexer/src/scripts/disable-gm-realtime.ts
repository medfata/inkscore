import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const result = await pool.query(`
    UPDATE contracts 
    SET indexing_enabled = false 
    WHERE LOWER(address) = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f'
  `);
  console.log('Done - rows affected:', result.rowCount);
  await pool.end();
}

main().catch(console.error);