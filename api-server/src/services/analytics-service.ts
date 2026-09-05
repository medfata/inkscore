import { query } from '../db';
import {
  SubAggregate,
  UserAnalyticsResponse,
} from '../types/analytics';
import { getGmCount, getInkypumpBuyVolume, getInkypumpSellVolume } from './analytics-metrics-service';
import { getSwapVolume } from './swap-service';
import { getTydroData } from './tydro-service';
import { getShelliesJoinedRaffles } from './analytics-counts-service';
import { getProtocolCount } from './blockscout-service';

// Response cache for wallet analytics (30 second TTL)
const analyticsCache: Map<string, { data: UserAnalyticsResponse; timestamp: number }> = new Map();
const ANALYTICS_CACHE_TTL = 30 * 1000; // 30 seconds

export class AnalyticsService {
  // ---- Sprint 3: LIVE aggregate -------------------------------------------
  //
  // The indexer-era version aggregated transaction_details — which FROZE the
  // moment the indexers stopped (gm_count stuck at 7 while the live count is
  // 317) — and decoded tx inputs from transaction_enrichment (the 67 GB
  // legacy table). Every metric is now computed from the SAME live,
  // cursored, Blockscout-backed services the score and dashboard cards use:
  // one data path, one source of truth. Values are HIGHER and CURRENT versus
  // the frozen indexer numbers — that is a correction, not a regression.
  //
  // With this rewrite the API has ZERO reads of transaction_details /
  // transaction_enrichment. Slugs, names, icons and currencies mirror the
  // analytics_metrics config rows exactly so the response shape is stable.

  private static readonly METRIC_META: Record<string, { name: string; icon: string | null; currency: string }> = {
    gm_count: { name: 'GM Activity', icon: 'gm', currency: 'COUNT' },
    InkySwap_usd_volume: { name: 'InkySwap Volume (USD)', icon: null, currency: 'USD' },
    tydro_usd_supply: { name: 'Tydro Supply Volume (USD)', icon: '', currency: 'USD' },
    Tydro_usd_borrow: { name: 'Tydro Borrow Volume (USD)', icon: '', currency: 'USD' },
    swap_volume: { name: 'Swap Volume (USD)', icon: '', currency: 'USD' },
    nft_traded: { name: 'Nft Traded', icon: '', currency: 'COUNT' },
    total_raffles_joined: { name: 'Total Raffles Joined', icon: null, currency: 'COUNT' },
    joinraffle: { name: 'joinRaffle', icon: null, currency: 'COUNT' },
    total_inkypump_buy_volume_usd: { name: 'Total Inkypump Buy Volume USD', icon: null, currency: 'USD' },
    total_inkypump_sell_volume_usd: { name: 'Total InkyPump Sell volume usd', icon: null, currency: 'USD' },
  };

  // Swap routers (mirrors swap-service's platform table): InkySwap has its
  // own configured metric; the other three routers form `swap_volume`.
  private static readonly INKYSWAP_ROUTER = '0x551134e92e537ceaa217c2ef63210af3ce96a065';
  private static readonly OTHER_SWAP_ROUTERS = [
    '0xd7e72f3615aa65b92a4dbdc211e296a35512988b', // Curve
    '0x9b17690de96fcfa80a3acaefe11d936629cd7a77', // DyorSwap
    '0x01d40099fcd87c018969b0e8d4ab1633fb34763', // Velodrome
  ];
  private static readonly NFT_MARKET_CONTRACTS = [
    '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5', // Net Protocol
    '0xbd6a027b85fd5285b1623563bbef6fadbe396afb', // Mintiq
    '0x9ebf93fdba9f32accab3d6716322dccd617a78f3', // Squid Market
  ];

  private metricResult(
    slug: string,
    count: number,
    usdValue: number,
    subAggregates: SubAggregate[] = []
  ): UserAnalyticsResponse['metrics'][0] {
    const meta = AnalyticsService.METRIC_META[slug] || { name: slug, icon: null as string | null, currency: 'COUNT' };
    const isUsd = meta.currency === 'USD';
    return {
      slug,
      name: meta.name,
      icon: meta.icon,
      currency: meta.currency,
      total_count: count,
      total_value: isUsd ? usdValue.toFixed(2) : String(count),
      sub_aggregates: subAggregates,
      last_updated: new Date(),
    };
  }

  async getWalletAnalytics(walletAddress: string): Promise<UserAnalyticsResponse> {
    const wallet = walletAddress.toLowerCase();

    // Check cache first
    const cached = analyticsCache.get(wallet);
    if (cached && Date.now() - cached.timestamp < ANALYTICS_CACHE_TTL) {
      return cached.data;
    }

    const [gm, swap, tydro, inkyBuy, inkySell, raffles, netTraded, mintiqTraded, squidTraded] = await Promise.all([
      getGmCount(wallet).catch(() => null),
      getSwapVolume(wallet).catch(() => null),
      getTydroData(wallet).catch(() => null),
      getInkypumpBuyVolume(wallet).catch(() => null),
      getInkypumpSellVolume(wallet).catch(() => null),
      getShelliesJoinedRaffles(wallet).catch(() => null),
      getProtocolCount(wallet, 'nft-traded-net', AnalyticsService.NFT_MARKET_CONTRACTS[0], null).catch(() => null),
      getProtocolCount(wallet, 'nft-traded-mintiq', AnalyticsService.NFT_MARKET_CONTRACTS[1], null).catch(() => null),
      getProtocolCount(wallet, 'nft-traded-squid', AnalyticsService.NFT_MARKET_CONTRACTS[2], null).catch(() => null),
    ]);

    // Per-router swap slices from the swap service's byPlatform breakdown.
    const byRouter = new Map<string, { usd: number; count: number }>();
    for (const p of swap?.byPlatform || []) {
      const addr = (p.contractAddress || '').toLowerCase();
      if (!addr) continue;
      const e = byRouter.get(addr) || { usd: 0, count: 0 };
      e.usd += Number(p.usdValue) || 0;
      e.count += Number(p.txCount) || 0;
      byRouter.set(addr, e);
    }
    const inky = byRouter.get(AnalyticsService.INKYSWAP_ROUTER) || { usd: 0, count: 0 };
    let otherSwaps = { usd: 0, count: 0 };
    const swapSubs: SubAggregate[] = [];
    for (const addr of AnalyticsService.OTHER_SWAP_ROUTERS) {
      const e = byRouter.get(addr) || { usd: 0, count: 0 };
      otherSwaps.usd += e.usd;
      otherSwaps.count += e.count;
      if (e.count > 0) {
        swapSubs.push({ contract_address: addr, count: e.count, eth_value: '0', usd_value: e.usd.toFixed(2) });
      }
    }

    const tradedTotal = (netTraded?.count ?? 0) + (mintiqTraded?.count ?? 0) + (squidTraded?.count ?? 0);
    const tradedSubs: SubAggregate[] = [
      { contract_address: AnalyticsService.NFT_MARKET_CONTRACTS[0], count: netTraded?.count ?? 0, eth_value: '0', usd_value: '0' },
      { contract_address: AnalyticsService.NFT_MARKET_CONTRACTS[1], count: mintiqTraded?.count ?? 0, eth_value: '0', usd_value: '0' },
      { contract_address: AnalyticsService.NFT_MARKET_CONTRACTS[2], count: squidTraded?.count ?? 0, eth_value: '0', usd_value: '0' },
    ];

    const metrics: UserAnalyticsResponse['metrics'] = [
      this.metricResult('gm_count', gm?.total_count ?? 0, 0),
      this.metricResult('InkySwap_usd_volume', inky.count, inky.usd),
      this.metricResult('tydro_usd_supply', tydro?.depositCount ?? 0, tydro?.totalDepositedUsd ?? 0),
      this.metricResult('Tydro_usd_borrow', tydro?.borrowCount ?? 0, tydro?.totalBorrowedUsd ?? 0),
      this.metricResult('swap_volume', otherSwaps.count, otherSwaps.usd, swapSubs),
      this.metricResult('nft_traded', tradedTotal, 0, tradedSubs),
      this.metricResult('total_raffles_joined', raffles?.total_count ?? 0, 0),
      this.metricResult('joinraffle', raffles?.total_count ?? 0, 0),
      this.metricResult('total_inkypump_buy_volume_usd', inkyBuy?.total_count ?? 0, parseFloat(inkyBuy?.total_value || '0')),
      this.metricResult('total_inkypump_sell_volume_usd', inkySell?.total_count ?? 0, parseFloat(inkySell?.total_value || '0')),
    ];

    const result: UserAnalyticsResponse = {
      wallet_address: wallet,
      metrics,
    };

    // Cache the result
    analyticsCache.set(wallet, { data: result, timestamp: Date.now() });

    return result;
  }

  // Single-slug variant for the /api/analytics/:wallet/:metric fallback:
  // computed from the same live services (a full compute is shared-cached —
  // the per-metric services each cache independently, so this is cheap).
  async getWalletMetric(walletAddress: string, metricSlug: string): Promise<UserAnalyticsResponse['metrics'][0] | null> {
    const full = await this.getWalletAnalytics(walletAddress);
    return full.metrics.find((m) => m.slug === metricSlug) || null;
  }
}

export const analyticsService = new AnalyticsService();
