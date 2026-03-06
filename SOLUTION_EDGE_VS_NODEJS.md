# Solution: Edge Runtime Blocks IP Addresses

## The Real Issue

**Vercel Edge Runtime cannot make fetch requests to raw IP addresses** - only to domain names!

Your API server is at `http://77.42.41.78:4000` (IP address), which is why Edge Runtime returns 403.

## Why This Happens

Edge Runtime has security restrictions:
- ✅ Can fetch: `https://api.example.com`
- ❌ Cannot fetch: `http://77.42.41.78:4000`

This is a Vercel security policy to prevent abuse.

## The Fix

### Option 1: Use Node.js Runtime (Current Solution)

Node.js runtime **DOES support SSE streaming** via ReadableStream and still allows fetching from IP addresses.

```typescript
export const runtime = 'nodejs'; // ✅ Works with IP addresses + SSE
```

**Myth busted:** Node.js runtime on Vercel supports streaming responses perfectly fine using ReadableStream and Response objects.

### Option 2: Add a Domain to Your API Server (Better Long-term)

1. Point a domain to your server:
   ```
   api.yourdomain.com → 77.42.41.78
   ```

2. Set up HTTPS (Let's Encrypt):
   ```bash
   sudo certbot --nginx -d api.yourdomain.com
   ```

3. Update Vercel environment variable:
   ```
   API_SERVER_URL=https://api.yourdomain.com
   ```

4. Then you can use Edge Runtime:
   ```typescript
   export const runtime = 'edge'; // ✅ Works with domains
   ```

## Performance Comparison

| Feature | Edge Runtime | Node.js Runtime |
|---------|-------------|-----------------|
| SSE Streaming | ✅ Yes | ✅ Yes |
| Fetch IP addresses | ❌ No | ✅ Yes |
| Fetch domains | ✅ Yes | ✅ Yes |
| Cold start | Faster | Slightly slower |
| Global distribution | Better | Good |

## Current Implementation

We're using **Node.js runtime** because:
1. Your API server uses an IP address
2. Node.js runtime supports SSE streaming perfectly
3. It's the quickest fix without infrastructure changes

## Streaming Still Works!

Both runtimes support SSE via:
```typescript
const stream = new ReadableStream({
  async start(controller) {
    controller.enqueue(encoder.encode('data: ...\n\n'));
  }
});

return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  }
});
```

This works identically in both Edge and Node.js runtimes.

## Recommendation

For production, set up a domain for your API server and use HTTPS. Then you can switch to Edge Runtime for better performance.
