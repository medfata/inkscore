import { query } from './index.js';
import { config } from '../config.js';

export interface BridgeTransfer {
  tx_hash: string;
  from_address: string;
  to_address: string;
  platform: string;
  sub_platform?: string;
  method_selector?: string;
  eth_value: string;
  block_number: number;
  block_timestamp: Date;
}

const BATCH_SIZE = 100;

export async function insertBridgeTransfers(transfers: BridgeTransfer[]): Promise<void> {
  if (transfers.length === 0) return;

  for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
    const batch = transfers.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
  }
}

async function insertBatch(transfers: BridgeTransfer[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  transfers.forEach((tx, idx) => {
    const offset = idx * 10;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10})`
    );
    values.push(
      tx.tx_hash,
      tx.from_address.toLowerCase(),
      tx.to_address.toLowerCase(),
      tx.platform,
      tx.sub_platform || null,
      tx.method_selector || null,
      tx.eth_value,
      tx.block_number,
      tx.block_timestamp,
      config.chainId
    );
  });

  await query(
    `INSERT INTO bridge_transfers 
     (tx_hash, from_address, to_address, platform, sub_platform, method_selector, eth_value, block_number, block_timestamp, chain_id)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, to_address) DO NOTHING`,
    values
  );
}

// Get or create sync cursor for a bridge hot wallet
export async function getBridgeSyncCursor(walletAddress: string, platform: string): Promise<number> {
  interface CursorRow {
    last_block_processed: number;
  }

  const rows = await query<CursorRow>(
    `INSERT INTO bridge_sync_cursors (wallet_address, platform, last_block_processed)
     VALUES ($1, $2, 0)
     ON CONFLICT (wallet_address) DO UPDATE SET platform = $2
     RETURNING last_block_processed`,
    [walletAddress.toLowerCase(), platform]
  );
  return rows[0]?.last_block_processed || 0;
}

export async function updateBridgeSyncCursor(walletAddress: string, blockNumber: number): Promise<void> {
  await query(
    `UPDATE bridge_sync_cursors 
     SET last_block_processed = $2, last_sync_at = NOW(), is_syncing = false
     WHERE wallet_address = $1`,
    [walletAddress.toLowerCase(), blockNumber]
  );
}

// Get total bridge volume for a wallet (all platforms)
export async function getWalletBridgeVolume(walletAddress: string): Promise<{
  totalEth: string;
  totalUsd: number;
  txCount: number;
  byPlatform: Array<{ platform: string; ethValue: string; usdValue: number; txCount: number }>;
}> {
  interface BridgeRow {
    platform: string;
    total_eth: string;
    tx_count: string;
  }

  const rows = await query<BridgeRow>(
    `SELECT 
       platform,
       SUM(eth_value) as total_eth,
       COUNT(*) as tx_count
     FROM bridge_transfers
     WHERE to_address = $1
     GROUP BY platform`,
    [walletAddress.toLowerCase()]
  );

  let totalEth = BigInt(0);
  let txCount = 0;
  const byPlatform: Array<{ platform: string; ethValue: string; usdValue: number; txCount: number }> = [];

  for (const row of rows) {
    const ethValue = row.total_eth || '0';
    totalEth += BigInt(Math.floor(parseFloat(ethValue) * 1e18));
    txCount += parseInt(row.tx_count || '0');
    byPlatform.push({
      platform: row.platform,
      ethValue,
      usdValue: 0, // Will be calculated with ETH price
      txCount: parseInt(row.tx_count || '0'),
    });
  }

  return {
    totalEth: (Number(totalEth) / 1e18).toString(),
    totalUsd: 0,
    txCount,
    byPlatform,
  };
}
