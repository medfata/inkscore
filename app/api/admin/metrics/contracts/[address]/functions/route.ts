import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/admin/metrics/contracts/[address]/functions - Get distinct functions for a contract
export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    const functions = await query<{
      function_name: string;
    }>(`
      SELECT DISTINCT function_name
      FROM transaction_details
      WHERE contract_address = $1
      AND function_name IS NOT NULL
      ORDER BY function_name ASC
    `, [address.toLowerCase()]);

    return NextResponse.json({ 
      contract_address: address,
      functions: functions.map(f => f.function_name)
    });
  } catch (error) {
    console.error('Failed to fetch contract functions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contract functions' },
      { status: 500 }
    );
  }
}