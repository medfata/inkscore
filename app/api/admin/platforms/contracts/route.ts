import { NextRequest, NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';
import { query } from '@/lib/db';

// GET /api/admin/platforms/contracts - List all contracts (simplified)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    // Simple query from contracts table with platform information
    const contracts = await query<{
      id: number;
      address: string;
      name: string;
      deploy_block: number;
      fetch_transactions: boolean;
      indexing_enabled: boolean;
      indexing_status: string;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
      platform_names: string | null;
    }>(`
      SELECT 
        c.id,
        c.address,
        c.name,
        c.deploy_block,
        c.fetch_transactions,
        c.indexing_enabled,
        c.indexing_status,
        c.is_active,
        c.created_at,
        c.updated_at,
        STRING_AGG(p.name, ', ') as platform_names
      FROM contracts c
      LEFT JOIN platform_contracts pc ON c.id = pc.contract_id
      LEFT JOIN platforms p ON pc.platform_id = p.id
      ${activeOnly ? 'WHERE c.is_active = true' : ''}
      GROUP BY c.id, c.address, c.name, c.deploy_block, c.fetch_transactions, 
               c.indexing_enabled, c.indexing_status, c.is_active, c.created_at, c.updated_at
      ORDER BY c.name ASC
    `);

    // Transform to match expected format
    const contractsWithPlatforms = contracts.map(contract => ({
      ...contract,
      platforms: contract.platform_names 
        ? contract.platform_names.split(', ').map(name => ({ name }))
        : [],
      tx_count: 0, // Simplified - no stats
      unique_wallets: 0, // Simplified - no stats
    }));

    return NextResponse.json({ contracts: contractsWithPlatforms });
  } catch (error) {
    console.error('Failed to fetch contracts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contracts' },
      { status: 500 }
    );
  }
}

// POST /api/admin/platforms/contracts - Create a new contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.address || !body.name) {
      return NextResponse.json(
        { error: 'Missing required fields: address, name' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      return NextResponse.json(
        { error: 'Invalid contract address format' },
        { status: 400 }
      );
    }

    // Validate creation date for new hybrid indexer
    if (!body.creation_date) {
      return NextResponse.json(
        { error: 'Creation date is required for hybrid indexing' },
        { status: 400 }
      );
    }

    // Check if address already exists
    const existing = await platformsService.getContractByAddress(body.address);
    if (existing) {
      return NextResponse.json(
        { error: 'Contract with this address already exists' },
        { status: 409 }
      );
    }

    const contract = await platformsService.createContract({
      address: body.address,
      name: body.name,
      deploy_block: body.deploy_block || 0,
      fetch_transactions: body.fetch_transactions ?? true,
      platform_ids: body.platform_ids || [],
      contract_type: body.contract_type || 'count',
      creation_date: body.creation_date,
    });

    return NextResponse.json({ contract }, { status: 201 });
  } catch (error) {
    console.error('Failed to create contract:', error);
    return NextResponse.json(
      { error: 'Failed to create contract' },
      { status: 500 }
    );
  }
}
