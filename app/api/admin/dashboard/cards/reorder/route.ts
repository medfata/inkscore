import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ReorderDashboardCardsRequest } from '@/lib/types/dashboard';

// POST /api/admin/dashboard/cards/reorder - Reorder cards in a row
export async function POST(request: NextRequest) {
  try {
    const body: ReorderDashboardCardsRequest = await request.json();
    const { row, card_ids } = body;

    // Validate
    if (!row || !card_ids || !Array.isArray(card_ids)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['row3', 'row4'].includes(row)) {
      return NextResponse.json({ error: 'Invalid row value' }, { status: 400 });
    }

    // Update display_order for each card
    for (let i = 0; i < card_ids.length; i++) {
      await query(`
        UPDATE dashboard_cards 
        SET display_order = $1
        WHERE id = $2 AND row = $3
      `, [i, card_ids[i], row]);
    }

    return NextResponse.json({ message: 'Cards reordered successfully' });
  } catch (error) {
    console.error('Failed to reorder dashboard cards:', error);
    return NextResponse.json({ error: 'Failed to reorder dashboard cards' }, { status: 500 });
  }
}
