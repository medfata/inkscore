import { NextRequest, NextResponse } from 'next/server';
import { googleSheetsService } from '@/lib/services/google-sheets-service';
import { CreatePlatformListingRequest } from '@/lib/types/platform-request';

export async function POST(request: NextRequest) {
  try {
    const body: CreatePlatformListingRequest = await request.json();

    // Validation
    if (!body.platform_name?.trim()) {
      return NextResponse.json({ error: 'Platform name is required' }, { status: 400 });
    }
    if (!body.platform_url?.trim()) {
      return NextResponse.json({ error: 'Platform URL is required' }, { status: 400 });
    }
    if (!body.email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const result = await googleSheetsService.appendPlatformRequest({
      platform_name: body.platform_name.trim(),
      platform_url: body.platform_url.trim(),
      email: body.email.trim(),
      twitter_url: body.twitter_url?.trim(),
      telegram_url: body.telegram_url?.trim(),
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Failed to submit platform request:', error);
    return NextResponse.json(
      { error: 'Failed to submit request. Please try again later.' },
      { status: 500 }
    );
  }
}
