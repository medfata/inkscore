import { NextRequest, NextResponse } from 'next/server';
import { metricsService } from '@/lib/services/metrics-service';
import { CreateMetricRequest } from '@/lib/types/analytics';

// GET /api/admin/metrics - List all metrics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';

    const metrics = await metricsService.getAllMetrics(activeOnly);
    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}

// POST /api/admin/metrics - Create new metric
export async function POST(request: NextRequest) {
  try {
    const body: CreateMetricRequest = await request.json();

    // Validate required fields
    if (!body.slug || !body.name || !body.aggregation_type || !body.currency) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, name, aggregation_type, currency' },
        { status: 400 }
      );
    }

    if (!body.contracts || body.contracts.length === 0) {
      return NextResponse.json(
        { error: 'At least one contract is required' },
        { status: 400 }
      );
    }

    const metric = await metricsService.createMetric(body);
    return NextResponse.json({ metric }, { status: 201 });
  } catch (error) {
    console.error('Error creating metric:', error);
    
    // Check for unique constraint violation
    if (error instanceof Error && error.message.includes('unique')) {
      return NextResponse.json(
        { error: 'A metric with this slug already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create metric' },
      { status: 500 }
    );
  }
}
