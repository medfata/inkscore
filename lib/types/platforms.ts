// ============================================================================
// Platform & Points System Types
// ============================================================================

// Platform (third-party dApp)
export interface Platform {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  platform_type: PlatformType;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export type PlatformType = 'dex' | 'defi' | 'bridge' | 'social' | 'launchpad' | 'nft' | 'other' | (string & {});

// Contract (to be indexed)
export interface Contract {
  id: number;
  address: string;
  name: string;
  deploy_block: number;
  fetch_transactions: boolean;
  indexing_enabled: boolean;
  indexing_status: IndexingStatus;
  current_block: number;
  total_blocks: number;
  progress_percent: number;
  last_indexed_at: Date | null;
  error_message: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  // Hybrid indexer fields
  contract_type?: 'count' | 'volume';
  creation_date?: string;
  backfill_status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  backfill_progress?: number;
  total_transactions?: number;
  indexed_transactions?: number;
  enrichment_status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  enrichment_progress?: number;
  last_backfill_date?: Date;
}

export type IndexingStatus = 'pending' | 'indexing' | 'complete' | 'paused' | 'error';

// Platform with its contracts
export interface PlatformWithContracts extends Platform {
  contracts: Contract[];
}

// Contract with its platforms
export interface ContractWithPlatforms extends Contract {
  platforms: Platform[];
}

// ============================================================================
// Token Types
// ============================================================================

export interface DiscoveredToken {
  id: number;
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number;
  icon_url: string | null;
  tags: string[] | null;
  is_stablecoin: boolean;
  is_native_wrapper: boolean;
  coingecko_id: string | null;
  dexscreener_pair_address: string | null;
  last_price_usd: number | null;
  price_source: string | null;
  price_updated_at: Date | null;
  is_active: boolean;
  discovered_at: Date;
  updated_at: Date;
}

export interface TokenTransfer {
  id: number;
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
  event_type: string | null;
  block_number: number | null;
  block_timestamp: Date | null;
  created_at: Date;
}

// ============================================================================
// Native Metrics Types
// ============================================================================

export interface NativeMetric {
  id: number;
  key: NativeMetricKey;
  name: string;
  description: string | null;
  value_type: 'count' | 'days' | 'usd';
  icon: string | null;
  display_order: number;
  is_active: boolean;
  created_at: Date;
}

export type NativeMetricKey = 'wallet_age' | 'total_tx' | 'nft_collections' | 'erc20_tokens' | 'total_volume' | 'meme_coins';

// ============================================================================
// Points System Types
// ============================================================================

export interface PointsRule {
  id: number;
  metric_type: 'platform' | 'native' | 'metric';
  platform_id: number | null;
  native_metric_id: number | null;
  name: string;
  description: string | null;
  calculation_mode: CalculationMode;
  ranges: PointRange[];
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

export type CalculationMode = 'range' | 'multiplier';

export interface PointRange {
  min: number;
  max: number | null;  // null = unlimited (e.g., >= 1000)
  points: number;
}

// Points rule with related data
export interface PointsRuleWithRelations extends PointsRule {
  platform?: Platform;
  native_metric?: NativeMetric;
  metrics?: Array<{
    id: number;
    name: string;
    slug: string;
    aggregation_type: string;
    currency: string;
  }>;
}

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

export interface PlatformStatsResponse {
  platform: Platform;
  contracts: Array<{
    address: string;
    name: string;
    indexing_status: IndexingStatus;
    progress_percent: number;
    tx_count: number;
    unique_wallets: number;
  }>;
  total_tx_count: number;
  total_unique_wallets: number;
  total_usd_volume: number;
}

export interface IndexingProgressResponse {
  platforms: Array<{
    id: number;
    name: string;
    logo_url: string | null;
    contracts: Array<{
      address: string;
      name: string;
      indexing_status: IndexingStatus;
      progress_percent: number;
      current_block: number;
      total_blocks: number;
    }>;
  }>;
  global_stats: {
    total_contracts: number;
    contracts_complete: number;
    contracts_indexing: number;
    total_transactions: number;
    total_unique_wallets: number;
  };
}

// ============================================================================
// Admin API Request Types
// ============================================================================

export interface CreatePlatformRequest {
  slug: string;
  name: string;
  description?: string;
  logo_url?: string;
  website_url?: string;
  platform_type: PlatformType;
  display_order?: number;
}

export interface UpdatePlatformRequest extends Partial<CreatePlatformRequest> {
  is_active?: boolean;
}

export interface CreateContractRequest {
  address: string;
  name: string;
  deploy_block: number;
  fetch_transactions?: boolean;
  platform_ids?: number[];  // Link to platforms
  // Hybrid indexer fields
  contract_type?: 'count' | 'volume';
  creation_date?: string;
}

export interface UpdateContractRequest {
  name?: string;
  deploy_block?: number;
  fetch_transactions?: boolean;
  indexing_enabled?: boolean;
  platform_ids?: number[];
}

export interface CreatePointsRuleRequest {
  metric_type: 'platform' | 'native' | 'metric';
  platform_id?: number;
  native_metric_id?: number;
  metric_ids?: number[];  // For metric-based rules
  name: string;
  description?: string;
  calculation_mode: CalculationMode;
  ranges: PointRange[];
  display_order?: number;
}

export interface UpdatePointsRuleRequest extends Partial<CreatePointsRuleRequest> {
  is_active?: boolean;
}

export interface CreateRankRequest {
  name: string;
  min_points: number;
  max_points?: number;
  logo_url?: string;
  color?: string;
  description?: string;
  display_order?: number;
}

export interface UpdateRankRequest extends Partial<CreateRankRequest> {
  is_active?: boolean;
}
