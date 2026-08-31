import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pad, toEventSelector, toHex } from 'viem';
import { stakingPointsService } from '../staking-points-service';

/* ------------------------------ mocks ------------------------------ */

const mocks = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(),
  getBlock: vi.fn(),
  readContract: vi.fn(),
  query: vi.fn(),
  queryOne: vi.fn(),
}));

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual, // keep parseEventLogs/encodeEventLogs/parseAbi real
    createPublicClient: vi.fn(() => ({
      getTransactionReceipt: mocks.getTransactionReceipt,
      getBlock: mocks.getBlock,
      readContract: mocks.readContract,
    })),
    http: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
}));

/* ---------------------------- fixtures ----------------------------- */

const STAKING = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6';
const ZENITH = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';
const WALLET = '0x24e1fb6dc66ebfd52adda097aa323980a3aad106';
const OTHER = '0x9999fb6dc66ebfd52adda097aa323980a3999999';
const TX = '0xabded65b15ffd9b2d0a24abfe3be370082957a0aa1ccb8e75705e290d4a3be64' as const;

const TRANSFER_SIG = toEventSelector('Transfer(address,address,uint256)');
const STAKED_SIG = toEventSelector('Staked(address,uint256,uint8,uint256,uint256)');

const STAKED_AT = BigInt(1_000_000);
const DAY = BigInt(86_400);
const UNLOCK_AT = STAKED_AT + DAY;

const topicAddr = (addr: string) => pad(addr as `0x${string}`);
const topicUint = (n: bigint | number) => pad(toHex(BigInt(n)));

/** Zenith Transfer log with an explicit emitting contract address. */
function transferLog(from: string, to: string, tokenId: number, address: string) {
  return {
    address,
    topics: [TRANSFER_SIG, topicAddr(from), topicAddr(to), topicUint(tokenId)],
    data: '0x',
  };
}

/** Staking-contract Staked log — data carries (period, stakedAt, unlockAt). */
function stakedLog(user: string, tokenId: number, period = 0) {
  return {
    address: STAKING,
    topics: [STAKED_SIG, topicAddr(user), topicUint(tokenId)],
    data: `${topicUint(period)}${topicUint(STAKED_AT).slice(2)}${topicUint(UNLOCK_AT).slice(2)}`,
  };
}

const OPEN_ROW = {
  id: 1,
  token_id: 482,
  points_award: '5',
  staked_at_sec: Number(STAKED_AT),
  unlock_at_sec: Number(UNLOCK_AT),
};

/* ------------------------------- anchor ---------------------------- */

describe('anchorFromTx', () => {
  beforeEach(() => {
    [mocks.getTransactionReceipt, mocks.getBlock, mocks.readContract, mocks.query, mocks.queryOne].forEach((m) => m.mockReset());
  });

  it('records an open position from a verified stake receipt', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(WALLET, STAKING, 482, ZENITH), stakedLog(WALLET, 482, 0)],
    });
    mocks.query.mockResolvedValue([]);

    const result = await stakingPointsService.anchorFromTx(WALLET, 482, TX);

    expect(result).toEqual({ anchored: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('ON CONFLICT (token_id, staked_at) DO NOTHING');
    expect(params).toEqual([WALLET, 482, 0, Number(STAKED_AT), Number(UNLOCK_AT), 5, TX]);
  });

  it('rejects a Staked event signed by a different wallet', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(OTHER, STAKING, 482, ZENITH), stakedLog(OTHER, 482, 0)],
    });

    const result = await stakingPointsService.anchorFromTx(WALLET, 482, TX);

    expect(result).toEqual({ anchored: false });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects an unknown lock period instead of guessing the award', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [stakedLog(WALLET, 482, 9)],
    });

    const result = await stakingPointsService.anchorFromTx(WALLET, 482, TX);

    expect(result).toEqual({ anchored: false });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

/* ------------------------------- settle ---------------------------- */

describe('settleFromTx', () => {
  beforeEach(() => {
    [mocks.getTransactionReceipt, mocks.getBlock, mocks.readContract, mocks.query, mocks.queryOne].forEach((m) => m.mockReset());
  });

  it('credits the full award when the NFT returns to the wallet at/after unlock', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(STAKING, WALLET, 482, ZENITH)],
      blockNumber: BigInt(123),
    });
    mocks.getBlock.mockResolvedValue({ timestamp: UNLOCK_AT });
    mocks.queryOne.mockResolvedValue(OPEN_ROW);
    mocks.query.mockResolvedValue([{ id: 1 }]);

    const result = await stakingPointsService.settleFromTx(WALLET, 482, TX);

    expect(result).toEqual({ settled: 5 });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('unstaked_at IS NULL');
    expect(params[0]).toBe(Number(UNLOCK_AT));
    expect(params[1]).toBe(5);
  });

  it('returns null when the tx is not an unstake of that token', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(WALLET, OTHER, 482, ZENITH)], // outgoing sale, not unstake
      blockNumber: BigInt(123),
    });

    const result = await stakingPointsService.settleFromTx(WALLET, 482, TX);

    expect(result).toBeNull();
    expect(mocks.getBlock).not.toHaveBeenCalled();
  });

  it('credits 0 when the unstake is verified but no anchor row exists', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(STAKING, WALLET, 482, ZENITH)],
      blockNumber: BigInt(123),
    });
    mocks.getBlock.mockResolvedValue({ timestamp: UNLOCK_AT });
    mocks.queryOne.mockResolvedValue(null);

    const result = await stakingPointsService.settleFromTx(WALLET, 482, TX);

    expect(result).toEqual({ settled: 0 });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('prorates a position that left the contract before unlock', async () => {
    mocks.getTransactionReceipt.mockResolvedValue({
      logs: [transferLog(STAKING, WALLET, 482, ZENITH)],
      blockNumber: BigInt(123),
    });
    mocks.getBlock.mockResolvedValue({ timestamp: STAKED_AT + DAY / BigInt(4) });
    mocks.queryOne.mockResolvedValue(OPEN_ROW);
    mocks.query.mockResolvedValue([{ id: 1 }]);

    const result = await stakingPointsService.settleFromTx(WALLET, 482, TX);

    expect(result).toEqual({ settled: 1.25 });
  });
});

/* ------------------------------ reconcile -------------------------- */

describe('reconcileWallet', () => {
  beforeEach(() => {
    [mocks.getTransactionReceipt, mocks.getBlock, mocks.readContract, mocks.query, mocks.queryOne].forEach((m) => m.mockReset());
  });

  it('leaves open rows whose position is still staked', async () => {
    mocks.query.mockResolvedValue([OPEN_ROW]); // open rows select
    mocks.readContract.mockResolvedValue([WALLET, STAKED_AT, UNLOCK_AT]); // still staked
    mocks.queryOne.mockResolvedValue({ banked: 0 });

    const result = await stakingPointsService.reconcileWallet(WALLET);

    expect(result).toEqual({ banked: 0, settledCount: 0 });
    expect(mocks.query).toHaveBeenCalledTimes(1); // only the SELECT
  });

  it('settles vanished positions at the full award once unlock has passed', async () => {
    mocks.query
      .mockResolvedValueOnce([OPEN_ROW]) // open rows select
      .mockResolvedValueOnce([{ id: 1 }]); // UPDATE returning
    mocks.readContract.mockResolvedValue([
      '0x0000000000000000000000000000000000000000',
      STAKED_AT,
      UNLOCK_AT,
    ]);
    mocks.queryOne.mockResolvedValue({ banked: 5 });

    const result = await stakingPointsService.reconcileWallet(WALLET);

    expect(result).toEqual({ banked: 5, settledCount: 1 });
    const [, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(params[1]).toBe(5); // full award (unlock already passed)
  });
});

/* ----------------------------- bankedTotal -------------------------- */

describe('stakingPointsService.bankedTotal', () => {
  beforeEach(() => {
    mocks.queryOne.mockReset();
  });

  it('sums settled points for the wallet', async () => {
    mocks.queryOne.mockResolvedValue({ banked: 65 });
    const total = await stakingPointsService.bankedTotal(WALLET);
    expect(total).toBe(65);
    expect(mocks.queryOne.mock.calls[0][0]).toContain('SUM(points_settled)');
  });

  it('treats a missing row as zero', async () => {
    mocks.queryOne.mockResolvedValue(null);
    const total = await stakingPointsService.bankedTotal(OTHER);
    expect(total).toBe(0);
  });
});
