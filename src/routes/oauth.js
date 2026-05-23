const express = require('express');
const https = require('https');
const { query } = require('../config/database');
const logger = require('../lib/logger');

const router = express.Router();

const OURA_CLIENT_ID = (process.env.OURA_CLIENT_ID || '').trim();
const OURA_CLIENT_SECRET = (process.env.OURA_CLIENT_SECRET || '').trim();
const STRAVA_CLIENT_ID = (process.env.STRAVA_CLIENT_ID || '').trim();
const STRAVA_CLIENT_SECRET = (process.env.STRAVA_CLIENT_SECRET || '').trim();
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net').trim();
const API_URL = (process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com').trim();
const stravaRedirectUri = API_URL + '/api/oauth/strava/callback';
const ouraRedirectUri = API_URL + '/api/oauth/oura/callback';

// ─── Strava ──────────────────────────────────────────────────────────

function stravaTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, code, grant_type: 'authorization_code' });
    const options = { hostname: 'www.strava.com', port: 443, path: '/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => { let data = ''; response.on('data', (chunk) => { data += chunk; }); response.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid Strava response')); } }); });
    request.on('error', (err) => reject(err)); request.write(postData); request.end();
  });
}

router.get('/strava/connect', async (req, res) => {
  try {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) return res.status(500).json({ error: 'Strava not configured' });
    const token = req.query.token; if (!token) return res.status(401).json({ error: 'Missing token' });
    let userId; try { userId = require('jsonwebtoken').verify(token, process.env.JWT_SECRET).userId; } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    res.redirect('https://www.strava.com/oauth/authorize?client_id=' + STRAVA_CLIENT_ID + '&redirect_uri=' + encodeURIComponent(stravaRedirectUri) + '&response_type=code&scope=' + encodeURIComponent('read,activity:read_all,profile:read_all') + '&state=' + encodeURIComponent(state));
  } catch (err) { logger.error('Strava connect: ' + err.message); res.status(500).json({ error: err.message }); }
});

router.get('/strava/callback', async (req, res) => {
  try {
    const code = req.query.code, state = req.query.state;
    if (!code || !state) return res.redirect(FRONTEND_URL + '/#/settings?error=strava_cancelled');
    let userId; try { userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId; } catch { return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state'); }
    const tokenData = await stravaTokenRequest(code);
    if (!tokenData.access_token) { logger.error('Strava token fail: ' + JSON.stringify(tokenData)); return res.redirect(FRONTEND_URL + '/#/settings?error=strava_token'); }
    await query('INSERT INTO oauth_connections (user_id, provider, access_token) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = $4, token_expires_at = $5, provider_athlete_id = $6, scope = $7, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()', [userId, 'strava', tokenData.access_token, tokenData.refresh_token, new Date(Date.now() + tokenData.expires_in * 1000).toISOString(), tokenData.athlete.id.toString(), 'read,activity:read_all,profile:read_all', 'ok']);
    res.redirect(FRONTEND_URL + '/#/settings?strava=connected');
  } catch (err) { logger.error('Strava callback: ' + err.message); res.redirect(FRONTEND_URL + '/#/settings?error=strava_failed'); }
});

router.post('/strava/disconnect', async (req, res) => {
  try { const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token; const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET); await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [decoded.userId, 'strava']); res.json({ message: 'Strava disconnected' }); } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
});

// ─── Oura ────────────────────────────────────────────────────────────

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = 'grant_type=authorization_code&code=' + encodeURIComponent(code) + '&redirect_uri=' + encodeURIComponent(ouraRedirectUri) + '&client_id=' + encodeURIComponent(OURA_CLIENT_ID) + '&client_secret=' + encodeURIComponent(OURA_CLIENT_SECRET);
    const options = { hostname: 'api.ouraring.com', port: 443, path: '/v2/oauth/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) } };
    const request = https.request(options, (response) => { let data = ''; response.on('data', (chunk) => { data += chunk; }); response.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid Oura response')); } }); });
    request.on('error', (err) => reject(err)); request.write(postData); request.end();
  });
}

router.get('/oura/connect', async (req, res) => {
  try {
    if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) return res.status(500).json({ error: 'Oura not configured' });
    const token = req.query.token; if (!token) return res.status(401).json({ error: 'Missing token' });
    let userId; try { userId = require('jsonwebtoken').verify(token, process.env.JWT_SECRET).userId; } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    res.redirect('https://cloud.ouraring.com/oauth/authorize?client_id=' + OURA_CLIENT_ID + '&redirect_uri=' + encodeURIComponent(ouraRedirectUri) + '&response_type=code&state=' + encodeURIComponent(state));
  } catch (err) { logger.error('Oura connect: ' + err.message); res.status(500).json({ error: err.message }); }
});

router.get('/oura/callback', async (req, res) => {
  try {
    const code = req.query.code, state = req.query.state, error = req.query.error;
    if (error) return res.redirect(FRONTEND_URL + '/#/settings?error=oura_' + error);
    if (!code || !state) return res.redirect(FRONTEND_URL + '/#/settings?error=oura_missing');
    let userId; try { userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId; } catch { return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state'); }
    logger.info('Oura exchanging code for token. redirectUri=' + ouraRedirectUri + ' codeLength=' + (code ? code.length : 0));
    const tokenData = await ouraTokenRequest(code);
    logger.info('Oura token response: ' + JSON.stringify(tokenData).substring(0, 500));
    if (!tokenData.access_token) { logger.error('Oura token FAILED: ' + JSON.stringify(tokenData)); return res.redirect(FRONTEND_URL + '/#/settings?error=oura_token_fail&detail=' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown')); }
    await query('INSERT INTO oauth_connections (user_id, provider, access_token) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = $4, token_expires_at = $5, sync_status = $6, connected_at = NOW(), last_sync_at = NOW()', [userId, 'oura', tokenData.access_token, tokenData.refresh_token || null, new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(), 'ok']);
    res.redirect(FRONTEND_URL + '/#/settings?oura=connected');
  } catch (err) { logger.error('Oura callback: ' + err.message); res.redirect(FRONTEND_URL + '/#/settings?error=oura_failed'); }
});

router.post('/oura/disconnect', async (req, res) => {
  try { const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token; const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET); await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [decoded.userId, 'oura']); res.json({ message: 'Oura disconnected' }); } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
});

// ─── Sync ────────────────────────────────────────────────────────────

function apiGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname, port: 443, path, method: 'GET', headers }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    request.on('error', (err) => reject(err));
    request.end();
  });
}

router.post('/strava/sync', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || req.body.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    let userId; try { userId = require('jsonwebtoken').verify(token, process.env.JWT_SECRET).userId; } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [userId, 'strava']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Strava not connected' });
    const accessToken = conn.rows[0].access_token;

    const after = Math.floor(Date.now() / 1000) - 30 * 86400;
    const activities = await apiGet('www.strava.com', '/api/v3/athlete/activities?after=' + after + '&per_page=50', { Authorization: 'Bearer ' + accessToken });

    let imported = 0;
    if (Array.isArray(activities)) {
      for (const a of activities) {
        await query(
          'INSERT INTO activities (user_id, external_id, provider, name, type, start_date, duration_seconds, distance_meters, elevation_gain_meters, calories, avg_hr, max_hr, avg_power, max_power, avg_speed_ms, max_speed_ms, avg_cadence, summary_polyline, location_city, location_state, location_country, commute, manual, device_name, gear_id, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW()) ON CONFLICT (user_id, external_id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, start_date = EXCLUDED.start_date, duration_seconds = EXCLUDED.duration_seconds, distance_meters = EXCLUDED.distance_meters, elevation_gain_meters = EXCLUDED.elevation_gain_meters, calories = EXCLUDED.calories, avg_hr = EXCLUDED.avg_hr, max_hr = EXCLUDED.max_hr, avg_power = EXCLUDED.avg_power, max_power = EXCLUDED.max_power, avg_speed_ms = EXCLUDED.avg_speed_ms, max_speed_ms = EXCLUDED.max_speed_ms, avg_cadence = EXCLUDED.avg_cadence, summary_polyline = EXCLUDED.summary_polyline, location_city = EXCLUDED.location_city, location_state = EXCLUDED.location_state, location_country = EXCLUDED.location_country, commute = EXCLUDED.commute, manual = EXCLUDED.manual, device_name = EXCLUDED.device_name, gear_id = EXCLUDED.gear_id, raw_data = EXCLUDED.raw_data, updated_at = NOW()',
          [userId, a.id.toString(), 'strava', a.name, a.type, new Date(a.start_date), a.elapsed_time, Math.round(a.distance), a.total_elevation_gain || 0, a.calories || 0, a.average_heartrate || 0, a.max_heartrate || 0, a.average_watts || 0, a.max_watts || 0, a.average_speed || 0, a.max_speed || 0, a.average_cadence || 0, a.map && a.map.summary_polyline || '', a.location_city || '', a.location_state || '', a.location_country || '', a.commute || false, a.manual || false, a.device_name || '', a.gear_id || '', JSON.stringify(a)]
        );
        imported++;
      }
    }

    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', userId, 'strava']);
    res.json({ imported, total: Array.isArray(activities) ? activities.length : 0 });
  } catch (err) { logger.error('Strava sync: ' + err.message); res.status(500).json({ error: err.message }); }
});

router.post('/oura/sync', async (req, res) => {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token || req.body.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });
    let userId; try { userId = require('jsonwebtoken').verify(token, process.env.JWT_SECRET).userId; } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const conn = await query('SELECT access_token FROM oauth_connections WHERE user_id = $1 AND provider = $2', [userId, 'oura']);
    if (conn.rows.length === 0) return res.status(404).json({ error: 'Oura not connected' });
    const accessToken = conn.rows[0].access_token;

    const now = new Date().toISOString().split('T')[0];
    const start = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

    const [sleep, readiness, activity] = await Promise.all([
      apiGet('api.ouraring.com', '/v2/usercollection/daily_sleep?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_readiness?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
      apiGet('api.ouraring.com', '/v2/usercollection/daily_activity?start_date=' + start + '&end_date=' + now, { Authorization: 'Bearer ' + accessToken }),
    ]);

    let imported = 0;
    const data = { sleep: sleep && sleep.data ? sleep.data.length : 0, readiness: readiness && readiness.data ? readiness.data.length : 0, activity: activity && activity.data ? activity.data.length : 0 };

    if (sleep && Array.isArray(sleep.data)) {
      for (const d of sleep.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'sleep_total', d.total_sleep_duration || 0, JSON.stringify(d)]);
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'sleep_score', d.score || 0, JSON.stringify(d)]);
        imported += 2;
      }
    }

    if (readiness && Array.isArray(readiness.data)) {
      for (const d of readiness.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'readiness_score', d.score || 0, JSON.stringify(d)]);
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'hrv', d.hrv_balance || 0, JSON.stringify(d)]);
        imported += 2;
      }
    }

    if (activity && Array.isArray(activity.data)) {
      for (const d of activity.data) {
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'steps', d.steps || 0, JSON.stringify(d)]);
        await query('INSERT INTO health_data (user_id, provider, date, metric_type, value, raw_data, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) ON CONFLICT (user_id, provider, date, metric_type) DO UPDATE SET value = EXCLUDED.value, raw_data = EXCLUDED.raw_data, updated_at = NOW()', [userId, 'oura', d.day, 'calories', d.total_calories || 0, JSON.stringify(d)]);
        imported += 2;
      }
    }

    await query('UPDATE oauth_connections SET last_sync_at = NOW(), sync_status = $1 WHERE user_id = $2 AND provider = $3', ['ok', userId, 'oura']);
    res.json({ imported, data });
  } catch (err) { logger.error('Oura sync: ' + err.message); res.status(500).json({ error: err.message }); }
});

router.get('/connections', async (req, res) => {
  try { const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token; const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET); const result = await query('SELECT provider, scope, connected_at, last_sync_at, sync_status FROM oauth_connections WHERE user_id = $1 ORDER BY provider', [decoded.userId]); res.json({ connections: result.rows, count: result.rows.length }); } catch (err) { res.status(401).json({ error: 'Invalid token' }); }
});

module.exports = router;
