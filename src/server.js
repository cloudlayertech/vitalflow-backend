require('dotenv').config();

const { createApp } = require('./app');
const { pool, gracefulShutdown: dbShutdown } = require('./config/database');
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

// Auto-run migrations on startup
async function runMigrations() {
  try {
    const fs = require('fs');
    const path = require('path');
    const migrationsDir = path.join(__dirname, '..', 'migrations');

    if (!fs.existsSync(migrationsDir)) {
      logger.warn('No migrations directory found at: ' + migrationsDir);
      return;
    }

    // Create migrations tracking table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        run_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`Found ${files.length} migration files`);

    for (const file of files) {
      const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if (rows.length > 0) {
        logger.info(`Skipping already-run migration: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      logger.info(`Running migration: ${file}`);
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      logger.info(`Migration completed: ${file}`);
    }

    logger.info('All migrations completed');
  } catch (err) {
    logger.error('Migration failed: ' + err.message);
    logger.error(err.stack);
  }
}

const server = app.listen(PORT, async () => {
  logger.info(`VitalFlow API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);

  // Run migrations after server starts
  await runMigrations();
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
