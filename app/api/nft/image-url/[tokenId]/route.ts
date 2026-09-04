import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  try {
    const { tokenId } = await params;

    if (!/^\d+$/.test(tokenId)) {
      return NextResponse.json({ error: 'Invalid token ID' }, { status: 400 });
    }

    const host = request.headers.get('host') || 'www.inkscore.xyz';
    const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
    const imageUrl = `${protocol}://${host}/api/nft/image/${tokenId}`;

    return NextResponse.json({ imageUrl });
  } catch (error) {
    console.error('[ImageURL] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
