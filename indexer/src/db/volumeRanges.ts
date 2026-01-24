/**
 * Database operations for volume indexer ranges
 * Separate from event indexer ranges to allow independent progress tracking
 */

import { query, queryOne } from './index.js';
import { config } from '../config.js';

export interface VolumeIndexerRange {
  id: number;
  contract_address: string;
  range_start: string;
  range_end: string;
  current_block: string;
  is_complete: boolean;
}

export async function ensureVolumeRangesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS volume_indexer_ranges (
      id SERIAL PRIMARY KEY,
      contract_address VARCHAR(42) NOT NULL,
      chain_id INTEGER NOT NULL,
      range_start BIGINT NOT NULL,
      range_end BIGINT NOT NULL,
      current_block BIGINT NOT NULL,
      is_complete BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(contract_address, range_start, range_end)
    );
    CREATE INDEX IF NOT EXISTS idx_volume_ranges_contract ON volume_indexer_ranges(contract_address);
  `);
}

export async function getOrCreateVolumeRanges(
  contractAddress: string,
  deployBlock: number,
  latestBlock: number,
  numWorkers: number
): Promise<VolumeIndexerRange[]> {
  await ensureVolumeRangesTable();
  
  const address = contractAddress.toLowerCase();

  // Check if ranges already exist
  const existing = await query<VolumeIndexerRange>(
    'SELECT * FROM volume_indexer_ranges WHERE contract_address = $1 ORDER BY range_start',
    [address]
  );

  if (existing.length > 0) {
    // Check if we need to extend for new blocks
    const maxRangeEnd = Math.max(...existing.map(r => Number(r.range_end)));
    
    if (latestBlock > maxRangeEnd) {
      const newRangeStart = maxRangeEnd + 1;
      await query(
        `INSERT INTO volume_indexer_ranges (contract_address, chain_id, range_start, range_end, current_block, is_complete)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (contract_address, range_start, range_end) DO NOTHING`,
        [address, config.chainId, newRangeStart, latestBlock, newRangeStart]
      );
      
      return query<VolumeIndexerRange>(
        'SELECT * FROM volume_indexer_ranges WHERE contract_address = $1 ORDER BY range_start',
        [address]
      );
    }
    
    return existing;
  }

  // Create new ranges for initial backfill
  const totalBlocks = latestBlock - deployBlock;
  const blocksPerWorker = Math.ceil(totalBlocks / numWorkers);

  const ranges: VolumeIndexerRange[] = [];

  for (let i = 0; i < numWorkers; i++) {
    const rangeStart = deployBlock + i * blocksPerWorker;
    const rangeEnd = Math.min(deployBlock + (i + 1) * blocksPerWorker - 1, latestBlock);

    if (rangeStart > latestBlock) break;

    await query(
      `INSERT INTO volume_indexer_ranges (contract_address, chain_id, range_start, range_end, current_block, is_complete)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (contract_address, range_start, range_end) DO NOTHING`,
      [address, config.chainId, rangeStart, rangeEnd, rangeStart]
    );

    const inserted = await queryOne<VolumeIndexerRange>(
      'SELECT * FROM volume_indexer_ranges WHERE contract_address = $1 AND range_start = $2',
      [address, rangeStart]
    );

    if (inserted) ranges.push(inserted);
  }

  return ranges;
}

export async function updateVolumeRangeProgress(
  rangeId: number,
  currentBlock: number,
  isComplete: boolean
): Promise<void> {
  await query(
    `UPDATE volume_indexer_ranges 
     SET current_block = $1, is_complete = $2, updated_at = NOW() 
     WHERE id = $3`,
    [currentBlock, isComplete, rangeId]
  );
}

export async function areAllVolumeRangesComplete(contractAddress: string): Promise<boolean> {
  const result = await queryOne<{ incomplete: string }>(
    `SELECT COUNT(*) as incomplete FROM volume_indexer_ranges 
     WHERE contract_address = $1 AND is_complete = false`,
    [contractAddress.toLowerCase()]
  );
  return result?.incomplete === '0';
}

export async function resetVolumeRanges(contractAddress: string): Promise<void> {
  await query(
    'DELETE FROM volume_indexer_ranges WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
  console.log(`Reset volume ranges for ${contractAddress}`);
}
