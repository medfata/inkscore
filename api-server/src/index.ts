import express from 'express';
import cors from 'cors';
import { pool, testConnection } from './db';
import walletRoutes from './routes/backup_wallet';
import analyticsRoutes from './routes/analytics';
import dashboardRoutes from './routes/dashboard';
import marvkRoutes from './routes/marvk';
import nadoRoutes from './routes/nado';
import copinkRoutes from './routes/copink';
import ranksRoutes from './routes/ranks';

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

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
app.use('/api/marvk', marvkRoutes);
app.use('/api/nado', nadoRoutes);
app.use('/api/copink', copinkRoutes);
app.use('/api/ranks', ranksRoutes);

// Start server with database connection test
async function startServer() {
  console.log('Testing database connection...');
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.error('Failed to connect to database. Server will not start.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
  });
}

startServer();

export default app;
