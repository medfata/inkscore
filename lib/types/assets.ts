// ============================================================================
// Tracked Assets Types
// ============================================================================

export type AssetType = 'erc20_token' | 'meme_coin' | 'nft_collection';
export type TokenType = 'stablecoin' | 'native' | 'defi' | 'governance' | 'utility' | 'meme';

export interface TrackedAsset {
  id: number;
  asset_type: AssetType;
  token_type: TokenType | null;
  name: string;
  symbol: string | null;
  address: string;
  logo_url: string | null;
  decimals: number;
  description: string | null;
  website_url: string | null;
  twitter_handle: string | null;
  coingecko_id: string | null;
  dexscreener_pair_address: string | null;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// API Request Types
// ============================================================================

export interface CreateAssetRequest {
  asset_type: AssetType;
  token_type?: TokenType;
  name: string;
  symbol?: string;
  address: string;
  logo_url?: string;
  decimals?: number;
  description?: string;
  website_url?: string;
  twitter_handle?: string;
  coingecko_id?: string;
  dexscreener_pair_address?: string;
  display_order?: number;
}

export interface UpdateAssetRequest extends Partial<CreateAssetRequest> {
  is_active?: boolean;
}

// ============================================================================
// Grouped Assets Response (for dashboard)
// ============================================================================

export interface GroupedAssetsResponse {
  erc20_tokens: TrackedAsset[];
  meme_coins: TrackedAsset[];
  nft_collections: TrackedAsset[];
}
