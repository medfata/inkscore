import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { createPublicClient, http } from 'viem';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_ABI } from '@/lib/nft-contract';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Ink Chain configuration
const inkChain = {
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
};

const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(),
});

interface LeaderboardEntry {
  wallet_address: string;
  score: number;
  rank: string;
  minted_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Fetch leaderboard ordered by score descending
    const result = await pool.query<LeaderboardEntry>(
      `SELECT 
        wallet_address,
        score,
        rank,
        minted_at,
        updated_at
      FROM nft_mints
      WHERE score > 0
      ORDER BY score DESC, minted_at ASC
      LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get actual tokenIds from contract and fetch metadata
    const leaderboardWithTokenIds = await Promise.all(
      result.rows.map(async (entry) => {
        try {
          // Query contract for actual tokenId
          const hasNFTData = await publicClient.readContract({
            address: NFT_CONTRACT_ADDRESS,
            abi: NFT_CONTRACT_ABI,
            functionName: 'hasNFT',
            args: [entry.wallet_address as `0x${string}`],
          }) as [boolean, bigint];

          const actualTokenId = hasNFTData[1].toString();

          // Build absolute URL for server-side fetch
          const host = request.headers.get('host') || 'localhost:3000';
          const protocol = host.includes('localhost') ? 'http' : 'https';
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${protocol}://${host}`;
          const metadataUrl = `${baseUrl}/api/nft/metadata/${actualTokenId}`;

          // Fetch the metadata to get the actual image
          let nftImageUrl = '';
          try {
            console.log(`[Leaderboard] Fetching metadata from: ${metadataUrl}`);
            const metadataResponse = await fetch(metadataUrl);
            if (metadataResponse.ok) {
              const metadata = await metadataResponse.json();
              nftImageUrl = metadata.image || ''; // Extract the base64 SVG image
              console.log(`[Leaderboard] Got image for token ${actualTokenId}, length: ${nftImageUrl.length}`);
            } else {
              console.error(`[Leaderboard] Metadata fetch failed with status: ${metadataResponse.status}`);
            }
          } catch (fetchError) {
            console.error(`Failed to fetch metadata for token ${actualTokenId}:`, fetchError);
          }

          return {
            ...entry,
            token_id: actualTokenId,
            nft_image_url: nftImageUrl,
          };
        } catch (error) {
          console.error(`Failed to fetch tokenId for ${entry.wallet_address}:`, error);
          return {
            ...entry,
            token_id: '0',
            nft_image_url: '', // Return empty if query fails
          };
        }
      })
    );

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM nft_mints WHERE score > 0'
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    return NextResponse.json({
      leaderboard: leaderboardWithTokenIds,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[NFT Leaderboard] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
