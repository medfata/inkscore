import { NextRequest, NextResponse } from 'next/server';
import { platformsService } from '@/lib/services/platforms-service';

// GET /api/admin/platforms/contracts/[address] - Get a single contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const contract = await platformsService.getContractByAddress(address);
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const contractWithPlatforms = await platformsService.getContractWithPlatforms(contract.id);
    const stats = await platformsService.getContractStats(address);

    return NextResponse.json({ contract: contractWithPlatforms, stats });
  } catch (error) {
    console.error('Failed to fetch contract:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contract' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/platforms/contracts/[address] - Update a contract
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const body = await request.json();

    const existing = await platformsService.getContractByAddress(address);
    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const contract = await platformsService.updateContract(existing.id, body);
    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Failed to update contract:', error);
    return NextResponse.json(
      { error: 'Failed to update contract' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/platforms/contracts/[address] - Delete a contract
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const existing = await platformsService.getContractByAddress(address);
    if (!existing) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const deleted = await platformsService.deleteContract(existing.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Failed to delete contract' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete contract:', error);
    return NextResponse.json(
      { error: 'Failed to delete contract' },
      { status: 500 }
    );
  }
}
