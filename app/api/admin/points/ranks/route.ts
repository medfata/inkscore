import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/admin/points/ranks - List all ranks
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const ranks = await pointsService.getAllRanks(activeOnly);
    return NextResponse.json({ ranks });
  } catch (error) {
    console.error('Failed to fetch ranks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ranks' },
      { status: 500 }
    );
  }
}

// POST /api/admin/points/ranks - Create a new rank
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || body.min_points === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: name, min_points' },
        { status: 400 }
      );
    }

    if (typeof body.min_points !== 'number' || body.min_points < 0) {
      return NextResponse.json(
        { error: 'min_points must be a non-negative number' },
        { status: 400 }
      );
    }

    if (body.max_points !== undefined && body.max_points !== null) {
      if (typeof body.max_points !== 'number' || body.max_points < body.min_points) {
        return NextResponse.json(
          { error: 'max_points must be a number greater than or equal to min_points' },
          { status: 400 }
        );
      }
    }

    const rank = await pointsService.createRank(body);
    return NextResponse.json({ rank }, { status: 201 });
  } catch (error) {
    console.error('Failed to create rank:', error);
    return NextResponse.json(
      { error: 'Failed to create rank' },
      { status: 500 }
    );
  }
}
