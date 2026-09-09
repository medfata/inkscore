import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-api-auth';
import { verifySessionToken } from '@/lib/auth/signature-auth';
import { getSignupBonus, setSignupBonus } from '@/lib/services/app-settings-service';

export const dynamic = 'force-dynamic';

// Sanity cap so a typo can't hand every wallet a million points.
const MAX_BONUS_POINTS = 1_000_000;

/**
 * GET /api/admin/points/bonus
 * Current signup bonus + who changed it last (admin-only).
 */
export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const bonus = await getSignupBonus();
    return NextResponse.json({
      points: bonus.points,
      updated_by: bonus.updatedBy,
      updated_at: bonus.updatedAt,
    });
  } catch (error) {
    console.error('[AdminBonus] Failed to read bonus setting:', error);
    return NextResponse.json(
      {
        error:
          'Failed to read bonus setting. If this persists, migration 029_app_settings.sql may not be applied yet.',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/points/bonus
 * Update the signup bonus. Body: { points: number } (non-negative integer).
 * Records the admin wallet from the session token as updated_by.
 */
export async function PUT(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const points = Number(body?.points);

    if (!Number.isFinite(points) || !Number.isInteger(points) || points < 0) {
      return NextResponse.json(
        { error: 'points must be a non-negative integer' },
        { status: 400 }
      );
    }
    if (points > MAX_BONUS_POINTS) {
      return NextResponse.json(
        { error: `points cannot exceed ${MAX_BONUS_POINTS.toLocaleString()}` },
        { status: 400 }
      );
    }

    // checkAdminAuth already validated this token; re-verify to extract the
    // admin wallet address for the audit trail.
    const token = request.headers.get('authorization')?.substring(7) || '';
    const session = verifySessionToken(token);
    const updatedBy = session.valid && session.address ? session.address : 'unknown';

    const bonus = await setSignupBonus(points, updatedBy);

    console.log(`[AdminBonus] Signup bonus set to ${bonus.points} by ${bonus.updatedBy}`);
    return NextResponse.json({
      points: bonus.points,
      updated_by: bonus.updatedBy,
      updated_at: bonus.updatedAt,
    });
  } catch (error) {
    console.error('[AdminBonus] Failed to update bonus setting:', error);
    return NextResponse.json(
      { error: 'Failed to update bonus setting' },
      { status: 500 }
    );
  }
}
