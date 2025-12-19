import { NextRequest, NextResponse } from 'next/server';
import { metricsService } from '@/lib/services/metrics-service';
import { UpdateMetricRequest } from '@/lib/types/analytics';

// GET /api/admin/metrics/[id] - Get single metric
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Try to parse as number first, otherwise treat as slug
    const idOrSlug = /^\d+$/.test(id) ? parseInt(id) : id;
    const metric = await metricsService.getMetric(idOrSlug);

    if (!metric) {
      return NextResponse.json(
        { error: 'Metric not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ metric });
  } catch (error) {
    console.error('Error fetching metric:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metric' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/metrics/[id] - Update metric
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const metricId = parseInt(id);
    
    if (isNaN(metricId)) {
      return NextResponse.json(
        { error: 'Invalid metric ID' },
        { status: 400 }
      );
    }

    const body: UpdateMetricRequest = await request.json();
    const metric = await metricsService.updateMetric(metricId, body);

    if (!metric) {
      return NextResponse.json(
        { error: 'Metric not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ metric });
  } catch (error) {
    console.error('Error updating metric:', error);
    return NextResponse.json(
      { error: 'Failed to update metric' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/metrics/[id] - Delete metric
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const metricId = parseInt(id);
    
    if (isNaN(metricId)) {
      return NextResponse.json(
        { error: 'Invalid metric ID' },
        { status: 400 }
      );
    }

    const deleted = await metricsService.deleteMetric(metricId);

    if (!deleted) {
      return NextResponse.json(
        { error: 'Metric not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting metric:', error);
    return NextResponse.json(
      { error: 'Failed to delete metric' },
      { status: 500 }
    );
  }
}
