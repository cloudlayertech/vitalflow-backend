const express = require('express');
const { query } = require('../config/database');
const logger = require('../lib/logger');

const router = express.Router();

const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = process.env.API_URL || 'https://vitalflow-api-mbzw.onrender.com';
const redirectUri = API_URL + '/api/oauth/oura/callback';

router.get('/oura/debug', (req, res) => {
  res.json({
    clientIdSet: !!OURA_CLIENT_ID,
    clientIdLength: OURA_CLIENT_ID ? OURA_CLIENT_ID.length : 0,
    clientSecretSet: !!OURA_CLIENT_SECRET,
    redirectUri: redirectUri,
  });
});

router.get('/oura/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_' + error);
    }

    if (!code || !state) {
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_missing_params');
    }

    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      return res.redirect(FRONTEND_URL + '/#/settings?error=invalid_state');
    }

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);
    params.append('client_id', OURA_CLIENT_ID);
    params.append('client_secret', OURA_CLIENT_SECRET);

    const tokenRes = await fetch('https://api.ouraring.com/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      logger.error('Oura token error: ' + JSON.stringify(tokenData));
      return res.redirect(FRONTEND_URL + '/#/settings?error=oura_token_failed');
    }

    await query(
      'INSERT INTO oauth_connections (user_id, provider, access_token, refresh_token, token_expires_at, scopes, sync_status, connected_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (user_id, provider) DO UPDATE SET access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes, sync_status = $7, last_sync_at = NOW()',
      [
        userId,
        'oura',
        tokenData.access_token,
        tokenData.refresh_token || null,
        new Date(Date.now() + (tokenData.expires_in || 3600) * 1000),
        'daily heartrate workout tag session spo2',
        'ok',
      ]
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
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.userId;
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token', statusCode: 401 });
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
