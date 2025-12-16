import { query, queryOne } from './index.js';
import { config } from '../config.js';

interface Cursor {
  contract_address: string;
  last_indexed_block: number;
  is_backfill_complete: boolean;
}

export async function getCursor(contractAddress: string): Promise<Cursor | null> {
  return queryOne<Cursor>(
    'SELECT * FROM indexer_cursors WHERE contract_address = $1',
    [contractAddress.toLowerCase()]
  );
}

export async function upsertCursor(
  contractAddress: string,
  lastBlock: number,
  deployBlock: number,
  isBackfillComplete: boolean
): Promise<void> {
  await query(
    `INSERT INTO indexer_cursors (contract_address, chain_id, last_indexed_block, deploy_block, is_backfill_complete, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (contract_address) 
     DO UPDATE SET last_indexed_block = $3, is_backfill_complete = $5, updated_at = NOW()`,
    [contractAddress.toLowerCase(), config.chainId, lastBlock, deployBlock, isBackfillComplete]
  );
}
