import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/admin/points/rules - List all points rules
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const rules = await pointsService.getAllPointsRules(activeOnly);
    return NextResponse.json({ rules });
  } catch (error) {
    console.error('Failed to fetch points rules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch points rules' },
      { status: 500 }
    );
  }
}

// POST /api/admin/points/rules - Create a new points rule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.metric_type || !body.name || !body.calculation_mode || !body.ranges) {
      return NextResponse.json(
        { error: 'Missing required fields: metric_type, name, calculation_mode, ranges' },
        { status: 400 }
      );
    }

    // Validate metric reference
    if (body.metric_type === 'platform' && !body.platform_id) {
      return NextResponse.json(
        { error: 'platform_id is required for platform metrics' },
        { status: 400 }
      );
    }
    if (body.metric_type === 'native' && !body.native_metric_id) {
      return NextResponse.json(
        { error: 'native_metric_id is required for native metrics' },
        { status: 400 }
      );
    }

    // Validate ranges
    if (!Array.isArray(body.ranges) || body.ranges.length === 0) {
      return NextResponse.json(
        { error: 'ranges must be a non-empty array' },
        { status: 400 }
      );
    }

    for (const range of body.ranges) {
      if (typeof range.min !== 'number' || typeof range.points !== 'number') {
        return NextResponse.json(
          { error: 'Each range must have min (number) and points (number)' },
          { status: 400 }
        );
      }
    }

    const rule = await pointsService.createPointsRule(body);
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error('Failed to create points rule:', error);
    return NextResponse.json(
      { error: 'Failed to create points rule' },
      { status: 500 }
    );
  }
}
