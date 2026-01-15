import { Pool, QueryResult } from 'pg';

// Singleton pattern for serverless environments
// Prevents creating multiple pools across function invocations
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

const pool = globalForDb.pool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool limits - critical for serverless
  max: 5, // Maximum connections per instance (Vercel has multiple instances)
  min: 0, // Allow pool to shrink to 0 when idle
  idleTimeoutMillis: 10000, // Close idle connections after 10s
  connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
});

// Preserve pool across invocations (works for warm functions)
globalForDb.pool = pool;

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function queryWithCount(
  text: string,
  params?: unknown[]
): Promise<QueryResult> {
  return pool.query(text, params);
}

export { pool };
