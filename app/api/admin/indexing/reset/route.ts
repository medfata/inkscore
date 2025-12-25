import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// POST /api/admin/indexing/reset - Reset indexing data for a specific contract
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contract_address } = body;

    if (!contract_address) {
      return NextResponse.json(
        { error: 'contract_address is required' },
        { status: 400 }
      );
    }

    const normalizedAddress = contract_address.toLowerCase();

    // Start a transaction to ensure all deletions happen atomically
    // Delete in correct order to respect foreign key constraints

    // 1. Delete from transaction_details (child table)
    const txResult = await query<{ count: string }>(
      `WITH deleted AS (
        DELETE FROM transaction_details 
        WHERE LOWER(contract_address) = $1
        RETURNING 1
      ) SELECT COUNT(*) as count FROM deleted`,
      [normalizedAddress]
    );
    const deletedTxCount = parseInt(txResult[0]?.count || '0');

    // 2. Delete from wallet_interactions
    const interactionsResult = await query<{ count: string }>(
      `WITH deleted AS (
        DELETE FROM wallet_interactions 
        WHERE LOWER(contract_address) = $1
        RETURNING 1
      ) SELECT COUNT(*) as count FROM deleted`,
      [normalizedAddress]
    );
    const deletedInteractionsCount = parseInt(interactionsResult[0]?.count || '0');

    // 3. Reset the cursor in tx_indexer_cursors
    await query(
      `UPDATE tx_indexer_cursors 
       SET last_next_token = NULL, 
           total_indexed = 0, 
           api_total_count = 0, 
           is_complete = FALSE, 
           updated_at = NOW()
       WHERE LOWER(contract_address) = $1`,
      [normalizedAddress]
    );

    // 4. Update contract status back to pending and reset total_indexed
    await query(
      `UPDATE contracts 
       SET indexing_status = 'pending',
           progress_percent = 0,
           current_block = 0,
           total_indexed = 0,
           error_message = NULL,
           updated_at = NOW()
       WHERE LOWER(address) = $1`,
      [normalizedAddress]
    );

    return NextResponse.json({
      success: true,
      message: 'Indexing data reset successfully',
      deleted: {
        transaction_details: deletedTxCount,
        wallet_interactions: deletedInteractionsCount,
      },
      contract_address: normalizedAddress,
    });
  } catch (error) {
    console.error('Failed to reset indexing data:', error);
    return NextResponse.json(
      { error: 'Failed to reset indexing data', details: String(error) },
      { status: 500 }
    );
  }
}
