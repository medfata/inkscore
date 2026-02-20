import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ink-score-export-${timestamp}.csv`;

    const firstPageRes = await fetch(`${API_BASE_URL}/api/nft/leaderboard?page=1`);
    if (!firstPageRes.ok) {
      throw new Error(`Failed to fetch leaderboard: ${firstPageRes.status}`);
    }

    const firstPageData = await firstPageRes.json();
    const { total, limit } = firstPageData;

    console.log(`[Export CSV] Total wallets: ${total}, Limit per page: ${limit}`);

    const totalPages = Math.ceil(total / limit);
    const pagePromises: Promise<any>[] = [];

    for (let page = 1; page <= totalPages; page++) {
      pagePromises.push(
        fetch(`${API_BASE_URL}/api/nft/leaderboard?page=${page}`).then(res => res.json())
      );
    }

    const allPages = await Promise.all(pagePromises);

    const allWallets = allPages.flatMap(page => page.leaderboard || []);

    allWallets.sort((a, b) => b.score - a.score);

    const csvRows = ['wallet_address,score'];

    for (const wallet of allWallets) {
      csvRows.push(`${wallet.wallet_address},${wallet.score}`);
    }

    const csvContent = csvRows.join('\n');

    const response = new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });

    console.log(`[Export CSV] Exported ${allWallets.length} wallets`);

    return response;
  } catch (error) {
    console.error('[Export CSV] Error:', error);
    return NextResponse.json(
      { error: 'Failed to export CSV' },
      { status: 500 }
    );
  }
}
