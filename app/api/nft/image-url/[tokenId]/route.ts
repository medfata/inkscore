import { NextRequest, NextResponse } from 'next/server';

const ROUTESCAN_API = 'https://cdn.routescan.io/api/evm/57073/erc721-transfers';
const NFT_CONTRACT_ADDRESS = '0xBE1965cE0D06A79A411FFCD9a1C334638dF77649';

interface RoutescanResponse {
  items: Array<{
    token: {
      uri256: string;
      contentType: string;
    };
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId } = await params;

    const url = `${ROUTESCAN_API}?tokenAddress=${NFT_CONTRACT_ADDRESS}&tokenId=${tokenId}&count=true&limit=1`;

    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[ImageURL] Routescan API error: ${response.status}`);
      return NextResponse.json(
        { error: 'Failed to fetch from Routescan' },
        { status: 500 }
      );
    }

    const data: RoutescanResponse = await response.json();

    if (!data.items || data.items.length === 0) {
      return NextResponse.json(
        { error: 'Token not found' },
        { status: 404 }
      );
    }

    const imageUrl = data.items[0].token?.uri256;

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'Image URL not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ imageUrl });
  } catch (error) {
    console.error('[ImageURL] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
