import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { DashboardCardWithRelations, CreateDashboardCardRequest } from '@/lib/types/dashboard';

// GET /api/admin/dashboard/cards - List all dashboard cards with relations
export async function GET() {
  try {
    // Fetch all cards
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
      ORDER BY row, display_order, id
    `);

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
      ORDER BY dcm.card_id, dcm.display_order
    `);

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
      ORDER BY dcp.card_id, dcp.display_order
    `);

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

    return NextResponse.json({ cards: cardsWithRelations });
  } catch (error) {
    console.error('Failed to fetch dashboard cards:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard cards' }, { status: 500 });
  }
}

// POST /api/admin/dashboard/cards - Create a new dashboard card
export async function POST(request: NextRequest) {
  try {
    const body: CreateDashboardCardRequest = await request.json();
    const { row, card_type, title, subtitle, color, display_order, metric_ids, platform_ids } = body;

    // Validate required fields
    if (!row || !card_type || !title || !color) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Validate row
    if (!['row3', 'row4'].includes(row)) {
      return NextResponse.json({ error: 'Invalid row value' }, { status: 400 });
    }

    // Validate card_type
    if (!['aggregate', 'single'].includes(card_type)) {
      return NextResponse.json({ error: 'Invalid card_type value' }, { status: 400 });
    }

    // Get max display_order for the row if not provided
    let order = display_order;
    if (order === undefined) {
      const maxOrder = await queryOne<{ max_order: number | null }>(`
        SELECT MAX(display_order) as max_order FROM dashboard_cards WHERE row = $1
      `, [row]);
      order = (maxOrder?.max_order ?? -1) + 1;
    }

    // Create the card
    const card = await queryOne<{ id: number }>(`
      INSERT INTO dashboard_cards (row, card_type, title, subtitle, color, display_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [row, card_type, title, subtitle || null, color, order]);

    if (!card) {
      return NextResponse.json({ error: 'Failed to create card' }, { status: 500 });
    }

    // Link metrics
    if (metric_ids && metric_ids.length > 0) {
      for (let i = 0; i < metric_ids.length; i++) {
        await query(`
          INSERT INTO dashboard_card_metrics (card_id, metric_id, display_order)
          VALUES ($1, $2, $3)
        `, [card.id, metric_ids[i], i]);
      }
    }

    // Link platforms
    if (platform_ids && platform_ids.length > 0) {
      for (let i = 0; i < platform_ids.length; i++) {
        await query(`
          INSERT INTO dashboard_card_platforms (card_id, platform_id, display_order)
          VALUES ($1, $2, $3)
        `, [card.id, platform_ids[i], i]);
      }
    }

    return NextResponse.json({ id: card.id, message: 'Card created successfully' });
  } catch (error) {
    console.error('Failed to create dashboard card:', error);
    return NextResponse.json({ error: 'Failed to create dashboard card' }, { status: 500 });
  }
}
