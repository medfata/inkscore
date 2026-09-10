import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { pool, testConnection } from './db';
import walletRoutes from './routes/backup_wallet';
import analyticsRoutes from './routes/analytics';
import dashboardRoutes from './routes/dashboard';
import nadoRoutes from './routes/nado';
import otomateRoutes from './routes/otomate';
import ranksRoutes from './routes/ranks';
import adminProxiesRoutes from './routes/admin-proxies';
import cryptoclashRoutes from './routes/cryptoclash';
import sweepRoutes from './routes/sweep';
import { startRefreshWorker } from './services/refresh-worker';
import { startCatchupWorker } from './services/catchup-worker';
import { initProxyPool, logProxyStatus } from './services/proxy-agent';
import { bypassWalletCache } from './cache';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
// Gzip responses for any non-local hop (bridge byPlatform lists, holdings,
// cards payloads compress 5-10x). Trivial CPU cost at this scale.
app.use(compression());

// Explicit refresh (?refresh=true) opens a short bypass window so wallet
// cache entries older than the default are recomputed live, while concurrent
// viewers keep their cached data. See cache.ts bypassWalletCache.
app.use((req, _res, next) => {
  if (req.query.refresh === 'true') bypassWalletCache(5000);
  next();
});

// Health check endpoint
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'unhealthy', error: 'Database connection failed' });
  }
});

// API Routes
app.use('/api/wallet', walletRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/nado', nadoRoutes);
app.use('/api/otomate', otomateRoutes);
// Deprecated alias (Copink → Otomate rename): keep serving the old path so
// cached clients and old snapshots don't 404 during the transition.
app.use('/api/copink', otomateRoutes);
app.use('/api/ranks', ranksRoutes);
app.use('/api/admin/proxies', adminProxiesRoutes);
app.use('/api/cryptoclash', cryptoclashRoutes);
app.use('/api/sweep', sweepRoutes);

// Start server with database connection test
async function startServer() {
  console.log('Testing database connection...');
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('Failed to connect to database. Server will not start.');
    process.exit(1);
  }

  const server = app.listen(PORT, async () => {
    console.log(`API server running on port ${PORT}`);
    // Proxy pool (DB keys, else legacy file/template) + quota schedulers.
    await initProxyPool();
    // Residential proxy pool for Blockscout egress (per-IP rate limits).
    logProxyStatus();
    // Background worker: completes truncated Blockscout fills + refreshes
    // stale caches without blocking interactive traffic.
    startRefreshWorker();
  startCatchupWorker();
  });
  // Node's default keep-alive timeout (5s) is shorter than the idle window
  // proxies/clients reuse connections over — the classic cause of sporadic
  // ECONNRESETs and re-handshakes between Next and Express. Keep the socket
  // alive longer than any intermediary's idle timeout.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000; // must exceed keepAliveTimeout
}

startServer();

export default app;
