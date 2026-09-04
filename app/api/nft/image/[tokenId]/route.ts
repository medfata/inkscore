import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_ABI } from '@/lib/nft-contract';
import { generateScoreNFTSvg } from '@/lib/services/nft-image-service';
import { getLeaderboardScoreFloor } from '@/lib/leaderboard-cache';
import { queryOne } from '@/lib/db';

export const revalidate = 600;

// Ink Chain configuration
const inkChain = {
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-gel.inkonchain.com'] },
  },
};

// API server base URL
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

const publicClient = createPublicClient({
  chain: inkChain,
  transport: http(),
});

interface WalletScoreResponse {
  wallet_address: string;
  total_points: number;
  rank: {
    name: string;
    color: string | null;
    logo_url: string | null;
  } | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId } = await params;
    
    // Strict validation: only numeric tokenIds
    if (!/^\d+$/.test(tokenId)) {
      return new NextResponse('Invalid token ID format', { status: 400 });
    }

    const tokenIdNum = parseInt(tokenId, 10);

    if (isNaN(tokenIdNum) || tokenIdNum <= 0) {
      return new NextResponse('Invalid token ID', { status: 400 });
    }

    // Query contract to get wallet address from tokenId
    let walletAddress: string;
    try {
      walletAddress = await publicClient.readContract({
        address: NFT_CONTRACT_ADDRESS,
        abi: NFT_CONTRACT_ABI,
        functionName: 'tokenWallet',
        args: [BigInt(tokenIdNum)],
      }) as string;

      // Check if wallet is zero address (token doesn't exist)
      if (!walletAddress || walletAddress === '0x0000000000000000000000000000000000000000') {
        return new NextResponse('NFT not found', { status: 404 });
      }
    } catch {
      return new NextResponse('NFT not found', { status: 404 });
    }

    let score: number;
    let rank: string;
    let rankColor = '#6366f1';

    const override = await queryOne<{ score: number; rank: string }>(
      'SELECT score, rank FROM admin_score_overrides WHERE wallet_address = $1',
      [walletAddress.toLowerCase()]
    );

    if (override) {
      score = Number(override.score);
      rank = override.rank;
      const rankRow = await queryOne<{ color: string }>(
        'SELECT color FROM ranks WHERE name = $1 AND is_active = true LIMIT 1',
        [rank]
      );
      rankColor = rankRow?.color || '#6366f1';
      console.log(`[NFT Image] Using admin override for ${walletAddress}: score=${score}, rank=${rank}, color=${rankColor}`);
    } else {
      const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${walletAddress.toLowerCase()}/score`);
      if (!scoreRes.ok) {
        console.error('Failed to fetch wallet score from API server');
        return new NextResponse('Failed to fetch wallet score', { status: 500 });
      }

      const scoreData: WalletScoreResponse = await scoreRes.json();
      score = scoreData.total_points;
      rank = scoreData.rank?.name || 'Unranked';
      rankColor = scoreData.rank?.color || '#6366f1';

      const floor = await getLeaderboardScoreFloor(walletAddress);
      if (floor !== null && score < floor) {
        console.log(`[NFT Image] Clamped ${score} -> ${floor} for ${walletAddress}`);
        score = floor;
      }
    }

    console.log(`[NFT Image] Token ${tokenId}, Wallet: ${walletAddress}, Score: ${score}, Rank: ${rank}`);
    
    // Calculate top percentage
    let topPercentage = 50;
    if (score >= 5000) topPercentage = 1;
    else if (score >= 2000) topPercentage = 5;
    else if (score >= 1000) topPercentage = 10;
    else if (score >= 500) topPercentage = 20;
    else if (score >= 100) topPercentage = 30;

    // Generate SVG image
    const svgImage = generateScoreNFTSvg({
      score,
      rank,
      rankColor,
      walletAddress,
      topPercentage,
    });

    // Return SVG with proper headers (no-cache to always get fresh score)
    return new NextResponse(svgImage, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline';",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('NFT image generation error:', error);
    return new NextResponse('Failed to generate NFT image', { status: 500 });
  }
}
