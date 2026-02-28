# CryptoClash 404 Fix

## Problem

The frontend was getting 404 errors when calling `/api/cryptoclash/...` because there were no Next.js API routes to proxy the requests to the backend server.

```
GET /api/cryptoclash/0xD0C0AdE59C0c277D078216d57860486f5B4402A9 404
```

## Root Cause

- Backend API server runs on `http://localhost:4000`
- Next.js frontend runs on `http://localhost:3000`
- Frontend calls `/api/cryptoclash/...` which goes to Next.js
- Next.js had no API routes to proxy to the backend
- Result: 404 Not Found

## Solution

Created Next.js API proxy routes that forward requests to the backend:

### 1. GET Route: `app/api/cryptoclash/[wallet]/route.ts`

Proxies GET requests to fetch player data:

```typescript
GET /api/cryptoclash/:wallet
  ↓
GET http://localhost:4000/api/cryptoclash/:wallet
```

### 2. POST Route: `app/api/cryptoclash/auth/route.ts`

Proxies POST requests for authentication:

```typescript
POST /api/cryptoclash/auth
  ↓
POST http://localhost:4000/api/cryptoclash/auth
```

### 3. Dashboard Aggregation: `app/api/[wallet]/dashboard/route.ts`

Added CryptoClash to the streaming dashboard endpoint:

```typescript
{ id: 'cryptoclash', fetch: () => fetchFromExpress(`/api/cryptoclash/${walletAddress}`) }
```

## Request Flow

### Before Fix
```
Frontend → /api/cryptoclash/:wallet → Next.js → 404 ❌
```

### After Fix
```
Frontend → /api/cryptoclash/:wallet → Next.js API Route → Backend (port 4000) → Response ✅
```

## Files Created

1. `app/api/cryptoclash/[wallet]/route.ts` - GET endpoint proxy
2. `app/api/cryptoclash/auth/route.ts` - POST endpoint proxy

## Files Modified

1. `app/api/[wallet]/dashboard/route.ts` - Added cryptoclash to metrics array

## Testing

### 1. Test Backend Directly

```bash
curl http://localhost:4000/api/cryptoclash/0xYourWallet
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

### 2. Test Next.js Proxy

```bash
curl http://localhost:3000/api/cryptoclash/0xYourWallet
```

Should return the same response as above.

### 3. Test in Browser

1. Restart Next.js dev server (if not already done)
2. Connect wallet
3. Check browser Network tab
4. Should see: `GET /api/cryptoclash/0xYourWallet 200 OK`
5. After ~1 second, wallet should prompt for signature

## Auto-Authentication Flow

Now that the API routes are working, the auto-authentication should trigger:

1. User connects wallet
2. Frontend calls `/api/cryptoclash/:wallet` (via dashboard aggregation)
3. Next.js proxies to backend
4. Backend returns `requiresAuth: true`
5. Frontend's useEffect detects this
6. After 1 second delay, requests wallet signature
7. User signs message
8. Frontend sends signature to `/api/cryptoclash/auth`
9. Next.js proxies to backend
10. Backend authenticates with CryptoClash API
11. Token cached for 24 hours
12. Frontend fetches data again
13. Backend returns player stats
14. Card displays data

## Environment Variables

The API routes use:

```typescript
const API_SERVER_URL = process.env.API_SERVER_URL || 'http://localhost:4000';
```

For production, set `API_SERVER_URL` to your backend server URL.

## Verification

After restarting Next.js, you should see in the logs:

```
[STREAM] Started for wallet: 0xYourWallet
[FETCH] Requesting: http://localhost:4000/api/cryptoclash/0xYourWallet
[FETCH] Response status: 200 for /api/cryptoclash/0xYourWallet
[STREAM] Metric cryptoclash completed in XXXms
```

And in the browser console (after ~1 second):

```
Starting CryptoClash auth...
Wallet address: 0xYourWallet
```

Then MetaMask should prompt for signature.

## Common Issues

**Still getting 404**:
- Restart Next.js dev server
- Clear `.next` cache: `rm -rf .next`
- Check API server is running on port 4000

**No signature prompt**:
- Check browser console for errors
- Verify `requiresAuth: true` in API response
- Check the 1-second delay hasn't been skipped
- Ensure MetaMask is unlocked

**Authentication fails**:
- Check backend logs for errors
- Verify CryptoClash API is accessible
- Check signature format is correct
- Try disconnecting and reconnecting wallet
