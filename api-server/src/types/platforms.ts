// ============================================================================
// Platform & Points System Types
// ============================================================================

export type PlatformType = 'dex' | 'defi' | 'bridge' | 'social' | 'launchpad' | 'nft' | 'other' | (string & {});
export type IndexingStatus = 'pending' | 'indexing' | 'complete' | 'paused' | 'error';
export type NativeMetricKey = 'wallet_age' | 'total_tx' | 'nft_collections' | 'erc20_tokens' | 'total_volume' | 'meme_coins';
export type CalculationMode = 'range' | 'multiplier';

// ============================================================================
// Ranking Types
// ============================================================================

export interface Rank {
  id: number;
  name: string;
  min_points: number;
  max_points: number | null;
  logo_url: string | null;
  color: string | null;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Wallet Points Breakdown Types
// ============================================================================

export interface WalletPointsBreakdown {
  native: {
    [key in NativeMetricKey]?: {
      value: number;
      points: number;
    };
  };
  platforms: {
    [platformSlug: string]: {
      tx_count: number;
      usd_volume: number;
      points: number;
    };
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface WalletScoreResponse {
  wallet_address: string;
  total_points: number;
  rank: {
    name: string;
    color: string | null;
    logo_url: string | null;
  } | null;
  breakdown: WalletPointsBreakdown;
  last_updated: Date;
}
