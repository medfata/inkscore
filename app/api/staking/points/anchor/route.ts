import { NextRequest, NextResponse } from 'next/server';
import { stakingPointsService } from '@/lib/services/staking-points-service';
import type { HexAddress } from '@/lib/staking-contract';

/**
 * Anchor a staking position — fired right after a STAKE tx confirms.
 *
 * POST { wallet, tokenId, txHash }
 *
 * The server decodes the stake tx receipt (Staked event + inbound NFT
 * Transfer), verifies it against the wallet, and records an OPEN position
 * row. No points are credited here — they bank at unstake (claim).
 * Idempotent: repeated calls for the same stake no-op (unique constraint).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let body: { wallet?: unknown; tokenId?: unknown; txHash?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const walletParam = typeof body.wallet === 'string' ? body.wallet : '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(walletParam)) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 });
  }
  const wallet = walletParam.toLowerCase() as HexAddress;

  const txHash = typeof body.txHash === 'string' ? body.txHash : '';
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'Invalid txHash' }, { status: 400 });
  }

  const tokenId = Number(body.tokenId);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 888) {
    return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
  }

  try {
    const result = await stakingPointsService.anchorFromTx(wallet, tokenId, txHash as HexAddress);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[staking-points] anchor failed:', (err as Error).message);
    return NextResponse.json({ error: 'Anchor failed' }, { status: 502 });
  }
}
