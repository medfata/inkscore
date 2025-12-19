import { NextRequest, NextResponse } from 'next/server';
import { priceService } from '@/lib/services/price-service';

// POST /api/prices/eth/sync - Sync historical ETH prices
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '90');

    await priceService.syncHistoricalPrices(days);

    return NextResponse.json({
      success: true,
      message: `Synced ${days} days of historical prices`,
    });
  } catch (error) {
    console.error('Error syncing ETH prices:', error);
    return NextResponse.json(
      { error: 'Failed to sync ETH prices' },
      { status: 500 }
    );
  }
}
