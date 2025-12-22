import { NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';
import { IndexingProgressResponse } from '@/lib/types/platforms';
import { query } from '@/lib/db';

// GET /api/admin/indexing/progress - Get indexing progress for all platforms
export async function GET() {
  try {
    // Get all data in parallel with optimized queries
    const [platforms, globalStats, allContractsWithPlatforms] = await Promise.all([
      platformsService.getAllPlatforms(true),
      platformsService.getGlobalStats(),
      // Single query to get all contracts with their platform mappings
      query<{
        platform_id: number;
        contract_address: string;
        contract_name: string;
        indexing_status: string;
        progress_percent: string;
        current_block: string;
        total_blocks: string;
      }>(`
        SELECT 
          pc.platform_id,
          c.address as contract_address,
          c.name as contract_name,
          c.indexing_status,
          c.progress_percent,
          c.current_block,
          c.total_blocks
        FROM platform_contracts pc
        JOIN contracts c ON pc.contract_id = c.id
        WHERE c.is_active = true
        ORDER BY c.name ASC
      `),
    ]);

    // Group contracts by platform_id
    const contractsByPlatform = new Map<number, Array<{
      address: string;
      name: string;
      indexing_status: string;
      progress_percent: string;
      current_block: string;
      total_blocks: string;
    }>>();

    for (const row of allContractsWithPlatforms) {
      const contracts = contractsByPlatform.get(row.platform_id) || [];
      contracts.push({
        address: row.contract_address,
        name: row.contract_name,
        indexing_status: row.indexing_status,
        progress_percent: row.progress_percent,
        current_block: row.current_block,
        total_blocks: row.total_blocks,
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
