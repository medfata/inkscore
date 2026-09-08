// One-off diagnostic: measure the cold latency of every ScoreInputs gather
// for a single wallet, mimicking gatherScoreInputs() (parallel batch, each
// input individually timed). Run: npx tsx scripts/score-timing.ts <wallet>
import 'dotenv/config';

const wallet = (process.argv[2] || '0x8655df35818f348ea4e371a613e73677d816f589').toLowerCase();

async function timed<T>(label: string, p: Promise<T>): Promise<[string, number, T | null]> {
  const start = Date.now();
  try {
    const v = await p;
    return [label, Date.now() - start, v];
  } catch (err) {
    console.warn(`  [${label}] failed: ${(err as Error).message}`);
    return [label, Date.now() - start, null];
  }
}

async function main() {
  const { walletStatsService } = await import('../src/services/wallet-stats-service');
  const { getBridgeVolume } = await import('../src/services/bridge-service');
  const { getSwapVolume } = await import('../src/services/swap-service');
  const { getTydroData } = await import('../src/services/tydro-service');
  const { getNft2meData } = await import('../src/services/nft2me-service');
  const { getZnsMetrics, getShelliesJoinedRaffles, getShelliesPayToPlay, getShelliesStaking, getTemplarsBalance, getZenithNft, getZenithStaking, getInkBrokersMetrics } = await import('../src/services/analytics-counts-service');
  const { getGmCount, getInkypumpCreatedTokens, getInkypumpBuyVolume, getInkypumpSellVolume, getCowswapSwaps, getMintCount } = await import('../src/services/analytics-metrics-service');
  const { sweepService } = await import('../src/services/sweep-service');
  const { getNadoMetrics } = await import('../src/services/nado-service');
  const { getCopinkMetrics } = await import('../src/services/copink-service');
  const { getGoneFishinData } = await import('../src/services/gonefishin-service');
  const { getSentryData } = await import('../src/services/sentry-service');
  const { getHypercallData } = await import('../src/services/hypercall-service');
  const { openSeaService } = await import('../src/services/opensea-service');

  const jobs: Array<[string, Promise<unknown>]> = [
    ['wallet-stats', walletStatsService.getAllStats(wallet)],
    ['bridge', getBridgeVolume(wallet)],
    ['swap', getSwapVolume(wallet)],
    ['tydro', getTydroData(wallet)],
    ['nft2me', getNft2meData(wallet)],
    ['zns', getZnsMetrics(wallet)],
    ['shellies-raffles', getShelliesJoinedRaffles(wallet)],
    ['shellies-pay', getShelliesPayToPlay(wallet)],
    ['shellies-staking', getShelliesStaking(wallet)],
    ['templars', getTemplarsBalance(wallet)],
    ['zenith-nft', getZenithNft(wallet)],
    ['zenith-staking', getZenithStaking(wallet)],
    ['ink-brokers', getInkBrokersMetrics(wallet)],
    ['gm', getGmCount(wallet)],
    ['inkypump-created', getInkypumpCreatedTokens(wallet)],
    ['inkypump-buy', getInkypumpBuyVolume(wallet)],
    ['inkypump-sell', getInkypumpSellVolume(wallet)],
    ['cowswap', getCowswapSwaps(wallet)],
    ['mint', getMintCount(wallet)],
    ['sweep', sweepService.getDeployedCollections(wallet)],
    ['nado', getNadoMetrics(wallet)],
    ['copink', getCopinkMetrics(wallet)],
    ['gonefishin', getGoneFishinData(wallet)],
    ['sentry', getSentryData(wallet)],
    ['hypercall', getHypercallData(wallet)],
    ['opensea-counts', openSeaService.getAllCounts(wallet)],
  ];

  const start = Date.now();
  const results = await Promise.all(jobs.map(([label, p]) => timed(label, p)));
  const total = Date.now() - start;

  console.log(`\n=== Cold gather timings for ${wallet} (parallel batch wall time: ${(total / 1000).toFixed(1)}s) ===`);
  results
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, ms]) => console.log(`  ${label.padEnd(18)} ${(ms / 1000).toFixed(1)}s`));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
