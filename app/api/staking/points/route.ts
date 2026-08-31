import { NextRequest, NextResponse } from 'next/server';
import { stakingPointsService } from '@/lib/services/staking-points-service';
import type { HexAddress } from '@/lib/staking-contract';

/**
 * Banked staking points for a wallet — read-only.
 * Live (still-staked) accrual is derived client-side from chain timestamps;
 * this endpoint only reports what has been settled at unstake time.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const walletParam = request.nextUrl.searchParams.get('wallet') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletParam)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
  }
  const wallet = walletParam.toLowerCase() as HexAddress;

  try {
    const banked = await stakingPointsService.bankedTotal(wallet);
    return NextResponse.json({ banked });
  } catch (err) {
    console.error('[staking-points] banked lookup failed:', (err as Error).message);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 502 });
  }
}
