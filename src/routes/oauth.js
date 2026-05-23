const express = require('express');
const https = require('https');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../lib/errors');
const logger = require('../lib/logger');

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';

function frontendRedirect(path, query) {
  return `${FRONTEND_URL}/#${path}?${query}`;
}

// ============ STRAVA ROUTES ============

router.get('/strava/connect', requireAuth, (req, res) => {
  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: 'Strava integration not configured' });
  }
  const redirectUri = `${API_URL}/api/oauth/strava/callback`;
  const state = Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64');
  const authUrl = 'https://www.strava.com/oauth/authorize?' +
    `client_id=${STRAVA_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    'response_type=code&' +
    'scope=read,activity:read_all,profile:read_all&' +
    `state=${encodeURIComponent(state)}`;
  res.redirect(authUrl);
});

router.get('/strava/callback', async (req, res, next) => {
  try {
    const { code, state, error: stravaError } = req.query;
    if (stravaError) {
      logger.error(`Strava auth error: ${stravaError}`);
      return res.redirect(frontendRedirect('/settings', 'strava=error'));
    }
    if (!code) throw new ValidationError('Authorization code missing');
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      throw new ValidationError('Invalid state parameter');
    }
    const tokenData = await stravaTokenRequest(code);
    await query(
      'INSERT INTO oauth_connections (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, sync_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, provider) DO UPDATE SET provider_athlete_id = EXCLUDED.provider_athlete_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'strava', tokenData.athlete.id.toString(), tokenData.access_token, tokenData.refresh_token, new Date(Date.now() + tokenData.expires_in * 1000), 'read,activity:read_all,profile:read_all', 'ok']
    );
    logger.info(`Strava connected for user ${userId}`);
    res.redirect('https://ambitious-meadow-053230410.7.azurestaticapps.net/#/settings?strava=connected');
  } catch (err) {
    next(err);
  }
});

router.post('/strava/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'strava']);
    res.json({ message: 'Strava account disconnected' });
  } catch (err) {
    next(err);
  }
});

// ============ OURA ROUTES ============

router.get('/oura/connect', (req, res, next) => {
  try {
    if (!OURA_CLIENT_ID) return res.status(500).json({ error: 'Oura integration not configured' });
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token query parameter' });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = decoded.userId;
    const redirectUri = `${API_URL}/api/oauth/oura/callback`;
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    const authUrl = 'https://moi.ouraring.com/oauth/v2/ext/oauth-authorize?' +
      `client_id=${OURA_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      'response_type=code&' +
      'scope=email+personal+daily_readiness+daily_sleep+daily_activity+daily_spo2+heartrate+workout+tag+session+stress+heart_health+ring_configuration&' +
      `state=${encodeURIComponent(state)}`;
    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
});

router.get('/oura/callback', async (req, res, next) => {
  try {
    const { code, state, error: ouraError } = req.query;
    if (ouraError) {
      logger.error(`Oura auth error: ${ouraError}`);
      return res.redirect(frontendRedirect('/settings', 'oura=error'));
    }
    if (!code) throw new ValidationError('Authorization code missing');
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      throw new ValidationError('Invalid state parameter');
    }
    const tokenData = await ouraTokenRequest(code);
    await query(
      'INSERT INTO oauth_connections (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, sync_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, provider) DO UPDATE SET provider_athlete_id = EXCLUDED.provider_athlete_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'oura', tokenData.user_id || tokenData.userId || null, tokenData.access_token, tokenData.refresh_token || null, new Date(Date.now() + (tokenData.expires_in || 3600) * 1000), 'daily heartrate workout tag session spo2', 'ok']
    );
    logger.info(`Oura connected for user ${userId}`);
    res.redirect('https://ambitious-meadow-053230410.7.azurestaticapps.net/#/settings?oura=connected');
  } catch (err) {
    next(err);
  }
});

router.post('/oura/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'oura']);
    res.json({ message: 'Oura account disconnected' });
  } catch (err) {
    next(err);
  }
});

// ============ SHARED ============

router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT provider, scope, connected_at, last_sync_at, sync_status FROM oauth_connections WHERE user_id = $1 ORDER BY provider ASC`,
      [req.user.userId]
    );
    res.json({ connections: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// ============ HELPERS ============

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({ client_id: OURA_CLIENT_ID, client_secret: OURA_CLIENT_SECRET, code, grant_type: 'authorization_code' }).toString();
    const options = { hostname: 'api.ouraring.com', port: 443, path: '/v2/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { const parsed = JSON.parse(data); if (parsed.errors || parsed.error) reject(new Error(parsed.error_description || parsed.error)); else resolve(parsed); } catch { reject(new Error('Invalid response from Oura')); } });
    });
    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

function stravaTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code' });
    const options = { hostname: 'www.strava.com', port: 443, path: '/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { const parsed = JSON.parse(data); if (parsed.errors || parsed.message) reject(new Error(parsed.message)); else resolve(parsed); } catch { reject(new Error('Invalid response from Strava')); } });
    });
    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

function apiGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname, port: 443, path, method: 'GET', headers }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

async function ensureHealthDataTable() {
  await query(`CREATE TABLE IF NOT EXISTS health_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    value NUMERIC DEFAULT 0,
    raw_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider, date, metric_type)
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_health_data_user_date ON health_data(user_id, date)');
}

// POST /api/oauth/strava/sync
router.post('/strava/sync', requireAuth, async (req, res, next) => {
  try {
    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'strava']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Strava not connected' });
    const accessToken = conn.rows[0].access_token;
    logger.info('Strava sync: fetching activities for user ' + req.user.userId);
    const after = Math.floor(Date.now() / 1000) - 30 * 86400;
    const activities = await apiGet('www.strava.com', '/api/v3/athlete/activities?after=' + after + '&per_page=50', { Authorization: 'Bearer ' + accessToken });
    logger.info('Strava sync: response=' + JSON.stringify(activities).substring(0, 300));
    if (!Array.isArray(activities)) {
      logger.error('Strava sync: unexpected response type: ' + typeof activities);
      return res.status(500).json({ error: 'Invalid Strava response', response: activities });
    }
    let imported = 0;
    for (const a of activities) {
      await query(
        'INSERT INTO activities (user_id, external_id, provider, name, type, start_date, duration_seconds, distance_meters, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) ON CONFLICT (user_id, external_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, start_date = EXCLUDED.start_date, duration_seconds = EXCLUDED.duration_seconds, distance_meters = EXCLUDED.distance_meters, raw_data = EXCLUDED.raw_data, updated_at = NOW()',
        [req.user.userId, a.id.toString(), 'strava', a.name, a.type, new Date(a.start_date), a.elapsed_time, Math.round(a.distance), JSON.stringify(a)]
      );
      imported++;
    }
    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', req.user.userId, 'strava']);
    res.json({ imported, total: activities.length });
  } catch (err) { logger.error('Strava sync: ' + err.message); next(err); }
});

// POST /api/oauth/oura/sync
router.post('/oura/sync', requireAuth, async (req, res, next) => {
  try {
    await ensureHealthDataTable();
    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'oura']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Oura not connected' });
    const accessToken = conn.rows[0].access_token;
    logger.info('Oura sync: fetching data for user ' + req.user.userId);
    const now = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const [sleep, readiness, activity] = await Promise.all([
      apiGet('api.ouraring.com', '/v2/usercollection/daily_sleep?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_readiness?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_activity?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
    ]);
    logger.info('Oura sleep: ' + (sleep.data ? sleep.data.length : 'no data'));
    logger.info('Oura readiness: ' + (readiness.data ? readiness.data.length : 'no data'));
    logger.info('Oura activity: ' + (activity.data ? activity.data.length : 'no data'));
    let imported = 0;
    if (sleep && Array.isArray(sleep.data)) {
      for (const d of sleep.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'sleep_total', d.total_sleep_duration || 0, JSON.stringify(d)]);
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'sleep_score', d.score || 0, JSON.stringify(d)]);
        if (d.average_hrv) {
          await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'hrv', d.average_hrv, JSON.stringify(d)]);
          imported += 1;
        }
        imported += 2;
      }
    }
    if (readiness && Array.isArray(readiness.data)) {
      for (const d of readiness.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'readiness_score', d.score || 0, JSON.stringify(d)]);
        imported += 1;
      }
    }
    if (activity && Array.isArray(activity.data)) {
      for (const d of activity.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'steps', d.steps || 0, JSON.stringify(d)]);
        imported += 1;
      }
    }
    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', req.user.userId, 'oura']);
    res.json({ imported, data: { sleep: sleep.data?.length || 0, readiness: readiness.data?.length || 0, activity: activity.data?.length || 0 } });
  } catch (err) { logger.error('Oura sync: ' + err.message); next(err); }
});

router.get('/debug', requireAuth, async (req, res) => {
  const conns = await query('SELECT provider, scope, sync_status, last_sync_at FROM oauth_connections WHERE user_id = $1', [req.user.userId]);
  res.json({ userId: req.user.userId, connections: conns.rows });
});

module.exports = router;
OEOFcat > src/routes/oauth.js << 'OEOF'
const express = require('express');
const https = require('https');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../lib/errors');
const logger = require('../lib/logger');

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';

function frontendRedirect(path, query) {
  return `${FRONTEND_URL}/#${path}?${query}`;
}

// ============ STRAVA ROUTES ============

router.get('/strava/connect', requireAuth, (req, res) => {
  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: 'Strava integration not configured' });
  }
  const redirectUri = `${API_URL}/api/oauth/strava/callback`;
  const state = Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64');
  const authUrl = 'https://www.strava.com/oauth/authorize?' +
    `client_id=${STRAVA_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    'response_type=code&' +
    'scope=read,activity:read_all,profile:read_all&' +
    `state=${encodeURIComponent(state)}`;
  res.redirect(authUrl);
});

router.get('/strava/callback', async (req, res, next) => {
  try {
    const { code, state, error: stravaError } = req.query;
    if (stravaError) {
      logger.error(`Strava auth error: ${stravaError}`);
      return res.redirect(frontendRedirect('/settings', 'strava=error'));
    }
    if (!code) throw new ValidationError('Authorization code missing');
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      throw new ValidationError('Invalid state parameter');
    }
    const tokenData = await stravaTokenRequest(code);
    await query(
      'INSERT INTO oauth_connections (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, sync_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, provider) DO UPDATE SET provider_athlete_id = EXCLUDED.provider_athlete_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'strava', tokenData.athlete.id.toString(), tokenData.access_token, tokenData.refresh_token, new Date(Date.now() + tokenData.expires_in * 1000), 'read,activity:read_all,profile:read_all', 'ok']
    );
    logger.info(`Strava connected for user ${userId}`);
    res.redirect('https://ambitious-meadow-053230410.7.azurestaticapps.net/#/settings?strava=connected');
  } catch (err) {
    next(err);
  }
});

router.post('/strava/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'strava']);
    res.json({ message: 'Strava account disconnected' });
  } catch (err) {
    next(err);
  }
});

// ============ OURA ROUTES ============

router.get('/oura/connect', (req, res, next) => {
  try {
    if (!OURA_CLIENT_ID) return res.status(500).json({ error: 'Oura integration not configured' });
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token query parameter' });
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
      return res.status(401).json({ error: 'Invalid token' });
    }
    const userId = decoded.userId;
    const redirectUri = `${API_URL}/api/oauth/oura/callback`;
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    const authUrl = 'https://moi.ouraring.com/oauth/v2/ext/oauth-authorize?' +
      `client_id=${OURA_CLIENT_ID}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      'response_type=code&' +
      'scope=email+personal+daily_readiness+daily_sleep+daily_activity+daily_spo2+heartrate+workout+tag+session+stress+heart_health+ring_configuration&' +
      `state=${encodeURIComponent(state)}`;
    res.redirect(authUrl);
  } catch (err) {
    next(err);
  }
});

router.get('/oura/callback', async (req, res, next) => {
  try {
    const { code, state, error: ouraError } = req.query;
    if (ouraError) {
      logger.error(`Oura auth error: ${ouraError}`);
      return res.redirect(frontendRedirect('/settings', 'oura=error'));
    }
    if (!code) throw new ValidationError('Authorization code missing');
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      throw new ValidationError('Invalid state parameter');
    }
    const tokenData = await ouraTokenRequest(code);
    await query(
      'INSERT INTO oauth_connections (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, sync_status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (user_id, provider) DO UPDATE SET provider_athlete_id = EXCLUDED.provider_athlete_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'oura', tokenData.user_id || tokenData.userId || null, tokenData.access_token, tokenData.refresh_token || null, new Date(Date.now() + (tokenData.expires_in || 3600) * 1000), 'daily heartrate workout tag session spo2', 'ok']
    );
    logger.info(`Oura connected for user ${userId}`);
    res.redirect('https://ambitious-meadow-053230410.7.azurestaticapps.net/#/settings?oura=connected');
  } catch (err) {
    next(err);
  }
});

router.post('/oura/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'oura']);
    res.json({ message: 'Oura account disconnected' });
  } catch (err) {
    next(err);
  }
});

// ============ SHARED ============

router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT provider, scope, connected_at, last_sync_at, sync_status FROM oauth_connections WHERE user_id = $1 ORDER BY provider ASC`,
      [req.user.userId]
    );
    res.json({ connections: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

// ============ HELPERS ============

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({ client_id: OURA_CLIENT_ID, client_secret: OURA_CLIENT_SECRET, code, grant_type: 'authorization_code' }).toString();
    const options = { hostname: 'api.ouraring.com', port: 443, path: '/v2/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { const parsed = JSON.parse(data); if (parsed.errors || parsed.error) reject(new Error(parsed.error_description || parsed.error)); else resolve(parsed); } catch { reject(new Error('Invalid response from Oura')); } });
    });
    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

function stravaTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code' });
    const options = { hostname: 'www.strava.com', port: 443, path: '/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { const parsed = JSON.parse(data); if (parsed.errors || parsed.message) reject(new Error(parsed.message)); else resolve(parsed); } catch { reject(new Error('Invalid response from Strava')); } });
    });
    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

function apiGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname, port: 443, path, method: 'GET', headers }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); } });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

async function ensureHealthDataTable() {
  await query(`CREATE TABLE IF NOT EXISTS health_data (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,
    date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    value NUMERIC DEFAULT 0,
    raw_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, provider, date, metric_type)
  )`);
  await query('CREATE INDEX IF NOT EXISTS idx_health_data_user_date ON health_data(user_id, date)');
}

// POST /api/oauth/strava/sync
router.post('/strava/sync', requireAuth, async (req, res, next) => {
  try {
    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'strava']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Strava not connected' });
    const accessToken = conn.rows[0].access_token;
    logger.info('Strava sync: fetching activities for user ' + req.user.userId);
    const after = Math.floor(Date.now() / 1000) - 30 * 86400;
    const activities = await apiGet('www.strava.com', '/api/v3/athlete/activities?after=' + after + '&per_page=50', { Authorization: 'Bearer ' + accessToken });
    logger.info('Strava sync: response=' + JSON.stringify(activities).substring(0, 300));
    if (!Array.isArray(activities)) {
      logger.error('Strava sync: unexpected response type: ' + typeof activities);
      return res.status(500).json({ error: 'Invalid Strava response', response: activities });
    }
    let imported = 0;
    for (const a of activities) {
      await query(
        'INSERT INTO activities (user_id, external_id, provider, name, type, start_date, duration_seconds, distance_meters, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) ON CONFLICT (user_id, external_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, start_date = EXCLUDED.start_date, duration_seconds = EXCLUDED.duration_seconds, distance_meters = EXCLUDED.distance_meters, raw_data = EXCLUDED.raw_data, updated_at = NOW()',
        [req.user.userId, a.id.toString(), 'strava', a.name, a.type, new Date(a.start_date), a.elapsed_time, Math.round(a.distance), JSON.stringify(a)]
      );
      imported++;
    }
    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', req.user.userId, 'strava']);
    res.json({ imported, total: activities.length });
  } catch (err) { logger.error('Strava sync: ' + err.message); next(err); }
});

// POST /api/oauth/oura/sync
router.post('/oura/sync', requireAuth, async (req, res, next) => {
  try {
    await ensureHealthDataTable();
    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [req.user.userId, 'oura']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Oura not connected' });
    const accessToken = conn.rows[0].access_token;
    logger.info('Oura sync: fetching data for user ' + req.user.userId);
    const now = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const [sleep, readiness, activity] = await Promise.all([
      apiGet('api.ouraring.com', '/v2/usercollection/daily_sleep?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_readiness?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_activity?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
    ]);
    logger.info('Oura sleep: ' + (sleep.data ? sleep.data.length : 'no data'));
    logger.info('Oura readiness: ' + (readiness.data ? readiness.data.length : 'no data'));
    logger.info('Oura activity: ' + (activity.data ? activity.data.length : 'no data'));
    let imported = 0;
    if (sleep && Array.isArray(sleep.data)) {
      for (const d of sleep.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'sleep_total', d.total_sleep_duration || 0, JSON.stringify(d)]);
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'sleep_score', d.score || 0, JSON.stringify(d)]);
        if (d.average_hrv) {
          await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'hrv', d.average_hrv, JSON.stringify(d)]);
          imported += 1;
        }
        imported += 2;
      }
    }
    if (readiness && Array.isArray(readiness.data)) {
      for (const d of readiness.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'readiness_score', d.score || 0, JSON.stringify(d)]);
        imported += 1;
      }
    }
    if (activity && Array.isArray(activity.data)) {
      for (const d of activity.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [req.user.userId, 'oura', d.day, 'steps', d.steps || 0, JSON.stringify(d)]);
        imported += 1;
      }
    }
    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', req.user.userId, 'oura']);
    res.json({ imported, data: { sleep: sleep.data?.length || 0, readiness: readiness.data?.length || 0, activity: activity.data?.length || 0 } });
  } catch (err) { logger.error('Oura sync: ' + err.message); next(err); }
});

router.get('/debug', requireAuth, async (req, res) => {
  const conns = await query('SELECT provider, scope, sync_status, last_sync_at FROM oauth_connections WHERE user_id = $1', [req.user.userId]);
  res.json({ userId: req.user.userId, connections: conns.rows });
});

module.exports = router;
