import { NextRequest, NextResponse } from 'next/server';
import { getCachedLeaderboard } from '@/lib/leaderboard-cache';

export async function GET(request: NextRequest) {
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ink-score-export-${timestamp}.csv`;

    const cached = await getCachedLeaderboard();
    
    if (!cached) {
      return NextResponse.json(
        { error: 'Leaderboard not cached yet. Please try again later.' },
        { status: 503 }
      );
    }

    const leaderboard = cached.data;
    console.log(`[Export CSV] Exporting ${leaderboard.length} wallets`);

    const csvRows = ['wallet_address,score'];

    for (const wallet of leaderboard) {
      csvRows.push(`${wallet.wallet_address},${wallet.score}`);
    }

    const csvContent = csvRows.join('\n');

    const response = new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

    return response;
  } catch (error) {
    console.error('[Export CSV] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export CSV' },
      { status: 500 }
    );
  }
}
