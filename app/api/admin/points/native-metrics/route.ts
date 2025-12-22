import { NextRequest, NextResponse } from 'next/server';
import { pointsService } from '@/lib/services/points-service';

// GET /api/admin/points/native-metrics - List all native metrics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    const metrics = await pointsService.getAllNativeMetrics(activeOnly);
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('Failed to fetch native metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch native metrics' },
      { status: 500 }
    );
  }
}
