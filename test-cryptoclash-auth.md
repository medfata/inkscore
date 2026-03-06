# Testing CryptoClash Authentication

## Step 1: Start the API Server

```bash
cd api-server
npm run dev
```

The server should start on port 4000.

## Step 2: Test the Endpoint (Without Auth)

```bash
curl http://localhost:4000/api/cryptoclash/0xD0C0AdE59C0c277D078216d57860486f5B4402A9
```

Expected response (should include `requiresAuth: true`):
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

## Step 3: Start the Frontend

In a new terminal:

```bash
npm run dev
```

The frontend should start on port 3000.

## Step 4: Test in Browser

1. Open http://localhost:3000
2. Connect your wallet
3. Navigate to your wallet's dashboard
4. Scroll down to Row 5 (where Copink and NFT2Me cards are)
5. Look for the CryptoClash card
6. You should see a "Sign In" button

## Step 5: Authenticate

1. Click the "Sign In" button
2. Your wallet (MetaMask) should prompt you to sign a message:
   ```
   Sign in to Crypto Clash
   Timestamp: [current timestamp]
   ```
3. Click "Sign" in MetaMask
4. The card should update with your CryptoClash stats

## Troubleshooting

### "Sign In" button not showing

Check browser console for errors:
```javascript
// Open browser console (F12)
// Look for any errors related to CryptoClash
```

Verify the API response:
```javascript
// In browser console:
fetch('/api/cryptoclash/YOUR_WALLET_ADDRESS')
  .then(r => r.json())
  .then(console.log)
```

Should show `requiresAuth: true` if not authenticated.

### Wallet not prompting for signature

1. Check if MetaMask is installed and unlocked
2. Check browser console for errors
3. Verify `window.ethereum` is available:
   ```javascript
   // In browser console:
   console.log(window.ethereum)
   ```

### Authentication fails

1. Check API server logs for errors
2. Verify the signature format is correct
3. Try disconnecting and reconnecting wallet
4. Clear browser cache and try again

## Debug Mode

To see detailed logs, add console.log statements:

In `app/components/Dashboard.tsx`, add to `handleCryptoClashAuth`:
```typescript
console.log('Starting CryptoClash auth...');
console.log('Wallet address:', walletAddress);
console.log('Signature:', signature);
console.log('Response:', data);
```

In `api-server/src/routes/cryptoclash.ts`, add:
```typescript
console.log('Auth request:', { userId, timestamp });
console.log('CryptoClash response:', data);
```

## Expected Flow

1. **Initial Load**: Card shows loading skeleton
2. **After Load**: Card shows "Sign In" button (if `requiresAuth: true`)
3. **Click Sign In**: Button shows "Authenticating..." with spinner
4. **Wallet Prompt**: MetaMask shows signature request
5. **After Signing**: Card updates with stats
6. **Subsequent Visits**: Stats load automatically (no signature needed for 23 hours)
