const express = require('express');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../lib/logger');

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ambitious-meadow-053230410.7.azurestaticapps.net';
const API_URL = 'https://vitals-auth-izmn.vercel.app';
const redirectUri = `${API_URL}/api/oauth/strava/callback`;

// POST /api/oauth/strava/authorize - Returns auth URL (uses Bearer token in header)
router.post('/strava/authorize', requireAuth, async (req, res, next) => {
  try {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Strava OAuth not configured' });
    }

    const state = Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64');

    const authUrl = new URL('https://www.strava.com/oauth/authorize');
    authUrl.searchParams.set('client_id', STRAVA_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
    authUrl.searchParams.set('state', state);

    res.json({ authUrl: authUrl.toString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/oauth/strava/connect - Direct redirect (uses token in query param)
router.get('/strava/connect', requireAuth, async (req, res, next) => {
  try {
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Strava OAuth not configured' });
    }
    const state = Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64');
    const authUrl = new URL('https://www.strava.com/oauth/authorize');
    authUrl.searchParams.set('client_id', STRAVA_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
    authUrl.searchParams.set('state', state);
    res.redirect(authUrl.toString());
  } catch (err) {
    next(err);
  }
});

router.get('/strava/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/settings?error=strava_cancelled`);
    }
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      return res.redirect(`${FRONTEND_URL}/settings?error=invalid_state`);
    }
    const tokenRes = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect(`${FRONTEND_URL}/settings?error=strava_token_failed`);
    }
    await query(
      `INSERT INTO oauth_connections (user_id, provider, access_token, refresh_token, token_expires_at, scopes, sync_status, connected_at)
       VALUES ($1, 'strava', $2, $3, $4, $5, 'ok', NOW())
       ON CONFLICT (user_id, provider) DO UPDATE SET
         access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes,
         sync_status = 'ok', last_sync_at = NOW()`,
      [userId, tokenData.access_token, tokenData.refresh_token,
       new Date(Date.now() + tokenData.expires_in * 1000),
       ['read', 'activity:read_all', 'profile:read_all']]
    );
    res.redirect(`${FRONTEND_URL}/settings?strava=connected`);
  } catch (err) {
    logger.error('Strava callback error:', err.message);
    res.redirect(`${FRONTEND_URL}/settings?error=strava_failed`);
  }
});

router.post('/strava/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query('DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2',
      [req.user.userId, 'strava']);
    res.json({ disconnected: true });
  } catch (err) { next(err); }
});

router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT provider, connected_at as "connectedAt", last_sync_at as "lastSyncAt", sync_status as "syncStatus" FROM oauth_connections WHERE user_id = $1',
      [req.user.userId]);
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
