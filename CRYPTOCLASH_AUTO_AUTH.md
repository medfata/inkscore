# CryptoClash Auto-Authentication on Wallet Connect

## Overview

CryptoClash authentication now happens automatically when a user connects their wallet. No separate "Sign In" button is needed.

## Implementation

### Automatic Authentication Flow

```
1. User clicks "Connect Wallet"
2. Wallet connection completes
3. System checks if CryptoClash authentication is needed
4. If needed: Wallet prompts user to sign message
5. User signs message
6. Backend authenticates with CryptoClash API
7. Token cached for 24 hours
8. Dashboard loads with CryptoClash stats
```

### Code Changes

**app/page.tsx** - Added auto-authentication on wallet connect:

```typescript
useEffect(() => {
  const authenticateCryptoClash = async () => {
    if (!isConnected || !address || isDemo) return;

    // Check if already authenticated
    const checkResponse = await fetch(`/api/cryptoclash/${address}`);
    const checkData = await checkResponse.json();
    
    if (!checkData.requiresAuth) return; // Already authenticated

    // Create message and request signature
    const timestamp = Date.now();
    const message = `Sign in to Crypto Clash\nTimestamp: ${timestamp}`;
    
    const signature = await window.ethereum.request({
      method: 'personal_sign',
      params: [message, address],
    });

    // Authenticate with backend
    await fetch('/api/cryptoclash/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: address, signature, message, timestamp }),
    });
  };

  // Delay to let wallet connection settle
  const timer = setTimeout(authenticateCryptoClash, 1000);
  return () => clearTimeout(timer);
}, [isConnected, address, isDemo]);
```

**app/components/Dashboard.tsx** - Simplified CryptoClash card:

- Removed "Sign In" button
- Removed authentication handler function
- Shows "Authenticating..." message if `requiresAuth: true`
- Shows stats once authenticated

## User Experience

### First-Time Connection

1. User clicks "Connect Wallet"
2. MetaMask prompts: "Connect to this site?"
3. User approves connection
4. **1 second delay**
5. MetaMask prompts: "Sign in to Crypto Clash\nTimestamp: {timestamp}"
6. User signs message
7. Dashboard loads with all stats including CryptoClash

### Subsequent Connections (within 24 hours)

1. User clicks "Connect Wallet"
2. MetaMask prompts: "Connect to this site?"
3. User approves connection
4. Dashboard loads immediately with all stats (no signature needed)

### After Token Expiration (24+ hours)

1. User clicks "Connect Wallet"
2. MetaMask prompts: "Connect to this site?"
3. User approves connection
4. **1 second delay**
5. MetaMask prompts: "Sign in to Crypto Clash\nTimestamp: {timestamp}"
6. User signs message
7. Dashboard loads with all stats

## Benefits

✅ **Seamless UX**: No extra buttons or steps
✅ **One-time signature**: Only asked once per 24 hours
✅ **Silent failure**: If user rejects, dashboard still loads (just no CryptoClash stats)
✅ **Automatic retry**: Next time they connect, they'll be prompted again
✅ **No UI clutter**: Card shows stats or loading state, no authentication UI

## Error Handling

### User Rejects Signature

- Error is caught silently
- Dashboard loads normally
- CryptoClash card shows "Authenticating..." message
- User can refresh page to try again

### Network Error

- Error is caught silently
- Dashboard loads normally
- CryptoClash card shows loading skeleton
- Will retry on next page load

### CryptoClash API Down

- Backend returns `requiresAuth: true`
- Card shows "Authenticating..." message
- Will retry on next page load

## Testing

### Test First-Time Authentication

1. Clear browser cache and localStorage
2. Disconnect wallet if connected
3. Click "Connect Wallet"
4. Approve connection in MetaMask
5. **Wait for signature prompt** (appears after ~1 second)
6. Sign the message
7. Verify CryptoClash stats appear on dashboard

### Test Cached Authentication

1. After authenticating once, disconnect wallet
2. Click "Connect Wallet" again
3. Approve connection in MetaMask
4. **No signature prompt should appear**
5. Dashboard loads immediately with CryptoClash stats

### Test Rejection Handling

1. Clear cache and disconnect wallet
2. Click "Connect Wallet"
3. Approve connection
4. **Reject the signature request**
5. Dashboard should still load (without CryptoClash stats)
6. CryptoClash card shows "Authenticating..." message

## Timing

- **1 second delay** before signature request
  - Allows wallet connection to fully settle
  - Prevents race conditions
  - Gives user time to see dashboard loading

## Security

- Signature is unique per connection (timestamp-based)
- Token stored server-side only
- Automatic expiration after 24 hours
- User must explicitly approve each signature
- No private keys transmitted

## Troubleshooting

**Signature prompt not appearing**

- Check browser console for errors
- Verify MetaMask is unlocked
- Try disconnecting and reconnecting
- Clear browser cache

**"Authenticating..." message stuck**

- User likely rejected signature
- Refresh page to try again
- Or disconnect and reconnect wallet

**Stats not loading after signing**

- Check network tab for API errors
- Verify backend is running
- Check backend logs for authentication errors
- Try clearing cache and reconnecting

## Future Enhancements

- Show toast notification when signature is needed
- Add retry button if authentication fails
- Store authentication preference in localStorage
- Batch multiple platform authentications together
- Add progress indicator during authentication
