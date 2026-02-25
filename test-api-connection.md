# API Connection 403 Error Investigation

## Problem
All requests from Vercel to `http://77.42.41.78:4000` are returning HTTP 403 Forbidden.

## Possible Causes

### 1. Firewall/Security Group Blocking Vercel IPs
Your server at `77.42.41.78` might have a firewall that's blocking Vercel's IP ranges.

**Solution:** Whitelist Vercel's IP ranges in your firewall
- Check your server's firewall rules (iptables, ufw, cloud provider security groups)
- Vercel uses dynamic IPs, so you may need to allow all IPs or use a different approach

### 2. Reverse Proxy (Nginx/Apache) Configuration
If you're using a reverse proxy, it might be blocking requests based on:
- User-Agent headers
- Missing headers
- Request origin

**Check:** Look at your Nginx/Apache configuration for any `deny` rules

### 3. Rate Limiting / DDoS Protection
Services like Cloudflare, Fail2ban, or ModSecurity might be blocking Vercel's requests.

### 4. HTTP vs HTTPS
Your API server is using HTTP (`http://77.42.41.78:4000`). Some platforms block HTTP requests for security.

**Solution:** Use HTTPS instead

### 5. Server-Side IP Whitelist
Your Express app might have middleware that checks IP addresses.

## Diagnostic Steps

### Step 1: Test Direct Access
```bash
curl -v http://77.42.41.78:4000/health
```

### Step 2: Test from Vercel
Check Vercel function logs to see the exact error

### Step 3: Check Server Logs
SSH into `77.42.41.78` and check:
```bash
# Check if requests are reaching the server
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log

# Or if using PM2/Docker
pm2 logs
docker logs <container-name>
```

### Step 4: Test with User-Agent
Vercel might be sending specific headers:
```bash
curl -v -H "User-Agent: Vercel" http://77.42.41.78:4000/health
```

## Recommended Solutions

### Option A: Use HTTPS with Domain
1. Set up a domain pointing to `77.42.41.78`
2. Install SSL certificate (Let's Encrypt)
3. Update `API_SERVER_URL` to `https://yourdomain.com`

### Option B: Deploy API Server to Vercel
1. Deploy the `api-server` folder as a separate Vercel project
2. Update `API_SERVER_URL` to the Vercel URL
3. Both services will be on Vercel's network

### Option C: Use Vercel's IP Allowlist Feature (Enterprise)
If you have Vercel Enterprise, you can get static IPs

### Option D: Add Authentication Header
Add a secret token that Vercel sends with each request:
```typescript
// In dashboard route
const response = await fetch(`${API_SERVER_URL}${endpoint}`, {
  headers: {
    'Authorization': `Bearer ${process.env.API_SECRET_TOKEN}`
  }
});

// In API server
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.API_SECRET_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
```

## Immediate Action Required

1. **Check your server logs** at `77.42.41.78` to see if requests are arriving
2. **Check firewall rules** on the server
3. **Test the health endpoint** directly: `curl http://77.42.41.78:4000/health`
4. **Consider switching to HTTPS** with a proper domain

The 403 error means the request is reaching something (server/firewall/proxy) but being rejected. We need to find out what's rejecting it.
