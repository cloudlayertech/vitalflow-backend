require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { pool, query } = require('../config/database');
const logger = require('../lib/logger');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function initMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations() {
  const result = await query('SELECT filename FROM migrations ORDER BY id ASC');
  return new Set(result.rows.map(r => r.filename));
}

async function runMigration(filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  logger.info(`Running migration: ${filename}`);

  await query('BEGIN');
  try {
    await query(sql);
    await query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
    await query('COMMIT');
    logger.info(`Migration applied: ${filename}`);
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

async function main() {
  try {
    await initMigrationsTable();
    const applied = await getAppliedMigrations();

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`Found ${files.length} migration files, ${applied.size} already applied`);

    let ran = 0;
    for (const file of files) {
      if (!applied.has(file)) {
        await runMigration(file);
        ran++;
      } else {
        logger.info(`Skipping (already applied): ${file}`);
      }
    }

    logger.info(`Migration complete. Applied ${ran} new migration(s).`);
  } catch (err) {
    logger.error('Migration failed', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
