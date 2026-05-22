const express = require('express');
const https = require('https');
const { query } = require('../config/database');
const logger = require('../lib/logger');

const router = express.Router();

const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';
const redirectUri = API_URL + '/api/oauth/oura/callback';

function ouraTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = 'grant_type=authorization_code&code=' + encodeURIComponent(code) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) +
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
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid response')); }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

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
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'daily heartrate workout tag session spo2');
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  } catch (err) {
    logger.error('Oura connect error: ' + err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
