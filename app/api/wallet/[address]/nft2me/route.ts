import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// NFT2Me contract addresses
const NFT2ME_CONTRACTS = {
  FACTORY: '0x00000000001594c61dd8a6804da9ab58ed2483ce', // Factory contract for collections
  MINTER: '0x00000000009a1e02f00e280dcfa4c81c55724212', // Minter contract for NFTs
};

// Function names to track
const TRACKED_FUNCTIONS = {
  CREATE_COLLECTION: 'CreateCollectionN2M_000oEFvt',
  MINT: 'Mint',
};

interface Nft2MeResponse {
  collectionsCreated: number;
  nftsMinted: number;
  totalTransactions: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;
    const wallet = address.toLowerCase();

    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // Optimized query matching the pattern used by fast analytics endpoints
    // Assumes addresses are stored in lowercase in the database
    const walletLower = wallet.toLowerCase();
    const factoryLower = NFT2ME_CONTRACTS.FACTORY.toLowerCase();
    const minterLower = NFT2ME_CONTRACTS.MINTER.toLowerCase();

    const result = await query<{
      collections_created: string;
      nfts_minted: string;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE contract_address = $1 AND function_name = $2) as collections_created,
        COUNT(*) FILTER (WHERE contract_address = $3 AND function_name = $4) as nfts_minted
      FROM transaction_details
      WHERE wallet_address = $5
        AND status = 1
        AND (
          (contract_address = $1 AND function_name = $2) OR
          (contract_address = $3 AND function_name = $4)
        )
    `, [
      factoryLower, TRACKED_FUNCTIONS.CREATE_COLLECTION,
      minterLower, TRACKED_FUNCTIONS.MINT,
      walletLower
    ]);

    const collectionsCreated = parseInt(result[0]?.collections_created || '0', 10);
    const nftsMinted = parseInt(result[0]?.nfts_minted || '0', 10);

    const response: Nft2MeResponse = {
      collectionsCreated: Number(collectionsCreated),
      nftsMinted: Number(nftsMinted),
      totalTransactions: collectionsCreated + nftsMinted,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching NFT2Me data:', error);
    return NextResponse.json({ error: 'Failed to fetch NFT2Me data' }, { status: 500 });
  }
}