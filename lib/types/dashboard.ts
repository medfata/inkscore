// ============================================================================
// Dashboard Cards Types
// ============================================================================

export type DashboardCardRow = 'row3' | 'row4';
export type DashboardCardType = 'aggregate' | 'single';

export interface DashboardCard {
  id: number;
  row: DashboardCardRow;
  card_type: DashboardCardType;
  title: string;
  subtitle: string | null;
  color: string; // e.g., 'purple', 'cyan', 'yellow', 'pink'
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface DashboardCardMetric {
  id: number;
  card_id: number;
  metric_id: number;
  display_order: number;
}

export interface DashboardCardPlatform {
  id: number;
  card_id: number;
  platform_id: number;
  display_order: number;
}

// Card with all relations
export interface DashboardCardWithRelations extends DashboardCard {
  metrics: Array<{
    id: number;
    metric_id: number;
    metric: {
      id: number;
      slug: string;
      name: string;
      currency: string;
      aggregation_type: string;
    };
  }>;
  platforms: Array<{
    id: number;
    platform_id: number;
    platform: {
      id: number;
      slug: string;
      name: string;
      logo_url: string | null;
    };
  }>;
}

// API Response for dashboard
export interface DashboardCardsResponse {
  row3: DashboardCardWithRelations[];
  row4: DashboardCardWithRelations[];
}

// Card data with fetched metric values (for rendering)
export interface DashboardCardData extends DashboardCardWithRelations {
  totalValue: number;
  totalCount: number;
  byPlatform: Array<{
    platform: {
      id: number;
      name: string;
      logo_url: string | null;
    };
    value: number;
    count: number;
  }>;
}

// Admin API Request Types
export interface CreateDashboardCardRequest {
  row: DashboardCardRow;
  card_type: DashboardCardType;
  title: string;
  subtitle?: string;
  color: string;
  display_order?: number;
  metric_ids: number[];
  platform_ids: number[];
}

export interface UpdateDashboardCardRequest extends Partial<CreateDashboardCardRequest> {
  is_active?: boolean;
}

// Reorder request
export interface ReorderDashboardCardsRequest {
  row: DashboardCardRow;
  card_ids: number[]; // ordered array of card IDs
}
