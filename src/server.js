const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./models');
const { setupWebSocket, getConnectionCount, getChannelStats } = require('./websocket/ws');
const authMiddleware = require('./middleware/auth');

const oracleRoutes = require('./routes/oracle');
const swapRoutes = require('./routes/swap');
const portfolioRoutes = require('./routes/portfolio');
const riskRoutes = require('./routes/risk');
const fundingRoutes = require('./routes/funding');
const frogRoutes = require('./routes/frog');
const ordersRoutes = require('./routes/orders');
const leverageRoutes = require('./routes/leverage');
const rewardsRoutes = require('./routes/rewards');
const lendingRoutes = require('./routes/lending');
const kycRoutes = require('./routes/kyc');
const conversionRoutes = require('./routes/conversion');
const adminRoutes = require('./routes/admin');
const eventsRoutes = require('./routes/events');
const securityRoutes = require('./routes/security');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for rate limiting behind reverse proxies
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// CORS - allow any localhost origin (Vite may use different ports)
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-wallet-address'],
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiting - 100 requests per minute
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please try again in a minute.',
    retryAfter: '60 seconds'
  },
  keyGenerator: (req) => {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '0.0.0.0';
  }
});
app.use('/api/', globalLimiter);

// Auth middleware (optional - extracts wallet address)
app.use(authMiddleware);

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      name: 'SX Omni Chain Backend API',
      version: '1.0.0',
      status: 'Running',
      port: PORT,
      timestamp: new Date().toISOString(),
      endpoints: {
        oracle: '/api/oracle',
        swap: '/api/swap',
        portfolio: '/api/portfolio',
        risk: '/api/risk',
        funding: '/api/funding',
        frog: '/api/frog',
        orders: '/api/orders',
        leverage: '/api/leverage',
        rewards: '/api/rewards',
        lending: '/api/lending',
        kyc: '/api/kyc',
        conversion: '/api/conversion',
        admin: '/api/admin',
        events: '/api/events',
        security: '/api/security'
      },
      websocket: '/ws',
      chains: ['Hoodi Testnet (560048)', 'Base Sepolia (84532)']
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      wsConnections: getConnectionCount(),
      wsChannels: getChannelStats(),
      timestamp: new Date().toISOString()
    }
  });
});

// Mount all routes under /api/
app.use('/api/oracle', oracleRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/risk', riskRoutes);
app.use('/api/funding', fundingRoutes);
app.use('/api/frog', frogRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/leverage', leverageRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/lending', lendingRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/conversion', conversionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/security', securityRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
    availableEndpoints: [
      'GET  /',
      'GET  /api/health',
      'GET  /api/oracle/prices',
      'GET  /api/oracle/prices/:asset',
      'GET  /api/oracle/disputes',
      'POST /api/oracle/simulate-dispute',
      'POST /api/oracle/simulate-twap',
      'POST /api/swap/quote',
      'POST /api/swap/execute',
      'GET  /api/swap/history/:address',
      'GET  /api/portfolio/:address',
      'POST /api/portfolio/settlement/preview',
      'POST /api/portfolio/settlement/execute',
      'GET  /api/risk/:address',
      'POST /api/risk/inject-equity',
      'POST /api/risk/close-portfolio',
      'POST /api/risk/simulate-drop',
      'GET  /api/funding/rate/:asset',
      'GET  /api/funding/next-deduction',
      'GET  /api/funding/history/:positionId',
      'POST /api/funding/apply',
      'GET  /api/frog/score',
      'GET  /api/frog/history',
      'GET  /api/frog/metrics',
      'POST /api/frog/update',
      'POST /api/orders/hidden',
      'GET  /api/orders/hidden/:address',
      'POST /api/orders/execute/:orderId',
      'POST /api/orders/simulate-execution',
      'POST /api/leverage/open',
      'GET  /api/leverage/positions/:address',
      'POST /api/leverage/close/:positionId',
      'POST /api/leverage/simulate-price/:positionId',
      'GET  /api/rewards/:address',
      'GET  /api/rewards/rate',
      'POST /api/rewards/credit',
      'POST /api/lending/lend',
      'POST /api/lending/withdraw',
      'POST /api/lending/borrow',
      'POST /api/lending/short/open',
      'POST /api/lending/short/close',
      'GET  /api/lending/portfolio/:address',
      'POST /api/kyc/submit',
      'POST /api/kyc/approve/:address',
      'POST /api/kyc/reject/:address',
      'GET  /api/kyc/status/:address',
      'POST /api/conversion/convert',
      'GET  /api/conversion/rates',
      'POST /api/admin/register-device',
      'POST /api/admin/proposal',
      'POST /api/admin/approve/:proposalId',
      'POST /api/admin/kill-switch/activate',
      'POST /api/admin/kill-switch/deactivate',
      'GET  /api/admin/proposals',
      'GET  /api/admin/devices',
      'GET  /api/admin/status',
      'GET  /api/events',
      'GET  /api/events/stats',
      'POST /api/events/index',
      'POST /api/security/chat',
      'GET  /api/security/logs',
      'GET  /api/security/locked'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// Create HTTP server
const server = http.createServer(app);

// Setup WebSocket
setupWebSocket(server);

// Start server
async function startServer() {
  try {
    console.log('[Server] Connecting to database...');
    await db.sequelize.authenticate();
    console.log('[Server] Database connection established');

    console.log('[Server] Syncing database models...');
    await db.sequelize.sync({ alter: true });
    console.log('[Server] Database models synced');

    // Start oracle price updates
    const { startPriceUpdates } = require('./routes/oracle');
    startPriceUpdates();

    server.listen(PORT, () => {
      console.log('');
      console.log('==============================================');
      console.log('  SX OMNI CHAIN BACKEND API');
      console.log('==============================================');
      console.log(`  Server:    http://localhost:${PORT}`);
      console.log(`  WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`  API Base:  http://localhost:${PORT}/api`);
      console.log(`  Health:    http://localhost:${PORT}/api/health`);
      console.log('----------------------------------------------');
      console.log('  Chains:    Hoodi (560048), Base Sepolia (84532)');
      console.log('  Database:  PostgreSQL (Render)');
      console.log('  CORS:      localhost:5173');
      console.log('==============================================');
      console.log('');
    });
  } catch (error) {
    console.error('[Server] Failed to start:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  const { stopPriceUpdates } = require('./routes/oracle');
  stopPriceUpdates();
  server.close(() => {
    db.sequelize.close().then(() => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  });
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received. Shutting down...');
  const { stopPriceUpdates } = require('./routes/oracle');
  stopPriceUpdates();
  server.close(() => {
    db.sequelize.close().then(() => {
      console.log('[Server] Shutdown complete');
      process.exit(0);
    });
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

startServer();

module.exports = { app, server };
