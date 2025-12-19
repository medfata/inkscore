import { query } from '../db';
import { metricsService } from './metrics-service';
import { priceService } from './price-service';
import {
  MetricWithRelations,
  SubAggregate,
  UserAnalyticsResponse,
} from '../types/analytics';

export class AnalyticsService {
  // Get all analytics for a wallet (direct query - no caching)
  async getWalletAnalytics(walletAddress: string): Promise<UserAnalyticsResponse> {
    const wallet = walletAddress.toLowerCase();
    const metrics = await metricsService.getAllMetrics(true);

    const result: UserAnalyticsResponse = {
      wallet_address: wallet,
      metrics: [],
    };

    for (const metric of metrics) {
      const metricData = await this.queryMetricForWallet(wallet, metric);
      result.metrics.push(metricData);
    }

    return result;
  }

  // Get specific metric for a wallet (direct query)
  async getWalletMetric(walletAddress: string, metricSlug: string): Promise<UserAnalyticsResponse['metrics'][0] | null> {
    const wallet = walletAddress.toLowerCase();
    const metric = await metricsService.getMetric(metricSlug);

    if (!metric) return null;

    return this.queryMetricForWallet(wallet, metric);
  }

  // Direct query for a metric
  private async queryMetricForWallet(
    walletAddress: string,
    metric: MetricWithRelations
  ): Promise<UserAnalyticsResponse['metrics'][0]> {
    const contractAddresses = metric.contracts
      .filter(c => c.include_mode === 'include')
      .map(c => c.contract_address);

    if (contractAddresses.length === 0) {
      return this.emptyMetricResult(metric);
    }

    const functionNames = metric.functions
      .filter(f => f.include_mode === 'include')
      .map(f => f.function_name);

    // Determine which table to use
    // Use transaction_details for ETH value (has eth_value column)
    // Use wallet_interactions for count (has all transactions)
    const useTransactionDetails = metric.aggregation_type === 'sum_eth_value';
    
    // Check if data exists in transaction_details for these contracts
    // If not, fall back to wallet_interactions
    let table = useTransactionDetails ? 'transaction_details' : 'wallet_interactions';
    
    if (useTransactionDetails) {
      // Verify transaction_details has data for these contracts
      const checkResult = await query<{ count: string }>(`
        SELECT COUNT(*) as count FROM transaction_details 
        WHERE contract_address = ANY($1) LIMIT 1
      `, [contractAddresses]);
      
      if (parseInt(checkResult[0]?.count || '0') === 0) {
        // Fall back to wallet_interactions (won't have ETH values but will have counts)
        table = 'wallet_interactions';
      }
    }

    // Build query params
    const params: unknown[] = [walletAddress, contractAddresses];
    let functionFilter = '';
    
    if (functionNames.length > 0) {
      functionFilter = 'AND function_name = ANY($3)';
      params.push(functionNames);
    }

    // Query based on aggregation type
    let rows: {
      contract_address: string;
      function_name: string | null;
      tx_count: string;
      eth_total: string;
    }[];

    if (table === 'transaction_details' && metric.aggregation_type === 'sum_eth_value') {
      rows = await query(`
        SELECT 
          contract_address,
          function_name,
          COUNT(*) as tx_count,
          COALESCE(SUM(CAST(eth_value AS NUMERIC) / 1e18), 0) as eth_total
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = ANY($2)
          AND status = 1
          ${functionFilter}
        GROUP BY contract_address, function_name
      `, params);
    } else {
      // Count-based query from wallet_interactions
      rows = await query(`
        SELECT 
          contract_address,
          function_name,
          COUNT(*) as tx_count,
          0 as eth_total
        FROM wallet_interactions
        WHERE wallet_address = $1
          AND contract_address = ANY($2)
          ${functionFilter}
        GROUP BY contract_address, function_name
      `, params);
    }

    if (rows.length === 0) {
      return this.emptyMetricResult(metric);
    }

    // Get ETH price for USD conversion
    const ethPrice = await priceService.getCurrentPrice();

    // Aggregate results
    let totalCount = 0;
    let totalEth = 0;
    const subAggregates: Record<string, SubAggregate> = {};

    for (const row of rows) {
      const contract = row.contract_address.toLowerCase();
      const count = parseInt(row.tx_count);
      const eth = parseFloat(row.eth_total) || 0;

      totalCount += count;
      totalEth += eth;

      // Sub-aggregate by contract
      if (!subAggregates[contract]) {
        subAggregates[contract] = {
          contract_address: contract,
          count: 0,
          eth_value: '0',
          usd_value: '0',
          by_function: {},
        };
      }

      subAggregates[contract].count += count;
      const currentEth = parseFloat(subAggregates[contract].eth_value);
      subAggregates[contract].eth_value = (currentEth + eth).toString();
      subAggregates[contract].usd_value = ((currentEth + eth) * ethPrice).toFixed(2);

      // Sub-aggregate by function
      if (row.function_name) {
        if (!subAggregates[contract].by_function) {
          subAggregates[contract].by_function = {};
        }
        if (!subAggregates[contract].by_function![row.function_name]) {
          subAggregates[contract].by_function![row.function_name] = {
            count: 0,
            eth_value: '0',
            usd_value: '0',
          };
        }
        subAggregates[contract].by_function![row.function_name].count += count;
        const funcEth = parseFloat(subAggregates[contract].by_function![row.function_name].eth_value);
        subAggregates[contract].by_function![row.function_name].eth_value = (funcEth + eth).toString();
        subAggregates[contract].by_function![row.function_name].usd_value = ((funcEth + eth) * ethPrice).toFixed(2);
      }
    }

    const totalUsd = (totalEth * ethPrice).toFixed(2);

    return {
      slug: metric.slug,
      name: metric.name,
      icon: metric.icon,
      currency: metric.currency,
      total_count: totalCount,
      total_value: metric.currency === 'USD' 
        ? totalUsd 
        : metric.currency === 'ETH' 
          ? totalEth.toString() 
          : totalCount.toString(),
      sub_aggregates: Object.values(subAggregates),
      last_updated: new Date(),
    };
  }

  // Return empty result for a metric
  private emptyMetricResult(metric: MetricWithRelations): UserAnalyticsResponse['metrics'][0] {
    return {
      slug: metric.slug,
      name: metric.name,
      icon: metric.icon,
      currency: metric.currency,
      total_count: 0,
      total_value: '0',
      sub_aggregates: [],
      last_updated: new Date(),
    };
  }
}

export const analyticsService = new AnalyticsService();
