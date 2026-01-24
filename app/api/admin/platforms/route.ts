import { NextRequest, NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';
import { checkAdminAuth } from '@/lib/admin-api-auth';

// GET /api/admin/platforms - List all platforms
export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const withContracts = searchParams.get('withContracts') === 'true';

    if (withContracts) {
      const platforms = await platformsService.getAllPlatforms(activeOnly);
      const platformsWithContracts = await Promise.all(
        platforms.map(p => platformsService.getPlatformWithContracts(p.id))
      );
      return NextResponse.json({ platforms: platformsWithContracts });
    }

    const platforms = await platformsService.getAllPlatforms(activeOnly);
    return NextResponse.json({ platforms });
  } catch (error) {
    console.error('Failed to fetch platforms:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platforms' },
      { status: 500 }
    );
  }
}

// POST /api/admin/platforms - Create a new platform
export async function POST(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.slug || !body.name || !body.platform_type) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, name, platform_type' },
        { status: 400 }
      );
    }

    // Check if slug already exists
    const existing = await platformsService.getPlatformBySlug(body.slug);
    if (existing) {
      return NextResponse.json(
        { error: 'Platform with this slug already exists' },
        { status: 409 }
      );
    }

    const platform = await platformsService.createPlatform(body);
    return NextResponse.json({ platform }, { status: 201 });
  } catch (error) {
    console.error('Failed to create platform:', error);
    return NextResponse.json(
      { error: 'Failed to create platform' },
      { status: 500 }
    );
  }
}
