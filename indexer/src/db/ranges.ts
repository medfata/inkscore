import { query, queryOne } from './index.js';
import { config } from '../config.js';

export interface IndexerRange {
  id: number;
  contract_address: string;
  range_start: string;
  range_end: string;
  current_block: string;
  is_complete: boolean;
}

export async function getOrCreateRanges(
  contractAddress: string,
  deployBlock: number,
  latestBlock: number,
  numWorkers: number
): Promise<IndexerRange[]> {
  const address = contractAddress.toLowerCase();

  // Check if ranges already exist
  const existing = await query<IndexerRange>(
    'SELECT * FROM indexer_ranges WHERE contract_address = $1 ORDER BY range_start',
    [address]
  );

  if (existing.length > 0) {
    // Check if we need to extend for new blocks (polling mode)
    const maxRangeEnd = Math.max(...existing.map(r => Number(r.range_end)));
    
    if (latestBlock > maxRangeEnd) {
      // Create a new range for blocks since last indexed
      const newRangeStart = maxRangeEnd + 1;
      await query(
        `INSERT INTO indexer_ranges (contract_address, chain_id, range_start, range_end, current_block, is_complete)
         VALUES ($1, $2, $3, $4, $5, false)
         ON CONFLICT (contract_address, range_start, range_end) DO NOTHING`,
        [address, config.chainId, newRangeStart, latestBlock, newRangeStart]
      );
      
      // Return updated list
      return query<IndexerRange>(
        'SELECT * FROM indexer_ranges WHERE contract_address = $1 ORDER BY range_start',
        [address]
      );
    }
    
    return existing;
  }

  // Create new ranges for initial backfill
  const totalBlocks = latestBlock - deployBlock;
  const blocksPerWorker = Math.ceil(totalBlocks / numWorkers);

  const ranges: IndexerRange[] = [];

  for (let i = 0; i < numWorkers; i++) {
    const rangeStart = deployBlock + i * blocksPerWorker;
    const rangeEnd = Math.min(deployBlock + (i + 1) * blocksPerWorker - 1, latestBlock);

    if (rangeStart > latestBlock) break;

    await query(
      `INSERT INTO indexer_ranges (contract_address, chain_id, range_start, range_end, current_block, is_complete)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (contract_address, range_start, range_end) DO NOTHING`,
      [address, config.chainId, rangeStart, rangeEnd, rangeStart]
    );

    const inserted = await queryOne<IndexerRange>(
      'SELECT * FROM indexer_ranges WHERE contract_address = $1 AND range_start = $2',
      [address, rangeStart]
    );

    if (inserted) ranges.push(inserted);
  }

  return ranges;
}

export async function updateRangeProgress(
  rangeId: number,
  currentBlock: number,
  isComplete: boolean
): Promise<void> {
  await query(
    `UPDATE indexer_ranges 
     SET current_block = $1, is_complete = $2, updated_at = NOW() 
     WHERE id = $3`,
    [currentBlock, isComplete, rangeId]
  );
}

export async function areAllRangesComplete(contractAddress: string): Promise<boolean> {
  const result = await queryOne<{ incomplete: string }>(
    `SELECT COUNT(*) as incomplete FROM indexer_ranges 
     WHERE contract_address = $1 AND is_complete = false`,
    [contractAddress.toLowerCase()]
  );
  return result?.incomplete === '0';
}
