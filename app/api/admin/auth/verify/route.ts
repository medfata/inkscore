import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSignature, createSessionToken } from '@/lib/auth/signature-auth';

/**
 * POST /api/admin/auth/verify
 * Verify a signed message and create a session token
 */
export async function POST(request: NextRequest) {
  try {
    const { message, signature } = await request.json();

    if (!message || !signature) {
      return NextResponse.json(
        { error: 'Missing message or signature' },
        { status: 400 }
      );
    }

    const result = await verifyAdminSignature(message, signature);

    if (!result.valid) {
      return NextResponse.json(
        { error: result.error || 'Invalid signature' },
        { status: 403 }
      );
    }

    // Create session token
    const token = createSessionToken(result.address!);

    return NextResponse.json({
      success: true,
      token,
      address: result.address,
    });
  } catch (error) {
    console.error('Auth verification failed:', error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
