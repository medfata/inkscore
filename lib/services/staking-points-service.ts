/**
 * Staking points service — anchor at stake, settle at unstake.
 *
 * The deployed staking contract emits `Staked(...)` but NEVER emits its
 * declared `Unstaked` event (verified on-chain), so settlement cannot use
 * event-log scanning (the public RPC also caps eth_getLogs ranges at 10k
 * blocks — any history scan breaks within ~40 minutes of chain growth).
 *
 * Instead, everything is derived from *transaction receipts* and *state
 * reads* — plain RPC primitives with no range limits:
 *
 *  1. ANCHOR (right after the stake tx confirms): decode the stake tx
 *     receipt → `Staked` event (user, tokenId, period, stakedAt, unlockAt)
 *     → insert an OPEN position row. No points are credited yet.
 *  2. SETTLE (right after the unstake tx confirms): decode the unstake tx
 *     receipt → ERC-721 `Transfer` FROM the staking contract TO the wallet
 *     with the matching tokenId — that transfer IS the unstake proof — and
 *     take the receipt block timestamp as unstakedAt. Credit the award to
 *     the open anchor row (full award: the contract reverts unstake before
 *     unlock; prorated only if somehow earlier).
 *  3. RECONCILE (page visit, no tx): for every OPEN anchor row, read
 *     `stakeInfo(tokenId)` state — if the position vanished, settle it.
 *
 * Security: every value is decoded from signed transaction receipts or
 * chain state; the client only ever supplies wallet/tokenId/txHash hints.
 * Unique (token_id, staked_at) makes anchors idempotent; settlement only
 * ever flips an OPEN row (WHERE unstaked_at IS NULL), so replays no-op.
 */

import { createPublicClient, http, parseAbi, parseEventLogs } from 'viem';
import { query, queryOne } from '@/lib/db';
import {
  INK_RPC_URL,
  STAKING_ABI,
  STAKING_CONTRACT_ADDRESS,
  STAKING_EVENTS_ABI,
  ZENITH_NFT_ADDRESS,
  type HexAddress,
} from '@/lib/staking-contract';
import { awardForPeriod, round2 } from '@/lib/staking-points';

/** ERC-721 Transfer — the unstake proof inside the unstake tx receipt. */
const ERC721_TRANSFER_EVENT = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const DECODE_ABI = [...ERC721_TRANSFER_EVENT, ...STAKING_EVENTS_ABI] as const;

function client() {
  return createPublicClient({
    // retryCount 1 — don't amplify provider 429s with viem's default backoff
    transport: http(INK_RPC_URL, { timeout: 15_000, retryCount: 1 }),
  });
}

interface AnchorRow {
  id: number;
  token_id: number;
  points_award: string;
  staked_at_sec: number;
  unlock_at_sec: number;
}

/* ----------------------- log-decoding helpers ----------------------- */

function isAddress(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

function argAddress(args: unknown, key: string): string | null {
  const value = (args as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'string' ? value.toLowerCase() : null;
}

function argBigint(args: unknown, key: string): bigint | null {
  const value = (args as Record<string, unknown> | undefined)?.[key];
  return typeof value === 'bigint' ? value : null;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export class StakingPointsService {
  /** Banked (settled) points for a wallet. */
  async bankedTotal(wallet: HexAddress): Promise<number> {
    const row = await queryOne<{ banked: number }>(
      `SELECT COALESCE(SUM(points_settled), 0)::float8 AS banked
         FROM staking_points
        WHERE wallet_address = $1 AND unstaked_at IS NOT NULL`,
      [wallet]
    );
    return row?.banked ?? 0;
  }

  /**
   * ANCHOR — verify the stake tx receipt and record the OPEN position.
   * Idempotent: a repeated call for the same stake no-ops on conflict.
   */
  async anchorFromTx(
    wallet: HexAddress,
    tokenId: number,
    txHash: HexAddress
  ): Promise<{ anchored: boolean }> {
    const c = client();
    const receipt = await c.getTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({ abi: DECODE_ABI, logs: receipt.logs, strict: false });

    const staked = events.find(
      (ev) =>
        ev.eventName === 'Staked' &&
        isAddress(ev.address, STAKING_CONTRACT_ADDRESS) &&
        argAddress(ev.args, 'user') === wallet &&
        argBigint(ev.args, 'tokenId') === BigInt(tokenId)
    );
    if (!staked) return { anchored: false };

    const args = staked.args as { period: number | bigint; stakedAt: bigint; unlockAt: bigint };
    const award = awardForPeriod(Number(args.period));
    if (award === null || !(BigInt(args.unlockAt) > BigInt(args.stakedAt))) {
      return { anchored: false };
    }

    await query(
      `INSERT INTO staking_points
         (wallet_address, token_id, lock_period, staked_at, unlock_at, points_award, tx_hash)
       VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5), $6, $7)
       ON CONFLICT (token_id, staked_at) DO NOTHING`,
      [wallet, tokenId, Number(args.period), Number(args.stakedAt), Number(args.unlockAt), award, txHash]
    );
    return { anchored: true };
  }

  /**
   * SETTLE — verify the unstake via the tx receipt (NFT Transfer from the
   * staking contract back to the wallet) and credit the open anchor row.
   */
  async settleFromTx(
    wallet: HexAddress,
    tokenId: number,
    txHash: HexAddress
  ): Promise<{ settled: number } | null> {
    const c = client();
    const receipt = await c.getTransactionReceipt({ hash: txHash });
    const events = parseEventLogs({ abi: DECODE_ABI, logs: receipt.logs, strict: false });

    const unstakeTransfer = events.find(
      (ev) =>
        ev.eventName === 'Transfer' &&
        isAddress(ev.address, ZENITH_NFT_ADDRESS) &&
        argAddress(ev.args, 'from') === STAKING_CONTRACT_ADDRESS.toLowerCase() &&
        argAddress(ev.args, 'to') === wallet &&
        argBigint(ev.args, 'tokenId') === BigInt(tokenId)
    );
    if (!unstakeTransfer) return null; // this tx is not an unstake of that token

    const block = await c.getBlock({ blockNumber: receipt.blockNumber });
    const unstakedAtSec = Number(block.timestamp);

    const row = await queryOne<AnchorRow>(
      `SELECT id, token_id, points_award,
              EXTRACT(EPOCH FROM staked_at)::int AS staked_at_sec,
              EXTRACT(EPOCH FROM unlock_at)::int AS unlock_at_sec
         FROM staking_points
        WHERE wallet_address = $1 AND token_id = $2 AND unstaked_at IS NULL
        ORDER BY staked_at DESC
        LIMIT 1`,
      [wallet, tokenId]
    );
    if (!row) return { settled: 0 }; // unstake verified, but no anchor to credit

    const award = Number(row.points_award);
    const settled =
      unstakedAtSec >= row.unlock_at_sec
        ? award
        : round2(
            (award * Math.max(0, unstakedAtSec - row.staked_at_sec)) /
              Math.max(1, row.unlock_at_sec - row.staked_at_sec)
          );

    const updated = await query<{ id: number }>(
      `UPDATE staking_points
          SET unstaked_at = to_timestamp($1), points_settled = $2, settled_at = now()
        WHERE id = $3 AND unstaked_at IS NULL
        RETURNING id`,
      [unstakedAtSec, settled, row.id]
    );
    return { settled: updated.length > 0 ? settled : 0 };
  }

  /**
   * RECONCILE — settle OPEN anchor rows whose position left the contract
   * (unstaked while the page was closed), verified by `stakeInfo` state.
   * Rows still staked stay open. Idempotent per row.
   */
  async reconcileWallet(wallet: HexAddress): Promise<{ banked: number; settledCount: number }> {
    const rows = await query<AnchorRow>(
      `SELECT id, token_id, points_award,
              EXTRACT(EPOCH FROM staked_at)::int AS staked_at_sec,
              EXTRACT(EPOCH FROM unlock_at)::int AS unlock_at_sec
         FROM staking_points
        WHERE wallet_address = $1 AND unstaked_at IS NULL`,
      [wallet]
    );

    const c = client();
    const nowSec = Math.floor(Date.now() / 1000);
    let settledCount = 0;

    for (const row of rows) {
      const result = await c.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'stakeInfo',
        args: [BigInt(row.token_id)],
      });
      const [depositor] = result;
      if (typeof depositor === 'string' && depositor.toLowerCase() === wallet) {
        continue; // still staked — nothing to settle
      }

      const award = Number(row.points_award);
      const settled =
        nowSec >= row.unlock_at_sec
          ? award
          : round2(
              (award * Math.max(0, nowSec - row.staked_at_sec)) /
                Math.max(1, row.unlock_at_sec - row.staked_at_sec)
            );
      const updated = await query<{ id: number }>(
        `UPDATE staking_points
            SET unstaked_at = to_timestamp($1), points_settled = $2, settled_at = now()
          WHERE id = $3 AND unstaked_at IS NULL
          RETURNING id`,
        [nowSec, settled, row.id]
      );
      settledCount += updated.length;
    }

    return { banked: await this.bankedTotal(wallet), settledCount };
  }
}

/** Singleton (repo convention — see other services in /lib/services). */
export const stakingPointsService = new StakingPointsService();
