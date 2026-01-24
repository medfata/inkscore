import { recoverMessageAddress } from 'viem';
import { ADMIN_WALLETS } from '../admin-auth';

/**
 * Generate a message for the user to sign
 * Include timestamp to prevent replay attacks
 */
export function generateAuthMessage(address: string): string {
  const timestamp = Date.now();
  return `Sign this message to authenticate as admin.\n\nWallet: ${address}\nTimestamp: ${timestamp}`;
}

/**
 * Verify a signed message and check if the signer is an admin
 * Returns the verified address if valid, null otherwise
 */
export async function verifyAdminSignature(
  message: string,
  signature: string
): Promise<{ valid: boolean; address?: string; error?: string }> {
  try {
    // Recover the address from the signature
    const recoveredAddress = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });

    // Check if recovered address is an admin
    if (!ADMIN_WALLETS.includes(recoveredAddress.toLowerCase())) {
      return {
        valid: false,
        error: 'Wallet is not authorized for admin access',
      };
    }

    // Extract timestamp from message to check freshness (prevent replay attacks)
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    if (timestampMatch) {
      const timestamp = parseInt(timestampMatch[1]);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (now - timestamp > fiveMinutes) {
        return {
          valid: false,
          error: 'Signature expired. Please sign again.',
        };
      }
    }

    return {
      valid: true,
      address: recoveredAddress.toLowerCase(),
    };
  } catch (error) {
    console.error('Signature verification failed:', error);
    return {
      valid: false,
      error: 'Invalid signature',
    };
  }
}

/**
 * Create a session token after successful signature verification
 * In production, use JWT or similar
 */
export function createSessionToken(address: string): string {
  // Simple implementation - in production use JWT with secret
  const payload = {
    address: address.toLowerCase(),
    timestamp: Date.now(),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Verify a session token
 */
export function verifySessionToken(token: string): { valid: boolean; address?: string } {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    const oneHour = 60 * 60 * 1000;

    if (Date.now() - payload.timestamp > oneHour) {
      return { valid: false };
    }

    if (!ADMIN_WALLETS.includes(payload.address)) {
      return { valid: false };
    }

    return { valid: true, address: payload.address };
  } catch {
    return { valid: false };
  }
}
