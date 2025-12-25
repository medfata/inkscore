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
  status: number; // 1 = success, 0 = failed
}

const BATCH_SIZE = 1000; // Increased for better throughput with large pages

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
    const offset = idx * 9;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`
    );
    values.push(
      interaction.wallet_address.toLowerCase(),
      interaction.contract_address.toLowerCase(),
      interaction.function_selector,
      interaction.function_name,
      interaction.tx_hash,
      interaction.block_number,
      interaction.block_timestamp,
      interaction.status,
      config.chainId
    );
  });

  await query(
    `INSERT INTO wallet_interactions 
     (wallet_address, contract_address, function_selector, function_name, tx_hash, block_number, block_timestamp, status, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, wallet_address, contract_address) DO NOTHING`,
    values
  );

  // Update total_indexed count on contracts table
  // Group by contract_address and increment counts
  const countsByContract = new Map<string, number>();
  for (const interaction of interactions) {
    const addr = interaction.contract_address.toLowerCase();
    countsByContract.set(addr, (countsByContract.get(addr) || 0) + 1);
  }
  
  for (const [contractAddr, count] of countsByContract) {
    await query(
      `UPDATE contracts SET total_indexed = COALESCE(total_indexed, 0) + $1, updated_at = NOW() 
       WHERE LOWER(address) = $2`,
      [count, contractAddr]
    );
  }
}
