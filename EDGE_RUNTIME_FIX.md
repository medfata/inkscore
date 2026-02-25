# Edge Runtime + External API 403 Fix

## The Real Problem

Your streaming implementation is **100% correct**. The issue is:

1. ✅ SSE streaming works perfectly (you can see events coming through)
2. ❌ Your API server at `http://77.42.41.78:4000` returns 403 for requests from Vercel

## Why 403 Happens

Your server at `77.42.41.78:4000` is likely:
- **Blocking Vercel's IP ranges** (firewall/security group)
- **Has a reverse proxy** (Nginx/Apache) with restrictive rules
- **Using DDoS protection** that flags Vercel's requests as suspicious
- **Requires specific headers** that we're not sending

## Edge Runtime is Fine for SSE

Edge Runtime supports SSE perfectly. The 403 is NOT caused by Edge Runtime - it's your server rejecting the connection.

## Solutions (in order of preference)

### Solution 1: Use a Domain with HTTPS (Recommended)

Instead of `http://77.42.41.78:4000`, use a proper domain:

1. Point a domain to your server: `api.yourdomain.com → 77.42.41.78`
2. Install SSL certificate (Let's Encrypt is free)
3. Update Vercel env: `API_SERVER_URL=https://api.yourdomain.com`

**Why this works:**
- HTTPS is more trusted by security systems
- Domains are less likely to be blocked than raw IPs
- Better for production anyway

### Solution 2: Check Server Firewall

SSH into `77.42.41.78` and check:

```bash
# Check iptables rules
sudo iptables -L -n -v

# Check ufw status
sudo ufw status

# Check if requests are arriving
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

Look for:
- Blocked IP ranges
- Rate limiting rules
- Geographic restrictions

### Solution 3: Add API Authentication

Add a secret token to bypass security:

**In Vercel environment variables:**
```
API_SECRET_TOKEN=your-secret-token-here
```

**In dashboard route.ts:**
```typescript
async function fetchFromExpress<T>(endpoint: string): Promise<FetchResult<T>> {
  const headers: HeadersInit = {
    'User-Agent': 'Vercel-Next.js',
    'Accept': 'application/json',
  };
  
  if (process.env.API_SECRET_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.API_SECRET_TOKEN}`;
  }
  
  const response = await fetch(`${API_SERVER_URL}${endpoint}`, { headers });
  // ... rest of code
}
```

**In api-server/src/index.ts:**
```typescript
// Add before other middleware
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.API_SECRET_TOKEN;
  
  if (expectedToken && token !== expectedToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
```

### Solution 4: Whitelist Vercel IPs

If you have firewall rules, you need to allow Vercel's IP ranges. However, Vercel uses dynamic IPs, so this is not ideal.

### Solution 5: Deploy API Server to Vercel

Deploy your `api-server` folder as a separate Vercel project:

1. Create `vercel.json` in `api-server/`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "src/index.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "src/index.ts"
    }
  ]
}
```

2. Deploy: `cd api-server && vercel`
3. Update main app's `API_SERVER_URL` to the Vercel URL

## Testing Right Now

To confirm it's a server-side block, test from your local machine:

```bash
# Test from your machine
curl -v http://77.42.41.78:4000/health

# Test with Vercel-like headers
curl -v -H "User-Agent: Vercel-Next.js" http://77.42.41.78:4000/health

# Test a wallet endpoint
curl -v http://77.42.41.78:4000/api/wallet/0xb806cd8325dea2174844768cedd2f8a045cca8e7/stats
```

If these work from your machine but fail from Vercel, it's definitely a firewall/IP blocking issue.

## Current Status

- ✅ SSE streaming implementation is correct
- ✅ Edge Runtime is the right choice
- ✅ Client-side EventSource is working
- ❌ Server at 77.42.41.78:4000 is blocking Vercel's requests

**Next step:** Check your server logs and firewall rules to see why it's returning 403.
