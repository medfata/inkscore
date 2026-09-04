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
  // True when some inputs timed out (e.g. wallet stats under a cold burst).
  // responseCache clamps partial results to the default 30s TTL so the score
  // recomputes — and converges — on the next load instead of locking in an
  // understated score for the wallet-cache window.
  partial?: boolean;
}
