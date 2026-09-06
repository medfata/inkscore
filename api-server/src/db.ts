import dotenv from 'dotenv';
import { Pool, QueryResult } from 'pg';

// Load environment variables first
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Multi-lane backfill runs several api-server instances against ONE
  // Postgres; keep per-instance pools small there via env (Postgres
  // max_connections is shared). Defaults unchanged for the prod instance.
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  min: parseInt(process.env.PG_POOL_MIN || '5', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Insurance: a future slow/hung query releases its connection instead of
  // pinning one of the 20 slots forever.
  statement_timeout: 10_000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✓ Database connection successful');
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result: QueryResult = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export { pool };
