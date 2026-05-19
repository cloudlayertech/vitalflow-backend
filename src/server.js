require('dotenv').config();

const { createApp } = require('./app');
const { gracefulShutdown: dbShutdown } = require('./config/database');
const logger = require('./lib/logger');

const PORT = process.env.PORT || 3001;

// Validate required environment variables
const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const app = createApp();

const server = app.listen(PORT, () => {
  logger.info(`VitalFlow API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
async function handleShutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  server.close(async () => {
    try {
      await dbShutdown();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', err.message);
      process.exit(1);
    }
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err.message);
  handleShutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
});
