import { NextRequest, NextResponse } from 'next/server';
import { assetsService } from '@/lib/services/assets-service';
import { CreateAssetRequest } from '@/lib/types/assets';

// GET /api/admin/assets - List all assets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const assetType = searchParams.get('type');

    let assets;
    if (assetType && ['erc20_token', 'meme_coin', 'nft_collection'].includes(assetType)) {
      assets = await assetsService.getAssetsByType(
        assetType as 'erc20_token' | 'meme_coin' | 'nft_collection',
        includeInactive
      );
    } else {
      assets = await assetsService.getAllAssets(includeInactive);
    }

    // Group by type for easier frontend consumption
    const grouped = {
      erc20_tokens: assets.filter((a) => a.asset_type === 'erc20_token'),
      meme_coins: assets.filter((a) => a.asset_type === 'meme_coin'),
      nft_collections: assets.filter((a) => a.asset_type === 'nft_collection'),
    };

    return NextResponse.json({ assets, grouped });
  } catch (error) {
    console.error('Failed to fetch assets:', error);
    return NextResponse.json({ error: 'Failed to fetch assets' }, { status: 500 });
  }
}

// POST /api/admin/assets - Create new asset
export async function POST(request: NextRequest) {
  try {
    const body: CreateAssetRequest = await request.json();

    // Validate required fields
    if (!body.asset_type || !body.name || !body.address) {
      return NextResponse.json(
        { error: 'Missing required fields: asset_type, name, address' },
        { status: 400 }
      );
    }

    // Validate asset_type
    if (!['erc20_token', 'meme_coin', 'nft_collection'].includes(body.asset_type)) {
      return NextResponse.json({ error: 'Invalid asset_type' }, { status: 400 });
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
    }

    // Check for duplicate address
    const existing = await assetsService.getAssetByAddress(body.address);
    if (existing) {
      return NextResponse.json(
        { error: 'Asset with this address already exists' },
        { status: 409 }
      );
    }

    const asset = await assetsService.createAsset(body);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (error) {
    console.error('Failed to create asset:', error);
    return NextResponse.json({ error: 'Failed to create asset' }, { status: 500 });
  }
}
