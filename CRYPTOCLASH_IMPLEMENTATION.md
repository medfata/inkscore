# CryptoClash Dashboard Integration

## Overview

Successfully integrated CryptoClash game metrics into the dashboard, displaying player stats including Clash Tickets, LP Tickets, and Points.

## Implementation Details

### 1. Backend API Route (`api-server/src/routes/cryptoclash.ts`)

Created a new route that fetches player data from the CryptoClash API:

**Endpoint**: `GET /api/cryptoclash/:wallet`

**External API**: `https://www.cryptoclash.ink/api/player?userId={wallet}`

**Metrics Returned**:
- `clashTickets` - Number of clash tickets owned
- `lpTickets` - Number of LP tickets owned
- `points` - Total game points
- `totalBattles` - Number of battles played
- `isPatron` - Whether the player is a patron

**Caching**: 5 minutes

### 2. API Server Integration

**File**: `api-server/src/index.ts`
- Added CryptoClash route to Express app
- Route accessible at `/api/cryptoclash/:wallet`

**File**: `api-server/src/services/points-service-v2.ts`
- Added CryptoClash to the wallet aggregation service
- Fetches CryptoClash data alongside other platform metrics
- Includes type definitions for `CryptoClashResponse`

### 3. Frontend Dashboard Component

**File**: `app/components/Dashboard.tsx`

**Added**:
- `CryptoClashMetrics` interface
- State management for CryptoClash metrics
- Platform URL mapping to `https://www.cryptoclash.ink/`
- Response processing from aggregated API
- Individual metric loading support

**Dashboard Card Features**:
- Displays total points prominently
- Shows Clash Tickets, LP Tickets, and Total Battles
- Active player indicator (shows "Patron Player" if patron, otherwise "Active Player")
- Loading skeleton while fetching data
- Error handling with fallback UI
- Responsive design matching other platform cards
- Cyan color theme (border-cyan-500/20, bg-cyan-500/5)
- Logo from CryptoClash branding
- Links to CryptoClash website

### 4. Visual Design

**Card Styling**:
- Glass card effect with cyan accent
- 300px height to match other cards
- Animated fade-in on load (0.93s delay)
- Hover effects on logo
- Pulsing indicator for active players
- Patron badge for patron players

**Layout**:
- Located in Row 5 alongside Copink and NFT2Me
- Grid layout: 1 column on mobile, 2 on tablet, 4 on desktop
- Consistent spacing and padding with other cards

## API Response Structure

### CryptoClash API Response
```json
{
  "userId": "0xd0c0ade59c0c277d078216d57860486f5b4402a9",
  "playerName": "",
  "clashTickets": 0,
  "lpTickets": 0,
  "points": 0,
  "totalBattles": 0,
  "isPatron": false,
  // ... other fields not displayed
}
```

### Our API Response (Simplified)
```json
{
  "clashTickets": 0,
  "lpTickets": 0,
  "points": 0,
  "totalBattles": 0,
  "isPatron": false
}
```

## Files Modified

1. `api-server/src/routes/cryptoclash.ts` - NEW
2. `api-server/src/index.ts` - Added route import and registration
3. `api-server/src/services/points-service-v2.ts` - Added to aggregation
4. `app/components/Dashboard.tsx` - Added card component and state management

## Testing

To test the integration:

1. **Start API Server**:
   ```bash
   cd api-server
   npm run dev
   ```

2. **Test API Endpoint**:
   ```bash
   curl http://localhost:4000/api/cryptoclash/0xD0C0AdE59C0c277D078216d57860486f5b4402A9
   ```

3. **View Dashboard**:
   - Navigate to the dashboard with a wallet address
   - Look for the CryptoClash card in Row 5
   - Verify metrics are displayed correctly

## Example Wallet

Test with: `0xD0C0AdE59C0c277D078216d57860486f5b4402A9`

This wallet should return data from the CryptoClash API.

## Future Enhancements

Potential improvements:
- Add historical points tracking
- Display player rank/leaderboard position
- Show card collection stats
- Add battle win/loss ratio
- Display recent battles
- Show patron benefits
- Add referral code display

## Notes

- The CryptoClash API returns many additional fields (packs, boxes, resources, etc.) that are not currently displayed
- The card focuses on the three main metrics requested: Clash Tickets, LP Tickets, and Points
- Total Battles is included as an additional metric to show player activity
- Patron status is used to customize the active player indicator
- The API is cached for 5 minutes to reduce load on the CryptoClash server
- Error handling returns zero values if the API is unavailable

## Resources

- CryptoClash Website: https://www.cryptoclash.ink/
- CryptoClash Logo: https://www.cryptoclash.ink/branding/cclogonoback.webp
- API Endpoint: https://www.cryptoclash.ink/api/player?userId={wallet}
