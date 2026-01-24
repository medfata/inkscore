import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { DashboardCardWithRelations, DashboardCardsResponse } from '@/lib/types/dashboard';

// GET /api/dashboard/cards - Public endpoint to get active dashboard cards
export async function GET(request: NextRequest) {
  try {
    // Fetch active cards only
    const cards = await query<{
      id: number;
      row: string;
      card_type: string;
      title: string;
      subtitle: string | null;
      color: string;
      display_order: number;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT * FROM dashboard_cards
      WHERE is_active = true
      ORDER BY row, display_order, id
    `);

    if (cards.length === 0) {
      return NextResponse.json({ row3: [], row4: [] });
    }

    const cardIds = cards.map(c => c.id);

    // Fetch metrics for all cards
    const cardMetrics = await query<{
      id: number;
      card_id: number;
      metric_id: number;
      display_order: number;
      metric_slug: string;
      metric_name: string;
      metric_currency: string;
      metric_aggregation_type: string;
    }>(`
      SELECT 
        dcm.id,
        dcm.card_id,
        dcm.metric_id,
        dcm.display_order,
        am.slug as metric_slug,
        am.name as metric_name,
        am.currency as metric_currency,
        am.aggregation_type as metric_aggregation_type
      FROM dashboard_card_metrics dcm
      JOIN analytics_metrics am ON am.id = dcm.metric_id
      WHERE dcm.card_id = ANY($1)
      ORDER BY dcm.card_id, dcm.display_order
    `, [cardIds]);

    // Fetch platforms for all cards
    const cardPlatforms = await query<{
      id: number;
      card_id: number;
      platform_id: number;
      display_order: number;
      platform_slug: string;
      platform_name: string;
      platform_logo_url: string | null;
    }>(`
      SELECT 
        dcp.id,
        dcp.card_id,
        dcp.platform_id,
        dcp.display_order,
        p.slug as platform_slug,
        p.name as platform_name,
        p.logo_url as platform_logo_url
      FROM dashboard_card_platforms dcp
      JOIN platforms p ON p.id = dcp.platform_id
      WHERE dcp.card_id = ANY($1)
      ORDER BY dcp.card_id, dcp.display_order
    `, [cardIds]);

    // Build response with relations
    const cardsWithRelations: DashboardCardWithRelations[] = cards.map(card => ({
      ...card,
      row: card.row as 'row3' | 'row4',
      card_type: card.card_type as 'aggregate' | 'single',
      metrics: cardMetrics
        .filter(m => m.card_id === card.id)
        .map(m => ({
          id: m.id,
          metric_id: m.metric_id,
          metric: {
            id: m.metric_id,
            slug: m.metric_slug,
            name: m.metric_name,
            currency: m.metric_currency,
            aggregation_type: m.metric_aggregation_type,
          },
        })),
      platforms: cardPlatforms
        .filter(p => p.card_id === card.id)
        .map(p => ({
          id: p.id,
          platform_id: p.platform_id,
          platform: {
            id: p.platform_id,
            slug: p.platform_slug,
            name: p.platform_name,
            logo_url: p.platform_logo_url,
          },
        })),
    }));

    // Split by row
    const response: DashboardCardsResponse = {
      row3: cardsWithRelations.filter(c => c.row === 'row3'),
      row4: cardsWithRelations.filter(c => c.row === 'row4'),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch dashboard cards:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard cards' }, { status: 500 });
  }
}
