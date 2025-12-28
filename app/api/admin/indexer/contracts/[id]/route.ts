import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryWithCount } from '@/lib/db';

interface IndexerContract {
  id: number;
  chain_id: number;
  address: string;
  name: string | null;
  deploy_block: number;
  index_type: 'COUNT_TX' | 'USD_VOLUME';
  abi: any | null;
  is_active: boolean;
  created_at: Date;
}

// GET /api/admin/indexer/contracts/[id] - Get single contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = parseInt(id);

    if (isNaN(contractId)) {
      return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });
    }

    const contract = await queryOne<IndexerContract & { chain_name: string }>(`
      SELECT c.*, ch.name as chain_name
      FROM contracts_to_index c
      LEFT JOIN chain_config ch ON c.chain_id = ch.chain_id
      WHERE c.id = $1
    `, [contractId]);

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Failed to fetch contract:', error);
    return NextResponse.json({ error: 'Failed to fetch contract' }, { status: 500 });
  }
}

// PUT /api/admin/indexer/contracts/[id] - Update contract
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = parseInt(id);
    const body = await request.json();

    if (isNaN(contractId)) {
      return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(body.name);
    }
    if (body.deploy_block !== undefined) {
      updates.push(`deploy_block = $${paramIndex++}`);
      values.push(body.deploy_block);
    }
    if (body.index_type !== undefined) {
      if (!['COUNT_TX', 'USD_VOLUME'].includes(body.index_type)) {
        return NextResponse.json({ error: 'Invalid index_type' }, { status: 400 });
      }
      updates.push(`index_type = $${paramIndex++}`);
      values.push(body.index_type);
    }
    if (body.abi !== undefined) {
      updates.push(`abi = $${paramIndex++}`);
      values.push(body.abi ? JSON.stringify(body.abi) : null);
    }
    if (body.is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(body.is_active);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(contractId);

    const contract = await queryOne<IndexerContract>(`
      UPDATE contracts_to_index
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    return NextResponse.json({ contract });
  } catch (error) {
    console.error('Failed to update contract:', error);
    return NextResponse.json({ error: 'Failed to update contract' }, { status: 500 });
  }
}

// DELETE /api/admin/indexer/contracts/[id] - Delete contract and all indexed data
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const contractId = parseInt(id);

    if (isNaN(contractId)) {
      return NextResponse.json({ error: 'Invalid contract ID' }, { status: 400 });
    }

    // Get contract info first
    const contract = await queryOne<IndexerContract>(
      'SELECT * FROM contracts_to_index WHERE id = $1',
      [contractId]
    );

    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

    const deletedCounts = {
      contract: contract.address,
      indexer_ranges: 0,
      transaction_details: 0,
      wallet_interactions: 0,
      tx_indexer_cursors: 0,
    };

    // Delete associated indexer ranges
    const rangesResult = await queryWithCount(
      'DELETE FROM indexer_ranges WHERE chain_id = $1 AND LOWER(contract_address) = LOWER($2)',
      [contract.chain_id, contract.address]
    );
    deletedCounts.indexer_ranges = rangesResult.rowCount || 0;

    // Delete transaction details for this contract
    const txDetailsResult = await queryWithCount(
      'DELETE FROM transaction_details WHERE LOWER(contract_address) = LOWER($1)',
      [contract.address]
    );
    deletedCounts.transaction_details = txDetailsResult.rowCount || 0;

    // Delete wallet interactions for this contract
    const interactionsResult = await queryWithCount(
      'DELETE FROM wallet_interactions WHERE LOWER(contract_address) = LOWER($1)',
      [contract.address]
    );
    deletedCounts.wallet_interactions = interactionsResult.rowCount || 0;

    // Delete tx indexer cursor for this contract
    const cursorResult = await queryWithCount(
      'DELETE FROM tx_indexer_cursors WHERE LOWER(contract_address) = LOWER($1)',
      [contract.address]
    );
    deletedCounts.tx_indexer_cursors = cursorResult.rowCount || 0;

    // Delete the contract itself
    await query('DELETE FROM contracts_to_index WHERE id = $1', [contractId]);

    return NextResponse.json({
      success: true,
      deleted: deletedCounts,
      message: `Deleted contract ${contract.name || contract.address} and all associated data`
    });
  } catch (error) {
    console.error('Failed to delete contract:', error);
    return NextResponse.json({ error: 'Failed to delete contract' }, { status: 500 });
  }
}
