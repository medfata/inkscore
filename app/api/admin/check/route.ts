import { NextRequest, NextResponse } from 'next/server';
import { isAdminWallet } from '@/lib/admin-auth';

/**
 * GET /api/admin/check?address=0x...
 * Check if a wallet address is an admin (server-side only)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get('address');

  if (!address) {
    return NextResponse.json(
      { error: 'Address parameter required' },
      { status: 400 }
    );
  }

  const isAdmin = isAdminWallet(address);

  return NextResponse.json({
    isAdmin,
    address: address.toLowerCase(),
  });
}
