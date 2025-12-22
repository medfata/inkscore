import { NextRequest, NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';

// GET /api/admin/platforms/[id] - Get a single platform
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const platformId = parseInt(id);

    if (isNaN(platformId)) {
      return NextResponse.json({ error: 'Invalid platform ID' }, { status: 400 });
    }

    const platform = await platformsService.getPlatformWithContracts(platformId);
    if (!platform) {
      return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
    }

    // Get stats
    const stats = await platformsService.getPlatformStats(platformId);

    return NextResponse.json({ platform, stats });
  } catch (error) {
    console.error('Failed to fetch platform:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platform' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/platforms/[id] - Update a platform
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const platformId = parseInt(id);

    if (isNaN(platformId)) {
      return NextResponse.json({ error: 'Invalid platform ID' }, { status: 400 });
    }

    const body = await request.json();
    const platform = await platformsService.updatePlatform(platformId, body);

    if (!platform) {
      return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
    }

    return NextResponse.json({ platform });
  } catch (error) {
    console.error('Failed to update platform:', error);
    return NextResponse.json(
      { error: 'Failed to update platform' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/platforms/[id] - Delete a platform
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const platformId = parseInt(id);

    if (isNaN(platformId)) {
      return NextResponse.json({ error: 'Invalid platform ID' }, { status: 400 });
    }

    const deleted = await platformsService.deletePlatform(platformId);
    if (!deleted) {
      return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete platform:', error);
    return NextResponse.json(
      { error: 'Failed to delete platform' },
      { status: 500 }
    );
  }
}
