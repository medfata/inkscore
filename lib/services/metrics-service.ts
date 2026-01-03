import { query, queryOne } from '../db';
import {
  AnalyticsMetric,
  MetricContract,
  MetricFunction,
  MetricWithRelations,
  CreateMetricRequest,
  UpdateMetricRequest,
  ContractFunction,
} from '../types/analytics';

export class MetricsService {
  // In-memory cache for metrics (they rarely change)
  private metricsCache: { data: MetricWithRelations[]; timestamp: number } | null = null;
  private readonly METRICS_CACHE_TTL = 60 * 1000; // 1 minute

  // Get all metrics with their contracts and functions (optimized with single query + caching)
  async getAllMetrics(activeOnly: boolean = false): Promise<MetricWithRelations[]> {
    // Check cache first
    if (this.metricsCache && Date.now() - this.metricsCache.timestamp < this.METRICS_CACHE_TTL) {
      return activeOnly 
        ? this.metricsCache.data.filter(m => m.is_active)
        : this.metricsCache.data;
    }

    // Fetch all data in 3 parallel queries instead of N+1
    const [metrics, allContracts, allFunctions] = await Promise.all([
      query<AnalyticsMetric>(`
        SELECT * FROM analytics_metrics
        ORDER BY display_order ASC, created_at ASC
      `),
      query<MetricContract>(`SELECT * FROM analytics_metric_contracts`),
      query<MetricFunction>(`SELECT * FROM analytics_metric_functions`),
    ]);

    // Group contracts and functions by metric_id
    const contractsByMetric = new Map<number, MetricContract[]>();
    const functionsByMetric = new Map<number, MetricFunction[]>();

    for (const contract of allContracts) {
      const existing = contractsByMetric.get(contract.metric_id) || [];
      existing.push(contract);
      contractsByMetric.set(contract.metric_id, existing);
    }

    for (const func of allFunctions) {
      const existing = functionsByMetric.get(func.metric_id) || [];
      existing.push(func);
      functionsByMetric.set(func.metric_id, existing);
    }

    // Assemble results
    const result: MetricWithRelations[] = metrics.map(metric => ({
      ...metric,
      contracts: contractsByMetric.get(metric.id) || [],
      functions: functionsByMetric.get(metric.id) || [],
    }));

    // Update cache
    this.metricsCache = { data: result, timestamp: Date.now() };

    return activeOnly ? result.filter(m => m.is_active) : result;
  }

  // Invalidate cache (call after create/update/delete)
  invalidateCache(): void {
    this.metricsCache = null;
  }

  // Get single metric by ID or slug
  async getMetric(idOrSlug: number | string): Promise<MetricWithRelations | null> {
    const isId = typeof idOrSlug === 'number';
    
    const metric = await queryOne<AnalyticsMetric>(`
      SELECT * FROM analytics_metrics
      WHERE ${isId ? 'id' : 'slug'} = $1
    `, [idOrSlug]);

    if (!metric) return null;

    const contracts = await query<MetricContract>(`
      SELECT * FROM analytics_metric_contracts
      WHERE metric_id = $1
    `, [metric.id]);

    const functions = await query<MetricFunction>(`
      SELECT * FROM analytics_metric_functions
      WHERE metric_id = $1
    `, [metric.id]);

    return {
      ...metric,
      contracts,
      functions,
    };
  }

  // Create new metric
  async createMetric(data: CreateMetricRequest): Promise<MetricWithRelations> {
    // Insert metric
    const metric = await queryOne<AnalyticsMetric>(`
      INSERT INTO analytics_metrics 
        (slug, name, description, aggregation_type, value_field, currency, icon, display_order)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      data.slug,
      data.name,
      data.description || null,
      data.aggregation_type,
      data.value_field || null,
      data.currency,
      data.icon || null,
      data.display_order || 0,
    ]);

    if (!metric) throw new Error('Failed to create metric');

    // Insert contracts
    for (const contract of data.contracts) {
      await query(`
        INSERT INTO analytics_metric_contracts (metric_id, contract_address, include_mode)
        VALUES ($1, $2, $3)
      `, [metric.id, contract.address.toLowerCase(), contract.include_mode]);
    }

    // Insert functions
    for (const func of data.functions) {
      await query(`
        INSERT INTO analytics_metric_functions (metric_id, function_name, function_selector, include_mode)
        VALUES ($1, $2, $3, $4)
      `, [metric.id, func.name, func.selector || null, func.include_mode]);
    }

    return this.getMetric(metric.id) as Promise<MetricWithRelations>;
  }

  // Update metric
  async updateMetric(id: number, data: UpdateMetricRequest): Promise<MetricWithRelations | null> {
    this.invalidateCache();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (data.slug !== undefined) {
      updates.push(`slug = $${paramIndex++}`);
      values.push(data.slug);
    }
    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.aggregation_type !== undefined) {
      updates.push(`aggregation_type = $${paramIndex++}`);
      values.push(data.aggregation_type);
    }
    if (data.value_field !== undefined) {
      updates.push(`value_field = $${paramIndex++}`);
      values.push(data.value_field);
    }
    if (data.currency !== undefined) {
      updates.push(`currency = $${paramIndex++}`);
      values.push(data.currency);
    }
    if (data.icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(data.icon);
    }
    if (data.display_order !== undefined) {
      updates.push(`display_order = $${paramIndex++}`);
      values.push(data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(data.is_active);
    }

    if (updates.length > 0) {
      updates.push(`updated_at = NOW()`);
      values.push(id);

      await query(`
        UPDATE analytics_metrics
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
      `, values);
    }

    // Update contracts if provided
    if (data.contracts) {
      await query(`DELETE FROM analytics_metric_contracts WHERE metric_id = $1`, [id]);
      
      for (const contract of data.contracts) {
        await query(`
          INSERT INTO analytics_metric_contracts (metric_id, contract_address, include_mode)
          VALUES ($1, $2, $3)
        `, [id, contract.address.toLowerCase(), contract.include_mode]);
      }
    }

    // Update functions if provided
    if (data.functions) {
      await query(`DELETE FROM analytics_metric_functions WHERE metric_id = $1`, [id]);
      
      for (const func of data.functions) {
        await query(`
          INSERT INTO analytics_metric_functions (metric_id, function_name, function_selector, include_mode)
          VALUES ($1, $2, $3, $4)
        `, [id, func.name, func.selector || null, func.include_mode]);
      }
    }

    return this.getMetric(id);
  }

  // Delete metric
  async deleteMetric(id: number): Promise<boolean> {
    this.invalidateCache();
    const result = await query(`
      DELETE FROM analytics_metrics WHERE id = $1 RETURNING id
    `, [id]);
    return result.length > 0;
  }

  // Get functions for a contract (from indexed data)
  async getContractFunctions(contractAddress: string): Promise<ContractFunction[]> {
    // Use transaction_details as the single source of truth
    const functions = await query<ContractFunction>(`
      SELECT 
        function_name,
        function_selector,
        COUNT(*) as tx_count
      FROM transaction_details
      WHERE contract_address = $1
        AND function_name IS NOT NULL
        AND status = 1
      GROUP BY function_name, function_selector
      ORDER BY tx_count DESC
    `, [contractAddress.toLowerCase()]);

    return functions;
  }
}

export const metricsService = new MetricsService();
