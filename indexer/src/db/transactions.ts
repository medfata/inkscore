import { query } from './index.js';
import { config } from '../config.js';

export interface TransactionDetail {
  tx_hash: string;
  wallet_address: string;
  contract_address: string;
  function_selector: string | null;
  function_name: string | null;
  input_data: string | null;
  eth_value: string;
  gas_used: number | null;
  gas_price: string | null;
  block_number: number;
  block_timestamp: Date;
  status: number;
}

const BATCH_SIZE = 500; // Increased for better throughput with large pages

export async function insertTransactionDetails(txs: TransactionDetail[]): Promise<void> {
  if (txs.length === 0) return;

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const batch = txs.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
  }
}

async function insertBatch(txs: TransactionDetail[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  txs.forEach((tx, idx) => {
    const offset = idx * 13;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`
    );
    values.push(
      tx.tx_hash,
      tx.wallet_address.toLowerCase(),
      tx.contract_address.toLowerCase(),
      tx.function_selector,
      tx.function_name,
      tx.input_data,
      tx.eth_value,
      tx.gas_used,
      tx.gas_price,
      tx.block_number,
      tx.block_timestamp,
      tx.status,
      config.chainId
    );
  });

  await query(
    `INSERT INTO transaction_details 
     (tx_hash, wallet_address, contract_address, function_selector, function_name, input_data, eth_value, gas_used, gas_price, block_number, block_timestamp, status, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash) DO NOTHING`,
    values
  );
}
