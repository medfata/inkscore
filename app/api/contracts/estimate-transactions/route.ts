import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return NextResponse.json({ error: 'Invalid contract address' }, { status: 400 });
  }

  try {
    // Call Routescan API to get transaction count
    const response = await fetch(
      `https://cdn.routescan.io/api/evm/57073/address/${address}/transactions?limit=1`,
      {
        headers: {
          'accept': '*/*',
          'cache-control': 'no-cache',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Routescan API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract total count from response
    // The exact structure depends on Routescan API response format
    const totalCount = data.total || data.count || 0;

    return NextResponse.json({ 
      count: totalCount,
      address: address 
    });

  } catch (error) {
    console.error('Error estimating transactions:', error);
    return NextResponse.json(
      { error: 'Failed to estimate transaction count' }, 
      { status: 500 }
    );
  }
}