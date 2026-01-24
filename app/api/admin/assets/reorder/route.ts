import { NextRequest, NextResponse } from 'next/server';
import { assetsService } from '@/lib/services/assets-service';
import { AssetType } from '@/lib/types/assets';

// POST /api/admin/assets/reorder - Reorder assets within a type
export async function POST(request: NextRequest) {
  try {
    const body: { asset_type: AssetType; asset_ids: number[] } = await request.json();

    if (!body.asset_type || !body.asset_ids || !Array.isArray(body.asset_ids)) {
      return NextResponse.json(
        { error: 'Missing required fields: asset_type, asset_ids' },
        { status: 400 }
      );
    }

    if (!['erc20_token', 'meme_coin', 'nft_collection'].includes(body.asset_type)) {
      return NextResponse.json({ error: 'Invalid asset_type' }, { status: 400 });
    }

    await assetsService.reorderAssets(body.asset_type, body.asset_ids);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to reorder assets:', error);
    return NextResponse.json({ error: 'Failed to reorder assets' }, { status: 500 });
  }
}
