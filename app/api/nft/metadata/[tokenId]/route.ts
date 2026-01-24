import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { NFT_CONTRACT_ADDRESS, NFT_CONTRACT_ABI } from '@/lib/nft-contract';
import { generateScoreNFTSvg } from '@/lib/services/nft-image-service';

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

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{
    trait_type: string;
    value: string | number;
  }>;
}

interface WalletScoreResponse {
  wallet_address: string;
  total_points: number;
  rank: {
    name: string;
    color: string | null;
    logo_url: string | null;
  } | null;
}

function abbreviateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId } = await params;
    const tokenIdNum = parseInt(tokenId, 10);

    if (isNaN(tokenIdNum) || tokenIdNum <= 0) {
      return NextResponse.json(
        { error: 'Invalid token ID' },
        { status: 400 }
      );
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
        return NextResponse.json(
          { error: 'NFT not found' },
          { status: 404 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'NFT not found' },
        { status: 404 }
      );
    }

    // Fetch current score and rank from API server (same source as dashboard)
    const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${walletAddress.toLowerCase()}/score`);
    if (!scoreRes.ok) {
      console.error('Failed to fetch wallet score from API server');
      return NextResponse.json(
        { error: 'Failed to fetch wallet score' },
        { status: 500 }
      );
    }

    const scoreData: WalletScoreResponse = await scoreRes.json();
    const score = scoreData.total_points;
    const rank = scoreData.rank?.name || 'Unranked';
    const rankColor = scoreData.rank?.color || '#6366f1';

    console.log(`[NFT Metadata] Token ${tokenId}, Wallet: ${walletAddress}, Score: ${score}, Rank: ${rank}`);
    
    // Calculate top percentage (simplified - you can enhance this with actual leaderboard data)
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

    // Convert SVG to base64 data URI
    const svgBase64 = Buffer.from(svgImage).toString('base64');
    const imageDataUri = `data:image/svg+xml;base64,${svgBase64}`;

    // Build metadata response
    const metadata: NFTMetadata = {
      name: `InkScore #${tokenId}`,
      description: `Dynamic achievement NFT representing wallet score on InkScore. This NFT displays the current score and rank for wallet ${abbreviateAddress(walletAddress)}.`,
      image: imageDataUri,
      external_url: `https://inkscore.xyz/wallet/${walletAddress}`,
      attributes: [
        { trait_type: 'Score', value: score },
        { trait_type: 'Rank', value: rank },
        { trait_type: 'Wallet', value: abbreviateAddress(walletAddress) },
      ],
    };

    // Set cache headers for dynamic content (short cache)
    return NextResponse.json(metadata, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  } catch (error) {
    console.error('NFT metadata error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch NFT metadata' },
      { status: 500 }
    );
  }
}
