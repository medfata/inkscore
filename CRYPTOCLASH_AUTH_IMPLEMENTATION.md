# CryptoClash Authentication Implementation

## Overview

CryptoClash requires wallet signature authentication to access player data. This implementation handles the complete authentication flow from signature request to token caching.

## Authentication Flow

```
1. User visits dashboard
2. CryptoClash card shows "Sign In" button
3. User clicks "Sign In"
4. Wallet prompts user to sign message: "Sign in to Crypto Clash\nTimestamp: {timestamp}"
5. Frontend sends signature to backend /api/cryptoclash/auth
6. Backend authenticates with CryptoClash API
7. Backend caches JWT token (valid for 24 hours)
8. Frontend fetches player metrics
9. Card displays player stats
```

## Backend Implementation

### API Routes

**POST /api/cryptoclash/auth**
- Receives wallet signature and message
- Authenticates with CryptoClash API
- Caches JWT token for 23 hours
- Returns success status

Request body:
```json
{
  "userId": "0xWalletAddress",
  "signature": "0x...",
  "message": "Sign in to Crypto Clash\nTimestamp: 1772237250952",
  "timestamp": 1772237250952
}
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

**GET /api/cryptoclash/:wallet**
- Checks for cached authentication token
- If authenticated: Fetches player data from CryptoClash API
- If not authenticated: Returns `requiresAuth: true`
- Handles token expiration and re-authentication

Response (authenticated):
```json
{
  "clashTickets": 0,
  "lpTickets": 0,
  "points": 0,
  "totalBattles": 0,
  "isPatron": false
}
```

Response (not authenticated):
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

### Token Caching

Tokens are cached in-memory per wallet address:

```typescript
const tokenCache = new Map<string, { token: string; expiresAt: number }>();
```

- Cache duration: 23 hours (to be safe before 24h expiration)
- Automatic cleanup on 401 responses
- Per-wallet isolation

### CryptoClash API Integration

**Authentication Endpoint**: `POST https://www.cryptoclash.ink/api/auth/login`

Request:
```json
{
  "userId": "0xWalletAddress",
  "signature": "0x...",
  "message": "Sign in to Crypto Clash\nTimestamp: {timestamp}",
  "timestamp": 1772237250952
}
```

Response:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiJ9...",
  "userId": "0xWalletAddress"
}
```

**Player Data Endpoint**: `GET https://www.cryptoclash.ink/api/player?userId={wallet}`

Headers:
```
Authorization: Bearer {token}
```

## Frontend Implementation

### Dashboard Component

**State Management**:
```typescript
const [cryptoclashMetrics, setCryptoclashMetrics] = useState<CryptoClashMetrics | null>(null);
const [cryptoclashAuthenticating, setCryptoclashAuthenticating] = useState(false);
```

**Authentication Handler**:
```typescript
const handleCryptoClashAuth = async () => {
  // 1. Create message with timestamp
  const timestamp = Date.now();
  const message = `Sign in to Crypto Clash\nTimestamp: ${timestamp}`;
  
  // 2. Request signature from wallet
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, walletAddress],
  });
  
  // 3. Send to backend for authentication
  const response = await fetch('/api/cryptoclash/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: walletAddress, signature, message, timestamp }),
  });
  
  // 4. Fetch metrics after successful auth
  if (response.ok) {
    const metricsResponse = await fetch(`/api/cryptoclash/${walletAddress}`);
    const metrics = await metricsResponse.json();
    setCryptoclashMetrics(metrics);
  }
};
```

### UI States

**Loading State**:
- Shows skeleton animation while fetching data
- Displayed when `isMetricLoading('cryptoclash')` or `!cryptoclashMetrics`

**Authentication Required State**:
- Shows "Sign In" button
- Displayed when `cryptoclashMetrics.requiresAuth === true`
- Button shows spinner during authentication

**Authenticated State**:
- Shows player metrics (Points, Clash Tickets, LP Tickets, Total Battles)
- Shows active player indicator
- Shows patron badge if applicable

**Demo State**:
- Shows zero values
- No authentication required

## Security Considerations

### Signature Verification

The signature is verified by CryptoClash's backend:
1. Message format must match exactly: `"Sign in to Crypto Clash\nTimestamp: {timestamp}"`
2. Timestamp must be recent (CryptoClash validates this)
3. Signature must be valid for the wallet address
4. Each signature is unique due to timestamp

### Token Security

- Tokens are stored server-side only (not exposed to frontend)
- Tokens expire after 24 hours
- Tokens are wallet-specific
- Invalid tokens trigger re-authentication

### Privacy

- No private keys are ever transmitted
- Only wallet signatures are sent
- User must explicitly approve each signature request
- Tokens are cached per-wallet to minimize signature requests

## User Experience

### First Visit
1. User sees CryptoClash card with "Sign In" button
2. Clicks "Sign In"
3. Wallet prompts for signature
4. User approves signature
5. Card updates with player stats

### Subsequent Visits (within 23 hours)
1. User sees CryptoClash card
2. Stats load automatically (no signature needed)
3. Token is cached and reused

### Token Expiration (after 24 hours)
1. Backend detects expired/invalid token
2. Returns `requiresAuth: true`
3. User sees "Sign In" button again
4. Process repeats

## Error Handling

### Authentication Failures
- User rejects signature: Shows alert, returns to sign-in state
- Network error: Shows alert, returns to sign-in state
- Invalid signature: Returns `requiresAuth: true`

### API Failures
- CryptoClash API down: Returns zero values
- Token expired: Clears cache, returns `requiresAuth: true`
- Rate limiting: Returns cached data if available

### Wallet Not Connected
- Shows alert: "Please connect your wallet first"
- User must connect wallet before authentication

## Testing

### Manual Testing

1. **First-time authentication**:
   ```bash
   # Start API server
   cd api-server && npm run dev
   
   # Start frontend
   npm run dev
   
   # Visit dashboard with wallet
   # Click "Sign In" on CryptoClash card
   # Approve signature in wallet
   # Verify stats appear
   ```

2. **Token caching**:
   ```bash
   # After authentication, refresh page
   # Stats should load without signature prompt
   ```

3. **Token expiration**:
   ```bash
   # Wait 24 hours or manually clear cache
   # Refresh page
   # Should show "Sign In" button again
   ```

### API Testing

```bash
# Test authentication endpoint
curl -X POST http://localhost:4000/api/cryptoclash/auth \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "0xYourWallet",
    "signature": "0xYourSignature",
    "message": "Sign in to Crypto Clash\nTimestamp: 1772237250952",
    "timestamp": 1772237250952
  }'

# Test player data endpoint (after auth)
curl http://localhost:4000/api/cryptoclash/0xYourWallet
```

## Files Modified

1. `api-server/src/routes/cryptoclash.ts` - Added authentication logic
2. `app/components/Dashboard.tsx` - Added auth handler and UI
3. `lib/hooks/useCryptoClashAuth.ts` - Created (optional wagmi hook)

## Dependencies

- No new dependencies required
- Uses native `window.ethereum` for signatures
- Uses standard `fetch` for API calls

## Future Enhancements

- Persistent token storage (localStorage/cookies)
- Automatic re-authentication on token expiration
- Background token refresh
- Multi-wallet support
- Remember authentication preference
- Batch authentication for multiple platforms

## Troubleshooting

**"Please connect your wallet first"**
- Ensure MetaMask or compatible wallet is installed
- Ensure wallet is connected to the site
- Check browser console for errors

**"Authentication failed"**
- Verify wallet address is correct
- Ensure signature was approved
- Check network connectivity
- Verify CryptoClash API is accessible

**Stats not loading after authentication**
- Check browser console for errors
- Verify token was cached (check backend logs)
- Try clearing cache and re-authenticating
- Verify CryptoClash API is responding

**Token expired message**
- Normal after 24 hours
- Click "Sign In" again to re-authenticate
- Token will be cached for another 24 hours
