import { NextRequest, NextResponse } from 'next/server';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

// Cache successful responses for 5 minutes
export const revalidate = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;

    const response = await fetch(`${API_SERVER_URL}/api/cryptoclash/${wallet}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout for production
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    const data = await response.json();
    
    return NextResponse.json(data, { 
      status: response.status,
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('[CryptoClash] API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch CryptoClash data' },
      { status: 500 }
    );
  }
}
