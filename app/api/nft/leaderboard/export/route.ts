import { NextRequest, NextResponse } from 'next/server';
import { getCachedLeaderboard } from '@/lib/leaderboard-cache';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';

    if (format !== 'csv') {
      return NextResponse.json({ error: 'Only CSV format is supported' }, { status: 400 });
    }

    const cached = await getCachedLeaderboard();
    
    if (!cached) {
      return NextResponse.json(
        { error: 'Leaderboard not cached yet. Please try again later.' },
        { status: 503 }
      );
    }

    const leaderboard = cached.data;
    console.log(`[Leaderboard Export] Exporting ${leaderboard.length} entries`);

    const csvHeader = 'wallet_address,score\n';
    const csvRows = leaderboard.map(entry => 
      `${entry.wallet_address},${entry.score}`
    ).join('\n');

    const csvContent = csvHeader + csvRows;

    const date = new Date().toISOString().split('T')[0];
    const filename = `minters-export-${date}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, s-maxage=300',
      },
    });
  } catch (error) {
    console.error('[Leaderboard Export] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export leaderboard' },
      { status: 500 }
    );
  }
}
