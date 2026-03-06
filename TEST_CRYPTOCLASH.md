# Testing CryptoClash Integration

## Prerequisites

1. API server running on port 4000
2. Next.js server running on port 3000
3. MetaMask installed and unlocked

## Step-by-Step Test

### 1. Restart Next.js Server

**IMPORTANT**: You must restart the Next.js dev server to pick up the new API routes.

```bash
# Stop the current server (Ctrl+C)
# Then start it again:
npm run dev
```

### 2. Verify API Routes Work

Open a new terminal and test:

```bash
# Test the proxy route
curl http://localhost:3000/api/cryptoclash/0xD0C0AdE59C0c277D078216d57860486f5B4402A9
```

Expected response:
```json
{
  "clashTickets": 0,
  "lpTickets": 0,
  "points": 0,
  "totalBattles": 0,
  "isPatron": false,
  "requiresAuth": true
}
```

If you get this response, the API routes are working! ✅

### 3. Test in Browser

1. Open http://localhost:3000
2. Open browser DevTools (F12)
3. Go to Network tab
4. Click "Connect Wallet"
5. Approve connection in MetaMask

### 4. Watch for Auto-Authentication

After connecting, watch for:

**In Network Tab**:
- `GET /api/0xYourWallet/dashboard?stream=true` - Should be 200 OK
- `GET /api/cryptoclash/0xYourWallet` - Should be 200 OK (not 404!)

**In Console Tab** (after ~1 second):
- Should see logs about CryptoClash authentication starting

**In MetaMask**:
- Should see signature request popup:
  ```
  Sign in to Crypto Clash
  Timestamp: 1772237250952
  ```

### 5. Sign the Message

1. Click "Sign" in MetaMask
2. Watch Network tab for:
   - `POST /api/cryptoclash/auth` - Should be 200 OK
   - `GET /api/cryptoclash/0xYourWallet` - Should return stats (not requiresAuth)

### 6. Verify Card Shows Data

1. Scroll down to Row 5 on the dashboard
2. Find the CryptoClash card (cyan border, between Copink and NFT2Me)
3. Should show your stats:
   - Total Points
   - Clash Tickets
   - LP Tickets
   - Total Battles

## Troubleshooting

### Issue: Still getting 404

**Solution**:
```bash
# Clear Next.js cache
rm -rf .next

# Restart server
npm run dev
```

### Issue: No signature prompt

**Check**:
1. Browser console for errors
2. Network tab shows `requiresAuth: true` in response
3. MetaMask is unlocked
4. No JavaScript errors blocking execution

**Debug**:
Add console.log to `app/page.tsx`:
```typescript
useEffect(() => {
  console.log('Wallet connected:', isConnected, address);
  // ... rest of code
}, [isConnected, address, isDemo]);
```

### Issue: Signature prompt appears but authentication fails

**Check**:
1. Backend logs for errors
2. Network tab for POST /api/cryptoclash/auth response
3. Signature format is correct

**Debug**:
Check backend logs:
```bash
# In api-server terminal, you should see:
Auth request: { userId: '0x...', timestamp: 1772237250952 }
CryptoClash response: { success: true, token: '...' }
```

### Issue: Card shows "Authenticating..." forever

**Possible causes**:
1. User rejected signature (check MetaMask)
2. Authentication failed (check backend logs)
3. Frontend not refetching after auth (check Network tab)

**Solution**:
1. Disconnect wallet
2. Reconnect wallet
3. Approve signature when prompted

## Expected Logs

### Next.js Server Logs

```
[STREAM] Started for wallet: 0xYourWallet
[FETCH] Requesting: http://localhost:4000/api/cryptoclash/0xYourWallet
[FETCH] Response status: 200 for /api/cryptoclash/0xYourWallet
[STREAM] Metric cryptoclash completed in 150ms
```

### Browser Console Logs

```
Wallet connected: true 0xYourWallet
Starting CryptoClash auth...
Wallet address: 0xYourWallet
CryptoClash authentication successful
```

### Backend Server Logs

```
Auth request: { userId: '0xYourWallet', timestamp: 1772237250952 }
CryptoClash response: { success: true, token: 'eyJhbGci...' }
```

## Success Criteria

✅ API routes return 200 (not 404)
✅ Signature prompt appears after ~1 second
✅ User can sign message
✅ Authentication succeeds
✅ Card shows player stats
✅ Next connection (within 24h) doesn't prompt for signature

## Next Steps

Once everything works:

1. Test with different wallets
2. Test token expiration (wait 24 hours or clear cache)
3. Test rejection handling (reject signature)
4. Test offline behavior (stop backend)
5. Deploy to production
