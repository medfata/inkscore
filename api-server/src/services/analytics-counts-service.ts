import { getLongCache, setLongCache, withInflight } from '../cache';
import { getProtocolCount, getProtocolTxHashes, getTxLogs, getTxData, partitionTxHashes } from './blockscout-service';
import { createPublicClient, http } from 'viem';
import { defineChain } from 'viem';

// ============================================
// Contract addresses and constants
// (moved verbatim from routes/analytics.ts)
// ============================================

// Shellies contract addresses and methods
const SHELLIES_RAFFLE_CONTRACTS = [
  '0x47a27a42525fff2b7264b342f74216e37a831332',
  '0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de'
];
const SHELLIES_PAY_TO_PLAY_CONTRACT = '0x57d287dc46cb0782c4bce1e4e964cc52083bb358';
const SHELLIES_STAKING_CONTRACT = '0xb39a48d294e1530a271e712b7a19243679d320d0';

// Templars of the Storm NFT contract address
const TEMPLARS_NFT_CONTRACT_ADDRESS = '0x46625E7de9894D83fca49E79cB53B5C25550cE99';

// ZNS tracking config
const ZNS_CONFIG = {
  deploy: { contract: '0x63c489d31a2c3de0638360931f47ff066282473f', functions: ['Deploy', 'deploy'] },
  sayGm: { contract: '0x3033d7ded400547d6442c55159da5c61f2721633', functions: ['SayGM', 'sayGM'] },
  register: { contract: '0xfb2cd41a8aec89efbb19575c6c48d872ce97a0a5', functions: ['RegisterDomains', 'registerDomains'] },
};

// Define Ink Chain for viem (Mainnet)
const inkChain = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
  blockExplorers: {
    default: { name: 'Routescan', url: 'https://explorer.inkonchain.com' },
  },
});

// Create viem public client for Ink Chain
const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(),
});

// ERC721 balanceOf ABI
const ERC721_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const TEMPLARS_LONG_CACHE_TTL = 5 * 60 * 1000;

interface TemplarsResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  value: number;
  total_count: number;
  total_value: string;
  sub_aggregates: unknown[];
  last_updated: Date;
}

// InkScore Zenith NFT collection contract address
const ZENITH_NFT_CONTRACT_ADDRESS = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';
// InkScore Zenith staking contract address
const ZENITH_STAKING_CONTRACT_ADDRESS = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6';
const ZENITH_LONG_CACHE_TTL = 5 * 60 * 1000;
// Hard cap on per-token stakeInfo reads for the staking breakdown
const ZENITH_MAX_STAKED_TOKENS = 100;

// InkScore Zenith staking view functions
const ZENITH_STAKING_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'stakedTokensOf',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'stakeInfo',
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'stakedAt', type: 'uint256' },
      { name: 'unlockTimestamp', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface ZenithNftBalanceResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_value: string;
  sub_aggregates: unknown[];
  last_updated: Date;
}

interface ZenithStakingResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_staked: number;
  one_month_count: number;
  one_week_count: number;
  one_day_count: number;
  sub_aggregates: Array<{ label: string; value: string }>;
  last_updated: Date;
}

// ============================================
// GET /api/analytics/:wallet/zns
// ============================================
export async function getZnsMetrics(walletLower: string) {
  // Counts via Blockscout (single batched query per action, no method
  // selectors needed — resolved by decoded method name).
  const [deployRes, sayGmRes, registerRes] = await Promise.all([
    getProtocolCount(walletLower, 'zns-deploy', ZNS_CONFIG.deploy.contract, null, ZNS_CONFIG.deploy.functions),
    getProtocolCount(walletLower, 'zns-saygm', ZNS_CONFIG.sayGm.contract, null, ZNS_CONFIG.sayGm.functions),
    getProtocolCount(walletLower, 'zns-register', ZNS_CONFIG.register.contract, null, ZNS_CONFIG.register.functions),
  ]);

  const deployCount = deployRes.count;
  const sayGmCount = sayGmRes.count;
  const registerCount = registerRes.count;

  const result = {
    slug: 'zns',
    name: 'ZNS Connect',
    currency: 'COUNT',
    total_count: deployCount + sayGmCount + registerCount,
    deploy_count: deployCount,
    say_gm_count: sayGmCount,
    register_domain_count: registerCount,
    last_updated: new Date(),
  };

  return result;
}

// ============================================
// shellies_joined_raffles (counts via Blockscout)
// ============================================
export async function getShelliesJoinedRaffles(walletLower: string) {
  const [r1, r2] = await Promise.all([
    getProtocolCount(walletLower, 'shellies-raffle-1', SHELLIES_RAFFLE_CONTRACTS[0], null, ['JoinRaffle', 'joinRaffle']),
    getProtocolCount(walletLower, 'shellies-raffle-2', SHELLIES_RAFFLE_CONTRACTS[1], null, ['JoinRaffle', 'joinRaffle']),
  ]);
  const count = r1.count + r2.count;

  const result = {
    slug: 'shellies_joined_raffles',
    name: 'Joined Raffles',
    icon: '🎟️',
    currency: 'COUNT',
    total_count: count,
    total_value: count.toString(),
    sub_aggregates: [],
    last_updated: new Date(),
  };

  return result;
}

// ============================================
// shellies_pay_to_play (counts via Blockscout)
// ============================================
export async function getShelliesPayToPlay(walletLower: string) {
  const pc = await getProtocolCount(walletLower, 'shellies-pay', SHELLIES_PAY_TO_PLAY_CONTRACT, null, ['PayToPlay', 'payToPlay']);
  const count = pc.count;

  const result = {
    slug: 'shellies_pay_to_play',
    name: 'Pay to Play',
    icon: '🎮',
    currency: 'COUNT',
    total_count: count,
    total_value: count.toString(),
    sub_aggregates: [],
    last_updated: new Date(),
  };

  return result;
}

// ============================================
// shellies_staking (counts via Blockscout; the
// legacy 0x1e332260 selector resolves to its decoded name on-chain)
// ============================================
export async function getShelliesStaking(walletLower: string) {
  // Fallback to transaction count (contract read not available in Express server)
  const pc = await getProtocolCount(walletLower, 'shellies-staking', SHELLIES_STAKING_CONTRACT, ['0x1e332260'], ['StakeBatch', 'stakeBatch']);
  const count = pc.count;

  const result = {
    slug: 'shellies_staking',
    name: 'Staking',
    icon: '🔒',
    currency: 'COUNT',
    total_count: count,
    total_value: count.toString(),
    sub_aggregates: [],
    last_updated: new Date(),
  };

  return result;
}

// ============================================
// templars_nft_balance - blockchain read operation
// ============================================
export async function getTemplarsBalance(walletLower: string): Promise<TemplarsResult> {
  // Single RPC call (~0.9s) and a slow-moving balance: dedup + 5-min cache.
  const templarsLcKey = `long:analytics:templars_nft_balance:${walletLower}`;
  const templarsLc = getLongCache<TemplarsResult>(templarsLcKey, TEMPLARS_LONG_CACHE_TTL);
  if (templarsLc) {
    return templarsLc;
  }
  return await withInflight<TemplarsResult>(templarsLcKey, async (): Promise<TemplarsResult> => {
    try {
      // First, try ERC721 balanceOf
      let balance: bigint;
      try {
        balance = await publicClient.readContract({
          address: TEMPLARS_NFT_CONTRACT_ADDRESS as `0x${string}`,
          abi: ERC721_BALANCE_OF_ABI,
          functionName: 'balanceOf',
          args: [walletLower as `0x${string}`],
        });
      } catch (erc721Error) {
        // If ERC721 fails, try ERC1155 balanceOf (requires token ID)
        // For now, we'll just return 0 and log the error
        console.error('Error reading ERC721 balanceOf for Templars NFT:', erc721Error);

        // Check if contract exists by trying to get code
        const code = await publicClient.getBytecode({
          address: TEMPLARS_NFT_CONTRACT_ADDRESS as `0x${string}`,
        });

        if (!code || code === '0x') {
          console.error(`Contract does not exist at ${TEMPLARS_NFT_CONTRACT_ADDRESS} on Ink mainnet`);
        }

        // Return 0 balance
        balance = BigInt(0);
      }

      const count = Number(balance);

      const result = {
        slug: 'templars_nft_balance',
        name: 'Templars of the Storm',
        icon: '⚔️',
        currency: 'COUNT',
        value: count,
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      setLongCache(templarsLcKey, result);
      return result;
    } catch (error) {
      console.error('Error fetching Templars NFT balance:', error);
      // Return 0 balance on error instead of failing
      const result = {
        slug: 'templars_nft_balance',
        name: 'Templars of the Storm',
        icon: '⚔️',
        currency: 'COUNT',
        value: 0,
        total_count: 0,
        total_value: '0',
        sub_aggregates: [],
        last_updated: new Date(),
      };
      return result;
    }
  });
}

// ============================================
// zenith_nft_balance - blockchain read operation
// (InkScore Zenith ERC721 holdings for the wallet). No points for now.
// ============================================
export async function getZenithNft(walletLower: string): Promise<ZenithNftBalanceResult> {
  const zenithLcKey = `long:analytics:zenith_nft_balance:${walletLower}`;
  const zenithLc = getLongCache<ZenithNftBalanceResult>(zenithLcKey, ZENITH_LONG_CACHE_TTL);
  if (zenithLc) {
    return zenithLc;
  }
  return await withInflight<ZenithNftBalanceResult>(zenithLcKey, async (): Promise<ZenithNftBalanceResult> => {
    try {
      const balance = await publicClient.readContract({
        address: ZENITH_NFT_CONTRACT_ADDRESS as `0x${string}`,
        abi: ERC721_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [walletLower as `0x${string}`],
      });

      const count = Number(balance);

      const result: ZenithNftBalanceResult = {
        slug: 'zenith_nft_balance',
        name: 'InkScore Zenith',
        icon: 'https://i2c.seadn.io/collection/inkscore-zenith/image_type_logo/831152ff66038d827191d68d3d66b9/2f831152ff66038d827191d68d3d66b9.png?h=250&w=250',
        currency: 'COUNT',
        total_count: count,
        total_value: count.toString(),
        sub_aggregates: [],
        last_updated: new Date(),
      };

      setLongCache(zenithLcKey, result);
      return result;
    } catch (error) {
      console.error('Error fetching InkScore Zenith NFT balance:', error);
      const result: ZenithNftBalanceResult = {
        slug: 'zenith_nft_balance',
        name: 'InkScore Zenith',
        icon: 'https://i2c.seadn.io/collection/inkscore-zenith/image_type_logo/831152ff66038d827191d68d3d66b9/2f831152ff66038d827191d68d3d66b9.png?h=250&w=250',
        currency: 'COUNT',
        total_count: 0,
        total_value: '0',
        sub_aggregates: [],
        last_updated: new Date(),
      };
      return result;
    }
  });
}

// ============================================
// zenith_staking - blockchain read operation
// (InkScore Zenith NFTs staked in the InkScoreStaking contract, broken
//  down by lock period: 1 month / 1 week / 1 day). No points for now.
// ============================================
export async function getZenithStaking(walletLower: string): Promise<ZenithStakingResult> {
  const zenithStakingLcKey = `long:analytics:zenith_staking:${walletLower}`;
  const zenithStakingLc = getLongCache<ZenithStakingResult>(zenithStakingLcKey, ZENITH_LONG_CACHE_TTL);
  if (zenithStakingLc) {
    return zenithStakingLc;
  }
  return await withInflight<ZenithStakingResult>(zenithStakingLcKey, async (): Promise<ZenithStakingResult> => {
    const emptyResult = (): ZenithStakingResult => ({
      slug: 'zenith_staking',
      name: 'InkScore Zenith Staking',
      icon: '/inkscore_logo.png',
      currency: 'COUNT',
      total_count: 0,
      total_staked: 0,
      one_month_count: 0,
      one_week_count: 0,
      one_day_count: 0,
      sub_aggregates: [
        { label: '1 Month Lock', value: '0' },
        { label: '1 Week Lock', value: '0' },
        { label: '1 Day Lock', value: '0' },
      ],
      last_updated: new Date(),
    });

    try {
      const tokenIds = await publicClient.readContract({
        address: ZENITH_STAKING_CONTRACT_ADDRESS as `0x${string}`,
        abi: ZENITH_STAKING_ABI,
        functionName: 'stakedTokensOf',
        args: [walletLower as `0x${string}`],
      });

      const totalStaked = tokenIds.length;          if (totalStaked === 0) {
        const result = emptyResult();
        setLongCache(zenithStakingLcKey, result);
        return result;
      }

      // Read each staked token's stake info to classify by lock period.
      // LockPeriod durations: Day = 1 day (86400s), Week = 7 days
      // (604800s), Month = 30 days (2592000s).
      const cappedTokenIds = tokenIds.slice(0, ZENITH_MAX_STAKED_TOKENS);
      const stakeInfos = await Promise.all(
        cappedTokenIds.map((tokenId) =>
          publicClient.readContract({
            address: ZENITH_STAKING_CONTRACT_ADDRESS as `0x${string}`,
            abi: ZENITH_STAKING_ABI,
            functionName: 'stakeInfo',
            args: [tokenId],
          })
        )
      );

      let oneMonthCount = 0;
      let oneWeekCount = 0;
      let oneDayCount = 0;
      for (const [, stakedAt, unlockTimestamp] of stakeInfos) {
        const lockDuration = Number(unlockTimestamp) - Number(stakedAt);
        if (lockDuration >= 2592000) oneMonthCount++;
        else if (lockDuration >= 604800) oneWeekCount++;
        else oneDayCount++;
      }

      const result: ZenithStakingResult = {
        slug: 'zenith_staking',
        name: 'InkScore Zenith Staking',
        icon: '/inkscore_logo.png',
        currency: 'COUNT',
        total_count: totalStaked,
        total_staked: totalStaked,
        one_month_count: oneMonthCount,
        one_week_count: oneWeekCount,
        one_day_count: oneDayCount,
        sub_aggregates: [
          { label: '1 Month Lock', value: oneMonthCount.toString() },
          { label: '1 Week Lock', value: oneWeekCount.toString() },
          { label: '1 Day Lock', value: oneDayCount.toString() },
        ],
        last_updated: new Date(),
      };

      setLongCache(zenithStakingLcKey, result);
      return result;
    } catch (error) {
      console.error('Error fetching InkScore Zenith staking metrics:', error);
      const result = emptyResult();
      return result;
    }
  });
}

// ============================================
// ink_brokers - Ink Brokers desk activity
// (clock-ins + claims via Blockscout counts; active seats/tiers via
//  on-chain seat reads on BrokerDesk). No points for now.
// ============================================

// BrokerDesk: activation ("clock in"), distributions, claims
const INK_BROKERS_DESK_CONTRACT = '0xDe773cf5e6973e29aff7e7125fB4dF21BbdE713E';
// Ink Brokers ERC-721 collection (4,444 brokers)
const INK_BROKERS_NFT_CONTRACT = '0x0e4aa738d2cbe8c1f3d4e46a1f1af33611365a5f';

const INK_BROKERS_CONFIG = {
  clockIn: { contract: INK_BROKERS_DESK_CONTRACT, functions: ['ClockIn', 'clockIn'] },
  claim: { contract: INK_BROKERS_DESK_CONTRACT, functions: ['Claim', 'claim'] },
};

// FloorRouterV2 (verified on explorer) - the Ink Brokers swap venue: buys
// route ETH -> WETH -> USDG -> asset, sells reverse. USDG is the routing
// asset in every tx, so each trade prices at its max USDG leg. Missed until
// 2026-09-07 (the card only counted desk actions).
const INK_BROKERS_FLOOR_ROUTER = '0xb3e8165984a91cf4001057ca646ee2e3a547cdf8';
// buy / sell - selectors extracted from verified tx inputs.
const INK_BROKERS_FLOOR_SELECTORS = ['0x646c4451', '0x64027ecd'];
const INK_BROKERS_USDG = '0xe343167631d89b6ffc58b88d6b7fb0228795491d';
const INK_BROKERS_MAX_SWAPS_PRICED = 1000;

const INK_BROKERS_LONG_CACHE_TTL = 5 * 60 * 1000;
// Hard cap on per-token seat reads (a wallet holding more brokers than
// this still counts clock-ins/claims fully; seat detail is capped).
const INK_BROKERS_MAX_SEAT_READS = 25;
// Hard cap on Blockscout NFT-holding pages walked for the wallet
const INK_BROKERS_MAX_NFT_PAGES = 3;
// Hard cap on clock-in txs whose logs get parsed for token ids
const INK_BROKERS_MAX_CLOCKIN_TXS = 100;

// ClockedIn(uint256 indexed tokenId, address indexed holder, address account, uint8 tier, uint256 weight, uint256 burned)
const INK_BROKERS_CLOCKED_IN_TOPIC = '0xb797fb3d5840101cfa696d7e1d829b700ec7aab206251d0db059fe82be386f65';

// BrokerDesk.seats(tokenId) => (holder, active, tier, at)
const INK_BROKERS_DESK_ABI = [
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'seats',
    outputs: [
      { name: 'holder', type: 'address' },
      { name: 'active', type: 'bool' },
      { name: 'tier', type: 'uint8' },
      { name: 'at', type: 'uint64' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: '', type: 'uint256' }],
    name: 'seatValid',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const INK_BROKERS_TIER_NAMES: Record<number, string> = {
  0: 'Intern',
  1: 'Analyst',
  2: 'Associate',
  3: 'VP',
  4: 'Partner',
};

interface InkBrokersResult {
  slug: string;
  name: string;
  icon: string;
  currency: string;
  total_count: number;
  total_value: string;
  clock_in_count: number;
  claim_count: number;
  owned_brokers: number;
  active_seats: number;
  swap_count: number;
  swap_volume_usd: number;
  seat_tiers: Array<{ label: string; value: string }>;
  sub_aggregates: Array<{ label: string; value: string }>;
  last_updated: Date;
}

// Fetch the wallet's Ink Brokers token ids from Blockscout NFT holdings.
// The collection is not ERC721Enumerable, so ids come from the explorer.
async function getInkBrokersTokenIds(walletLower: string): Promise<string[]> {
  const ids: string[] = [];
  let next: Record<string, unknown> | null = null;
  for (let page = 0; page < INK_BROKERS_MAX_NFT_PAGES; page++) {
    const url = new URL(`https://explorer.inkonchain.com/api/v2/addresses/${walletLower}/nft`);
    url.searchParams.set('type', 'ERC-721');
    if (next) {
      for (const [k, v] of Object.entries(next)) url.searchParams.set(k, String(v));
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) break;
    const j = (await r.json()) as {
      items?: Array<{ token?: { address_hash?: string }; id?: string }>;
      next_page_params?: Record<string, unknown> | null;
    };
    for (const item of j.items || []) {
      if (item.token?.address_hash?.toLowerCase() === INK_BROKERS_NFT_CONTRACT && item.id != null) {
        ids.push(item.id);
      }
    }
    next = j.next_page_params ?? null;
    if (!next) break;
  }
  return ids;
}

// Second id source: token ids the wallet clocked in, parsed from the
// ClockedIn event topic1 of its desk txs (getProtocolTxHashes + getTxLogs
// are both cursor-cached). Covers Blockscout's NFT-holdings indexing lag on
// fresh transfers — the desk's seat data is the on-chain source of truth
// anyway, so extra ids from past clock-ins are harmless (seatValid gates).
async function getInkBrokersClockedInTokenIds(walletLower: string): Promise<string[]> {
  const { hashes } = await getProtocolTxHashes(
    walletLower,
    INK_BROKERS_DESK_CONTRACT,
    null,
    ['ClockIn', 'clockIn'],
    10,
    'out'
  );
  if (hashes.length === 0) return [];
  const logsMap = await getTxLogs(hashes.slice(0, INK_BROKERS_MAX_CLOCKIN_TXS));
  const ids = new Set<string>();
  for (const logs of logsMap.values()) {
    for (const log of logs) {
      if (
        log.address?.toLowerCase() === INK_BROKERS_DESK_CONTRACT.toLowerCase() &&
        log.topics?.[0] === INK_BROKERS_CLOCKED_IN_TOPIC &&
        log.topics[1] &&
        log.topics[1] !== '0x' + '0'.repeat(64)
      ) {
        ids.add(BigInt(log.topics[1]).toString());
      }
    }
  }
  return [...ids];
}

export async function getInkBrokersMetrics(walletLower: string): Promise<InkBrokersResult> {
  const lcKey = `long:analytics:ink_brokers:${walletLower}`;
  const lc = getLongCache<InkBrokersResult>(lcKey, INK_BROKERS_LONG_CACHE_TTL);
  if (lc) {
    return lc;
  }
  return await withInflight<InkBrokersResult>(lcKey, async (): Promise<InkBrokersResult> => {
    const emptyResult = (): InkBrokersResult => ({
      slug: 'ink_brokers',
      name: 'Ink Brokers',
      icon: '🏛️',
      currency: 'COUNT',
      total_count: 0,
      total_value: '0',
      clock_in_count: 0,
      claim_count: 0,
      owned_brokers: 0,
      active_seats: 0,
      swap_count: 0,
      swap_volume_usd: 0,
      seat_tiers: [],
      sub_aggregates: [],
      last_updated: new Date(),
    });

    try {
      // Desk tx counts via Blockscout (cursor-cached; incremental after first visit)
      const [clockInRes, claimRes, tokenIds, clockedInIds, floorSwaps] = await Promise.all([
        getProtocolCount(walletLower, 'inkbrokers-clockin', INK_BROKERS_CONFIG.clockIn.contract, null, INK_BROKERS_CONFIG.clockIn.functions),
        getProtocolCount(walletLower, 'inkbrokers-claim', INK_BROKERS_CONFIG.claim.contract, null, INK_BROKERS_CONFIG.claim.functions),
        getInkBrokersTokenIds(walletLower),
        getInkBrokersClockedInTokenIds(walletLower).catch(() => [] as string[]),
        getProtocolTxHashes(walletLower, INK_BROKERS_FLOOR_ROUTER, INK_BROKERS_FLOOR_SELECTORS).catch((err: unknown) => {
          console.warn('[InkBrokers] FloorRouter swap discovery failed:', err instanceof Error ? err.message : err);
          return { hashes: [] as string[], complete: false };
        }),
      ]);

      // FloorRouterV2 buys+sells: USD volume = max USDG routing leg per tx
      // (the wallet sees ETH in / asset out, or the reverse - the USDG leg
      // carries the notional).
      let swapCount = 0;
      let swapVolumeUsd = 0;
      if (floorSwaps.hashes.length > 0) {
        const { cached: cachedHashes, uncached } = await partitionTxHashes(floorSwaps.hashes);
        const priced = [...cachedHashes, ...uncached.slice(0, INK_BROKERS_MAX_SWAPS_PRICED)];
        const txData = await getTxData(priced);
        for (const h of priced) {
          const d = txData.get(h);
          if (!d || d.meta.ok === false) continue;
          let txUsdg = 0;
          for (const leg of d.legs) {
            if (leg.tokenAddress.toLowerCase() === INK_BROKERS_USDG) {
              txUsdg = Math.max(txUsdg, leg.amount);
            }
          }
          swapCount++;
          swapVolumeUsd += txUsdg;
        }
      }

      // Union both id sources (holdings first, then clock-in history) and
      // read the desk's seat state per token. seatValid(tokenId) is the
      // on-chain truth: seat.active AND holderOf(tokenId) == seat.holder —
      // a seat dies the moment the broker NFT moves, even before the seat
      // row is cleared.
      const idSet = new Set<string>([...tokenIds, ...clockedInIds]);
      const allIds = [...idSet];
      const seatReadIds = allIds.slice(0, INK_BROKERS_MAX_SEAT_READS);
      let activeSeats = 0;
      const tierCounts: Record<string, number> = {};
      if (seatReadIds.length > 0) {
        const seats = await Promise.all(
          seatReadIds.map((tokenId) =>
            Promise.all([
              publicClient
                .readContract({
                  address: INK_BROKERS_DESK_CONTRACT as `0x${string}`,
                  abi: INK_BROKERS_DESK_ABI,
                  functionName: 'seats',
                  args: [BigInt(tokenId)],
                })
                .catch(() => null),
              publicClient
                .readContract({
                  address: INK_BROKERS_DESK_CONTRACT as `0x${string}`,
                  abi: INK_BROKERS_DESK_ABI,
                  functionName: 'seatValid',
                  args: [BigInt(tokenId)],
                })
                .catch(() => false),
            ])
          )
        );
        for (const [seat, valid] of seats) {
          if (!seat || !valid) continue;
          const tier = seat[2];
          activeSeats++;
          const tierName = INK_BROKERS_TIER_NAMES[Number(tier)] ?? `T${Number(tier)}`;
          tierCounts[tierName] = (tierCounts[tierName] ?? 0) + 1;
        }
      }

      const clockInCount = clockInRes.count;
      const claimCount = claimRes.count;

      const seatTiers = Object.entries(tierCounts).map(([label, value]) => ({ label, value: String(value) }));

      const result: InkBrokersResult = {
        slug: 'ink_brokers',
        name: 'Ink Brokers',
        icon: '🏛️',
        currency: 'COUNT',
        total_count: clockInCount + claimCount,
        total_value: (clockInCount + claimCount).toString(),
        clock_in_count: clockInCount,
        claim_count: claimCount,
        owned_brokers: allIds.length,
        active_seats: activeSeats,
        swap_count: swapCount,
        swap_volume_usd: Math.round(swapVolumeUsd * 100) / 100,
        seat_tiers: seatTiers,
        sub_aggregates: [
          { label: 'Clock-ins', value: clockInCount.toString() },
          { label: 'Claims', value: claimCount.toString() },
          { label: 'Active Seats', value: activeSeats.toString() },
          ...seatTiers.map((t) => ({ label: `${t.label} Seats`, value: t.value })),
        ],
        last_updated: new Date(),
      };

      setLongCache(lcKey, result);
      return result;
    } catch (error) {
      console.error('Error fetching Ink Brokers metrics:', error);
      return emptyResult();
    }
  });
}
