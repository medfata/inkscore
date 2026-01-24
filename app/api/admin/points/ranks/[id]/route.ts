import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/admin/points/ranks/[id] - Get a single rank
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rankId = parseInt(id);

    if (isNaN(rankId)) {
      return NextResponse.json({ error: 'Invalid rank ID' }, { status: 400 });
    }

    const rank = await pointsService.getRankById(rankId);
    if (!rank) {
      return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
    }

    return NextResponse.json({ rank });
  } catch (error) {
    console.error('Failed to fetch rank:', error);
    return NextResponse.json(
      { error: 'Failed to fetch rank' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/points/ranks/[id] - Update a rank
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rankId = parseInt(id);

    if (isNaN(rankId)) {
      return NextResponse.json({ error: 'Invalid rank ID' }, { status: 400 });
    }

    const body = await request.json();

    // Validate points if provided
    if (body.min_points !== undefined && (typeof body.min_points !== 'number' || body.min_points < 0)) {
      return NextResponse.json(
        { error: 'min_points must be a non-negative number' },
        { status: 400 }
      );
    }

    const rank = await pointsService.updateRank(rankId, body);
    if (!rank) {
      return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
    }

    return NextResponse.json({ rank });
  } catch (error) {
    console.error('Failed to update rank:', error);
    return NextResponse.json(
      { error: 'Failed to update rank' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/points/ranks/[id] - Delete a rank
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rankId = parseInt(id);

    if (isNaN(rankId)) {
      return NextResponse.json({ error: 'Invalid rank ID' }, { status: 400 });
    }

    const deleted = await pointsService.deleteRank(rankId);
    if (!deleted) {
      return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete rank:', error);
    return NextResponse.json(
      { error: 'Failed to delete rank' },
      { status: 500 }
    );
  }
}
