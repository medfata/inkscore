/**
 * Database operations for asset transfers and volume transactions
 */

import { query } from './index.js';
import { config } from '../config.js';

export interface AssetTransfer {
  tx_hash: string;
  log_index: number;
  asset_type: 'ETH' | 'ERC20' | 'ERC721' | 'ERC1155' | 'ERC1155_BATCH';
  asset_address: string | null; // NULL for native ETH
  from_address: string;
  to_address: string;
  amount_raw: string | null; // Raw amount (no decimals applied)
  token_id: string | null; // For NFTs
  block_number: number;
  block_timestamp: Date;
}

export interface VolumeTransaction {
  tx_hash: string;
  wallet_address: string;
  contract_address: string;
  to_address: string | null;
  eth_value: string;
  block_number: number;
  block_timestamp: Date;
  block_hash: string;
  transaction_index: number;
  gas_limit: string;
  gas_used: string;
  gas_price: string;
  effective_gas_price: string;
  max_fee_per_gas: string | null;
  max_priority_fee_per_gas: string | null;
  tx_fee_wei: string;
  nonce: number;
  tx_type: number;
  input_data: string | null;
  method_id: string | null;
  created_contract_address: string | null;
  transfer_count: number;
  status: number;
  access_list: any | null;
}

export interface TransactionLog {
  tx_hash: string;
  log_index: number;
  address: string;
  topic0: string | null;
  topic1: string | null;
  topic2: string | null;
  topic3: string | null;
  data: string | null;
  removed: boolean;
  block_number: number;
}

const BATCH_SIZE = 500;


export async function ensureAssetTables(): Promise<void> {
  await query(`
    -- Asset transfers table (all token/NFT/ETH movements)
    CREATE TABLE IF NOT EXISTS asset_transfers (
      id SERIAL PRIMARY KEY,
      tx_hash VARCHAR(66) NOT NULL,
      log_index INTEGER NOT NULL,
      asset_type VARCHAR(20) NOT NULL,
      asset_address VARCHAR(42),
      from_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42) NOT NULL,
      amount_raw NUMERIC(78),
      token_id NUMERIC(78),
      block_number INTEGER NOT NULL,
      block_timestamp TIMESTAMP,
      chain_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tx_hash, log_index, chain_id)
    );

    -- Indexes for fast queries
    CREATE INDEX IF NOT EXISTS idx_asset_tx ON asset_transfers(tx_hash);
    CREATE INDEX IF NOT EXISTS idx_asset_from ON asset_transfers(from_address);
    CREATE INDEX IF NOT EXISTS idx_asset_to ON asset_transfers(to_address);
    CREATE INDEX IF NOT EXISTS idx_asset_type ON asset_transfers(asset_type);
    CREATE INDEX IF NOT EXISTS idx_asset_address ON asset_transfers(asset_address);
    CREATE INDEX IF NOT EXISTS idx_asset_block ON asset_transfers(block_number);

    -- Volume transactions table (complete transaction data)
    CREATE TABLE IF NOT EXISTS volume_transactions (
      tx_hash VARCHAR(66) PRIMARY KEY,
      wallet_address VARCHAR(42) NOT NULL,
      contract_address VARCHAR(42) NOT NULL,
      to_address VARCHAR(42),
      eth_value VARCHAR(78),
      block_number INTEGER NOT NULL,
      block_timestamp TIMESTAMP,
      block_hash VARCHAR(66),
      transaction_index INTEGER,
      gas_limit VARCHAR(78),
      gas_used VARCHAR(78),
      gas_price VARCHAR(78),
      effective_gas_price VARCHAR(78),
      max_fee_per_gas VARCHAR(78),
      max_priority_fee_per_gas VARCHAR(78),
      tx_fee_wei VARCHAR(78),
      nonce INTEGER,
      tx_type INTEGER DEFAULT 0,
      input_data TEXT,
      method_id VARCHAR(10),
      created_contract_address VARCHAR(42),
      transfer_count INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      chain_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_vol_wallet ON volume_transactions(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_vol_contract ON volume_transactions(contract_address);
    CREATE INDEX IF NOT EXISTS idx_vol_block ON volume_transactions(block_number);
    CREATE INDEX IF NOT EXISTS idx_vol_to_address ON volume_transactions(to_address);
    CREATE INDEX IF NOT EXISTS idx_vol_method_id ON volume_transactions(method_id);
    CREATE INDEX IF NOT EXISTS idx_vol_timestamp ON volume_transactions(block_timestamp);

    -- Transaction logs table (all event logs)
    CREATE TABLE IF NOT EXISTS transaction_logs (
      id SERIAL PRIMARY KEY,
      tx_hash VARCHAR(66) NOT NULL,
      log_index INTEGER NOT NULL,
      address VARCHAR(42) NOT NULL,
      topic0 VARCHAR(66),
      topic1 VARCHAR(66),
      topic2 VARCHAR(66),
      topic3 VARCHAR(66),
      data TEXT,
      removed BOOLEAN DEFAULT FALSE,
      block_number INTEGER NOT NULL,
      chain_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tx_hash, log_index, chain_id)
    );

    CREATE INDEX IF NOT EXISTS idx_txlogs_tx ON transaction_logs(tx_hash);
    CREATE INDEX IF NOT EXISTS idx_txlogs_address ON transaction_logs(address);
    CREATE INDEX IF NOT EXISTS idx_txlogs_topic0 ON transaction_logs(topic0);
    CREATE INDEX IF NOT EXISTS idx_txlogs_block ON transaction_logs(block_number);
  `);
}


export async function insertAssetTransfers(transfers: AssetTransfer[]): Promise<void> {
  if (transfers.length === 0) return;

  await ensureAssetTables();

  for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
    const batch = transfers.slice(i, i + BATCH_SIZE);
    await insertAssetTransferBatch(batch);
  }
}

async function insertAssetTransferBatch(transfers: AssetTransfer[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  transfers.forEach((t, idx) => {
    const offset = idx * 11;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
    );
    values.push(
      t.tx_hash,
      t.log_index,
      t.asset_type,
      t.asset_address,
      t.from_address,
      t.to_address,
      t.amount_raw,
      t.token_id,
      t.block_number,
      t.block_timestamp,
      config.chainId
    );
  });

  await query(
    `INSERT INTO asset_transfers 
     (tx_hash, log_index, asset_type, asset_address, from_address, to_address, amount_raw, token_id, block_number, block_timestamp, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, log_index, chain_id) DO NOTHING`,
    values
  );
}


export async function insertVolumeTransactions(txs: VolumeTransaction[]): Promise<void> {
  if (txs.length === 0) return;

  await ensureAssetTables();

  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const batch = txs.slice(i, i + BATCH_SIZE);
    await insertVolumeTransactionBatch(batch);
  }
}

async function insertVolumeTransactionBatch(txs: VolumeTransaction[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  txs.forEach((t, idx) => {
    const offset = idx * 24;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24})`
    );
    values.push(
      t.tx_hash,
      t.wallet_address,
      t.contract_address,
      t.to_address,
      t.eth_value,
      t.block_number,
      t.block_timestamp,
      t.block_hash,
      t.transaction_index,
      t.gas_limit,
      t.gas_used,
      t.gas_price,
      t.effective_gas_price,
      t.max_fee_per_gas,
      t.max_priority_fee_per_gas,
      t.tx_fee_wei,
      t.nonce,
      t.tx_type,
      t.input_data,
      t.method_id,
      t.created_contract_address,
      t.transfer_count,
      t.status,
      config.chainId
    );
  });

  await query(
    `INSERT INTO volume_transactions 
     (tx_hash, wallet_address, contract_address, to_address, eth_value, block_number, block_timestamp, block_hash, transaction_index, gas_limit, gas_used, gas_price, effective_gas_price, max_fee_per_gas, max_priority_fee_per_gas, tx_fee_wei, nonce, tx_type, input_data, method_id, created_contract_address, transfer_count, status, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash) DO NOTHING`,
    values
  );
}


export async function insertTransactionLogs(logs: TransactionLog[]): Promise<void> {
  if (logs.length === 0) return;

  await ensureAssetTables();

  for (let i = 0; i < logs.length; i += BATCH_SIZE) {
    const batch = logs.slice(i, i + BATCH_SIZE);
    await insertTransactionLogsBatch(batch);
  }
}

async function insertTransactionLogsBatch(logs: TransactionLog[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  logs.forEach((l, idx) => {
    const offset = idx * 11;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
    );
    values.push(
      l.tx_hash,
      l.log_index,
      l.address,
      l.topic0,
      l.topic1,
      l.topic2,
      l.topic3,
      l.data,
      l.removed,
      l.block_number,
      config.chainId
    );
  });

  await query(
    `INSERT INTO transaction_logs 
     (tx_hash, log_index, address, topic0, topic1, topic2, topic3, data, removed, block_number, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, log_index, chain_id) DO NOTHING`,
    values
  );
}

/**
 * Query helpers for volume metrics
 */

// Get total USD volume for a wallet on a contract
export async function getWalletContractVolume(
  walletAddress: string,
  contractAddress: string
): Promise<{ ethVolume: string; transferCount: number; txCount: number }> {
  const result = await query<{ eth_volume: string; transfer_count: string; tx_count: string }>(`
    SELECT 
      COALESCE(SUM(CAST(eth_value AS NUMERIC)), 0) as eth_volume,
      COALESCE(SUM(transfer_count), 0) as transfer_count,
      COUNT(*) as tx_count
    FROM volume_transactions
    WHERE wallet_address = $1 AND contract_address = $2
  `, [walletAddress.toLowerCase(), contractAddress.toLowerCase()]);

  return {
    ethVolume: result[0]?.eth_volume || '0',
    transferCount: parseInt(result[0]?.transfer_count || '0'),
    txCount: parseInt(result[0]?.tx_count || '0'),
  };
}

// Get asset transfers for a transaction
export async function getTransactionTransfers(txHash: string): Promise<AssetTransfer[]> {
  return query<AssetTransfer>(
    'SELECT * FROM asset_transfers WHERE tx_hash = $1 ORDER BY log_index',
    [txHash]
  );
}

// Get all logs for a transaction
export async function getTransactionLogs(txHash: string): Promise<TransactionLog[]> {
  return query<TransactionLog>(
    'SELECT * FROM transaction_logs WHERE tx_hash = $1 ORDER BY log_index',
    [txHash]
  );
}
