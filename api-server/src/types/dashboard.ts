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
  color: string;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

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

export interface DashboardCardsResponse {
  row3: DashboardCardData[];
  row4: DashboardCardData[];
}
