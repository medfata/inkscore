import { NextRequest, NextResponse } from 'next/server';
import { contractsService } from '@/lib/services/contracts-service';

// GET /api/admin/contracts - List all contracts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const activeOnly = searchParams.get('active') === 'true';

    let contracts;
    if (category) {
      contracts = await contractsService.getContractsByCategory(category);
    } else {
      contracts = await contractsService.getAllContracts(activeOnly);
    }

    return NextResponse.json({ contracts });
  } catch (error) {
    console.error('Error fetching contracts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contracts' },
      { status: 500 }
    );
  }
}

// POST /api/admin/contracts - Create or update contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.address) {
      return NextResponse.json(
        { error: 'Contract address is required' },
        { status: 400 }
      );
    }

    const contract = await contractsService.upsertContract(body);
    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Error creating contract:', error);
    return NextResponse.json(
      { error: 'Failed to create contract' },
      { status: 500 }
    );
  }
}
