import { NextRequest, NextResponse } from 'next/server';
import { contractsService } from '@/lib/services/contracts-service';

// GET /api/admin/contracts/[address] - Get single contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const contract = await contractsService.getContract(address);

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }

    // Get stats
    const stats = await contractsService.getContractStats(address);

    return NextResponse.json({ contract, stats });
  } catch (error) {
    console.error('Error fetching contract:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contract' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/contracts/[address] - Update contract
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const body = await request.json();

    const contract = await contractsService.updateContract(address, body);

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Error updating contract:', error);
    return NextResponse.json(
      { error: 'Failed to update contract' },
      { status: 500 }
    );
  }
}
