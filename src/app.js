const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const { rateLimiter } = require('./middleware/rateLimit');
const { errorHandler } = require('./middleware/error');
const logger = require('./lib/logger');

// Route imports
const authRoutes = require('./routes/auth');
const healthRoutes = require('./routes/health');
const activitiesRoutes = require('./routes/activities');
const trainingRoutes = require('./routes/training');
const dashboardRoutes = require('./routes/dashboard');
const oauthRoutes = require('./routes/oauth');
const ouraOauthRoutes = require('./routes/oauth.oura');
const webhookRoutes = require('./routes/webhooks');

function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Allow frontend to load resources
    crossOriginEmbedderPolicy: false,
  }));

  // CORS
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:4173',
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(null, true); // In production, tighten this
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Logging
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
  }));

  // Rate limiting
  app.use(rateLimiter);

  // Health check (unauthenticated)
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: process.uptime(),
    });
  });

  // Mount API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/health-data', healthRoutes);
  app.use('/api/activities', activitiesRoutes);
  app.use('/api/training', trainingRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/oauth', oauthRoutes);
  app.use('/api/oauth', ouraOauthRoutes);
  app.use('/webhooks', webhookRoutes);

  // Root route
  app.get('/', (req, res) => {
    res.json({
      name: 'VitalFlow API',
      version: '0.1.0',
      status: 'running',
      docs: '/health',
    });
  });

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
