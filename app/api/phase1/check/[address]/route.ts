import { NextRequest, NextResponse } from 'next/server';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

// GET /api/phase1/check/[address] - Check if wallet is in Phase 1
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const walletAddress = address.toLowerCase();

    // Fetch from Express server
    const response = await fetch(`${API_SERVER_URL}/api/phase1/check/${walletAddress}`);
    
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to check Phase 1 status' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error checking Phase 1 status:', error);
    return NextResponse.json(
      { error: 'Failed to check Phase 1 status' },
      { status: 500 }
    );
  }
}
