// Simple wallet-based admin authentication
// Add authorized wallet addresses here (lowercase)
// You can also set them via environment variable: ADMIN_WALLETS=0xabc...,0xdef...

const envWallets = process.env.ADMIN_WALLETS?.split(',').map(w => w.trim().toLowerCase()) || [];

export const ADMIN_WALLETS = [
  '0x1234567890123456789012345678901234567890', // Replace with your wallet address
  ...envWallets, // Add more via ADMIN_WALLETS env variable
];

export function isAdminWallet(address: string | undefined): boolean {
  if (!address) return false;
  return ADMIN_WALLETS.includes(address.toLowerCase());
}
