import { query } from './index.js';

export interface TokenTransferData {
  tx_hash: string;
  log_index: number;
  token_address: string;
  token_name: string | null;
  token_symbol: string | null;
  token_decimals: number;
  token_icon: string | null;
  from_address: string;
  to_address: string;
  amount_raw: string;
  amount_decimal: number | null;
  usd_value: number | null;
  price_used: number | null;
  event_type: string;
  block_number: number;
  block_timestamp: Date;
}

const BATCH_SIZE = 100;

/**
 * Insert token transfers extracted from transaction logs
 */
export async function insertTokenTransfers(transfers: TokenTransferData[]): Promise<void> {
  if (transfers.length === 0) return;

  for (let i = 0; i < transfers.length; i += BATCH_SIZE) {
    const batch = transfers.slice(i, i + BATCH_SIZE);
    await insertBatch(batch);
  }
}

async function insertBatch(transfers: TokenTransferData[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  transfers.forEach((t, idx) => {
    const offset = idx * 16;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16})`
    );
    values.push(
      t.tx_hash,
      t.log_index,
      t.token_address.toLowerCase(),
      t.token_name,
      t.token_symbol,
      t.token_decimals,
      t.token_icon,
      t.from_address.toLowerCase(),
      t.to_address.toLowerCase(),
      t.amount_raw,
      t.amount_decimal,
      t.usd_value,
      t.price_used,
      t.event_type,
      t.block_number,
      t.block_timestamp
    );
  });

  await query(
    `INSERT INTO transaction_token_transfers 
     (tx_hash, log_index, token_address, token_name, token_symbol, token_decimals, token_icon, from_address, to_address, amount_raw, amount_decimal, usd_value, price_used, event_type, block_number, block_timestamp)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    values
  );
}

/**
 * Discover and upsert a token from transaction log data
 */
export async function discoverToken(data: {
  address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  iconUrl?: string;
  tags?: string[];
}): Promise<void> {
  const address = data.address.toLowerCase();

  // Detect if stablecoin
  const symbol = (data.symbol || '').toUpperCase();
  const name = (data.name || '').toUpperCase();
  const isStablecoin = symbol.includes('USD') || symbol.includes('DAI') || 
                       symbol.includes('FRAX') || name.includes('DOLLAR');
  
  // Detect if native wrapper (WETH)
  const isNativeWrapper = symbol === 'WETH' || 
                          address === '0x4200000000000000000000000000000000000006';

  await query(`
    INSERT INTO discovered_tokens (address, name, symbol, decimals, icon_url, tags, is_stablecoin, is_native_wrapper)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (address) DO UPDATE SET
      name = COALESCE(discovered_tokens.name, EXCLUDED.name),
      symbol = COALESCE(discovered_tokens.symbol, EXCLUDED.symbol),
      decimals = COALESCE(EXCLUDED.decimals, discovered_tokens.decimals),
      icon_url = COALESCE(discovered_tokens.icon_url, EXCLUDED.icon_url),
      updated_at = NOW()
  `, [
    address,
    data.name || null,
    data.symbol || null,
    data.decimals || 18,
    data.iconUrl || null,
    data.tags || null,
    isStablecoin,
    isNativeWrapper,
  ]);
}
