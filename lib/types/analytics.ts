// Contract metadata
export interface ContractMetadata {
  id: number;
  address: string;
  name: string;
  website_url: string | null;
  logo_url: string | null;
  category: string | null;
  is_active: boolean;
  created_at: Date;
}

// Analytics metric definition
export interface AnalyticsMetric {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  aggregation_type: 'sum_eth_value' | 'count' | 'count_by_function';
  value_field: string | null;
  currency: 'USD' | 'ETH' | 'COUNT';
  is_active: boolean;
  display_order: number;
  icon: string | null;
  created_at: Date;
  updated_at: Date;
}

// Metric contract mapping
export interface MetricContract {
  id: number;
  metric_id: number;
  contract_address: string;
  include_mode: 'include' | 'exclude';
}

// Metric function mapping
export interface MetricFunction {
  id: number;
  metric_id: number;
  function_name: string;
  function_selector: string | null;
  include_mode: 'include' | 'exclude';
}

// User analytics cache
export interface UserAnalyticsCache {
  id: number;
  wallet_address: string;
  metric_id: number;
  total_count: number;
  total_eth_value: string;
  total_usd_value: string;
  sub_aggregates: Record<string, SubAggregate>;
  last_block_processed: number;
  last_tx_hash: string | null;
  last_updated: Date;
}

export interface SubAggregate {
  contract_address: string;
  contract_name?: string;
  count: number;
  eth_value: string;
  usd_value: string;
  by_function?: Record<string, {
    count: number;
    eth_value: string;
    usd_value: string;
  }>;
}

// ETH price
export interface EthPrice {
  id: number;
  timestamp: Date;
  price_usd: string;
  source: string;
}

// Sync cursor
export interface AnalyticsSyncCursor {
  id: number;
  metric_id: number;
  last_block_processed: number;
  last_sync_at: Date | null;
  is_syncing: boolean;
}

// API response types
export interface MetricWithRelations extends AnalyticsMetric {
  contracts: MetricContract[];
  functions: MetricFunction[];
}

export interface UserAnalyticsResponse {
  wallet_address: string;
  metrics: {
    slug: string;
    name: string;
    icon: string | null;
    currency: string;
    total_count: number;
    total_value: string;
    sub_aggregates: SubAggregate[];
    last_updated: Date;
  }[];
}

// Admin API request types
export interface CreateMetricRequest {
  slug: string;
  name: string;
  description?: string;
  aggregation_type: 'sum_eth_value' | 'count' | 'count_by_function';
  value_field?: string;
  currency: 'USD' | 'ETH' | 'COUNT';
  icon?: string;
  display_order?: number;
  contracts: {
    address: string;
    include_mode: 'include' | 'exclude';
  }[];
  functions: {
    name: string;
    selector?: string;
    include_mode: 'include' | 'exclude';
  }[];
}

export interface UpdateMetricRequest extends Partial<CreateMetricRequest> {
  is_active?: boolean;
}

// Contract functions from indexed data
export interface ContractFunction {
  function_name: string;
  function_selector: string;
  tx_count: number;
}
