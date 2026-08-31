/**
 * Backfill staking-points ANCHORS for currently-staked positions.
 *
 * The anchor/settle system records an open position row when a stake tx
 * confirms (page flow). Stakes made before that system existed have no
 * anchor — without one, their points can never be credited at unstake.
 * This script finds every still-live staked position on-chain and emits
 * idempotent anchor INSERTs.
 *
 * Verification (defence in depth — a row is only anchored when BOTH agree):
 *   1. `Staked` event history (chunked scan — the public RPC caps
 *      eth_getLogs ranges at 10k blocks, so windows of 9.5k blocks).
 *   2. Live `stakeInfo(tokenId)` state: depositor must equal the event's
 *      user AND stakedAt must equal the event's stakedAt. This filters out
 *      unstaked / re-staked cycles whose events are stale.
 *
 * Plan awards come from STAKING_DURATIONS (0=5, 1=15, 2=50 — single source
 * of truth shared with the UI and the settle service), and each position's
 * lock duration is cross-checked against the plan table.
 *
 * Usage:
 *   npx tsx scripts/backfill-staking-anchors.ts                # print SQL
 *   npx tsx scripts/backfill-staking-anchors.ts --execute      # run against DATABASE_URL
 *
 * `--execute` inserts via pg using DATABASE_URL — point it at the local
 * test DB or hand the printed SQL to prod psql over SSH.
 */

import { createPublicClient, http, parseAbi } from 'viem';
import { Pool } from 'pg';
import { STAKING_DURATIONS } from '../lib/staking-contract';

const STAKING = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6' as const;
const DEPLOY_BLOCK = BigInt(54_589_499); // contracts/deployed-staking.json
const RPC = process.env.INK_RPC_URL ?? 'https://rpc-gel.inkonchain.com';
const CHUNK = BigInt(9_500); // stay under the RPC's 10k getLogs range cap
const DURATION_TOLERANCE_SEC = 60;

const ABI = parseAbi([
  'event Staked(address indexed user, uint256 indexed tokenId, uint8 period, uint256 stakedAt, uint256 unlockAt)',
  'function stakeInfo(uint256 tokenId) view returns (address depositor, uint256 stakedAt, uint256 unlockAt)',
]);

interface Candidate {
  tokenId: string;
  wallet: string; // lowercased
  period: number;
  stakedAtSec: number;
  unlockAtSec: number;
  txHash: string | null;
}

function planFor(period: number) {
  return STAKING_DURATIONS.find((d) => d.index === period) ?? null;
}

async function scanStakedEvents(): Promise<Candidate[]> {
  const client = createPublicClient({
    transport: http(RPC, { retryCount: 1, timeout: 20_000 }),
  });
  const head = await client.getBlockNumber();
  console.log(`chain head: ${head}`);

  const candidates: Candidate[] = [];
  for (let from = DEPLOY_BLOCK; from <= head; from += CHUNK) {
    const to = from + CHUNK - BigInt(1) > head ? head : from + CHUNK - BigInt(1);
    const logs = await client.getLogs({
      address: STAKING,
      event: ABI[0],
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const user = typeof log.args.user === 'string' ? log.args.user.toLowerCase() : null;
      const tokenId = log.args.tokenId !== undefined ? log.args.tokenId.toString() : null;
      if (!user || !tokenId) continue;
      candidates.push({
        tokenId,
        wallet: user,
        period: Number(log.args.period ?? -1),
        stakedAtSec: Number(log.args.stakedAt ?? 0),
        unlockAtSec: Number(log.args.unlockAt ?? 0),
        txHash: log.transactionHash ?? null,
      });
    }
  }
  return candidates;
}

async function verifyLive(client: ReturnType<typeof createPublicClient>, c: Candidate): Promise<boolean> {
  const [depositor, stakedAt] = await client.readContract({
    address: STAKING,
    abi: ABI,
    functionName: 'stakeInfo',
    args: [BigInt(c.tokenId)],
  });
  return (
    typeof depositor === 'string' &&
    depositor.toLowerCase() === c.wallet &&
    BigInt(stakedAt) === BigInt(c.stakedAtSec)
  );
}

async function main() {
  const execute = process.argv.includes('--execute');
  const client = createPublicClient({
    transport: http(RPC, { retryCount: 1, timeout: 20_000 }),
  });

  const events = await scanStakedEvents();
  console.log(`Staked events found: ${events.length}\n`);

  const anchors: Array<Candidate & { award: number; planLabel: string }> = [];
  let verified = 0;

  for (const c of events) {
    const plan = planFor(c.period);
    if (!plan) {
      console.warn(`SKIP token ${c.tokenId} (${c.wallet}): unknown LockPeriod ${c.period}`);
      continue;
    }
    // Cross-check the on-chain duration against the plan table.
    const durationSec = c.unlockAtSec - c.stakedAtSec;
    if (Math.abs(plan.seconds - durationSec) > DURATION_TOLERANCE_SEC) {
      console.warn(
        `WARN token ${c.tokenId}: duration ${durationSec}s does not match plan ${plan.label} (${plan.seconds}s) — anchoring with the event's period anyway`
      );
    }

    let live = false;
    try {
      live = await verifyLive(client, c);
    } catch (err) {
      console.warn(`SKIP token ${c.tokenId} (${c.wallet}): stakeInfo read failed — ${(err as Error).message}`);
      continue;
    }
    if (!live) {
      console.log(`SKIP token ${c.tokenId} (${c.wallet}): no longer staked at this position (stale event)`);
      continue;
    }
    verified += 1;
    anchors.push({ ...c, award: plan.points, planLabel: plan.label });
  }

  console.log(`\nLive positions to anchor: ${verified}\n`);

  const escape = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const statements = anchors.map(
    (a) =>
      `INSERT INTO staking_points\n  (wallet_address, token_id, lock_period, staked_at, unlock_at, points_award, tx_hash)\nVALUES (${escape(a.wallet)}, ${Number(a.tokenId)}, ${a.period}, to_timestamp(${a.stakedAtSec}), to_timestamp(${a.unlockAtSec}), ${a.award}, ${a.txHash ? escape(a.txHash) : 'NULL'})\nON CONFLICT (token_id, staked_at) DO NOTHING;`
  );

  // Human-readable summary
  for (const a of anchors) {
    const unlockDate = new Date(a.unlockAtSec * 1000).toISOString();
    console.log(
      `  ${a.wallet} · token ${a.tokenId} · ${a.planLabel} (${a.award} pts) · unlocks ${unlockDate}`
    );
  }
  const totalPts = anchors.reduce((sum, a) => sum + a.award, 0);
  console.log(`\nTotal pending points to become anchorable: ${totalPts}\n`);

  console.log(statements.join('\n\n'));

  if (execute) {
    if (!process.env.DATABASE_URL) {
      console.error('\n--execute requires DATABASE_URL');
      process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      let inserted = 0;
      for (const sql of statements) {
        const res = await pool.query(sql.replace(/;$/, ' RETURNING id'));
        inserted += res.rowCount ?? 0;
      }
      console.log(`\nExecuted against DATABASE_URL — ${inserted} anchor row(s) inserted.`);
    } finally {
      await pool.end();
    }
  } else if (statements.length > 0) {
    console.log('\n(print mode — re-run with --execute and DATABASE_URL to insert)');
  }
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
