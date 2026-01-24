import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/admin/points/rules/[id] - Get a single points rule
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id);

    if (isNaN(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule ID' }, { status: 400 });
    }

    const rule = await pointsService.getPointsRuleById(ruleId);
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Failed to fetch points rule:', error);
    return NextResponse.json(
      { error: 'Failed to fetch points rule' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/points/rules/[id] - Update a points rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id);

    if (isNaN(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule ID' }, { status: 400 });
    }

    const body = await request.json();

    // Validate ranges if provided
    if (body.ranges) {
      if (!Array.isArray(body.ranges)) {
        return NextResponse.json(
          { error: 'ranges must be an array' },
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
    }

    const rule = await pointsService.updatePointsRule(ruleId, body);
    if (!rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Failed to update points rule:', error);
    return NextResponse.json(
      { error: 'Failed to update points rule' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/points/rules/[id] - Delete a points rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id);

    if (isNaN(ruleId)) {
      return NextResponse.json({ error: 'Invalid rule ID' }, { status: 400 });
    }

    const deleted = await pointsService.deletePointsRule(ruleId);
    if (!deleted) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete points rule:', error);
    return NextResponse.json(
      { error: 'Failed to delete points rule' },
      { status: 500 }
    );
  }
}
