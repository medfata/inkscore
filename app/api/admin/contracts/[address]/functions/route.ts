import { NextRequest, NextResponse } from 'next/server';
import { metricsService } from '@/lib/services/metrics-service';

// GET /api/admin/contracts/[address]/functions - Get functions for a contract
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const functions = await metricsService.getContractFunctions(address);

    return NextResponse.json({ functions });
  } catch (error) {
    console.error('Error fetching contract functions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contract functions' },
      { status: 500 }
    );
  }
}
