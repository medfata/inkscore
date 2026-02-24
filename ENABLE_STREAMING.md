# How to Enable Dashboard Streaming

## Current Status

✅ Streaming is now **ENABLED** in `.env`:
```
NEXT_PUBLIC_ENABLE_STREAMING=true
```

## Next Steps

### 1. Restart Your Next.js Dev Server

**IMPORTANT:** Environment variables are only loaded when the server starts. You must restart:

```bash
# Stop the current dev server (Ctrl+C)
# Then restart:
npm run dev
```

### 2. Clear Browser Cache (Optional but Recommended)

```bash
# In your browser:
# - Open DevTools (F12)
# - Right-click the refresh button
# - Select "Empty Cache and Hard Reload"
```

### 3. Verify Streaming is Working

Open your browser's DevTools and check:

#### Network Tab
1. Go to Network tab
2. Filter by "EventStream" or look for `/api/[wallet]/dashboard?stream=true`
3. You should see a connection that stays open
4. Click on it to see events arriving progressively

#### Console Tab
You should see logs like:
```
[STREAM] Opening connection for wallet: 0x...
[STREAM] Connection opened
[STREAM] Received metric: stats (234ms)
[STREAM] Received metric: bridge (456ms)
...
[STREAM] All metrics completed (4567ms)
```

#### Visual Behavior
- Cards should appear **one by one** as data arrives
- NOT all at once after everything loads
- Faster metrics appear first (< 1s)
- Slower metrics appear later (up to 10s)

### 4. Enable Debug Panel (Optional)

The debug panel is already integrated. You should see a floating button in the bottom-right corner of the dashboard that shows:
- Connection status
- Loading/Loaded/Error counts
- Progress bar
- Total duration

## Troubleshooting

### Still seeing all cards load at once?

1. **Check environment variable:**
   ```bash
   # In your terminal where dev server is running:
   echo $NEXT_PUBLIC_ENABLE_STREAMING  # Linux/Mac
   # or
   echo %NEXT_PUBLIC_ENABLE_STREAMING%  # Windows CMD
   ```

2. **Verify in browser console:**
   ```javascript
   // In browser DevTools console:
   console.log(process.env.NEXT_PUBLIC_ENABLE_STREAMING)
   ```

3. **Check Network tab:**
   - Look for `/api/[wallet]/dashboard?stream=true`
   - If you see `/api/[wallet]/dashboard` (without `?stream=true`), streaming is not enabled

### No EventSource connection?

1. **Check browser compatibility:**
   ```javascript
   // In browser console:
   console.log(typeof EventSource)  // Should be "function"
   ```

2. **Check for errors:**
   - Look in browser console for `[STREAM]` logs
   - Check for any error messages

### Cards still show skeletons?

1. **Check if API server is running:**
   ```bash
   curl http://localhost:4000/health
   ```

2. **Check backend logs:**
   - Look for `[STREAM] Started for wallet:` messages
   - Check for any errors in the API responses

## Performance Expectations

With streaming enabled, you should see:

- **Time to first metric:** < 2 seconds
- **Time to 80% of metrics:** < 5 seconds  
- **Total time:** 5-10 seconds (depending on slowest metric)

Compare this to non-streaming where ALL cards appear after 10+ seconds.

## Testing

Run the test suite to verify everything works:

```bash
# Performance tests
npm run test:performance

# Benchmark
npm run benchmark:streaming

# Memory leak test
npm run test:memory-leaks

# Slow network test
npm run test:slow-network
```

## Disabling Streaming

To disable streaming and go back to the original behavior:

1. Edit `.env`:
   ```
   NEXT_PUBLIC_ENABLE_STREAMING=false
   ```

2. Restart dev server:
   ```bash
   npm run dev
   ```

## Need Help?

Check these files for more information:
- `.kiro/specs/dashboard-streaming/requirements.md` - Feature requirements
- `.kiro/specs/dashboard-streaming/design.md` - Technical design
- `.kiro/specs/dashboard-streaming/BROWSER_COMPATIBILITY.md` - Browser support
- `.kiro/specs/dashboard-streaming/PERFORMANCE_TESTING_GUIDE.md` - Testing guide
