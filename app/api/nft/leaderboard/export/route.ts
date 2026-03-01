import { NextRequest, NextResponse } from 'next/server';

const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';
const EXPLORER_API = 'https://explorer.inkonchain.com/api/v2/tokens';
const DEAD_WALLET = '0x0000000000000000000000000000000000000000';
const BROKEN_SCORE_WALLET = '0x4C50254DaFD191bBA2A6e0517C1742Caf1426dF5';
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';

    if (format !== 'csv') {
      return NextResponse.json({ error: 'Only CSV format is supported' }, { status: 400 });
    }

    console.log('[Leaderboard Export] Fetching all NFTs from Explorer API...');

    let allNFTs: any[] = [];
    let nextPageParams: { unique_token: number } | null = null;
    let baseUrl = `${EXPLORER_API}/${NFT_CONTRACT_ADDRESS}/instances`;

    do {
      const url: string = nextPageParams
        ? `${baseUrl}?unique_token=${nextPageParams.unique_token}`
        : baseUrl;

      const explorerResponse = await fetch(url);
      if (!explorerResponse.ok) {
        throw new Error(`Explorer API error: ${explorerResponse.status}`);
      }

      const data = await explorerResponse.json();
      allNFTs = [...allNFTs, ...data.items];
      nextPageParams = data.next_page_params;
    } while (nextPageParams !== null);

    console.log(`[Leaderboard Export] Fetched ${allNFTs.length} total NFTs`);

    const validNFTs = allNFTs.filter(
      nft => nft.owner?.hash &&
        nft.owner.hash.toLowerCase() !== DEAD_WALLET.toLowerCase()
    );

    console.log(`[Leaderboard Export] ${validNFTs.length} valid NFTs after filtering`);

    let leaderboard = validNFTs.map((nft) => {
      const scoreAttr = nft.metadata?.attributes?.find(
        (attr: { trait_type: string }) => attr.trait_type === 'Score'
      );

      return {
        wallet_address: nft.owner.hash,
        token_id: nft.id,
        score: typeof scoreAttr?.value === 'number' ? scoreAttr.value : 0,
      };
    });

    const brokenWalletEntry = leaderboard.find(
      entry => entry.wallet_address.toLowerCase() === BROKEN_SCORE_WALLET.toLowerCase()
    );

    if (brokenWalletEntry) {
      console.log(`[Leaderboard Export] Found broken wallet ${BROKEN_SCORE_WALLET}, fetching correct score...`);
      try {
        const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${BROKEN_SCORE_WALLET.toLowerCase()}/score`);
        if (scoreRes.ok) {
          const scoreData = await scoreRes.json();
          brokenWalletEntry.score = scoreData.total_points;
          console.log(`[Leaderboard Export] Updated broken wallet score to ${scoreData.total_points}`);
        }
      } catch (error) {
        console.error(`[Leaderboard Export] Failed to fetch correct score for broken wallet:`, error);
      }
    }

    leaderboard.sort((a, b) => b.score - a.score);

    const csvHeader = 'wallet_address,score\n';
    const csvRows = leaderboard.map(entry => 
      `${entry.wallet_address},${entry.score}`
    ).join('\n');

    const csvContent = csvHeader + csvRows;

    const date = new Date().toISOString().split('T')[0];
    const filename = `minters-export-${date}.csv`;

    console.log(`[Leaderboard Export] Returning CSV with ${leaderboard.length} entries`);

    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, must-revalidate',
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
