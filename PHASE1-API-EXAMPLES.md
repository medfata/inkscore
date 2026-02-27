# InkScore Phase 1 - API Examples

## API Endpoint Examples

### 1. Check Phase 1 Status (Eligible Wallet)

**Request:**
```bash
GET http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5
```

**Response:**
```json
{
  "isPhase1": true,
  "score": 7060,
  "totalPhase1Wallets": 2314
}
```

**Status Code:** `200 OK`

---

### 2. Check Phase 1 Status (Non-Eligible Wallet)

**Request:**
```bash
GET http://localhost:4000/api/phase1/check/0x0000000000000000000000000000000000000000
```

**Response:**
```json
{
  "isPhase1": false,
  "score": null,
  "totalPhase1Wallets": 2314
}
```

**Status Code:** `200 OK`

---

### 3. Invalid Wallet Address

**Request:**
```bash
GET http://localhost:4000/api/phase1/check/invalid-address
```

**Response:**
```json
{
  "error": "Invalid wallet address"
}
```

**Status Code:** `400 Bad Request`

---

### 4. Get All Phase 1 Wallets (Admin)

**Request:**
```bash
GET http://localhost:4000/api/phase1/wallets
```

**Response:**
```json
{
  "total": 2314,
  "wallets": [
    {
      "address": "0x1a1e4708fce01d805d6ea468e3c1ef9d1106b1b5",
      "score": 7060
    },
    {
      "address": "0x27326bd8e518183c5266b031cf90734e17dc4800",
      "score": 6975
    },
    {
      "address": "0x4efd3ccfb7a1de70e1b9553cd96f9579dad10ba3",
      "score": 6600
    }
    // ... 2,311 more entries
  ]
}
```

**Status Code:** `200 OK`

---

### 5. Wallet Stats with Phase 1 Status (Integrated)

**Request:**
```bash
GET http://localhost:4000/api/wallet/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5/stats
```

**Response:**
```json
{
  "balanceUsd": 1234.56,
  "balanceEth": 0.5,
  "totalTxns": 150,
  "nftCount": 5,
  "ageDays": 45,
  "firstTxDate": "2024-01-15T10:30:00Z",
  "nftCollections": [
    {
      "name": "Cool NFTs",
      "address": "0x...",
      "logo": "https://...",
      "count": 3
    }
  ],
  "tokenHoldings": [
    {
      "name": "USDC",
      "symbol": "USDC",
      "address": "0x...",
      "logo": "https://...",
      "balance": 1000,
      "usdValue": 1000,
      "tokenType": "stablecoin"
    }
  ],
  "phase1Status": {
    "isPhase1": true,
    "score": 7060
  }
}
```

**Status Code:** `200 OK`

---

## cURL Examples

### Check Phase 1 Status
```bash
curl -X GET "http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5" \
  -H "Accept: application/json"
```

### Get All Phase 1 Wallets
```bash
curl -X GET "http://localhost:4000/api/phase1/wallets" \
  -H "Accept: application/json"
```

### Check with Case Insensitive Address
```bash
# Both work the same (normalized to lowercase internally)
curl "http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5"
curl "http://localhost:4000/api/phase1/check/0x1a1e4708fce01d805d6ea468e3c1ef9d1106b1b5"
```

---

## JavaScript/TypeScript Examples

### Using Fetch API

```typescript
// Check Phase 1 status
async function checkPhase1Status(walletAddress: string) {
  const response = await fetch(
    `http://localhost:4000/api/phase1/check/${walletAddress}`
  );
  
  if (!response.ok) {
    throw new Error('Failed to check Phase 1 status');
  }
  
  const data = await response.json();
  return data;
}

// Usage
const status = await checkPhase1Status('0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5');
console.log(`Is Phase 1: ${status.isPhase1}`);
console.log(`Score: ${status.score}`);
```

### Using Axios

```typescript
import axios from 'axios';

// Check Phase 1 status
async function checkPhase1Status(walletAddress: string) {
  try {
    const { data } = await axios.get(
      `http://localhost:4000/api/phase1/check/${walletAddress}`
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('API Error:', error.response?.data);
    }
    throw error;
  }
}

// Get all Phase 1 wallets
async function getAllPhase1Wallets() {
  const { data } = await axios.get(
    'http://localhost:4000/api/phase1/wallets'
  );
  return data;
}
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react';

interface Phase1Status {
  isPhase1: boolean;
  score: number | null;
  totalPhase1Wallets: number;
}

function usePhase1Status(walletAddress: string | null) {
  const [status, setStatus] = useState<Phase1Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      setStatus(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`http://localhost:4000/api/phase1/check/${walletAddress}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch Phase 1 status');
        return res.json();
      })
      .then(data => {
        setStatus(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, [walletAddress]);

  return { status, loading, error };
}

// Usage in component
function WalletPhase1Badge({ walletAddress }: { walletAddress: string }) {
  const { status, loading, error } = usePhase1Status(walletAddress);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  if (!status) return null;

  return (
    <div className={status.isPhase1 ? 'badge-success' : 'badge-warning'}>
      {status.isPhase1 ? '✓ Phase 1 Eligible' : '✗ Not Eligible'}
      {status.isPhase1 && status.score && (
        <span className="score">Score: {status.score.toLocaleString()}</span>
      )}
    </div>
  );
}
```

---

## Response Headers

All API responses include standard headers:

```
Content-Type: application/json
Cache-Control: public, max-age=3600  (for Phase 1 endpoints)
X-Response-Time: <ms>
```

---

## Rate Limiting

Currently no rate limiting is implemented, but recommended limits:

- `/api/phase1/check/:wallet` - 100 requests/minute per IP
- `/api/phase1/wallets` - 10 requests/minute per IP (admin endpoint)

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Invalid wallet address"
}
```

### 500 Internal Server Error
```json
{
  "error": "Failed to check Phase 1 status"
}
```

---

## Testing with Different Wallets

### Known Phase 1 Wallets (from CSV)
```bash
# Highest score (7,060)
curl "http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5"

# Second highest (6,975)
curl "http://localhost:4000/api/phase1/check/0x27326Bd8E518183c5266B031Cf90734e17dc4800"

# Third highest (6,600)
curl "http://localhost:4000/api/phase1/check/0x4efd3CcFb7a1DE70e1B9553CD96f9579dAD10Ba3"
```

### Non-Phase 1 Wallet
```bash
# Random address not in CSV
curl "http://localhost:4000/api/phase1/check/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
```

---

## Postman Collection

Import this JSON into Postman:

```json
{
  "info": {
    "name": "InkScore Phase 1 API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Check Phase 1 Status",
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "http://localhost:4000/api/phase1/check/0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5",
          "protocol": "http",
          "host": ["localhost"],
          "port": "4000",
          "path": ["api", "phase1", "check", "0x1A1E4708FCe01d805d6Ea468E3C1EF9D1106b1B5"]
        }
      }
    },
    {
      "name": "Get All Phase 1 Wallets",
      "request": {
        "method": "GET",
        "header": [],
        "url": {
          "raw": "http://localhost:4000/api/phase1/wallets",
          "protocol": "http",
          "host": ["localhost"],
          "port": "4000",
          "path": ["api", "phase1", "wallets"]
        }
      }
    }
  ]
}
```
