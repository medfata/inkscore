import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/admin-api-auth';
import { verifySessionToken } from '@/lib/auth/signature-auth';
import {
  MAX_WALLET_BONUS_ENTRIES,
  getWalletBonuses,
  normalizeWalletBonuses,
  setWalletBonuses,
} from '@/lib/services/app-settings-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/points/wallet-bonus
 * Per-wallet bonus list (stacked on top of the global signup bonus) +
 * who changed it last (admin-only).
 */
export async function GET(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const setting = await getWalletBonuses();
    return NextResponse.json({
      wallets: setting.wallets,
      updated_by: setting.updatedBy,
      updated_at: setting.updatedAt,
    });
  } catch (error) {
    console.error('[AdminWalletBonus] Failed to read wallet bonuses:', error);
    return NextResponse.json(
      {
        error:
          'Failed to read wallet bonuses. If this persists, migration 032_wallet_bonus_points.sql may not be applied yet.',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/points/wallet-bonus
 * Replace the per-wallet bonus list.
 * Body: { wallets: [{ address: "0x...", points: number }] }.
 * Records the admin wallet from the session token as updated_by.
 */
export async function PUT(request: NextRequest) {
  const authError = checkAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body || !Array.isArray(body.wallets)) {
      return NextResponse.json(
        { error: 'wallets must be an array of { address, points }' },
        { status: 400 }
      );
    }
    if (body.wallets.length > MAX_WALLET_BONUS_ENTRIES) {
      return NextResponse.json(
        { error: `wallets cannot exceed ${MAX_WALLET_BONUS_ENTRIES} entries` },
        { status: 400 }
      );
    }

    const { wallets, errors } = normalizeWalletBonuses(body);
    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors[0], errors },
        { status: 400 }
      );
    }

    // checkAdminAuth already validated this token; re-verify to extract the
    // admin wallet address for the audit trail.
    const token = request.headers.get('authorization')?.substring(7) || '';
    const session = verifySessionToken(token);
    const updatedBy = session.valid && session.address ? session.address : 'unknown';

    const setting = await setWalletBonuses(wallets, updatedBy);

    console.log(
      `[AdminWalletBonus] Wallet bonuses set (${setting.wallets.length} entries) by ${setting.updatedBy}`
    );
    return NextResponse.json({
      wallets: setting.wallets,
      updated_by: setting.updatedBy,
      updated_at: setting.updatedAt,
    });
  } catch (error) {
    console.error('[AdminWalletBonus] Failed to update wallet bonuses:', error);
    return NextResponse.json(
      { error: 'Failed to update wallet bonuses' },
      { status: 500 }
    );
  }
}
