import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_WALLETS } from './admin-auth';
import { verifySessionToken } from './auth/signature-auth';

/**
 * Middleware to check if the request is from an authorized admin wallet
 * Now uses session token instead of trusting wallet address header
 */
export function checkAdminAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized: No authentication token provided' },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  const result = verifySessionToken(token);

  if (!result.valid) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or expired token' },
      { status: 403 }
    );
  }

  return null; // Auth passed
}

/**
 * DEPRECATED: Old header-based auth (INSECURE - DO NOT USE)
 * Kept for reference only
 */
export function checkAdminAuthLegacy(request: NextRequest): NextResponse | null {
  const walletAddress = request.headers.get('x-wallet-address');
  
  if (!walletAddress) {
    return NextResponse.json(
      { error: 'Unauthorized: No wallet address provided' },
      { status: 401 }
    );
  }

  if (!ADMIN_WALLETS.includes(walletAddress.toLowerCase())) {
    return NextResponse.json(
      { error: 'Unauthorized: Wallet not authorized for admin access' },
      { status: 403 }
    );
  }

  return null; // Auth passed
}
