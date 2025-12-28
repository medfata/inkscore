import { NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';
import { IndexingProgressResponse, IndexingStatus } from '@/lib/types/platforms';
import { query } from '@/lib/db';

// Routescan API configuration
const INK_CHAIN_ID = '57073';
const ROUTESCAN_BASE_URL = 'https://cdn.routescan.io/api/evm/all/transactions';

// Cache for Routescan counts
const routescanCountCache = new Map<string, { count: number; timestamp: number }>();
const CACHE_TTL_MS = 60000;

async function getRoutescanCount(contractAddress: string): Promise<number> {
  const cached = routescanCountCache.get(contractAddress.toLowerCase());
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.count;
  }

  try {
    const params = new URLSearchParams({
      fromAddresses: contractAddress,
      toAddresses: contractAddress,
      includedChainIds: INK_CHAIN_ID,
      count: 'true',
      limit: '1',
    });

    const response = await fetch(`${ROUTESCAN_BASE_URL}?${params.toString()}`);
    if (!response.ok) {
      return cached?.count || 0;
    }

    const data = await response.json();
    const count = data.count || 0;

    routescanCountCache.set(contractAddress.toLowerCase(), {
      count,
      timestamp: Date.now(),
    });

    return count;
  } catch {
    return cached?.count || 0;
  }
}

// GET /api/admin/indexing/progress - Get indexing progress for all platforms
export async function GET() {
  try {
    // Get all data in parallel
    const [platforms, globalStats, allContractsWithPlatforms, txCounts] = await Promise.all([
      platformsService.getAllPlatforms(true),
      platformsService.getGlobalStats(),
      // Get all contracts with their platform mappings
      query<{
        platform_id: number;
        contract_address: string;
        contract_name: string;
        indexing_status: string;
        fetch_transactions: boolean;
      }>(`
        SELECT 
          pc.platform_id,
          c.address as contract_address,
          c.name as contract_name,
          c.indexing_status,
          c.fetch_transactions
        FROM platform_contracts pc
        JOIN contracts c ON pc.contract_id = c.id
        WHERE c.is_active = true
        ORDER BY c.name ASC
      `),
      // Get transaction counts per contract
      query<{ contract_address: string; tx_count: string }>(`
        SELECT LOWER(contract_address) as contract_address, COUNT(*)::text as tx_count
        FROM transaction_details
        GROUP BY LOWER(contract_address)
      `),
    ]);

    const txCountMap = new Map(txCounts.map((t) => [t.contract_address, parseInt(t.tx_count, 10)]));

    // Group contracts by platform_id and calculate progress
    const contractsByPlatform = new Map<number, Array<{
      address: string;
      name: string;
      indexing_status: IndexingStatus;
      progress_percent: number;
      current_block: number;
      total_blocks: number;
    }>>();

    for (const row of allContractsWithPlatforms) {
      const totalIndexed = txCountMap.get(row.contract_address.toLowerCase()) || 0;
      
      // Get API total count for tx-based contracts
      let apiTotalCount = totalIndexed;
      if (row.fetch_transactions) {
        apiTotalCount = await getRoutescanCount(row.contract_address);
      }

      // Consider complete if we have at least (apiTotal - 100) transactions
      const isComplete = row.indexing_status === 'complete' ||
        (apiTotalCount > 0 && totalIndexed >= apiTotalCount - 100);

      const progressPercent = apiTotalCount > 0
        ? Math.min(100, Math.round((totalIndexed / apiTotalCount) * 100))
        : isComplete ? 100 : 0;

      let status: IndexingStatus;
      if (isComplete) {
        status = 'complete';
      } else if (row.indexing_status === 'indexing' || totalIndexed > 0) {
        status = 'indexing';
      } else if (row.indexing_status === 'error') {
        status = 'error';
      } else {
        status = 'pending';
      }

      const contracts = contractsByPlatform.get(row.platform_id) || [];
      contracts.push({
        address: row.contract_address,
        name: row.contract_name,
        indexing_status: status,
        progress_percent: progressPercent,
        current_block: totalIndexed,
        total_blocks: apiTotalCount,
      });
      contractsByPlatform.set(row.platform_id, contracts);
    }

    const platformsWithProgress: IndexingProgressResponse['platforms'] = platforms.map(platform => ({
      id: platform.id,
      name: platform.name,
      logo_url: platform.logo_url,
      contracts: contractsByPlatform.get(platform.id) || [],
    }));

    const response: IndexingProgressResponse = {
      platforms: platformsWithProgress,
      global_stats: globalStats,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch indexing progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch indexing progress' },
      { status: 500 }
    );
  }
}
