import { query, queryOne } from '../db';
import {
  TrackedAsset,
  AssetType,
  CreateAssetRequest,
  UpdateAssetRequest,
  GroupedAssetsResponse,
} from '../types/assets';

// Import to clear wallet stats cache when assets change
let clearWalletStatsCacheFn: (() => void) | null = null;

export function setWalletStatsCacheClearer(fn: () => void): void {
  clearWalletStatsCacheFn = fn;
}

// Cache for assets (5 minute TTL)
interface AssetsCache {
  assets: TrackedAsset[];
  timestamp: number;
}

let assetsCache: AssetsCache | null = null;
const ASSETS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class AssetsService {
  // Clear cache (call after mutations)
  clearCache(): void {
    assetsCache = null;
    // Also clear wallet stats cache so dashboard reflects changes immediately
    if (clearWalletStatsCacheFn) {
      clearWalletStatsCacheFn();
    }
  }

  // Get all assets (with caching)
  async getAllAssets(includeInactive = false): Promise<TrackedAsset[]> {
    // Check cache for active-only queries
    if (!includeInactive && assetsCache && Date.now() - assetsCache.timestamp < ASSETS_CACHE_TTL) {
      return assetsCache.assets;
    }

    const whereClause = includeInactive ? '' : 'WHERE is_active = true';
    const assets = await query<TrackedAsset>(
      `SELECT * FROM tracked_assets ${whereClause} ORDER BY asset_type, display_order, name`
    );

    // Cache active assets
    if (!includeInactive) {
      assetsCache = { assets, timestamp: Date.now() };
    }

    return assets;
  }

  // Get assets by type
  async getAssetsByType(assetType: AssetType, includeInactive = false): Promise<TrackedAsset[]> {
    const whereClause = includeInactive
      ? 'WHERE asset_type = $1'
      : 'WHERE asset_type = $1 AND is_active = true';

    return query<TrackedAsset>(
      `SELECT * FROM tracked_assets ${whereClause} ORDER BY display_order, name`,
      [assetType]
    );
  }

  // Get grouped assets (for dashboard)
  async getGroupedAssets(): Promise<GroupedAssetsResponse> {
    const assets = await this.getAllAssets(false);

    return {
      erc20_tokens: assets.filter((a) => a.asset_type === 'erc20_token'),
      meme_coins: assets.filter((a) => a.asset_type === 'meme_coin'),
      nft_collections: assets.filter((a) => a.asset_type === 'nft_collection'),
    };
  }

  // Get single asset by ID
  async getAssetById(id: number): Promise<TrackedAsset | null> {
    return queryOne<TrackedAsset>('SELECT * FROM tracked_assets WHERE id = $1', [id]);
  }

  // Get single asset by address
  async getAssetByAddress(address: string): Promise<TrackedAsset | null> {
    return queryOne<TrackedAsset>('SELECT * FROM tracked_assets WHERE address = $1', [
      address.toLowerCase(),
    ]);
  }

  // Create new asset
  async createAsset(data: CreateAssetRequest): Promise<TrackedAsset> {
    const result = await queryOne<TrackedAsset>(
      `INSERT INTO tracked_assets (
        asset_type, token_type, name, symbol, address, logo_url, decimals,
        description, website_url, twitter_handle, coingecko_id, 
        dexscreener_pair_address, display_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        data.asset_type,
        data.token_type || null,
        data.name,
        data.symbol || null,
        data.address.toLowerCase(),
        data.logo_url || null,
        data.decimals ?? 18,
        data.description || null,
        data.website_url || null,
        data.twitter_handle || null,
        data.coingecko_id || null,
        data.dexscreener_pair_address || null,
        data.display_order ?? 0,
      ]
    );

    this.clearCache();
    return result!;
  }

  // Update asset
  async updateAsset(id: number, data: UpdateAssetRequest): Promise<TrackedAsset | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    // Build dynamic update query
    const fieldMap: Record<string, keyof UpdateAssetRequest> = {
      asset_type: 'asset_type',
      token_type: 'token_type',
      name: 'name',
      symbol: 'symbol',
      address: 'address',
      logo_url: 'logo_url',
      decimals: 'decimals',
      description: 'description',
      website_url: 'website_url',
      twitter_handle: 'twitter_handle',
      coingecko_id: 'coingecko_id',
      dexscreener_pair_address: 'dexscreener_pair_address',
      display_order: 'display_order',
      is_active: 'is_active',
    };

    for (const [dbField, dataKey] of Object.entries(fieldMap)) {
      if (data[dataKey] !== undefined) {
        fields.push(`${dbField} = $${paramIndex}`);
        let value = data[dataKey];
        // Lowercase address
        if (dbField === 'address' && typeof value === 'string') {
          value = value.toLowerCase();
        }
        values.push(value);
        paramIndex++;
      }
    }

    if (fields.length === 0) {
      return this.getAssetById(id);
    }

    values.push(id);
    const result = await queryOne<TrackedAsset>(
      `UPDATE tracked_assets SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    this.clearCache();
    return result;
  }

  // Delete asset
  async deleteAsset(id: number): Promise<boolean> {
    const result = await query('DELETE FROM tracked_assets WHERE id = $1 RETURNING id', [id]);
    this.clearCache();
    return result.length > 0;
  }

  // Reorder assets within a type
  async reorderAssets(assetType: AssetType, assetIds: number[]): Promise<void> {
    // Update display_order for each asset
    for (let i = 0; i < assetIds.length; i++) {
      await query(
        'UPDATE tracked_assets SET display_order = $1 WHERE id = $2 AND asset_type = $3',
        [i, assetIds[i], assetType]
      );
    }
    this.clearCache();
  }

  // ============================================================================
  // Helper methods for wallet-stats-service compatibility
  // ============================================================================

  // Get ERC20 tokens (stablecoins + native + defi + governance + utility)
  async getErc20Tokens(): Promise<TrackedAsset[]> {
    return this.getAssetsByType('erc20_token');
  }

  // Get meme coins
  async getMemeCoins(): Promise<TrackedAsset[]> {
    return this.getAssetsByType('meme_coin');
  }

  // Get NFT collections
  async getNftCollections(): Promise<TrackedAsset[]> {
    return this.getAssetsByType('nft_collection');
  }

  // Get all tokens (ERC20 + meme coins) for wallet stats
  async getAllTokens(): Promise<TrackedAsset[]> {
    const assets = await this.getAllAssets();
    return assets.filter((a) => a.asset_type === 'erc20_token' || a.asset_type === 'meme_coin');
  }
}

export const assetsService = new AssetsService();
