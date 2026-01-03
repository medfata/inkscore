import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Simple GET /api/admin/indexing/progress - Just return basic contract info
export async function GET() {
  try {
    // Just get basic contract information from the contracts table
    const contracts = await query<{
      address: string;
      name: string;
      indexing_status: string;
      is_active: boolean;
    }>(`
      SELECT 
        address,
        name,
        indexing_status,
        is_active
      FROM contracts
      WHERE is_active = true
      ORDER BY name ASC
    `);

    const response = {
      contracts: contracts.map(contract => ({
        address: contract.address,
        name: contract.name,
        indexing_status: contract.indexing_status,
        progress_percent: contract.indexing_status === 'complete' ? 100 : 0,
        current_block: 0,
        total_blocks: 0,
      })),
      global_stats: {
        total_contracts: contracts.length,
        contracts_complete: contracts.filter(c => c.indexing_status === 'complete').length,
        contracts_indexing: contracts.filter(c => c.indexing_status === 'indexing').length,
        total_transactions: 0,
        total_unique_wallets: 0,
      },
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
