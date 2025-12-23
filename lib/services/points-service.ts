import { query, queryOne } from '../db';
import {
  NativeMetric,
  PointsRule,
  PointsRuleWithRelations,
  PointRange,
  Rank,
  WalletPointsCache,
  WalletPointsBreakdown,
  WalletScoreResponse,
  CreatePointsRuleRequest,
  UpdatePointsRuleRequest,
  CreateRankRequest,
  UpdateRankRequest,
  NativeMetricKey,
} from '../types/platforms';
import { walletStatsService } from './wallet-stats-service';

// Cache for points rules and related data (1 minute TTL - rarely changes)
interface RulesCache {
  rules: PointsRuleWithRelations[];
  nativeMetrics: NativeMetric[];
  ranks: Rank[];
  platformContracts: Map<number, string[]>; // platformId -> contract addresses
  timestamp: number;
}
let rulesCache: RulesCache | null = null;
const RULES_CACHE_TTL = 60 * 1000; // 1 minute

// Helper function to fetch total volume from indexed transactions
async function fetchTotalVolumeUsd(walletAddress: string): Promise<number> {
  try {
    // Get current ETH price
    let ethPrice = 3500;
    try {
      const priceResult = await queryOne<{ price_usd: number }>(
        `SELECT price_usd FROM eth_prices ORDER BY timestamp DESC LIMIT 1`
      );
      ethPrice = priceResult?.price_usd || 3500;
    } catch {
      // Use fallback price
    }

    // Query outgoing transactions (wallet is the sender)
    const outgoingResult = await queryOne<{ total_eth: string }>(
      `SELECT 
         COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as total_eth
       FROM transaction_details
       WHERE wallet_address = $1
         AND status = 1`,
      [walletAddress]
    );

    // Query incoming ETH transfers (WETH token transfers to wallet)
    let incomingEth = 0;
    try {
      const incomingResult = await queryOne<{ total_eth: string }>(
        `SELECT 
           COALESCE(SUM(
             CASE 
               WHEN token_address = '0x4200000000000000000000000000000000000006' 
               THEN COALESCE(amount_decimal, 0)
               ELSE 0 
             END
           ), 0) as total_eth
         FROM transaction_token_transfers
         WHERE to_address = $1`,
        [walletAddress]
      );
      incomingEth = parseFloat(incomingResult?.total_eth || '0');
    } catch {
      // Table might not exist
    }

    const outgoingEth = parseFloat(outgoingResult?.total_eth || '0');
    const totalEth = outgoingEth + incomingEth;
    
    return totalEth * ethPrice;
  } catch (error) {
    console.error('Error fetching total volume:', error);
    return 0;
  }
}

export class PointsService {
  // Invalidate cache (call after create/update/delete operations)
  invalidateCache(): void {
    rulesCache = null;
  }

  // Get cached rules and related data
  private async getCachedRulesData(): Promise<RulesCache> {
    if (rulesCache && Date.now() - rulesCache.timestamp < RULES_CACHE_TTL) {
      return rulesCache;
    }

    // Fetch all data in parallel
    const [rules, nativeMetrics, ranks, platformContractsRows] = await Promise.all([
      this.fetchAllPointsRules(true),
      query<NativeMetric>(`SELECT * FROM native_metrics WHERE is_active = true ORDER BY display_order ASC`),
      query<Rank>(`SELECT * FROM ranks WHERE is_active = true ORDER BY min_points ASC`),
      query<{ platform_id: number; address: string }>(`
        SELECT pc.platform_id, c.address 
        FROM platform_contracts pc
        JOIN contracts c ON c.id = pc.contract_id
      `),
    ]);

    // Build platform contracts map
    const platformContracts = new Map<number, string[]>();
    for (const row of platformContractsRows) {
      const existing = platformContracts.get(row.platform_id) || [];
      existing.push(row.address);
      platformContracts.set(row.platform_id, existing);
    }

    rulesCache = {
      rules,
      nativeMetrics,
      ranks,
      platformContracts,
      timestamp: Date.now(),
    };

    return rulesCache;
  }


  // Internal fetch without cache (used by getCachedRulesData)
  private async fetchAllPointsRules(activeOnly: boolean): Promise<PointsRuleWithRelations[]> {
    const whereClause = activeOnly ? 'WHERE pr.is_active = true' : '';
    
    const rules = await query<PointsRule & { platform_name?: string; native_metric_key?: string }>(`
      SELECT 
        pr.*,
        p.name as platform_name,
        p.slug as platform_slug,
        nm.key as native_metric_key,
        nm.name as native_metric_name
      FROM points_rules pr
      LEFT JOIN platforms p ON pr.platform_id = p.id
      LEFT JOIN native_metrics nm ON pr.native_metric_id = nm.id
      ${whereClause}
      ORDER BY pr.display_order ASC, pr.created_at ASC
    `);

    // For metric-based rules, fetch the associated metrics
    const ruleIds = rules.filter(r => r.metric_type === 'metric').map(r => r.id);
    const metricsMap = new Map<number, Array<{ id: number; name: string; slug: string; aggregation_type: string; currency: string }>>();
    
    if (ruleIds.length > 0) {
      const ruleMetrics = await query<{
        rule_id: number;
        metric_id: number;
        metric_name: string;
        metric_slug: string;
        aggregation_type: string;
        currency: string;
      }>(`
        SELECT 
          prm.rule_id,
          am.id as metric_id,
          am.name as metric_name,
          am.slug as metric_slug,
          am.aggregation_type,
          am.currency
        FROM points_rule_metrics prm
        JOIN analytics_metrics am ON prm.metric_id = am.id
        WHERE prm.rule_id = ANY($1)
      `, [ruleIds]);

      for (const rm of ruleMetrics) {
        const existing = metricsMap.get(rm.rule_id) || [];
        existing.push({
          id: rm.metric_id,
          name: rm.metric_name,
          slug: rm.metric_slug,
          aggregation_type: rm.aggregation_type,
          currency: rm.currency,
        });
        metricsMap.set(rm.rule_id, existing);
      }
    }

    return rules.map(rule => ({
      ...rule,
      ranges: typeof rule.ranges === 'string' ? JSON.parse(rule.ranges) : rule.ranges,
      metrics: metricsMap.get(rule.id) || undefined,
    }));
  }

  // ============================================================================
  // NATIVE METRICS
  // ============================================================================

  async getAllNativeMetrics(activeOnly: boolean = false): Promise<NativeMetric[]> {
    if (activeOnly) {
      const cached = await this.getCachedRulesData();
      return cached.nativeMetrics;
    }
    return query<NativeMetric>(`SELECT * FROM native_metrics ORDER BY display_order ASC`);
  }

  async getNativeMetricByKey(key: string): Promise<NativeMetric | null> {
    return queryOne<NativeMetric>(`SELECT * FROM native_metrics WHERE key = $1`, [key]);
  }

  // ============================================================================
  // POINTS RULES
  // ============================================================================

  async getAllPointsRules(activeOnly: boolean = false): Promise<PointsRuleWithRelations[]> {
    if (activeOnly) {
      const cached = await this.getCachedRulesData();
      return cached.rules;
    }
    return this.fetchAllPointsRules(false);
  }

  async getPointsRuleById(id: number): Promise<PointsRuleWithRelations | null> {
    const rule = await queryOne<PointsRule>(`SELECT * FROM points_rules WHERE id = $1`, [id]);
    if (!rule) return null;

    // For metric-based rules, also fetch the associated metrics
    let metrics: Array<{ id: number; name: string; slug: string; aggregation_type: string; currency: string }> | undefined;
    if (rule.metric_type === 'metric') {
      const ruleMetrics = await query<{
        metric_id: number;
        metric_name: string;
        metric_slug: string;
        aggregation_type: string;
        currency: string;
      }>(`
        SELECT 
          am.id as metric_id,
          am.name as metric_name,
          am.slug as metric_slug,
          am.aggregation_type,
          am.currency
        FROM points_rule_metrics prm
        JOIN analytics_metrics am ON prm.metric_id = am.id
        WHERE prm.rule_id = $1
      `, [id]);

      metrics = ruleMetrics.map(rm => ({
        id: rm.metric_id,
        name: rm.metric_name,
        slug: rm.metric_slug,
        aggregation_type: rm.aggregation_type,
        currency: rm.currency,
      }));
    }

    return {
      ...rule,
      ranges: typeof rule.ranges === 'string' ? JSON.parse(rule.ranges) : rule.ranges,
      metrics,
    };
  }


  async createPointsRule(data: CreatePointsRuleRequest): Promise<PointsRule> {
    this.invalidateCache();
    const result = await queryOne<PointsRule>(`
      INSERT INTO points_rules (
        metric_type, platform_id, native_metric_id, name, description,
        calculation_mode, ranges, display_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      data.metric_type,
      data.metric_type === 'platform' ? data.platform_id : null,
      data.metric_type === 'native' ? data.native_metric_id : null,
      data.name,
      data.description || null,
      data.calculation_mode,
      JSON.stringify(data.ranges),
      data.display_order || 0,
    ]);

    if (!result) throw new Error('Failed to create points rule');

    // For metric-based rules, create the junction table entries
    if (data.metric_type === 'metric' && data.metric_ids && data.metric_ids.length > 0) {
      for (const metricId of data.metric_ids) {
        await query(`
          INSERT INTO points_rule_metrics (rule_id, metric_id)
          VALUES ($1, $2)
          ON CONFLICT (rule_id, metric_id) DO NOTHING
        `, [result.id, metricId]);
      }
    }

    return {
      ...result,
      ranges: data.ranges,
    };
  }

  async updatePointsRule(id: number, data: UpdatePointsRuleRequest): Promise<PointsRule | null> {
    this.invalidateCache();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.calculation_mode !== undefined) {
      updates.push(`calculation_mode = $${paramIndex++}`);
      values.push(data.calculation_mode);
    }
    if (data.ranges !== undefined) {
      updates.push(`ranges = $${paramIndex++}`);
      values.push(JSON.stringify(data.ranges));
    }
    if (data.display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(data.is_active);
    }

    // Update the rule if there are field changes
    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(id);

      await query(`
        UPDATE points_rules
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `, values);
    }

    // Update metric associations if provided (for metric-based rules)
    if (data.metric_ids !== undefined) {
      // Delete existing associations
      await query(`DELETE FROM points_rule_metrics WHERE rule_id = $1`, [id]);
      
      // Insert new associations
      for (const metricId of data.metric_ids) {
        await query(`
          INSERT INTO points_rule_metrics (rule_id, metric_id)
          VALUES ($1, $2)
          ON CONFLICT (rule_id, metric_id) DO NOTHING
        `, [id, metricId]);
      }
    }

    return this.getPointsRuleById(id);
  }

  async deletePointsRule(id: number): Promise<boolean> {
    this.invalidateCache();
    const result = await query(`DELETE FROM points_rules WHERE id = $1 RETURNING id`, [id]);
    return result.length > 0;
  }

  // ============================================================================
  // RANKS
  // ============================================================================

  async getAllRanks(activeOnly: boolean = false): Promise<Rank[]> {
    const whereClause = activeOnly ? 'WHERE is_active = true' : '';
    return query<Rank>(`
      SELECT * FROM ranks
      ${whereClause}
      ORDER BY min_points ASC
    `);
  }

  async getRankById(id: number): Promise<Rank | null> {
    return queryOne<Rank>(`SELECT * FROM ranks WHERE id = $1`, [id]);
  }

  async getRankForPoints(points: number): Promise<Rank | null> {
    return queryOne<Rank>(`
      SELECT * FROM ranks
      WHERE is_active = true
        AND min_points <= $1
        AND (max_points IS NULL OR max_points >= $1)
      ORDER BY min_points DESC
      LIMIT 1
    `, [points]);
  }

  async createRank(data: CreateRankRequest): Promise<Rank> {
    const result = await queryOne<Rank>(`
      INSERT INTO ranks (name, min_points, max_points, logo_url, color, description, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      data.name,
      data.min_points,
      data.max_points || null,
      data.logo_url || null,
      data.color || null,
      data.description || null,
      data.display_order || 0,
    ]);

    if (!result) throw new Error('Failed to create rank');
    return result;
  }

  async updateRank(id: number, data: UpdateRankRequest): Promise<Rank | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.min_points !== undefined) {
      updates.push(`min_points = $${paramIndex++}`);
      values.push(data.min_points);
    }
    if (data.max_points !== undefined) {
      updates.push(`max_points = $${paramIndex++}`);
      values.push(data.max_points);
    }
    if (data.logo_url !== undefined) {
      updates.push(`logo_url = $${paramIndex++}`);
      values.push(data.logo_url);
    }
    if (data.color !== undefined) {
      updates.push(`color = $${paramIndex++}`);
      values.push(data.color);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(data.is_active);
    }

    if (updates.length === 0) return this.getRankById(id);

    updates.push(`updated_at = NOW()`);
    values.push(id);

    return queryOne<Rank>(`
      UPDATE ranks
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);
  }

  async deleteRank(id: number): Promise<boolean> {
    const result = await query(`DELETE FROM ranks WHERE id = $1 RETURNING id`, [id]);
    return result.length > 0;
  }


  // ============================================================================
  // POINTS CALCULATION
  // ============================================================================

  calculatePointsFromRanges(value: number, ranges: PointRange[], mode: string): number {
    if (mode === 'multiplier') {
      // For multiplier mode, the "points" field in ranges[0] is the multiplier rate
      const multiplier = ranges[0]?.points || 1;
      return Math.floor(value * multiplier);
    }
    return this.calculateRangePoints(value, ranges);
  }

  private calculateRangePoints(value: number, ranges: PointRange[]): number {
    const sortedRanges = [...ranges].sort((a, b) => a.min - b.min);
    for (const range of sortedRanges) {
      const min = range.min;
      const max = range.max ?? Infinity;
      if (value >= min && value <= max) {
        return range.points;
      }
    }
    return 0;
  }

  async calculateNativeMetricPoints(
    metricKey: NativeMetricKey,
    rule: PointsRule,
    stats: {
      ageDays: number;
      totalTxns: number;
      nftCount: number;
      tokenHoldings: Array<{ usdValue: number }>;
      totalVolumeUsd?: number;
    }
  ): Promise<{ value: number; points: number }> {
    let value = 0;

    switch (metricKey) {
      case 'wallet_age':
        value = stats.ageDays;
        break;
      case 'total_tx':
        value = stats.totalTxns;
        break;
      case 'nft_collections':
        value = stats.nftCount;
        break;
      case 'erc20_tokens':
        value = stats.tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0);
        break;
      case 'total_volume':
        value = stats.totalVolumeUsd || 0;
        break;
    }

    const points = this.calculatePointsFromRanges(value, rule.ranges, rule.calculation_mode);
    return { value, points };
  }

  async calculatePlatformPoints(
    walletAddress: string,
    platformId: number,
    rule: PointsRule,
    platformContracts: Map<number, string[]>
  ): Promise<{ tx_count: number; usd_volume: number; points: number }> {
    const wallet = walletAddress.toLowerCase();
    const addresses = platformContracts.get(platformId) || [];

    if (addresses.length === 0) {
      return { tx_count: 0, usd_volume: 0, points: 0 };
    }

    const stats = await queryOne<{ tx_count: string; usd_volume: string }>(`
      SELECT 
        COUNT(DISTINCT wi.tx_hash) as tx_count,
        COALESCE(SUM(td.total_usd_value), 0) as usd_volume
      FROM wallet_interactions wi
      LEFT JOIN transaction_details td ON td.tx_hash = wi.tx_hash
      WHERE wi.wallet_address = $1
        AND wi.contract_address = ANY($2)
    `, [wallet, addresses]);

    const txCount = parseInt(stats?.tx_count || '0');
    const usdVolume = parseFloat(stats?.usd_volume || '0');
    const valueForPoints = rule.calculation_mode === 'multiplier' ? usdVolume : txCount;
    const points = this.calculatePointsFromRanges(valueForPoints, rule.ranges, rule.calculation_mode);

    return { tx_count: txCount, usd_volume: usdVolume, points };
  }

  async calculateWalletScore(walletAddress: string): Promise<WalletScoreResponse> {
    const wallet = walletAddress.toLowerCase();
    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    let totalPoints = 0;

    // Fetch wallet stats and total volume in parallel
    const [stats, totalVolumeUsd] = await Promise.all([
      walletStatsService.getAllStats(wallet),
      fetchTotalVolumeUsd(wallet),
    ]);
    
    const cachedData = await this.getCachedRulesData();
    const { rules, nativeMetrics, platformContracts } = cachedData;
    const nativeMetricMap = new Map(nativeMetrics.map(m => [m.id, m]));

    // Process native metric rules
    const nativeRules = rules.filter(r => r.metric_type === 'native');
    for (const rule of nativeRules) {
      if (!rule.native_metric_id) continue;
      const metric = nativeMetricMap.get(rule.native_metric_id);
      if (!metric) continue;

      const result = await this.calculateNativeMetricPoints(
        metric.key as NativeMetricKey,
        rule,
        {
          ageDays: stats.ageDays,
          totalTxns: stats.totalTxns,
          nftCount: stats.nftCount,
          tokenHoldings: stats.tokenHoldings,
          totalVolumeUsd,
        }
      );
      breakdown.native[metric.key as NativeMetricKey] = result;
      totalPoints += result.points;
    }

    // Process platform rules
    const platformRules = rules.filter(r => r.metric_type === 'platform');
    const platformIds = platformRules.map(r => r.platform_id).filter(Boolean) as number[];
    const platforms = platformIds.length > 0 
      ? await query<{ id: number; slug: string }>(`SELECT id, slug FROM platforms WHERE id = ANY($1)`, [platformIds])
      : [];
    const platformMap = new Map(platforms.map(p => [p.id, p.slug]));

    const platformPromises = platformRules
      .filter(rule => rule.platform_id && platformMap.has(rule.platform_id))
      .map(async rule => {
        const slug = platformMap.get(rule.platform_id!)!;
        const result = await this.calculatePlatformPoints(wallet, rule.platform_id!, rule, platformContracts);
        return { slug, result };
      });

    const platformResults = await Promise.all(platformPromises);
    for (const { slug, result } of platformResults) {
      breakdown.platforms[slug] = result;
      totalPoints += result.points;
    }

    const rank = cachedData.ranks.find(r => 
      r.min_points <= totalPoints && (r.max_points === null || r.max_points >= totalPoints)
    ) || null;

    await this.cacheWalletPoints(wallet, totalPoints, rank?.id || null, breakdown);

    return {
      wallet_address: wallet,
      total_points: totalPoints,
      rank: rank ? {
        name: rank.name,
        color: rank.color,
        logo_url: rank.logo_url,
      } : null,
      breakdown,
      last_updated: new Date(),
    };
  }

  async getCachedWalletScore(walletAddress: string): Promise<WalletScoreResponse | null> {
    const wallet = walletAddress.toLowerCase();
    
    const cached = await queryOne<WalletPointsCache & { rank_name?: string; rank_color?: string; rank_logo?: string }>(`
      SELECT 
        wpc.*,
        r.name as rank_name,
        r.color as rank_color,
        r.logo_url as rank_logo
      FROM wallet_points_cache wpc
      LEFT JOIN ranks r ON wpc.rank_id = r.id
      WHERE wpc.wallet_address = $1
    `, [wallet]);

    if (!cached) return null;

    return {
      wallet_address: wallet,
      total_points: cached.total_points,
      rank: cached.rank_name ? {
        name: cached.rank_name,
        color: cached.rank_color || null,
        logo_url: cached.rank_logo || null,
      } : null,
      breakdown: typeof cached.breakdown === 'string' 
        ? JSON.parse(cached.breakdown) 
        : cached.breakdown,
      last_updated: cached.last_calculated_at,
    };
  }

  private async cacheWalletPoints(
    walletAddress: string,
    totalPoints: number,
    rankId: number | null,
    breakdown: WalletPointsBreakdown
  ): Promise<void> {
    await query(`
      INSERT INTO wallet_points_cache (wallet_address, total_points, rank_id, breakdown, last_calculated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (wallet_address) DO UPDATE SET
        total_points = $2,
        rank_id = $3,
        breakdown = $4,
        last_calculated_at = NOW(),
        updated_at = NOW()
    `, [walletAddress.toLowerCase(), totalPoints, rankId, JSON.stringify(breakdown)]);
  }
}

export const pointsService = new PointsService();
