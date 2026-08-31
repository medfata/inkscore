/**
 * Diagnostic: dump every staking-contract event since deployment and run the
 * same pairing logic as the points service, so we can see exactly what a
 * claim for each wallet should have settled.
 *
 * Run: npx tsx scripts/diagnose-staking-points.ts
 */
import { createPublicClient, http, parseAbi } from 'viem';

const STAKING = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6';
const DEPLOY_BLOCK = BigInt(54_589_499);
const RPC = 'https://rpc-gel.inkonchain.com';

const ABI = parseAbi([
  'event Staked(address indexed user, uint256 indexed tokenId, uint8 period, uint256 stakedAt, uint256 unlockAt)',
  'event Unstaked(address indexed user, uint256 indexed tokenId, uint256 unstakedAt)',
  'event EmergencyUnstaked(uint256 indexed tokenId, address indexed returnedTo)',
]);

async function getLogsChunked(
  client: ReturnType<typeof createPublicClient>,
  event: typeof ABI[number],
  wallet?: string
) {
  const head = await client.getBlockNumber();
  const CHUNK = BigInt(9500);
  const all: Array<{ blockNumber: bigint; logIndex: number | null; transactionHash: string | null; args: Record<string, unknown> }> = [];
  for (let from = DEPLOY_BLOCK; from <= head; from += CHUNK) {
    const to = from + CHUNK - BigInt(1) > head ? head : from + CHUNK - BigInt(1);
    const logs = await client.getLogs({
      address: STAKING,
      event,
      ...(wallet ? { args: { user: wallet as `0x${string}` } } : {}),
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      all.push({
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? null,
        transactionHash: log.transactionHash ?? null,
        args: (log.args ?? {}) as Record<string, unknown>,
      });
    }
  }
  return all;
}

async function main() {
  const client = createPublicClient({
    transport: http(RPC, { retryCount: 1, timeout: 20_000 }),
  });

  const latest = await client.getBlockNumber();
  console.log(`chain head: ${latest}`);

  const staked = await getLogsChunked(client, ABI[0]);
  const unstaked = await getLogsChunked(client, ABI[1]);
  const emergency = await getLogsChunked(client, ABI[2]);

  console.log(`\nStaked events: ${staked.length}`);
  for (const log of staked) {
    const a = log.args;
    console.log(
      `  token ${a.tokenId} user ${a.user} period ${a.period} stakedAt ${a.stakedAt} unlockAt ${a.unlockAt} ` +
      `block ${log.blockNumber} tx ${log.transactionHash}`
    );
  }

  console.log(`\nUnstaked events: ${unstaked.length}`);
  for (const log of unstaked) {
    const a = log.args;
    console.log(
      `  token ${a.tokenId} user ${a.user} unstakedAt ${a.unstakedAt} block ${log.blockNumber} tx ${log.transactionHash}`
    );
  }

  console.log(`\nEmergencyUnstaked events: ${emergency.length}`);
  for (const log of emergency) {
    const a = log.args;
    console.log(`  token ${a.tokenId} returnedTo ${a.returnedTo} block ${log.blockNumber}`);
  }

  // Per-wallet pairing summary (FIFO per token — same as the service)
  const wallets = new Set<string>();
  for (const log of staked) if (log.args.user) wallets.add(log.args.user.toLowerCase());
  for (const log of unstaked) if (log.args.user) wallets.add(log.args.user.toLowerCase());

  console.log('\n---- per-wallet settle simulation (AWARD: 0=5, 1=15, 2=50) ----');
  for (const wallet of wallets) {
    const wStaked = staked
      .filter((l) => l.args.user?.toLowerCase() === wallet)
      .map((l) => ({
        tokenId: l.args.tokenId?.toString() ?? '0',
        period: Number(l.args.period ?? -1),
        stakedAtSec: Number(l.args.stakedAt ?? 0),
        unlockAtSec: Number(l.args.unlockAt ?? 0),
        seq: Number(l.blockNumber) * 1_000_000 + (l.logIndex ?? 0),
      }))
      .sort((a, b) => a.seq - b.seq);
    const wUnstaked = unstaked
      .filter((l) => l.args.user?.toLowerCase() === wallet)
      .map((l) => ({
        tokenId: l.args.tokenId?.toString() ?? '0',
        unstakedAtSec: Number(l.args.unstakedAt ?? 0),
        seq: Number(l.blockNumber) * 1_000_000 + (l.logIndex ?? 0),
      }))
      .sort((a, b) => a.seq - b.seq);

    const pending = new Map<string, typeof wStaked>();
    const settled: Array<{ token: string; award: number; settled: number; note: string }> = [];
    let si = 0;
    for (const un of wUnstaked) {
      while (si < wStaked.length && wStaked[si].seq <= un.seq) {
        const s = wStaked[si++];
        const q = pending.get(s.tokenId) ?? [];
        q.push(s);
        pending.set(s.tokenId, q);
      }
      const q = pending.get(un.tokenId);
      if (!q || q.length === 0) {
        settled.push({ token: un.tokenId, award: 0, settled: 0, note: 'ORPHAN unstake (no paired stake)' });
        continue;
      }
      const s = q.shift()!;
      const award = s.period === 0 ? 5 : s.period === 1 ? 15 : s.period === 2 ? 50 : -1;
      const full = un.unstakedAtSec >= s.unlockAtSec;
      const settledPts = full
        ? award
        : Math.round((award * Math.max(0, un.unstakedAtSec - s.stakedAtSec)) / (s.unlockAtSec - s.stakedAtSec) * 100) / 100;
      settled.push({
        token: s.tokenId,
        award,
        settled: settledPts,
        note: full ? 'full (unstaked at/after unlock)' : 'PRORATED (unstaked before unlock)',
      });
    }

    const banked = settled.reduce((sum, r) => sum + (r.settled > 0 ? r.settled : 0), 0);
    console.log(`wallet ${wallet}`);
    for (const r of settled) {
      console.log(`  token ${r.token}: award ${r.award} → settle ${r.settled} (${r.note})`);
    }
    if (settled.length === 0) console.log('  (no unstake cycles)');
    console.log(`  expected banked: ${banked}`);
  }
}

main().catch((err) => {
  console.error('diagnostic failed:', err);
  process.exit(1);
});
