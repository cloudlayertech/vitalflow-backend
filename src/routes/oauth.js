const express = require('express');
const https = require('https');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../lib/logger');

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';
const stravaRedirectUri = API_URL + '/api/oauth/strava/callback';
const ouraRedirectUri = API_URL + '/api/oauth/oura/callback';

// ─── Strava ──────────────────────────────────────────────────────────

function buildStravaAuthUrl(userId) {
  const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
  const authUrl = new URL('https://www.strava.com/oauth/authorize');
  authUrl.searchParams.set('client_id', STRAVA_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', stravaRedirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
  authUrl.searchParams.set('state', state);
  return authUrl.toString();
}

function stravaTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
    });

    const options = {
      hostname: 'www.strava.com',
      port: 443,
      path: '/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response from Strava')); }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

router.get('/strava/connect', requireAuth, async (req, res, next) => {
  try {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Strava OAuth not configured' });
    }
    res.redirect(buildStravaAuthUrl(req.user.userId));
  } catch (err) {
    next(err);
  }
});

router.get('/strava/callback', async (req, res, next) => {
  try {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=strava_cancelled');
    }

    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state');
    }

    const tokenData = await stravaTokenRequest(code);

    if (!tokenData.access_token) {
      logger.error('Strava token error: ' + JSON.stringify(tokenData));
      return res.redirect(FRONTEND_URL + '/#/settings?error=strava_token_failed');
    }

    await query(
      'INSERT INTO oauth_connections (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, sync_status, connected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (user_id, provider) DO UPDATE SET provider_athlete_id = EXCLUDED.provider_athlete_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scope = EXCLUDED.scope, sync_status = $7, connected_at = EXCLUDED.connected_at, last_sync_at = NOW()',
      [
        userId,
        'strava',
        tokenData.athlete.id.toString(),
        tokenData.access_token,
        tokenData.refresh_token,
        new Date(Date.now() + tokenData.expires_in * 1000),
        'read,activity:read_all,profile:read_all',
        'ok',
      ]
    );

    res.redirect(FRONTEND_URL + '/#/settings?strava=connected');
  } catch (err) {
    next(err);
  }
});

router.post('/strava/disconnect', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2 RETURNING id',
      [req.user.userId, 'strava']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Strava connection not found' });
    }
    res.json({ message: 'Strava account disconnected' });
  } catch (err) {
    next(err);
  }
});

// ─── Oura ────────────────────────────────────────────────────────────

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = 'grant_type=authorization_code&code=' + encodeURIComponent(code) +
      '&redirect_uri=' + encodeURIComponent(ouraRedirectUri) +
      '&client_id=' + encodeURIComponent(OURA_CLIENT_ID) +
      '&client_secret=' + encodeURIComponent(OURA_CLIENT_SECRET);

    const options = {
      hostname: 'api.ouraring.com',
      port: 443,
      path: '/v2/oauth/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response from Oura')); }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

router.get('/oura/connect', async (req, res) => {
  try {
    if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Oura OAuth not configured' });
    }

    const token = req.query.token;
    if (!token) {
      return res.status(401).json({ error: 'Missing token', statusCode: 401 });
    }

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token', statusCode: 401 });
    }

    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');

    const authUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
    authUrl.searchParams.set('client_id', OURA_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', ouraRedirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'daily heartrate workout tag session spo2');
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  } catch (err) {
    logger.error('Oura connect error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/oura/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;

    if (error) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_' + error);
    }
    if (!code || !state) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_missing_params');
    }

    let userId;
    try {
      userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId;
    } catch {
      return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state');
    }

    const tokenData = await ouraTokenRequest(code);

    if (!tokenData.access_token) {
      logger.error('Oura token error: ' + JSON.stringify(tokenData));
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_token_failed');
    }

    await query(
      'INSERT INTO oauth_connections (user_id, provider, access_token, refresh_token, token_expires_at, scopes, sync_status, connected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes, sync_status = $7, last_sync_at = NOW()',
      [userId, 'oura', tokenData.access_token, tokenData.refresh_token || null, new Date(Date.now() + (tokenData.expires_in || 3600) * 1000), 'daily heartrate workout tag session spo2', 'ok']
    );

    res.redirect(FRONTEND_URL + '/#/settings?oura=connected');
  } catch (err) {
    logger.error('Oura callback error: ' + err.message);
    res.redirect(FRONTEND_URL + '/#/settings?error=oura_failed');
  }
});

router.post('/oura/disconnect', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2 RETURNING id',
      [req.user.userId, 'oura']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Oura connection not found' });
    }
    res.json({ message: 'Oura account disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Shared ──────────────────────────────────────────────────────────

router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, provider, provider_athlete_id, scope, connected_at, last_sync_at, sync_status FROM oauth_connections WHERE user_id = $1 ORDER BY provider ASC',
      [req.user.userId]
    );
    res.json({ connections: result.rows, count: result.rows.length });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
