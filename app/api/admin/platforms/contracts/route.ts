import { NextRequest, NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';

// GET /api/admin/platforms/contracts - List all contracts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    // Use optimized batch query instead of N+1 queries
    const contractsWithRelations = await platformsService.getAllContractsWithStatsAndPlatforms(activeOnly);

    return NextResponse.json({ contracts: contractsWithRelations });
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
