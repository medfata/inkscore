import { query } from '../db';
import { metricsService } from './metrics-service';
import { priceService } from './price-service';
import {
  MetricWithRelations,
  SubAggregate,
  UserAnalyticsResponse,
} from '../types/analytics';
import { createPublicClient, http, decodeFunctionData, parseAbi, erc20Abi } from 'viem';

// RPC endpoint for fetching transaction input data
const RPC_URL = process.env.RPC_URL || 'https://rpc-gel.inkonchain.com';

// WETH address on Ink chain (for ETH-equivalent tokens)
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006'.toLowerCase();

// Known token configurations on Ink chain (lowercase addresses)
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number; usdPegged?: boolean; coingeckoId?: string }> = {
  // Stablecoins (1:1 with USD)
  '0x0200c29006150606b650577bbe7b6248f58470c1': { symbol: 'USDT0', decimals: 6, usdPegged: true },
  '0xeb466342c4d449bc9f53a865d5cb90586f405215': { symbol: 'axlUSDC', decimals: 6, usdPegged: true },
  '0xf93d5ae5e9a3b91eb8f2962f74f8930c5d89b2b3': { symbol: 'USDC', decimals: 6, usdPegged: true },
  // WETH (use ETH price)
  [WETH_ADDRESS]: { symbol: 'WETH', decimals: 18, coingeckoId: 'ethereum' },
};

// Functions where the USD value needs to be extracted from input parameters
const DEFI_FUNCTIONS: Record<string, { assetIndex: number; amountIndex: number; abi: string }> = {
  'borrow': {
    assetIndex: 0,
    amountIndex: 1,
    abi: 'function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf)'
  },
  'supply': {
    assetIndex: 0,
    amountIndex: 1,
    abi: 'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
  },
  'deposit': {
    assetIndex: 0,
    amountIndex: 1,
    abi: 'function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
  },
  'repay': {
    assetIndex: 0,
    amountIndex: 1,
    abi: 'function repay(address asset, uint256 amount, uint256 interestRateMode, address onBehalfOf)'
  },
  'withdraw': {
    assetIndex: 0,
    amountIndex: 1,
    abi: 'function withdraw(address asset, uint256 amount, address to)'
  },
};

// Functions where the value is ETH in input parameters (not tx.value)
const ETH_PARAM_FUNCTIONS: Record<string, { amountIndex: number; abi: string }> = {
  'borrowETH': {
    amountIndex: 1,
    abi: 'function borrowETH(address, uint256 amount, uint16 referralCode)'
  },
  'repayETH': {
    amountIndex: 1,
    abi: 'function repayETH(address, uint256 amount, address onBehalfOf)'
  },
  'withdrawETH': {
    amountIndex: 1,
    abi: 'function withdrawETH(address, uint256 amount, address to)'
  },
};

// Simple in-memory cache for token prices (5 minute TTL)
const tokenPriceCache: Map<string, { price: number; timestamp: number }> = new Map();
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Response cache for wallet analytics (30 second TTL)
const analyticsCache: Map<string, { data: UserAnalyticsResponse; timestamp: number }> = new Map();
const ANALYTICS_CACHE_TTL = 30 * 1000; // 30 seconds


export class AnalyticsService {
  private rpcClient = createPublicClient({
    transport: http(RPC_URL),
  });

  // Get token info (decimals, symbol) - fetches from RPC if not known
  private async getTokenInfo(tokenAddress: string): Promise<{ decimals: number; symbol: string }> {
    const addr = tokenAddress.toLowerCase();

    // Check known tokens first
    if (KNOWN_TOKENS[addr]) {
      return { decimals: KNOWN_TOKENS[addr].decimals, symbol: KNOWN_TOKENS[addr].symbol };
    }

    // Fetch from RPC
    try {
      const [decimals, symbol] = await Promise.all([
        this.rpcClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'decimals',
        }),
        this.rpcClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: 'symbol',
        }),
      ]);
      return { decimals: Number(decimals), symbol: symbol as string };
    } catch {
      return { decimals: 18, symbol: 'UNKNOWN' };
    }
  }

  // Get token price in USD
  private async getTokenPriceUsd(tokenAddress: string, ethPrice: number): Promise<number> {
    const addr = tokenAddress.toLowerCase();

    // Check cache first
    const cached = tokenPriceCache.get(addr);
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
      return cached.price;
    }

    let price = 0;

    // Check known tokens
    const knownToken = KNOWN_TOKENS[addr];
    if (knownToken) {
      if (knownToken.usdPegged) {
        price = 1;
      } else if (knownToken.coingeckoId === 'ethereum' || addr === WETH_ADDRESS) {
        price = ethPrice;
      } else if (knownToken.coingeckoId) {
        price = await this.fetchCoinGeckoPrice(knownToken.coingeckoId);
      }
    }

    // If still no price, try to detect token type
    if (price === 0) {
      const tokenInfo = await this.getTokenInfo(addr);
      const symbol = tokenInfo.symbol.toUpperCase();

      if (symbol.includes('USD') || symbol.includes('DAI') || symbol.includes('FRAX')) {
        price = 1;
      } else if (symbol === 'WETH' || symbol === 'ETH') {
        price = ethPrice;
      } else {
        console.warn(`Unknown token price for ${symbol} (${addr}), using 0`);
        price = 0;
      }
    }

    // Cache the price
    tokenPriceCache.set(addr, { price, timestamp: Date.now() });

    return price;
  }

  // Fetch price from CoinGecko by ID
  private async fetchCoinGeckoPrice(coingeckoId: string): Promise<number> {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
      );
      if (!response.ok) return 0;
      const data = await response.json() as Record<string, { usd?: number }>;
      return data[coingeckoId]?.usd || 0;
    } catch {
      return 0;
    }
  }


  // Fetch USD value from DeFi transactions (borrow, supply, etc.)
  private async getDefiUsdValues(
    walletAddress: string,
    contractAddresses: string[],
    functionName: string,
    ethPrice: number
  ): Promise<Map<string, number>> {
    const valueMap = new Map<string, number>();

    const defiConfig = DEFI_FUNCTIONS[functionName];
    const ethParamConfig = ETH_PARAM_FUNCTIONS[functionName];

    if (!defiConfig && !ethParamConfig) return valueMap;

    try {
      const abi = parseAbi([defiConfig?.abi || ethParamConfig?.abi || '']);

      const txRows = await query<{ tx_hash: string; input: string }>(`
        SELECT te.tx_hash, te.input 
        FROM transaction_enrichment te
        JOIN transaction_details td ON te.tx_hash = td.tx_hash
        WHERE td.wallet_address = $1
          AND td.contract_address = ANY($2)
          AND td.function_name = $3
          AND td.status = 1
          AND te.input IS NOT NULL
      `, [walletAddress, contractAddresses, functionName]);

      for (const row of txRows) {
        try {
          if (row.input && row.input.length > 10) {
            const decoded = decodeFunctionData({
              abi,
              data: row.input as `0x${string}`,
            });

            if (defiConfig) {
              const asset = decoded.args?.[defiConfig.assetIndex] as string;
              const amount = decoded.args?.[defiConfig.amountIndex] as bigint;

              if (asset && typeof amount === 'bigint') {
                const tokenInfo = await this.getTokenInfo(asset);
                const tokenPrice = await this.getTokenPriceUsd(asset, ethPrice);
                const tokenAmount = Number(amount) / Math.pow(10, tokenInfo.decimals);
                const usdValue = tokenAmount * tokenPrice;
                valueMap.set(row.tx_hash.toLowerCase(), usdValue);
              }
            } else if (ethParamConfig) {
              const amount = decoded.args?.[ethParamConfig.amountIndex] as bigint;
              if (typeof amount === 'bigint') {
                const ethAmount = Number(amount) / 1e18;
                const usdValue = ethAmount * ethPrice;
                valueMap.set(row.tx_hash.toLowerCase(), usdValue);
              }
            }
          }
        } catch (err) {
          console.error(`Failed to decode tx ${row.tx_hash}:`, err);
        }
      }
    } catch (err) {
      console.error(`Error processing input data for ${functionName}:`, err);
    }

    return valueMap;
  }

  // Get all analytics for a wallet (with response caching)
  async getWalletAnalytics(walletAddress: string): Promise<UserAnalyticsResponse> {
    const wallet = walletAddress.toLowerCase();

    // Check cache first
    const cached = analyticsCache.get(wallet);
    if (cached && Date.now() - cached.timestamp < ANALYTICS_CACHE_TTL) {
      return cached.data;
    }

    const metrics = await metricsService.getAllMetrics(true);

    // Process all metrics in parallel for better performance
    const metricPromises = metrics.map(metric => this.queryMetricForWallet(wallet, metric));
    const metricsData = await Promise.all(metricPromises);

    const result: UserAnalyticsResponse = {
      wallet_address: wallet,
      metrics: metricsData,
    };

    // Cache the result
    analyticsCache.set(wallet, { data: result, timestamp: Date.now() });

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

    if (metric.aggregation_type === 'sum_eth_value') {
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
      rows = await query(`
        SELECT 
          contract_address,
          function_name,
          COUNT(*) as tx_count,
          0 as eth_total
        FROM transaction_details
        WHERE wallet_address = $1
          AND contract_address = ANY($2)
          AND status = 1
          ${functionFilter}
        GROUP BY contract_address, function_name
      `, params);
    }

    if (rows.length === 0) {
      return this.emptyMetricResult(metric);
    }

    // Get ETH price for USD conversion
    const ethPrice = await priceService.getCurrentPrice();

    // Check if any functions need value extraction from input data
    const functionsNeedingInputData = functionNames.filter(fn => DEFI_FUNCTIONS[fn] || ETH_PARAM_FUNCTIONS[fn]);

    // Map to store USD values from input data
    const inputDataUsdValues = new Map<string, number>();

    // Fetch input data values for special functions
    for (const funcName of functionsNeedingInputData) {
      const values = await this.getDefiUsdValues(walletAddress, contractAddresses, funcName, ethPrice);
      values.forEach((value, hash) => inputDataUsdValues.set(hash, value));
    }

    // Aggregate results
    let totalCount = 0;
    let totalEth = 0;
    const subAggregates: Record<string, SubAggregate> = {};

    for (const row of rows) {
      const contract = row.contract_address.toLowerCase();
      const count = parseInt(row.tx_count);
      let eth = parseFloat(row.eth_total) || 0;
      let usdFromInput = 0;

      const funcName = row.function_name;
      const needsInputData = funcName && (DEFI_FUNCTIONS[funcName] || ETH_PARAM_FUNCTIONS[funcName]);

      if (needsInputData && inputDataUsdValues.size > 0) {
        const txValueRows = await query<{ tx_hash: string }>(`
          SELECT tx_hash 
          FROM transaction_details
          WHERE wallet_address = $1
            AND contract_address = $2
            AND function_name = $3
            AND status = 1
        `, [walletAddress, contract, funcName]);

        for (const txRow of txValueRows) {
          const usdValue = inputDataUsdValues.get(txRow.tx_hash.toLowerCase());
          if (usdValue !== undefined) {
            usdFromInput += usdValue;
          }
        }

        eth = usdFromInput / ethPrice;
      }

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
