const express = require('express');
const https = require('https');
const { query } = require('../config/database');
const logger = require('../lib/logger');

const router = express.Router();

const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';
const stravaRedirectUri = API_URL + '/api/oauth/strava/callback';
const ouraRedirectUri = API_URL + '/api/oauth/oura/callback';

// ─── Strava ──────────────────────────────────────────────────────────

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
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid Strava response')); }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

router.get('/strava/connect', async (req, res) => {
  try {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Strava not configured' });
    }

    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    const authUrl = 'https://www.strava.com/oauth/authorize' +
      '?client_id=' + STRAVA_CLIENT_ID +
      '&redirect_uri=' + encodeURIComponent(stravaRedirectUri) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent('read,activity:read_all,profile:read_all') +
      '&state=' + encodeURIComponent(state);

    res.redirect(authUrl);
  } catch (err) {
    logger.error('Strava connect error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/strava/callback', async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=strava_cancelled');
    }

    let userId;
    try {
      userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId;
    } catch {
      return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state');
    }

    const tokenData = await stravaTokenRequest(code);

    if (!tokenData.access_token) {
      logger.error('Strava token fail: ' + JSON.stringify(tokenData));
      return res.redirect(FRONTEND_URL + '/#/settings?error=strava_token');
    }

    // Simple UPSERT - only required columns + a few extras
    const athleteId = tokenData.athlete && tokenData.athlete.id ? tokenData.athlete.id.toString() : null;
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const refreshToken = tokenData.refresh_token || null;

    await query(
      'INSERT INTO oauth_connections (user_id, provider, access_token) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = $4, token_expires_at = $5, provider_athlete_id = $6, scope = $7, sync_status = $8, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'strava', tokenData.access_token, refreshToken, expiresAt, athleteId, 'read,activity:read_all,profile:read_all', 'ok']
    );

    res.redirect(FRONTEND_URL + '/#/settings?strava=connected');
  } catch (err) {
    logger.error('Strava callback error: ' + err.message);
    res.redirect(FRONTEND_URL + '/#/settings?error=strava_failed');
  }
});

router.post('/strava/disconnect', async (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token || req.body.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [userId, 'strava']);
    res.json({ message: 'Strava disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Oura ────────────────────────────────────────────────────────────

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = 'grant_type=authorization_code' +
      '&code=' + encodeURIComponent(code) +
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
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid Oura response')); }
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
      return res.status(500).json({ error: 'Oura not configured' });
    }

    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    const authUrl = 'https://cloud.ouraring.com/oauth/authorize' +
      '?client_id=' + OURA_CLIENT_ID +
      '&redirect_uri=' + encodeURIComponent(ouraRedirectUri) +
      '&response_type=code' +
      '&scope=' + encodeURIComponent('daily heartrate workout tag session spo2') +
      '&state=' + encodeURIComponent(state);

    logger.info('Oura auth URL: ' + authUrl);
    res.redirect(authUrl);
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
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_missing');
    }

    let userId;
    try {
      userId = JSON.parse(Buffer.from(state, 'base64').toString()).userId;
    } catch {
      return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state');
    }

    logger.info('Oura exchanging code for token. redirectUri=' + ouraRedirectUri + ' codeLength=' + (code ? code.length : 0));

    const tokenData = await ouraTokenRequest(code);

    logger.info('Oura token response: ' + JSON.stringify(tokenData).substring(0, 500));

    if (!tokenData.access_token) {
      logger.error('Oura token FAILED: ' + JSON.stringify(tokenData));
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_token_fail&detail=' + encodeURIComponent(tokenData.error_description || tokenData.error || 'unknown'));
    }

    // Simple UPSERT - only required columns + extras in UPDATE
    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();
    const refreshToken = tokenData.refresh_token || null;

    await query(
      'INSERT INTO oauth_connections (user_id, provider, access_token) VALUES ($1, $2, $3) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = $4, token_expires_at = $5, scope = $6, sync_status = $7, connected_at = NOW(), last_sync_at = NOW()',
      [userId, 'oura', tokenData.access_token, refreshToken, expiresAt, 'daily heartrate workout tag session spo2', 'ok']
    );

    res.redirect(FRONTEND_URL + '/#/settings?oura=connected');
  } catch (err) {
    logger.error('Oura callback error: ' + err.message);
    res.redirect(FRONTEND_URL + '/#/settings?error=oura_failed');
  }
});

router.post('/oura/disconnect', async (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token || req.body.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2', [userId, 'oura']);
    res.json({ message: 'Oura disconnected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Shared ──────────────────────────────────────────────────────────

router.get('/connections', async (req, res) => {
  try {
    const token = req.headers.authorization || req.query.token || req.body.token;
    if (!token) return res.status(401).json({ error: 'Missing token' });

    let userId;
    try {
      const decoded = require('jsonwebtoken').verify(token.replace('Bearer ', ''), process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await query(
      'SELECT provider, scope, connected_at, last_sync_at, sync_status FROM oauth_connections WHERE user_id = $1 ORDER BY provider',
      [userId]
    );
    res.json({ connections: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
