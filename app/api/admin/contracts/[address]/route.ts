import { NextRequest, NextResponse } from 'next/server';
import { contractsService } from '@/lib/services/contracts-service';
import { query, queryWithCount } from '@/lib/db';

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

// DELETE /api/admin/contracts/[address] - Delete contract and all indexed data
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const normalizedAddress = address.toLowerCase();

    const deletedCounts = {
      contract: normalizedAddress,
      transaction_details: 0,
      wallet_interactions: 0,
      tx_indexer_cursors: 0,
      indexer_ranges: 0,
      contracts_to_index: 0,
      contracts: 0,
      platform_contracts: 0,
      contracts_metadata: 0,
    };

    // Delete transaction details
    const txResult = await queryWithCount(
      'DELETE FROM transaction_details WHERE LOWER(contract_address) = $1',
      [normalizedAddress]
    );
    deletedCounts.transaction_details = txResult.rowCount || 0;

    // Delete wallet interactions
    const interactionsResult = await queryWithCount(
      'DELETE FROM wallet_interactions WHERE LOWER(contract_address) = $1',
      [normalizedAddress]
    );
    deletedCounts.wallet_interactions = interactionsResult.rowCount || 0;

    // Delete tx indexer cursor
    const cursorResult = await queryWithCount(
      'DELETE FROM tx_indexer_cursors WHERE LOWER(contract_address) = $1',
      [normalizedAddress]
    );
    deletedCounts.tx_indexer_cursors = cursorResult.rowCount || 0;

    // Delete indexer ranges
    const rangesResult = await queryWithCount(
      'DELETE FROM indexer_ranges WHERE LOWER(contract_address) = $1',
      [normalizedAddress]
    );
    deletedCounts.indexer_ranges = rangesResult.rowCount || 0;

    // Delete from contracts_to_index (indexer config)
    const indexerContractResult = await queryWithCount(
      'DELETE FROM contracts_to_index WHERE LOWER(address) = $1',
      [normalizedAddress]
    );
    deletedCounts.contracts_to_index = indexerContractResult.rowCount || 0;

    // Delete from platform_contracts junction table (must be before contracts)
    const platformContractsResult = await queryWithCount(
      `DELETE FROM platform_contracts WHERE contract_id IN (
        SELECT id FROM contracts WHERE LOWER(address) = $1
      )`,
      [normalizedAddress]
    );
    deletedCounts.platform_contracts = platformContractsResult.rowCount || 0;

    // Delete from contracts table (platforms service)
    const contractsResult = await queryWithCount(
      'DELETE FROM contracts WHERE LOWER(address) = $1',
      [normalizedAddress]
    );
    deletedCounts.contracts = contractsResult.rowCount || 0;

    // Delete from contracts_metadata
    const metadataResult = await queryWithCount(
      'DELETE FROM contracts_metadata WHERE LOWER(address) = $1',
      [normalizedAddress]
    );
    deletedCounts.contracts_metadata = metadataResult.rowCount || 0;

    // Check if anything was deleted
    const totalDeleted = Object.values(deletedCounts).filter(v => typeof v === 'number').reduce((a, b) => a + (b as number), 0);
    if (totalDeleted === 0) {
      return NextResponse.json(
        { error: 'Contract not found in any table' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      deleted: deletedCounts,
      message: `Deleted contract ${address} and all associated data`
    });
  } catch (error) {
    console.error('Error deleting contract:', error);
    return NextResponse.json(
      { error: 'Failed to delete contract' },
      { status: 500 }
    );
  }
}
