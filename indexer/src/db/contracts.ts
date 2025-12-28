import { query, queryOne } from './index.js';

export interface IndexableContract {
  id: number;
  address: string;
  name: string;
  deploy_block: number;
  fetch_transactions: boolean;
  indexing_enabled: boolean;
  indexing_status: string;
}

/**
 * Get all contracts that should be indexed
 */
export async function getContractsToIndex(): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT id, address, name, deploy_block, fetch_transactions, indexing_enabled, indexing_status
    FROM contracts
    WHERE indexing_enabled = true
      AND is_active = true
    ORDER BY created_at ASC
  `);
}

/**
 * Get contracts that need backfill (pending only, not already indexing)
 * Also picks up contracts stuck in 'indexing' for more than 30 minutes (crashed indexer)
 */
export async function getContractsForBackfill(): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT id, address, name, deploy_block, fetch_transactions, indexing_enabled, indexing_status
    FROM contracts
    WHERE indexing_enabled = true
      AND is_active = true
      AND (
        indexing_status NOT IN ('complete', 'indexing')
        OR (indexing_status = 'indexing' AND updated_at < NOW() - INTERVAL '30 minutes')
      )
    ORDER BY created_at ASC
  `);
}

/**
 * Get a single contract by address
 */
export async function getContractByAddress(address: string): Promise<IndexableContract | null> {
  const normalizedAddress = address.toLowerCase();
  // Try exact match first, then fallback to case-insensitive
  let result = await queryOne<IndexableContract>(`
    SELECT id, address, name, deploy_block, fetch_transactions, indexing_enabled, indexing_status
    FROM contracts
    WHERE address = $1
  `, [normalizedAddress]);
  
  if (result) return result;
  
  return queryOne<IndexableContract>(`
    SELECT id, address, name, deploy_block, fetch_transactions, indexing_enabled, indexing_status
    FROM contracts
    WHERE LOWER(address) = $1
  `, [normalizedAddress]);
}

/**
 * Update contract indexing status
 */
export async function updateContractStatus(
  address: string,
  status: 'pending' | 'indexing' | 'complete' | 'paused' | 'error',
  currentBlock?: number,
  totalBlocks?: number,
  errorMessage?: string
): Promise<void> {
  const normalizedAddress = address.toLowerCase();
  const updates: string[] = ['indexing_status = $2', 'updated_at = NOW()'];
  const values: unknown[] = [normalizedAddress, status];
  let paramIndex = 3;

  if (currentBlock !== undefined) {
    updates.push(`current_block = $${paramIndex++}`);
    values.push(currentBlock);
  }
  if (totalBlocks !== undefined) {
    updates.push(`total_blocks = $${paramIndex++}`);
    values.push(totalBlocks);
  }
  if (currentBlock !== undefined && totalBlocks !== undefined && totalBlocks > 0) {
    updates.push(`progress_percent = $${paramIndex++}`);
    values.push(Math.round((currentBlock / totalBlocks) * 10000) / 100);
  }
  if (status === 'complete' || status === 'indexing') {
    updates.push(`last_indexed_at = NOW()`);
    updates.push(`error_message = NULL`);
  }
  if (errorMessage !== undefined) {
    updates.push(`error_message = $${paramIndex++}`);
    values.push(errorMessage);
  }

  // Try exact match first
  const result = await query(`
    UPDATE contracts
    SET ${updates.join(', ')}
    WHERE address = $1
    RETURNING id
  `, values);

  // Fallback for legacy mixed-case addresses
  if (result.length === 0) {
    await query(`
      UPDATE contracts
      SET ${updates.join(', ')}
      WHERE LOWER(address) = $1
    `, values);
  }
}

/**
 * Check if contracts table exists and has data
 * Falls back to config.ts if not
 */
export async function hasContractsInDatabase(): Promise<boolean> {
  try {
    const result = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM contracts WHERE is_active = true
    `);
    return parseInt(result?.count || '0') > 0;
  } catch {
    // Table doesn't exist yet
    return false;
  }
}
