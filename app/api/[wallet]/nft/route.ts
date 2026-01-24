import { NextRequest, NextResponse } from 'next/server';

const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

interface FetchResult<T> {
  data: T | null;
  error: string | null;
}

async function fetchFromExpress<T>(endpoint: string): Promise<FetchResult<T>> {
  try {
    const response = await fetch(`${API_SERVER_URL}${endpoint}`);
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}` };
    }
    const data = await response.json();
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// GET /api/[wallet]/nft - Aggregated NFT data from Express server
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  try {
    const { wallet } = await params;

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    const walletAddress = wallet.toLowerCase();

    // Parallel fetch NFT-related data from Express server
    const [statsResult, nft2meResult] = await Promise.all([
      fetchFromExpress<{ nftCount?: number; nftCollections?: unknown[] }>(`/api/wallet/${walletAddress}/stats`),
      fetchFromExpress(`/api/wallet/${walletAddress}/nft2me`),
    ]);

    // Collect any errors
    const errors: string[] = [];
    if (statsResult.error) errors.push(`stats: ${statsResult.error}`);
    if (nft2meResult.error) errors.push(`nft2me: ${nft2meResult.error}`);

    // Extract NFT-specific data from stats
    const nftData = {
      nftCount: statsResult.data?.nftCount ?? 0,
      nftCollections: statsResult.data?.nftCollections ?? [],
    };

    const response = {
      ...nftData,
      nft2me: nft2meResult.data,
      ...(errors.length > 0 && { errors }),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching NFT data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch NFT data' },
      { status: 500 }
    );
  }
}
