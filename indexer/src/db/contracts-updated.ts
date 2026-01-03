import { query, queryOne } from './index.js';

// Updated interface for the consolidated contracts table
export interface IndexableContract {
  id: number;
  address: string;
  name: string;
  deploy_block: number;
  fetch_transactions: boolean;
  
  // Indexing status
  indexing_enabled: boolean;
  indexing_status: 'pending' | 'indexing' | 'complete' | 'paused' | 'error';
  current_block: number;
  total_blocks: number;
  progress_percent: number;
  last_indexed_at: Date | null;
  error_message: string | null;
  total_indexed: number;
  
  // Metadata
  website_url: string | null;
  logo_url: string | null;
  category: string | null;
  
  // Indexer configuration
  chain_id: number;
  index_type: 'COUNT_TX' | 'USD_VOLUME';
  abi: any | null;
  
  // Status
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Get all contracts that should be indexed
 */
export async function getContractsToIndex(): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT * FROM contracts
    WHERE indexing_enabled = true
      AND is_active = true
    ORDER BY created_at ASC
  `);
}

/**
 * Get contracts that need backfill (pending or error status)
 * Also picks up contracts stuck in 'indexing' for more than 30 minutes (crashed indexer)
 */
export async function getContractsForBackfill(): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT * FROM contracts
    WHERE indexing_enabled = true
      AND is_active = true
      AND (
        indexing_status IN ('pending', 'error')
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
  return queryOne<IndexableContract>(`
    SELECT * FROM contracts
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

  await query(`
    UPDATE contracts
    SET ${updates.join(', ')}
    WHERE LOWER(address) = $1
  `, values);
}

/**
 * Update total indexed count from cursor
 */
export async function updateContractTotalIndexed(
  address: string,
  totalIndexed: number
): Promise<void> {
  const normalizedAddress = address.toLowerCase();
  await query(`
    UPDATE contracts
    SET total_indexed = $2, updated_at = NOW()
    WHERE LOWER(address) = $1
  `, [normalizedAddress, totalIndexed]);
}

/**
 * Check if contracts table exists and has data
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

/**
 * Get contracts by chain ID
 */
export async function getContractsByChain(chainId: number): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT * FROM contracts
    WHERE chain_id = $1
      AND is_active = true
    ORDER BY created_at ASC
  `, [chainId]);
}

/**
 * Get contracts by category
 */
export async function getContractsByCategory(category: string): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT * FROM contracts
    WHERE category = $1
      AND is_active = true
    ORDER BY name ASC
  `, [category]);
}

/**
 * Get contracts by index type
 */
export async function getContractsByIndexType(indexType: 'COUNT_TX' | 'USD_VOLUME'): Promise<IndexableContract[]> {
  return query<IndexableContract>(`
    SELECT * FROM contracts
    WHERE index_type = $1
      AND indexing_enabled = true
      AND is_active = true
    ORDER BY created_at ASC
  `, [indexType]);
}

/**
 * Get indexing statistics
 */
export async function getIndexingStats(): Promise<{
  total: number;
  pending: number;
  indexing: number;
  complete: number;
  error: number;
  paused: number;
}> {
  const result = await query<{
    status: string;
    count: string;
  }>(`
    SELECT indexing_status as status, COUNT(*) as count
    FROM contracts
    WHERE indexing_enabled = true AND is_active = true
    GROUP BY indexing_status
  `);

  const stats = {
    total: 0,
    pending: 0,
    indexing: 0,
    complete: 0,
    error: 0,
    paused: 0,
  };

  for (const row of result) {
    const count = parseInt(row.count);
    stats.total += count;
    stats[row.status as keyof typeof stats] = count;
  }

  return stats;
}

/**
 * Reset contract indexing status (for re-indexing)
 */
export async function resetContractIndexing(address: string): Promise<void> {
  const normalizedAddress = address.toLowerCase();
  await query(`
    UPDATE contracts
    SET 
      indexing_status = 'pending',
      current_block = 0,
      progress_percent = 0,
      total_indexed = 0,
      error_message = NULL,
      last_indexed_at = NULL,
      updated_at = NOW()
    WHERE LOWER(address) = $1
  `, [normalizedAddress]);
}