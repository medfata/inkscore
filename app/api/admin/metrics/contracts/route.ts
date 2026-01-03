import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/admin/metrics/contracts - Get all contracts for metrics configuration
export async function GET() {
  try {
    const contracts = await query<{
      address: string;
      name: string;
      is_active: boolean;
    }>(`
      SELECT 
        address,
        name,
        is_active
      FROM contracts
      WHERE is_active = true
      ORDER BY name ASC
    `);

    return NextResponse.json({ contracts });
  } catch (error) {
    console.error('Failed to fetch contracts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contracts' },
      { status: 500 }
    );
  }
}