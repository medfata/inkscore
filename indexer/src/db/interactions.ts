import { query } from './index.js';
import { config } from '../config.js';

export interface Interaction {
  wallet_address: string;
  contract_address: string;
  function_selector: string;
  function_name: string | null;
  tx_hash: string;
  block_number: number;
  block_timestamp: Date;
}

export async function insertInteractions(interactions: Interaction[]): Promise<void> {
  if (interactions.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  interactions.forEach((i, idx) => {
    const offset = idx * 8;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
    );
    values.push(
      i.wallet_address.toLowerCase(),
      i.contract_address.toLowerCase(),
      i.function_selector,
      i.function_name,
      i.tx_hash,
      i.block_number,
      i.block_timestamp,
      config.chainId
    );
  });

  await query(
    `INSERT INTO wallet_interactions 
     (wallet_address, contract_address, function_selector, function_name, tx_hash, block_number, block_timestamp, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, wallet_address, contract_address) DO NOTHING`,
    values
  );
}
