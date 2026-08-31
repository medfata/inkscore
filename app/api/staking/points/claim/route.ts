import { NextRequest, NextResponse } from 'next/server';
import { stakingPointsService } from '@/lib/services/staking-points-service';
import type { HexAddress } from '@/lib/staking-contract';

/**
 * Claim staking points — the ONLY point-crediting path, fired at unstake.
 *
 * POST { wallet, tokenId, txHash }
 *   Settle mode: verify the unstake via the tx receipt (NFT Transfer from
 *   the staking contract back to the wallet) and credit the OPEN anchor row.
 *
 * POST { wallet }
 *   Reconcile mode (self-heal on page visit): settle OPEN anchor rows whose
 *   position has left the contract, verified via stakeInfo state reads.
 *
 * Every settled value derives from tx receipts or chain state; the request
 * body only ever supplies lookup hints. Settlement flips an OPEN row once
 * (WHERE unstaked_at IS NULL), so replays are no-ops.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Per-wallet cooldown — reconcile only; tx-hash settlements run per unique tx. */
const RECONCILE_COOLDOWN_MS = 5_000;
const lastReconcileAt = new Map<string, number>();

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

  try {
    // ---- settle mode ----
    if (typeof body.txHash === 'string' && body.txHash.length > 0) {
      const txHash = body.txHash;
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return NextResponse.json({ error: 'Invalid txHash' }, { status: 400 });
      }
      const tokenId = Number(body.tokenId);
      if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 888) {
        return NextResponse.json({ error: 'Invalid tokenId' }, { status: 400 });
      }
      const result = await stakingPointsService.settleFromTx(wallet, tokenId, txHash as HexAddress);
      const banked = await stakingPointsService.bankedTotal(wallet);
      return NextResponse.json({ banked, settled: result?.settled ?? 0, settledCount: result ? 1 : 0 });
    }

    // ---- reconcile mode ----
    const now = Date.now();
    if (now - (lastReconcileAt.get(wallet) ?? 0) < RECONCILE_COOLDOWN_MS) {
      const banked = await stakingPointsService.bankedTotal(wallet);
      return NextResponse.json({ banked, settledCount: 0, throttled: true });
    }
    lastReconcileAt.set(wallet, now);

    const result = await stakingPointsService.reconcileWallet(wallet);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[staking-points] claim failed:', (err as Error).message);
    return NextResponse.json({ error: 'Claim failed' }, { status: 502 });
  }
}
