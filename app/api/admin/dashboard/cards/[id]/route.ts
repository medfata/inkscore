import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { UpdateDashboardCardRequest } from '@/lib/types/dashboard';

// GET /api/admin/dashboard/cards/[id] - Get a single card
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cardId = parseInt(id, 10);

    if (isNaN(cardId)) {
      return NextResponse.json({ error: 'Invalid card ID' }, { status: 400 });
    }

    const card = await queryOne(`
      SELECT * FROM dashboard_cards WHERE id = $1
    `, [cardId]);

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Fetch metrics
    const metrics = await query(`
      SELECT 
        dcm.id,
        dcm.metric_id,
        dcm.display_order,
        am.slug as metric_slug,
        am.name as metric_name,
        am.currency as metric_currency,
        am.aggregation_type as metric_aggregation_type
      FROM dashboard_card_metrics dcm
      JOIN analytics_metrics am ON am.id = dcm.metric_id
      WHERE dcm.card_id = $1
      ORDER BY dcm.display_order
    `, [cardId]);

    // Fetch platforms
    const platforms = await query(`
      SELECT 
        dcp.id,
        dcp.platform_id,
        dcp.display_order,
        p.slug as platform_slug,
        p.name as platform_name,
        p.logo_url as platform_logo_url
      FROM dashboard_card_platforms dcp
      JOIN platforms p ON p.id = dcp.platform_id
      WHERE dcp.card_id = $1
      ORDER BY dcp.display_order
    `, [cardId]);

    return NextResponse.json({
      ...card,
      metrics: metrics.map((m: Record<string, unknown>) => ({
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
      platforms: platforms.map((p: Record<string, unknown>) => ({
        id: p.id,
        platform_id: p.platform_id,
        platform: {
          id: p.platform_id,
          slug: p.platform_slug,
          name: p.platform_name,
          logo_url: p.platform_logo_url,
        },
      })),
    });
  } catch (error) {
    console.error('Failed to fetch dashboard card:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard card' }, { status: 500 });
  }
}

// PUT /api/admin/dashboard/cards/[id] - Update a card
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cardId = parseInt(id, 10);

    if (isNaN(cardId)) {
      return NextResponse.json({ error: 'Invalid card ID' }, { status: 400 });
    }

    const body: UpdateDashboardCardRequest = await request.json();
    const { row, card_type, title, subtitle, color, display_order, is_active, metric_ids, platform_ids } = body;

    // Check card exists
    const existing = await queryOne(`SELECT id FROM dashboard_cards WHERE id = $1`, [cardId]);
    if (!existing) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (row !== undefined) {
      if (!['row3', 'row4'].includes(row)) {
        return NextResponse.json({ error: 'Invalid row value' }, { status: 400 });
      }
      updates.push(`row = $${paramIndex++}`);
      values.push(row);
    }

    if (card_type !== undefined) {
      if (!['aggregate', 'single'].includes(card_type)) {
        return NextResponse.json({ error: 'Invalid card_type value' }, { status: 400 });
      }
      updates.push(`card_type = $${paramIndex++}`);
      values.push(card_type);
    }

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }

    if (subtitle !== undefined) {
      updates.push(`subtitle = $${paramIndex++}`);
      values.push(subtitle || null);
    }

    if (color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(color);
    }

    if (display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(display_order);
    }

    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    // Update card if there are changes
    if (updates.length > 0) {
      values.push(cardId);
      await query(`
        UPDATE dashboard_cards 
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `, values);
    }

    // Update metrics if provided
    if (metric_ids !== undefined) {
      // Remove existing
      await query(`DELETE FROM dashboard_card_metrics WHERE card_id = $1`, [cardId]);
      // Add new
      for (let i = 0; i < metric_ids.length; i++) {
        await query(`
          INSERT INTO dashboard_card_metrics (card_id, metric_id, display_order)
          VALUES ($1, $2, $3)
        `, [cardId, metric_ids[i], i]);
      }
    }

    // Update platforms if provided
    if (platform_ids !== undefined) {
      // Remove existing
      await query(`DELETE FROM dashboard_card_platforms WHERE card_id = $1`, [cardId]);
      // Add new
      for (let i = 0; i < platform_ids.length; i++) {
        await query(`
          INSERT INTO dashboard_card_platforms (card_id, platform_id, display_order)
          VALUES ($1, $2, $3)
        `, [cardId, platform_ids[i], i]);
      }
    }

    return NextResponse.json({ message: 'Card updated successfully' });
  } catch (error) {
    console.error('Failed to update dashboard card:', error);
    return NextResponse.json({ error: 'Failed to update dashboard card' }, { status: 500 });
  }
}

// DELETE /api/admin/dashboard/cards/[id] - Delete a card
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const cardId = parseInt(id, 10);

    if (isNaN(cardId)) {
      return NextResponse.json({ error: 'Invalid card ID' }, { status: 400 });
    }

    // Delete card (cascades to metrics and platforms)
    const result = await query(`
      DELETE FROM dashboard_cards WHERE id = $1 RETURNING id
    `, [cardId]);

    if (result.length === 0) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Card deleted successfully' });
  } catch (error) {
    console.error('Failed to delete dashboard card:', error);
    return NextResponse.json({ error: 'Failed to delete dashboard card' }, { status: 500 });
  }
}
