// =============================================================================
// inkscore points-accuracy validator
//
// Samples N wallets per leaderboard tier from cached_leaderboard, loads each
// wallet's stored raw ScoreInputs (wallet_metrics_snapshots), and recomputes
// the EXPECTED points with a fully independent re-implementation of every
// tier table (typed from the product spec in POINTS_SYSTEM_UPDATE_COMPLETE.md
// + the how-it-works page). Compares expected vs the engine's breakdown.
//
// Reference data (NOT math) is shared with the engine on purpose: the meme
// token address list, the leaderboard floor and the top-10 bonus set — those
// are inputs, and re-deriving them would only duplicate their data sources.
//
// Run: npx tsx scripts/validate-points.ts [perTier=5] [--chain]
//   --chain  additionally cross-checks on-chain-countable metrics
//            (Templars balance, Zenith held, Zenith staked) against direct
//            RPC reads (informational: a stale snapshot may lag the chain).
// =============================================================================
import 'dotenv/config';
import { createPublicClient, http, defineChain } from 'viem';

const PER_TIER = parseInt(process.argv[2] || '5', 10) || 5;
const DO_CHAIN = process.argv.includes('--chain');

// Mirrors points-service-v2 KNOWN_STALE_WALLETS (floor-clamp exemption).
const KNOWN_STALE_WALLETS = new Set(['0x4c50254dafd191bba2a6e0517c1742caf1426df5']);

const ink = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel.inkonchain.com'] } },
});
const TEMPLARS = '0x46625E7de9894D83fca49E79cB53B5C25550cE99';
const ZENITH_NFT = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';
const ZENITH_STAKING = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6';

// ---------------------------------------------------------------------------
// Independent tier tables (typed from the product spec — NOT imported from
// points-service-v2; a shared bug would hide, duplicated tiers get caught).
// ---------------------------------------------------------------------------
const t = (v: number, ...tiers: Array<[number, number]>): number => {
  for (const [min, pts] of tiers) if (v >= min) return pts;
  return 0;
};
// Native
const expNftCollections = (n: number) => t(n, [10, 400], [5, 250], [3, 150], [1, 50]);
const expTokenHoldings = (usd: number) => t(usd, [10000, 400], [1000, 300], [100, 150], [1, 50]);
const expMemeCoins = (usd: number) => t(usd, [1000, 300], [500, 200], [100, 100], [1, 50]);
const expWalletAge = (d: number) => (d <= 0 ? 0 : t(d, [731, 600], [366, 500], [181, 400], [91, 300], [31, 200], [1, 100]));
const expTotalTx = (n: number) => (n <= 0 ? 0 : t(n, [901, 600], [701, 500], [401, 400], [201, 300], [101, 200], [1, 100]));
// Platforms
const expBridge = (usd: number) => t(usd, [10000, 1000], [5000, 800], [1000, 500], [100, 200], [1, 50]);
const expGm = (n: number) => t(n, [150, 400], [50, 250], [10, 150], [1, 50]);
const expInkyPump = (created: number, vol: number) =>
  (created >= 3 ? 50 : created >= 1 ? 25 : 0) + t(vol, [10000, 350], [1000, 250], [100, 150], [1, 50]);
const expTydroSupply = (usd: number) => t(usd, [50000, 2500], [10000, 2000], [1000, 1200], [100, 500], [1, 100]);
const expTydroBorrow = (usd: number) => t(usd, [25000, 2500], [5000, 2000], [500, 1200], [50, 500], [1, 100]);
const expSwap = (usd: number) => t(usd, [25000, 1000], [10000, 800], [5000, 500], [1000, 200], [1, 50]);
const expShellies = (play: number, stake: number, raffle: number) =>
  t(play, [50, 150], [10, 75], [1, 25]) + t(stake, [5, 150], [3, 100], [1, 50]) + t(raffle, [10, 100], [5, 50], [1, 25]);
const expZns = (deploy: number, gm: number, reg: number) =>
  t(reg, [3, 200], [1, 100]) + t(deploy, [3, 50], [1, 20]) + t(gm, [10, 50], [1, 20]);
const expNft2me = (coll: number, mints: number) =>
  t(coll, [3, 100], [1, 50]) + t(mints, [100, 200], [10, 100], [1, 50]);
const expNadoDeposits = (usd: number) => t(usd, [50000, 2500], [10000, 2000], [1000, 1200], [100, 500], [1, 100]);
const expNadoVolume = (usd: number) => (usd >= 0 ? t(usd, [25000000, 2500], [10000000, 2300], [5000000, 2000], [1000000, 1600], [500000, 1100], [100000, 600], [0, 100]) : 0);
const expCopink = (subs: number, vol: number) =>
  t(vol, [10000, 300], [5000, 250], [1000, 150], [1, 50]) + (subs >= 3 ? 100 : subs >= 1 ? 50 : 0);
const expTemplars = (n: number) => (n >= 3 ? 5400 : n >= 2 ? 4200 : n >= 1 ? 3000 : 0);
const expOpensea = (buys: number, sells: number, mints: number) => {
  const total = buys + sells + mints;
  if (total <= 0) return 0;
  const tier = total >= 6 ? 'gold' : total >= 2 ? 'silver' : 'bronze';
  const p = (cnt: number, g: number, s: number, b: number) => (cnt > 0 ? (tier === 'gold' ? g : tier === 'silver' ? s : b) : 0);
  return p(buys, 2400, 1600, 600) + p(sells, 1600, 1000, 400) + p(mints, 1000, 600, 200);
};
const expCowswap = (usd: number) => (usd > 1000 ? 2000 : usd >= 101 ? 1200 : usd >= 10 ? 400 : 0);
const expSweep = (coll: number, badges: number, streak: number) =>
  t(coll, [6, 350], [2, 250], [1, 100]) + t(badges, [3, 250], [2, 150], [1, 100]) + t(streak, [6, 200], [2, 100], [1, 50]);
const expZenithNft = (n: number) => (n > 8 ? 5000 : n >= 2 ? 2500 : n >= 1 ? 1000 : 0);
const expZenithStaking = (n: number) => (n > 8 ? 6000 : n >= 2 ? 4000 : n >= 1 ? 2000 : 0);
const expSwapVenue = (usd: number) => (usd > 1000 ? 5000 : usd > 100 ? 2500 : usd >= 1 ? 1000 : 0);
const expGonefishin = (games: number) => Math.min(Math.floor(games) || 0, 3) * 500;

// ---------------------------------------------------------------------------
type Check = { key: string; expected: number; actual: number };

// Raw stored-input shape (wallet_metrics_snapshots.inputs). Extra fields may
// exist on old rows — only what the model consumes is declared here.
interface RawInputs {
  walletStats?: { nftCollections?: Array<{ count?: number }>; tokenHoldings?: Array<{ address?: string; usdValue?: number }>; balanceUsd?: number; ageDays?: number; totalTxns?: number };
  bridgeData?: { bridgedInUsd?: number; bridgedOutUsd?: number };
  swapData?: { totalUsd?: number };
  tydroData?: { currentSupplyUsd?: number; currentBorrowUsd?: number };
  gmData?: { total_count?: number };
  inkyPumpCreated?: { total_count?: number };
  inkyPumpBuy?: { total_value?: string };
  inkyPumpSell?: { total_value?: string };
  shelliesRaffles?: { total_count?: number };
  shelliesPayToPlay?: { total_count?: number };
  shelliesStaking?: { total_count?: number };
  znsData?: { deploy_count?: number; say_gm_count?: number; register_domain_count?: number };
  nft2meData?: { collectionsCreated?: number; nftsMinted?: number };
  nadoData?: { totalDeposits?: number; nadoVolumeUSD?: number };
  copinkData?: { subaccountsFound?: number; totalVolume?: number };
  templarsData?: { value?: number };
  mintData?: { total_count?: number };
  cowSwapData?: { total_value?: string };
  sweepData?: { totalCollections?: number; sweepBadgeBalance?: number; totalStreak?: number };
  zenithNftData?: { total_count?: number };
  zenithStakingData?: { total_count?: number };
  gonefishinData?: { gamesBought?: number };
  sentryData?: { volumeUsd?: number };
  hypercallData?: { usdgSpent?: number };
  inkBrokersData?: { swap_volume_usd?: number };
  openSeaCounts?: { buys: number; sales: number; mints: number };
}

async function main() {
  const { query } = await import('../src/db');
  const { pointsServiceV2 } = await import('../src/services/points-service-v2');
  const { pool } = await import('../src/db');

  // Reference data shared with the engine (data, not math).
  const memeTokens = await (pointsServiceV2 as unknown as { getMemeTokenAddresses(): Promise<Set<string>> }).getMemeTokenAddresses();
  const leaderboard = (await query<{ leaderboard_data: Array<{ wallet_address: string; score: string | number; rank: string }> }>(
    'SELECT leaderboard_data FROM cached_leaderboard WHERE id = 1'
  ))[0]?.leaderboard_data ?? [];
  const floors = new Map<string, number>();
  for (const e of leaderboard) floors.set(e.wallet_address.toLowerCase(), Number(e.score) || 0);
  const top10 = new Set(
    [...leaderboard].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)).slice(0, 10).map(e => e.wallet_address.toLowerCase())
  );
  console.log(`leaderboard entries: ${leaderboard.length}, tiers: ${[...new Set(leaderboard.map(e => e.rank))].join(', ')}\n`);

  // Sample wallets: top N by score within each leaderboard rank tier.
  const byTier = new Map<string, Array<{ wallet: string; score: number }>>();
  for (const e of leaderboard) {
    const w = e.wallet_address.toLowerCase();
    if (!w.startsWith('0x')) continue;
    const arr = byTier.get(e.rank) ?? [];
    arr.push({ wallet: w, score: Number(e.score) || 0 });
    byTier.set(e.rank, arr);
  }
  const sampled: Array<{ wallet: string; tier: string }> = [];
  for (const [tier, arr] of [...byTier.entries()].sort((a, b) => b[1][0].score - a[1][0].score)) {
    arr.sort((a, b) => b.score - a.score);
    for (const s of arr.slice(0, PER_TIER)) sampled.push({ wallet: s.wallet, tier });
  }
  console.log(`sampling ${sampled.length} wallets (${PER_TIER}/tier)\n`);

  let checks = 0, mismatches = 0;
  const failures: string[] = [];
  const chainDrift: string[] = [];
  let chainChecks = 0, chainBad = 0;

  let publicClient: ReturnType<typeof createPublicClient> | null = null;
  if (DO_CHAIN) {
    publicClient = createPublicClient({ chain: ink, transport: http() });
  }

  for (const { wallet, tier } of sampled) {
    const snapRow = (
      await query<{ inputs: Record<string, unknown>; captured_at: string }>(
        `SELECT inputs, captured_at FROM wallet_metrics_snapshots
          WHERE wallet = $1 AND partial = false
          ORDER BY captured_at DESC LIMIT 1`,
        [wallet]
      )
    )[0];
    if (!snapRow) {
      console.log(`✗ ${wallet} [${tier}] — no complete snapshot, skipped`);
      continue;
    }
    const inputs = snapRow.inputs as never;
    const ageH = ((Date.now() - new Date(snapRow.captured_at).getTime()) / 3_600_000).toFixed(1);

    // ACTUAL: the engine's own pure math over the exact stored inputs.
    const actual = await pointsServiceV2.computeScoreFromInputs(wallet, inputs);

    // EXPECTED: independent model.
    const s = snapRow.inputs as RawInputs;
    const st = s.walletStats ?? {};
    const tokenHoldings = st.tokenHoldings ?? [];
    const allHoldings = [...tokenHoldings, { address: '0x0', usdValue: Number(st.balanceUsd) || 0 }];
    const nonMemeUsd = allHoldings.filter(h => !memeTokens.has((h.address || '').toLowerCase())).reduce((a, b) => a + (Number(b.usdValue) || 0), 0);
    const memeUsd = tokenHoldings.filter(h => memeTokens.has((h.address || '').toLowerCase())).reduce((a, b) => a + (Number(b.usdValue) || 0), 0);
    const pumpBuy = parseFloat(s.inkyPumpBuy?.total_value || '0') || 0;
    const pumpSell = parseFloat(s.inkyPumpSell?.total_value || '0') || 0;
    const cowUsd = parseFloat(s.cowSwapData?.total_value || '0') || 0;

    const expNative: Record<string, number> = {
      nft_collections: expNftCollections((st.nftCollections ?? []).reduce((a, c) => a + (c.count || 0), 0)),
      erc20_tokens: expTokenHoldings(nonMemeUsd),
      meme_coins: expMemeCoins(memeUsd),
      wallet_age: expWalletAge(st.ageDays ?? 0),
      total_tx: expTotalTx(st.totalTxns ?? 0),
    };
    const expPlatforms: Record<string, number> = {
      bridge_in: expBridge(s.bridgeData?.bridgedInUsd || 0),
      bridge_out: expBridge(s.bridgeData?.bridgedOutUsd || 0),
      gm: expGm(s.gmData?.total_count || 0),
      inkypump: expInkyPump(s.inkyPumpCreated?.total_count || 0, pumpBuy + pumpSell),
      tydro: expTydroSupply(s.tydroData?.currentSupplyUsd || 0) + expTydroBorrow(s.tydroData?.currentBorrowUsd || 0),
      swap: expSwap(s.swapData?.totalUsd || 0),
      shellies: expShellies(s.shelliesPayToPlay?.total_count || 0, s.shelliesStaking?.total_count || 0, s.shelliesRaffles?.total_count || 0),
      zns: expZns(s.znsData?.deploy_count || 0, s.znsData?.say_gm_count || 0, s.znsData?.register_domain_count || 0),
      nft2me: expNft2me(s.nft2meData?.collectionsCreated || 0, s.nft2meData?.nftsMinted || 0),
      nado: expNadoDeposits(s.nadoData?.totalDeposits || 0) + expNadoVolume(s.nadoData?.nadoVolumeUSD ?? -1),
      copink: expCopink(s.copinkData?.subaccountsFound || 0, s.copinkData?.totalVolume || 0),
      templars: expTemplars(s.templarsData?.value || 0),
      opensea: expOpensea(s.openSeaCounts?.buys || 0, s.openSeaCounts?.sales || 0, s.mintData?.total_count || 0),
      cowswap: expCowswap(cowUsd),
      sweep: expSweep(s.sweepData?.totalCollections || 0, s.sweepData?.sweepBadgeBalance || 0, s.sweepData?.totalStreak || 0),
      zenith_nft: expZenithNft(s.zenithNftData?.total_count || 0),
      zenith_staking: expZenithStaking(s.zenithStakingData?.total_count || 0),
      hypercall: expSwapVenue(s.hypercallData?.usdgSpent || 0),
      sentry: expSwapVenue(s.sentryData?.volumeUsd || 0),
      ink_brokers: expSwapVenue(s.inkBrokersData?.swap_volume_usd || 0),
      gonefishin: expGonefishin(s.gonefishinData?.gamesBought || 0),
    };

    const walletChecks: Check[] = [];
    for (const [k, exp] of Object.entries(expNative)) {
      const act = actual.breakdown.native[k]?.points ?? 0;
      walletChecks.push({ key: `native.${k}`, expected: exp, actual: act });
    }
    for (const [k, exp] of Object.entries(expPlatforms)) {
      const act = actual.breakdown.platforms[k]?.points ?? 0;
      // Presence check: expected>0 must exist in the actual breakdown.
      walletChecks.push({ key: `platforms.${k}`, expected: exp, actual: act });
    }
    const bonusExpected = top10.has(wallet) ? 0 : 2000;
    walletChecks.push({ key: 'platforms.bonus_1000', expected: bonusExpected, actual: actual.breakdown.platforms['bonus_1000']?.points ?? 0 });

    let raw = 900 + [...Object.values(expNative), ...Object.values(expPlatforms), bonusExpected].reduce((a, b) => a + b, 0);
    const floor = floors.get(wallet);
    const expectedTotal = KNOWN_STALE_WALLETS.has(wallet) || floor === undefined || floor === null ? raw : Math.max(raw, floor);
    walletChecks.push({ key: 'TOTAL', expected: expectedTotal, actual: actual.total_points });

    const bad = walletChecks.filter(c => c.expected !== c.actual);
    checks += walletChecks.length;
    mismatches += bad.length;
    const flag = bad.length === 0 ? '✓' : '✗';
    console.log(`${flag} ${wallet} [${tier}] snapshot ${ageH}h old — ${walletChecks.length - bad.length}/${walletChecks.length} checks ok, total ${actual.total_points}`);
    for (const b of bad) {
      failures.push(`  ${wallet} [${tier}] ${b.key}: expected ${b.expected}, got ${b.actual}`);
      console.log(`    ✗ ${b.key}: expected ${b.expected}, got ${b.actual}`);
    }

    // Optional on-chain cross-check (informational — snapshot may lag chain).
    if (publicClient) {
      const owner = wallet as `0x${string}`;
      try {
        const [templarsBal, zenithBal, staked] = await Promise.all([
          publicClient.readContract({ address: TEMPLARS as `0x${string}`, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [owner] }),
          publicClient.readContract({ address: ZENITH_NFT as `0x${string}`, abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const, functionName: 'balanceOf', args: [owner] }),
          publicClient.readContract({ address: ZENITH_STAKING as `0x${string}`, abi: [{ type: 'function', name: 'stakedTokensOf', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256[]' }] }] as const, functionName: 'stakedTokensOf', args: [owner] }),
        ]);
        const chain = { templars: Number(templarsBal), zenith: Number(zenithBal), staked: staked.length };
        const snapCounts = {
          templars: s.templarsData?.value ?? null,
          zenith: s.zenithNftData?.total_count ?? null,
          staked: s.zenithStakingData?.total_count ?? null,
        };
        for (const k of Object.keys(chain) as Array<keyof typeof chain>) {
          chainChecks++;
          if (snapCounts[k] !== null && snapCounts[k] !== chain[k]) {
            chainBad++;
            chainDrift.push(`  ${wallet} [${tier}] ${k}: snapshot=${snapCounts[k]}, chain=${chain[k]} (snapshot ${ageH}h old)`);
          }
        }
      } catch (e) {
        console.log(`    (chain check failed for ${wallet}: ${(e as Error).message})`);
      }
    }
  }

  console.log('\n================ POINTS ACCURACY ================');
  console.log(`tier-math checks: ${checks - mismatches}/${checks} ok  →  accuracy ${(100 * (checks - mismatches) / Math.max(checks, 1)).toFixed(3)}%`);
  if (DO_CHAIN) {
    console.log(`on-chain count checks: ${chainChecks - chainBad}/${chainChecks} match (drift usually = snapshot age vs live chain)`);
    for (const d of chainDrift.slice(0, 10)) console.log(d);
  }
  if (failures.length) {
    console.log(`\nMISMATCHES (${failures.length}):`);
    for (const f of failures.slice(0, 30)) console.log(f);
  } else {
    console.log('All tier tables, the 900 base, the bonus and the total match the independent model. ✓');
  }
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
