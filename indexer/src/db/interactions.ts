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

const BATCH_SIZE = 500; // Max rows per insert to avoid Postgres parameter limit

export async function insertInteractions(interactions: Interaction[]): Promise<void> {
  if (interactions.length === 0) return;

  // Split into batches to avoid Postgres parameter limit (max ~65535 params)
  for (let i = 0; i < interactions.length; i += BATCH_SIZE) {
    const batch = interactions.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
  }
}

async function insertBatch(interactions: Interaction[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  interactions.forEach((interaction, idx) => {
    const offset = idx * 8;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
    );
    values.push(
      interaction.wallet_address.toLowerCase(),
      interaction.contract_address.toLowerCase(),
      interaction.function_selector,
      interaction.function_name,
      interaction.tx_hash,
      interaction.block_number,
      interaction.block_timestamp,
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
