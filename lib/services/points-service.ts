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

export class PointsService {
  // ============================================================================
  // NATIVE METRICS
  // ============================================================================

  async getAllNativeMetrics(activeOnly: boolean = false): Promise<NativeMetric[]> {
    const whereClause = activeOnly ? 'WHERE is_active = true' : '';
    return query<NativeMetric>(`
      SELECT * FROM native_metrics
      ${whereClause}
      ORDER BY display_order ASC
    `);
  }

  async getNativeMetricByKey(key: string): Promise<NativeMetric | null> {
    return queryOne<NativeMetric>(`SELECT * FROM native_metrics WHERE key = $1`, [key]);
  }

  // ============================================================================
  // POINTS RULES
  // ============================================================================

  async getAllPointsRules(activeOnly: boolean = false): Promise<PointsRuleWithRelations[]> {
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

    return rules.map(rule => ({
      ...rule,
      ranges: typeof rule.ranges === 'string' ? JSON.parse(rule.ranges) : rule.ranges,
    }));
  }

  async getPointsRuleById(id: number): Promise<PointsRuleWithRelations | null> {
    const rule = await queryOne<PointsRule>(`SELECT * FROM points_rules WHERE id = $1`, [id]);
    if (!rule) return null;

    return {
      ...rule,
      ranges: typeof rule.ranges === 'string' ? JSON.parse(rule.ranges) : rule.ranges,
    };
  }

  async createPointsRule(data: CreatePointsRuleRequest): Promise<PointsRule> {
    const result = await queryOne<PointsRule>(`
      INSERT INTO points_rules (
        metric_type, platform_id, native_metric_id, name, description,
        calculation_mode, ranges, display_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      data.metric_type,
      data.platform_id || null,
      data.native_metric_id || null,
      data.name,
      data.description || null,
      data.calculation_mode,
      JSON.stringify(data.ranges),
      data.display_order || 0,
    ]);

    if (!result) throw new Error('Failed to create points rule');
    return {
      ...result,
      ranges: data.ranges,
    };
  }

  async updatePointsRule(id: number, data: UpdatePointsRuleRequest): Promise<PointsRule | null> {
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

    if (updates.length === 0) return this.getPointsRuleById(id);

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await queryOne<PointsRule>(`
      UPDATE points_rules
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (!result) return null;
    return {
      ...result,
      ranges: typeof result.ranges === 'string' ? JSON.parse(result.ranges) : result.ranges,
    };
  }

  async deletePointsRule(id: number): Promise<boolean> {
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

  /**
   * Calculate points for a value based on ranges
   */
  calculatePointsFromRanges(value: number, ranges: PointRange[], mode: string): number {
    if (mode === 'per_item') {
      // For per_item mode (like ERC20 tokens), each item is evaluated separately
      // This is handled in calculateNativeMetricPoints
      return this.calculateRangePoints(value, ranges);
    }

    return this.calculateRangePoints(value, ranges);
  }

  private calculateRangePoints(value: number, ranges: PointRange[]): number {
    // Sort ranges by min value
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

  /**
   * Calculate points for a native metric
   */
  async calculateNativeMetricPoints(
    walletAddress: string,
    metricKey: NativeMetricKey,
    rule: PointsRule
  ): Promise<{ value: number; points: number }> {
    const wallet = walletAddress.toLowerCase();
    let value = 0;

    switch (metricKey) {
      case 'wallet_age': {
        const txStats = await walletStatsService.getInkChainTxStats(wallet);
        value = walletStatsService.calculateAgeDays(txStats.firstTxDate);
        break;
      }
      case 'total_tx': {
        const txStats = await walletStatsService.getInkChainTxStats(wallet);
        value = txStats.totalTxns;
        break;
      }
      case 'nft_collections': {
        const nftData = await walletStatsService.getAllNftHoldings(wallet);
        value = nftData.totalCount;
        break;
      }
      case 'erc20_tokens': {
        const tokenHoldings = await walletStatsService.getTokenHoldings(wallet);
        // For ERC20, we sum USD values and apply per_item logic
        if (rule.calculation_mode === 'per_item') {
          let totalPoints = 0;
          for (const token of tokenHoldings) {
            if (token.usdValue > 0) {
              totalPoints += this.calculateRangePoints(token.usdValue, rule.ranges);
            }
          }
          value = tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0);
          return { value, points: totalPoints };
        }
        value = tokenHoldings.reduce((sum, t) => sum + t.usdValue, 0);
        break;
      }
    }

    const points = this.calculatePointsFromRanges(value, rule.ranges, rule.calculation_mode);
    return { value, points };
  }

  /**
   * Calculate points for a platform
   */
  async calculatePlatformPoints(
    walletAddress: string,
    platformId: number,
    rule: PointsRule
  ): Promise<{ tx_count: number; usd_volume: number; points: number }> {
    const wallet = walletAddress.toLowerCase();

    // Get platform contracts
    const contracts = await query<{ address: string }>(`
      SELECT c.address FROM contracts c
      JOIN platform_contracts pc ON c.id = pc.contract_id
      WHERE pc.platform_id = $1
    `, [platformId]);

    if (contracts.length === 0) {
      return { tx_count: 0, usd_volume: 0, points: 0 };
    }

    const addresses = contracts.map(c => c.address);

    // Get transaction stats for this wallet on platform contracts
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

    // Calculate points based on rule configuration
    // Default: use tx_count for points calculation
    const valueForPoints = rule.calculation_mode === 'multiplier' ? usdVolume : txCount;
    const points = this.calculatePointsFromRanges(valueForPoints, rule.ranges, rule.calculation_mode);

    return { tx_count: txCount, usd_volume: usdVolume, points };
  }

  /**
   * Calculate total wallet score
   */
  async calculateWalletScore(walletAddress: string): Promise<WalletScoreResponse> {
    const wallet = walletAddress.toLowerCase();
    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    let totalPoints = 0;

    // Get all active rules
    const rules = await this.getAllPointsRules(true);

    // Process native metric rules
    const nativeRules = rules.filter(r => r.metric_type === 'native');
    for (const rule of nativeRules) {
      if (!rule.native_metric_id) continue;

      const metric = await queryOne<NativeMetric>(
        `SELECT * FROM native_metrics WHERE id = $1`,
        [rule.native_metric_id]
      );
      if (!metric) continue;

      const result = await this.calculateNativeMetricPoints(wallet, metric.key as NativeMetricKey, rule);
      breakdown.native[metric.key as NativeMetricKey] = result;
      totalPoints += result.points;
    }

    // Process platform rules
    const platformRules = rules.filter(r => r.metric_type === 'platform');
    for (const rule of platformRules) {
      if (!rule.platform_id) continue;

      const platform = await queryOne<{ slug: string }>(`SELECT slug FROM platforms WHERE id = $1`, [rule.platform_id]);
      if (!platform) continue;

      const result = await this.calculatePlatformPoints(wallet, rule.platform_id, rule);
      breakdown.platforms[platform.slug] = result;
      totalPoints += result.points;
    }

    // Get rank
    const rank = await this.getRankForPoints(totalPoints);

    // Cache the result
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

  /**
   * Get cached wallet score (fast)
   */
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

  /**
   * Cache wallet points
   */
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
