import { NextResponse } from 'next/server';
import { priceService } from '@/lib/services/price-service';

export const revalidate = 60;

// GET /api/prices/eth - Get current ETH price
export async function GET() {
  try {
    const price = await priceService.getCurrentPrice();

    return NextResponse.json({
      price_usd: price,
      timestamp: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ETH price' },
      { status: 500 }
    );
  }
}
