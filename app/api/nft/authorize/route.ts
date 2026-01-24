import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { Pool } from 'pg';

// Rate limiting: track requests per wallet
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 requests per minute per wallet

// Signature expiry time
const SIGNATURE_EXPIRY_SECONDS = 5 * 60; // 5 minutes

// API server base URL
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

interface AuthorizeRequest {
  walletAddress: string;
}

interface AuthorizeResponse {
  signature: string;
  score: number;
  rank: string;
  expiry: number;
  walletAddress: string;
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

function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function checkRateLimit(walletAddress: string): boolean {
  const now = Date.now();
  const key = walletAddress.toLowerCase();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body: AuthorizeRequest = await request.json();
    const { walletAddress } = body;

    // Validate wallet address
    if (!walletAddress || !isValidEthereumAddress(walletAddress)) {
      return NextResponse.json(
        { error: 'Invalid wallet address format' },
        { status: 400 }
      );
    }

    // Check rate limit
    if (!checkRateLimit(walletAddress)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    // Get signer private key from environment
    const signerPrivateKey = process.env.NFT_SIGNER_PRIVATE_KEY;
    if (!signerPrivateKey) {
      console.error('NFT_SIGNER_PRIVATE_KEY not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Fetch current score and rank from API server (same source as dashboard)
    const scoreRes = await fetch(`${API_SERVER_URL}/api/wallet/${walletAddress.toLowerCase()}/score?refresh=true`);
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

    console.log(`[NFT Authorize] Wallet: ${walletAddress}, Score: ${score}, Rank: ${rank}`);

    // Calculate expiry timestamp (5 minutes from now)
    const expiry = Math.floor(Date.now() / 1000) + SIGNATURE_EXPIRY_SECONDS;

    // Create message hash matching the contract's expected format
    // keccak256(abi.encodePacked(wallet, score, rank, expiry))
    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'string', 'uint256'],
      [walletAddress, score, rank, expiry]
    );

    // Sign the message hash (produces eth_sign compatible signature)
    const wallet = new ethers.Wallet(signerPrivateKey);
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    // Track NFT mint in database (upsert)
    try {
      await pool.query(
        `INSERT INTO nft_mints (wallet_address, score, rank, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (wallet_address) 
         DO UPDATE SET 
           score = EXCLUDED.score,
           rank = EXCLUDED.rank,
           updated_at = NOW()`,
        [walletAddress.toLowerCase(), score, rank]
      );
      console.log(`[NFT Authorize] Tracked mint for wallet: ${walletAddress}`);
    } catch (dbError) {
      console.error('[NFT Authorize] Database tracking error:', dbError);
      // Don't fail the authorization if DB tracking fails
    }

    const response: AuthorizeResponse = {
      signature,
      score,
      rank,
      expiry,
      walletAddress: walletAddress.toLowerCase(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('NFT authorization error:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization' },
      { status: 500 }
    );
  }
}
