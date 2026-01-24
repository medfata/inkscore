import { query, queryOne } from '../db';
import {
  NativeMetric,
  PointsRule,
  PointsRuleWithRelations,
  PointRange,
  Rank,
  WalletPointsBreakdown,
  WalletScoreResponse,
  CreatePointsRuleRequest,
  UpdatePointsRuleRequest,
  CreateRankRequest,
  UpdateRankRequest,
  NativeMetricKey,
} from '../types/platforms';
import { walletStatsService } from './wallet-stats-service';
import { assetsService } from './assets-service';

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

// Cache for meme token addresses (5 minute TTL)
interface MemeTokensCache {
  addresses: Set<string>;
  timestamp: number;
}
let memeTokensCache: MemeTokensCache | null = null;
const MEME_TOKENS_CACHE_TTL = 5 * 60 * 1000;

// Helper function to fetch total volume from indexed transactions (simplified)
async function fetchTotalVolumeUsd(walletAddress: string): Promise<number> {
  try {
    // Simple query - just get outgoing ETH volume (most important metric)
    const result = await queryOne<{ total_eth: string }>(`
      SELECT COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as total_eth
      FROM transaction_details
      WHERE wallet_address = $1 AND status = 1
    `, [walletAddress]);

    const totalEth = parseFloat(result?.total_eth || '0');

    // Use a fixed ETH price to avoid additional query
    const ethPrice = 3500; // Fixed price for performance

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
  // MANUAL POINTS CALCULATION METHODS
  // ============================================================================

  // Get meme token addresses from database
  private async getMemeTokenAddresses(): Promise<Set<string>> {
    if (memeTokensCache && Date.now() - memeTokensCache.timestamp < MEME_TOKENS_CACHE_TTL) {
      return memeTokensCache.addresses;
    }

    try {
      const memeCoins = await assetsService.getMemeCoins();
      const addresses = new Set(memeCoins.map(coin => coin.address.toLowerCase()));
      
      memeTokensCache = { addresses, timestamp: Date.now() };
      return addresses;
    } catch (error) {
      console.error('Failed to fetch meme token addresses:', error);
      // Fallback to hardcoded addresses if database fails
      return new Set([
        '0x0606fc632ee812ba970af72f8489baaa443c4b98', // ANITA
        '0x20c69c12abf2b6f8d8ca33604dd25c700c7e70a5', // CAT
        '0xd642b49d10cc6e1bc1c6945725667c35e0875f22', // PURPLE
        '0x2a1bce657f919ac3f9ab50b2584cfc77563a02ec', // ANDRU (AK47)
        '0x32bcb803f696c99eb263d60a05cafd8689026575', // KRAK (KRAKMASK)
        '0x62c99fac20b33b5423fdf9226179e973a8353e36', // BERT
      ]);
    }
  }

  private async isMemeToken(address: string): Promise<boolean> {
    const memeTokens = await this.getMemeTokenAddresses();
    return memeTokens.has(address.toLowerCase());
  }

  // 1. NFT Collections Points
  private calculateNftCollectionsPoints(nftCount: number): number {
    if (nftCount >= 1 && nftCount <= 3) return 100;
    if (nftCount >= 4 && nftCount <= 9) return 200;
    if (nftCount >= 10) return 300;
    return 0;
  }

  // 2. Token Holdings Points (excluding meme coins)
  private async calculateTokenHoldingsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    const memeTokens = await this.getMemeTokenAddresses();
    let points = 0;
    for (const token of tokenHoldings) {
      // Skip meme tokens
      if (memeTokens.has(token.address.toLowerCase())) continue;

      const balanceUsd = token.usdValue;
      if (balanceUsd >= 1 && balanceUsd <= 99) {
        points += 100;
      } else if (balanceUsd >= 100 && balanceUsd <= 999) {
        points += 200;
      } else if (balanceUsd >= 1000) {
        points += 300;
      }
    }
    return points;
  }

  // 3. Meme Coins Points
  private async calculateMemeCoinsPoints(tokenHoldings: Array<{ address: string; usdValue: number }>): Promise<number> {
    const memeTokens = await this.getMemeTokenAddresses();
    let points = 0;
    for (const token of tokenHoldings) {
      // Only process meme tokens
      if (!memeTokens.has(token.address.toLowerCase())) continue;

      const balanceUsd = token.usdValue;
      if (balanceUsd >= 1 && balanceUsd <= 10) {
        points += 50;
      } else if (balanceUsd >= 11 && balanceUsd <= 100) {
        points += 70;
      } else if (balanceUsd > 200) {
        points += 100;
      }
    }
    return points;
  }

  // 4. Wallet Age Points
  private calculateWalletAgePoints(ageDays: number): number {
    if (ageDays <= 30) return 100;
    if (ageDays <= 90) return 200;
    if (ageDays <= 180) return 300;
    if (ageDays <= 365) return 400;
    if (ageDays <= 730) return 500;
    return 600;
  }

  // 5. Total Transactions Points
  private calculateTotalTxPoints(txCount: number): number {
    if (txCount >= 1 && txCount <= 100) return 100;
    if (txCount <= 200) return 200;
    if (txCount <= 400) return 300;
    if (txCount <= 700) return 400;
    if (txCount <= 900) return 500;
    return 600;
  }

  // 6. Bridge Volume Points
  private calculateBridgeVolumePoints(bridgeInVolumeUsd: number): number {
    if (bridgeInVolumeUsd >= 10 && bridgeInVolumeUsd < 100) return 100;
    if (bridgeInVolumeUsd < 500) return 200;
    if (bridgeInVolumeUsd < 2000) return 300;
    if (bridgeInVolumeUsd < 5000) return 400;
    if (bridgeInVolumeUsd < 10000) return 500;
    if (bridgeInVolumeUsd >= 10000) return 600;
    return 0;
  }

  // 7. GM Points
  private calculateGmPoints(gmCount: number): number {
    if (gmCount >= 1 && gmCount < 10) return 100;
    if (gmCount >= 10 && gmCount <= 20) return 200;
    if (gmCount > 30) return 300;
    return 0;
  }

  // 8. InkyPump Points
  private calculateInkyPumpPoints(createdToken: boolean, boughtToken: boolean, soldToken: boolean): number {
    let points = 0;
    if (createdToken) points += 100;
    if (boughtToken) points += 100;
    if (soldToken) points += 100;
    return points;
  }

  // 9. Tydro Points
  private calculateTydroPoints(supplyUsd: number, borrowUsd: number): number {
    let points = 0;

    // Supply points
    if (supplyUsd >= 1 && supplyUsd <= 99) {
      points += 250;
    } else if (supplyUsd >= 100 && supplyUsd <= 499) {
      points += 500;
    } else if (supplyUsd >= 500 && supplyUsd <= 999) {
      points += 700;
    } else if (supplyUsd >= 1000) {
      points += 1000;
    }

    // Borrow points
    if (borrowUsd >= 1 && borrowUsd <= 99) {
      points += 250;
    } else if (borrowUsd >= 100 && borrowUsd <= 499) {
      points += 500;
    } else if (borrowUsd >= 500 && borrowUsd <= 999) {
      points += 700;
    } else if (borrowUsd >= 1000) {
      points += 1000;
    }

    return points;
  }

  // 10. Swap Volume Points
  private calculateSwapVolumePoints(swapAmountUsd: number): number {
    if (swapAmountUsd >= 5 && swapAmountUsd <= 50) return 100;
    if (swapAmountUsd >= 100 && swapAmountUsd <= 500) return 250;
    if (swapAmountUsd > 500 && swapAmountUsd <= 1000) return 500;
    if (swapAmountUsd > 1000) return 1000;
    return 0;
  }

  // 11. Shellies Points
  private calculateShelliesPoints(playedGame: boolean, stakedNft: boolean, joinedRaffle: boolean): number {
    let points = 0;
    if (playedGame) points += 100;
    if (stakedNft) points += 100;
    if (joinedRaffle) points += 100;
    return points;
  }

  // 12. ZNS Points
  private calculateZnsPoints(hasZnsDomain: boolean): number {
    return hasZnsDomain ? 100 : 0;
  }

  // 13. NFT2Me Points
  private calculateNft2mePoints(collectionCreated: boolean, nftMinted: boolean): number {
    let points = 0;
    if (collectionCreated) points += 100;
    if (nftMinted) points += 100;
    return points;
  }

  // 14. NFT Trading Points
  private calculateNftTradingPoints(hasTraded: boolean): number {
    return hasTraded ? 100 : 0;
  }

  // ============================================================================
  // DATA FETCHING HELPERS
  // ============================================================================

  private async fetchBridgeVolume(wallet: string): Promise<{ bridgedInUsd: number; bridgedInCount: number }> {
    try {
      const result = await queryOne<{ bridged_in_usd: string; bridged_in_count: string }>(`
        SELECT 
          COALESCE(SUM(CASE WHEN to_address = $1 THEN CAST(eth_value AS NUMERIC) / 1e18 * 3500 ELSE 0 END), 0) as bridged_in_usd,
          COUNT(CASE WHEN to_address = $1 THEN 1 END) as bridged_in_count
        FROM transaction_details
        WHERE (wallet_address = $1 OR to_address = $1)
          AND contract_address IN (
            '0x1cb6de532588fca4a21b7209de7c456af8434a65',
            '0xfebcf17b11376c724ab5a5229803c6e838b6eae5',
            '0x4cd00e387622c35bddb9b4c962c136462338bc31',
            '0x3a23f943181408eac424116af7b7790c94cb97a5',
            '0x26d8da52e56de71194950689ccf74cd309761324',
            '0xe18dfefce7a5d18d39ce6fc925f102286fa96fdc'
          )
          AND status = 1
      `, [wallet]);
      return {
        bridgedInUsd: parseFloat(result?.bridged_in_usd || '0'),
        bridgedInCount: parseInt(result?.bridged_in_count || '0')
      };
    } catch (error) {
      console.error('Error fetching bridge volume:', error);
      return { bridgedInUsd: 0, bridgedInCount: 0 };
    }
  }

  private async fetchGmCount(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0x9f500d075118272b3564ac6ef2c70a9067fd2d3f'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching GM count:', error);
      return { count: 0 };
    }
  }

  private async fetchInkyPumpCreatedTokens(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0x1d74317d760f2c72a94386f50e8d10f2c902b899'
          AND function_name = 'mint'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching InkyPump created tokens:', error);
      return { count: 0 };
    }
  }

  private async fetchInkyPumpBuyVolume(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0x1d74317d760f2c72a94386f50e8d10f2c902b899'
          AND function_name = 'buy'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching InkyPump buy volume:', error);
      return { count: 0 };
    }
  }

  private async fetchInkyPumpSellVolume(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0x1d74317d760f2c72a94386f50e8d10f2c902b899'
          AND function_name = 'sell'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching InkyPump sell volume:', error);
      return { count: 0 };
    }
  }

  private async fetchTydroData(wallet: string): Promise<{ supplyUsd: number; borrowUsd: number; supplyCount: number; borrowCount: number }> {
    try {
      const result = await queryOne<{ supply_usd: string; borrow_usd: string; supply_count: string; borrow_count: string }>(`
        SELECT 
          COALESCE(SUM(CASE WHEN function_name IN ('depositETH', 'supply') THEN CAST(eth_value AS NUMERIC) / 1e18 * 3500 ELSE 0 END), 0) as supply_usd,
          COALESCE(SUM(CASE WHEN function_name IN ('borrowETH', 'borrow') THEN CAST(eth_value AS NUMERIC) / 1e18 * 3500 ELSE 0 END), 0) as borrow_usd,
          COUNT(CASE WHEN function_name IN ('depositETH', 'supply') THEN 1 END) as supply_count,
          COUNT(CASE WHEN function_name IN ('borrowETH', 'borrow') THEN 1 END) as borrow_count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN ('0xde090efcd6ef4b86792e2d84e55a5fa8d49d25d2', '0x2816cf15f6d2a220e789aa011d5ee4eb6c47feba')
          AND status = 1
      `, [wallet]);
      return {
        supplyUsd: parseFloat(result?.supply_usd || '0'),
        borrowUsd: parseFloat(result?.borrow_usd || '0'),
        supplyCount: parseInt(result?.supply_count || '0'),
        borrowCount: parseInt(result?.borrow_count || '0')
      };
    } catch (error) {
      console.error('Error fetching Tydro data:', error);
      return { supplyUsd: 0, borrowUsd: 0, supplyCount: 0, borrowCount: 0 };
    }
  }

  private async fetchSwapVolume(wallet: string): Promise<{ totalUsd: number; txCount: number }> {
    try {
      const result = await queryOne<{ total_usd: string; tx_count: string }>(`
        SELECT 
          COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18 * 3500), 0) as total_usd,
          COUNT(*) as tx_count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN (
            '0x9b17690de96fcfa80a3acaefe11d936629cd7a77',
            '0x551134e92e537ceaa217c2ef63210af3ce96a065',
            '0x01d40099fcd87c018969b0e8d4ab1633fb34763c',
            '0xd7e72f3615aa65b92a4dbdc211e296a35512988b'
          )
          AND status = 1
      `, [wallet]);
      return {
        totalUsd: parseFloat(result?.total_usd || '0'),
        txCount: parseInt(result?.tx_count || '0')
      };
    } catch (error) {
      console.error('Error fetching swap volume:', error);
      return { totalUsd: 0, txCount: 0 };
    }
  }

  private async fetchShelliesRaffles(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN ('0x47a27a42525fff2b7264b342f74216e37a831332', '0xe757e8aa82b7ad9f1ef8d4fe657d90341885c0de')
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching Shellies raffles:', error);
      return { count: 0 };
    }
  }

  private async fetchShelliesPayToPlay(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0x57d287dc46cb0782c4bce1e4e964cc52083bb358'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching Shellies pay to play:', error);
      return { count: 0 };
    }
  }

  private async fetchShelliesStaking(wallet: string): Promise<{ count: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = '0xb39a48d294e1530a271e712b7a19243679d320d0'
          AND status = 1
      `, [wallet]);
      return { count: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching Shellies staking:', error);
      return { count: 0 };
    }
  }

  private async fetchZnsData(wallet: string): Promise<{ hasZnsDomain: boolean; totalCount: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN ('0x63c489d31a2c3de0638360931f47ff066282473f', '0x3033d7ded400547d6442c55159da5c61f2721633')
          AND status = 1
      `, [wallet]);
      const count = parseInt(result?.count || '0');
      return { hasZnsDomain: count > 0, totalCount: count };
    } catch (error) {
      console.error('Error fetching ZNS data:', error);
      return { hasZnsDomain: false, totalCount: 0 };
    }
  }

  private async fetchNft2meData(wallet: string): Promise<{ collectionsCreated: number; nftsMinted: number; totalTransactions: number }> {
    try {
      const result = await queryOne<{ collections: string; minted: string; total: string }>(`
        SELECT 
          COUNT(CASE WHEN contract_address = '0x00000000001594c61dd8a6804da9ab58ed2483ce' THEN 1 END) as collections,
          COUNT(CASE WHEN contract_address = '0x00000000009a1e02f00e280dcfa4c81c55724212' THEN 1 END) as minted,
          COUNT(*) as total
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN ('0x00000000001594c61dd8a6804da9ab58ed2483ce', '0x00000000009a1e02f00e280dcfa4c81c55724212')
          AND status = 1
      `, [wallet]);
      return {
        collectionsCreated: parseInt(result?.collections || '0'),
        nftsMinted: parseInt(result?.minted || '0'),
        totalTransactions: parseInt(result?.total || '0')
      };
    } catch (error) {
      console.error('Error fetching NFT2Me data:', error);
      return { collectionsCreated: 0, nftsMinted: 0, totalTransactions: 0 };
    }
  }

  private async fetchNftTradingData(wallet: string): Promise<{ totalCount: number }> {
    try {
      const result = await queryOne<{ count: string }>(`
        SELECT COUNT(*) as count
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address IN (
            '0x9ebf93fdba9f32accab3d6716322dccd617a78f3',
            '0xd00c96804e9ff35f10c7d2a92239c351ff3f94e5',
            '0xbd6a027b85fd5285b1623563bbef6fadbe396afb'
          )
          AND status = 1
      `, [wallet]);
      return { totalCount: parseInt(result?.count || '0') };
    } catch (error) {
      console.error('Error fetching NFT trading data:', error);
      return { totalCount: 0 };
    }
  }

  async calculateWalletScore(walletAddress: string): Promise<WalletScoreResponse> {
    const wallet = walletAddress.toLowerCase();
    const breakdown: WalletPointsBreakdown = {
      native: {},
      platforms: {},
    };
    let totalPoints = 0;

    console.log(`\n========== CALCULATING SCORE FOR ${wallet} ==========`);

    // Fetch wallet stats with cache bypass to ensure fresh data
    const stats = await walletStatsService.getAllStats(wallet);

    console.log(`DEBUG: Wallet Stats - ageDays: ${stats.ageDays}, totalTxns: ${stats.totalTxns}, nftCount: ${stats.nftCount}`);
    console.log(`DEBUG: Token Holdings Count: ${stats.tokenHoldings.length}`);
    console.log(`DEBUG: NFT Collections Count: ${stats.nftCollections.length}`);

    // Fetch all required data in parallel
    const [
      bridgeData,
      gmData,
      inkyPumpCreated,
      inkyPumpBuy,
      inkyPumpSell,
      tydroData,
      swapData,
      shelliesRaffles,
      shelliesPayToPlay,
      shelliesStaking,
      znsData,
      nft2meData,
      nftTradingData
    ] = await Promise.all([
      this.fetchBridgeVolume(wallet),
      this.fetchGmCount(wallet),
      this.fetchInkyPumpCreatedTokens(wallet),
      this.fetchInkyPumpBuyVolume(wallet),
      this.fetchInkyPumpSellVolume(wallet),
      this.fetchTydroData(wallet),
      this.fetchSwapVolume(wallet),
      this.fetchShelliesRaffles(wallet),
      this.fetchShelliesPayToPlay(wallet),
      this.fetchShelliesStaking(wallet),
      this.fetchZnsData(wallet),
      this.fetchNft2meData(wallet),
      this.fetchNftTradingData(wallet)
    ]);

    // 1. NFT Collections Points (only count supported collections)
    const supportedNftCount = stats.nftCollections.reduce((sum, col) => sum + col.count, 0);
    const nftPoints = this.calculateNftCollectionsPoints(supportedNftCount);
    breakdown.native['nft_collections'] = { value: supportedNftCount, points: nftPoints };
    totalPoints += nftPoints;
    console.log(`1. NFT Collections (Supported): ${supportedNftCount} NFTs from ${stats.nftCollections.length} collections → ${nftPoints} points`);
    console.log(`   DEBUG: All NFT Collections:`, JSON.stringify(stats.nftCollections, null, 2));
    stats.nftCollections.forEach(col => {
      console.log(`   - ${col.name}: ${col.count} NFTs (address: ${col.address})`);
    });

    // 2. Token Holdings Points (excluding meme coins)
    const tokenPoints = await this.calculateTokenHoldingsPoints(stats.tokenHoldings);
    const totalTokenValue = stats.tokenHoldings.reduce((sum, t) => sum + (Number(t.usdValue) || 0), 0);
    breakdown.native['erc20_tokens'] = {
      value: totalTokenValue,
      points: tokenPoints
    };
    totalPoints += tokenPoints;
    console.log(`2. Token Holdings: $${(totalTokenValue || 0).toFixed(2)} (${stats.tokenHoldings.length} tokens) → ${tokenPoints} points`);
    const memeTokens = await this.getMemeTokenAddresses();
    stats.tokenHoldings.forEach(t => {
      if (!memeTokens.has(t.address.toLowerCase())) {
        const usdVal = Number(t.usdValue) || 0;
        console.log(`   - ${t.symbol || t.address}: $${usdVal.toFixed(2)} (balance: ${t.balance}, raw usdValue: ${t.usdValue})`);
      }
    });

    // 3. Meme Coins Points (separate calculation)
    const memePoints = await this.calculateMemeCoinsPoints(stats.tokenHoldings);
    const memeTokensFiltered = stats.tokenHoldings.filter(t => memeTokens.has(t.address.toLowerCase()));
    breakdown.native['meme_coins'] = {
      value: memeTokensFiltered.length,
      points: memePoints
    };
    totalPoints += memePoints;
    console.log(`3. Meme Coins: ${memeTokensFiltered.length} meme tokens → ${memePoints} points`);
    memeTokensFiltered.forEach(t => {
      console.log(`   - ${t.symbol || t.address}: $${(Number(t.usdValue) || 0).toFixed(2)}`);
    });

    // 4. Wallet Age Points
    const agePoints = this.calculateWalletAgePoints(stats.ageDays);
    breakdown.native['wallet_age'] = { value: stats.ageDays, points: agePoints };
    totalPoints += agePoints;
    console.log(`4. Wallet Age: ${stats.ageDays} days → ${agePoints} points`);

    // 5. Total Transactions Points
    const txPoints = this.calculateTotalTxPoints(stats.totalTxns);
    breakdown.native['total_tx'] = { value: stats.totalTxns, points: txPoints };
    totalPoints += txPoints;
    console.log(`5. Total Transactions: ${stats.totalTxns} txs → ${txPoints} points`);

    // 6. Bridge Volume Points
    const bridgePoints = this.calculateBridgeVolumePoints(bridgeData.bridgedInUsd);
    breakdown.platforms['bridge'] = {
      tx_count: bridgeData.bridgedInCount,
      usd_volume: bridgeData.bridgedInUsd,
      points: bridgePoints
    };
    totalPoints += bridgePoints;
    console.log(`6. Bridge Volume: $${(bridgeData.bridgedInUsd || 0).toFixed(2)} (${bridgeData.bridgedInCount} txs) → ${bridgePoints} points`);

    // 7. GM Points
    const gmPoints = this.calculateGmPoints(gmData.count);
    breakdown.platforms['gm'] = { tx_count: gmData.count, usd_volume: 0, points: gmPoints };
    totalPoints += gmPoints;
    console.log(`7. GM: ${gmData.count} interactions → ${gmPoints} points`);

    // 8. InkyPump Points
    const inkyPumpPoints = this.calculateInkyPumpPoints(
      inkyPumpCreated.count > 0,
      inkyPumpBuy.count > 0,
      inkyPumpSell.count > 0
    );
    breakdown.platforms['inkypump'] = {
      tx_count: inkyPumpCreated.count + inkyPumpBuy.count + inkyPumpSell.count,
      usd_volume: 0,
      points: inkyPumpPoints
    };
    totalPoints += inkyPumpPoints;
    console.log(`8. InkyPump: Created=${inkyPumpCreated.count}, Buy=${inkyPumpBuy.count}, Sell=${inkyPumpSell.count} → ${inkyPumpPoints} points`);

    // 9. Tydro Points
    const tydroPoints = this.calculateTydroPoints(tydroData.supplyUsd, tydroData.borrowUsd);
    breakdown.platforms['tydro'] = {
      tx_count: tydroData.supplyCount + tydroData.borrowCount,
      usd_volume: tydroData.supplyUsd + tydroData.borrowUsd,
      points: tydroPoints
    };
    totalPoints += tydroPoints;
    console.log(`9. Tydro: Supply=$${(tydroData.supplyUsd || 0).toFixed(2)} (${tydroData.supplyCount} txs), Borrow=$${(tydroData.borrowUsd || 0).toFixed(2)} (${tydroData.borrowCount} txs) → ${tydroPoints} points`);

    // 10. Swap Volume Points
    const swapPoints = this.calculateSwapVolumePoints(swapData.totalUsd);
    breakdown.platforms['swap'] = {
      tx_count: swapData.txCount,
      usd_volume: swapData.totalUsd,
      points: swapPoints
    };
    totalPoints += swapPoints;
    console.log(`10. Swap Volume: $${(swapData.totalUsd || 0).toFixed(2)} (${swapData.txCount} txs) → ${swapPoints} points`);

    // 11. Shellies Points
    const shelliesPoints = this.calculateShelliesPoints(
      shelliesPayToPlay.count > 0,
      shelliesStaking.count > 0,
      shelliesRaffles.count > 0
    );
    breakdown.platforms['shellies'] = {
      tx_count: shelliesRaffles.count + shelliesPayToPlay.count + shelliesStaking.count,
      usd_volume: 0,
      points: shelliesPoints
    };
    totalPoints += shelliesPoints;
    console.log(`11. Shellies: Game=${shelliesPayToPlay.count}, Staking=${shelliesStaking.count}, Raffles=${shelliesRaffles.count} → ${shelliesPoints} points`);

    // 12. ZNS Points
    const znsPoints = this.calculateZnsPoints(znsData.hasZnsDomain);
    breakdown.platforms['zns'] = {
      tx_count: znsData.totalCount,
      usd_volume: 0,
      points: znsPoints
    };
    totalPoints += znsPoints;
    console.log(`12. ZNS: Has domain=${znsData.hasZnsDomain} (${znsData.totalCount} txs) → ${znsPoints} points`);

    // 13. NFT2Me Points
    const nft2mePoints = this.calculateNft2mePoints(
      nft2meData.collectionsCreated > 0,
      nft2meData.nftsMinted > 0
    );
    breakdown.platforms['nft2me'] = {
      tx_count: nft2meData.totalTransactions,
      usd_volume: 0,
      points: nft2mePoints
    };
    totalPoints += nft2mePoints;
    console.log(`13. NFT2Me: Collections=${nft2meData.collectionsCreated}, Minted=${nft2meData.nftsMinted} → ${nft2mePoints} points`);

    // 14. NFT Trading Points
    const nftTradingPoints = this.calculateNftTradingPoints(nftTradingData.totalCount > 0);
    breakdown.platforms['nft_trading'] = {
      tx_count: nftTradingData.totalCount,
      usd_volume: 0,
      points: nftTradingPoints
    };
    totalPoints += nftTradingPoints;
    console.log(`14. NFT Trading: ${nftTradingData.totalCount} trades → ${nftTradingPoints} points`);

    console.log(`\n========== TOTAL SCORE: ${totalPoints} points ==========\n`);

    const cachedData = await this.getCachedRulesData();
    const rank = cachedData.ranks.find(r =>
      r.min_points <= totalPoints && (r.max_points === null || r.max_points >= totalPoints)
    ) || null;

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
}

export const pointsService = new PointsService();
