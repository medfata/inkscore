# CryptoClash Wagmi Signature Fix

## Problem

The signature request wasn't appearing because the code was trying to use `window.ethereum.request()` directly, which doesn't work with Reown AppKit (WalletConnect).

## Root Cause

```typescript
// ❌ This only works with MetaMask injected provider
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [message, address],
});
```

Reown AppKit uses WalletConnect protocol, not the injected `window.ethereum` provider.

## Solution

Use wagmi's `useSignMessage` hook which works with all wallet providers:

```typescript
// ✅ Works with MetaMask, WalletConnect, Coinbase Wallet, etc.
import { useSignMessage } from 'wagmi';

const { signMessageAsync } = useSignMessage();
const signature = await signMessageAsync({ message });
```

## Changes Made

### app/page.tsx

1. **Added import**:
```typescript
import { useAccount, useDisconnect, useSignMessage } from 'wagmi';
```

2. **Added hook**:
```typescript
const { signMessageAsync } = useSignMessage();
```

3. **Updated signature request**:
```typescript
// Old (doesn't work with WalletConnect)
const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [message, address],
});

// New (works with all providers)
const signature = await signMessageAsync({ message });
```

4. **Added logging**:
```typescript
console.log('CryptoClash: Authentication required, requesting signature...');
console.log('CryptoClash: Signature received, authenticating...');
console.log('CryptoClash: Authentication successful');
```

## How It Works Now

### Signature Request Flow

1. User connects wallet via Reown AppKit
2. After 1 second, authentication check runs
3. Backend returns `requiresAuth: true`
4. Frontend calls `signMessageAsync({ message })`
5. **Reown AppKit shows signature modal** (not MetaMask popup)
6. User signs message in their wallet app
7. Signature sent to backend
8. Backend authenticates with CryptoClash API
9. Token cached for 24 hours
10. Stats displayed on dashboard

### Wallet Provider Support

✅ **MetaMask** - Browser extension
✅ **WalletConnect** - Mobile wallets via QR code
✅ **Coinbase Wallet** - Browser extension or mobile
✅ **Trust Wallet** - Mobile via WalletConnect
✅ **Rainbow** - Mobile via WalletConnect
✅ **Any WalletConnect-compatible wallet**

## Testing

### 1. Restart Next.js Server

```bash
# Stop current server (Ctrl+C)
npm run dev
```

### 2. Connect Wallet

1. Open http://localhost:3000
2. Click "Connect Wallet"
3. Choose your wallet provider (MetaMask, WalletConnect, etc.)
4. Approve connection

### 3. Watch for Signature Request

**After ~1 second**, you should see:

**In Browser Console**:
```
CryptoClash: Authentication required, requesting signature...
```

**In Reown AppKit Modal**:
- Signature request appears
- Message: "Sign in to Crypto Clash\nTimestamp: {timestamp}"
- Buttons: "Cancel" and "Sign"

**Or in MetaMask**:
- Popup appears
- Same message
- Buttons: "Cancel" and "Sign"

### 4. Sign the Message

Click "Sign" and watch console:

```
CryptoClash: Signature received, authenticating...
CryptoClash: Authentication successful
```

### 5. Verify Stats Appear

Scroll to Row 5 and check the CryptoClash card shows your stats.

## Debugging

### Issue: No signature request appears

**Check browser console**:
```javascript
// Should see:
CryptoClash: Authentication required, requesting signature...
```

If you don't see this, check:
1. Wallet is connected (`isConnected: true`)
2. Address is available
3. Not in demo mode
4. API returned `requiresAuth: true`

**Add more logging**:
```typescript
console.log('Wallet state:', { isConnected, address, isDemo });
console.log('Check response:', checkData);
```

### Issue: Signature request appears but fails

**Check error in console**:
```javascript
CryptoClash: Authentication skipped or failed: Error: User rejected
```

Common errors:
- `User rejected` - User clicked "Cancel"
- `User denied` - User rejected in wallet
- `Network error` - Backend not responding

### Issue: Signature succeeds but stats don't load

**Check Network tab**:
1. `POST /api/cryptoclash/auth` - Should be 200 OK
2. Response should be `{ success: true, token: "..." }`

**Check backend logs**:
```
Auth request: { userId: '0x...', timestamp: 1772237250952 }
CryptoClash response: { success: true, token: '...' }
```

## Signature Format

The message format is:
```
Sign in to Crypto Clash
Timestamp: 1772237250952
```

This is signed using EIP-191 (personal_sign):
```
"\x19Ethereum Signed Message:\n" + len(message) + message
```

The signature is a 65-byte hex string:
```
0x01cd8c2c57ccb499518960548302381b5b6e3459310b7ee480091aa7ce86781f45e73c4a0376f9b05d3a82bb52fde8bde0245e047eec1d969add0694b8c0f0f41c
```

## Comparison: Old vs New

### Old Method (MetaMask only)
```typescript
// Only works with injected provider
if (window.ethereum) {
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  });
}
```

**Problems**:
- ❌ Doesn't work with WalletConnect
- ❌ Doesn't work with Coinbase Wallet
- ❌ Requires checking for window.ethereum
- ❌ Not compatible with Reown AppKit

### New Method (All wallets)
```typescript
// Works with any wallet provider
const { signMessageAsync } = useSignMessage();
const signature = await signMessageAsync({ message });
```

**Benefits**:
- ✅ Works with all wallet providers
- ✅ Handles provider detection automatically
- ✅ Compatible with Reown AppKit
- ✅ Consistent API across providers
- ✅ Better error handling

## Next Steps

1. Test with different wallet providers:
   - MetaMask browser extension
   - WalletConnect mobile wallet
   - Coinbase Wallet
   - Trust Wallet via WalletConnect

2. Test edge cases:
   - User rejects signature
   - Network disconnects during signing
   - Backend is down
   - Token expiration after 24 hours

3. Add user feedback:
   - Toast notification when signature is needed
   - Loading indicator during authentication
   - Success message after authentication
   - Error message if authentication fails

## Resources

- [wagmi useSignMessage docs](https://wagmi.sh/react/api/hooks/useSignMessage)
- [Reown AppKit docs](https://docs.reown.com/appkit/overview)
- [EIP-191 Signed Data Standard](https://eips.ethereum.org/EIPS/eip-191)
