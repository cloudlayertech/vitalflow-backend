const express = require('express');
const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2').Strategy;
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const logger = require('../lib/logger');

const router = express.Router();

const OURA_CLIENT_ID = process.env.OURA_CLIENT_ID;
const OURA_CLIENT_SECRET = process.env.OURA_CLIENT_SECRET;
const API_URL = process.env.API_URL || 'https://vitals-auth.vercel.app';
const redirectUri = `${API_URL}/api/oauth/oura/callback`;

// Configure Oura OAuth2 strategy
passport.use('oura', new OAuth2Strategy({
  authorizationURL: 'https://cloud.ouraring.com/oauth/authorize',
  tokenURL: 'https://api.ouraring.com/v2/oauth/token',
  clientID: OURA_CLIENT_ID,
  clientSecret: OURA_CLIENT_SECRET,
  callbackURL: redirectUri,
  scope: ['daily', 'heartrate', 'workout', 'tag', 'session', 'spo2'],
  state: true,
  pkce: false,
}, async (accessToken, refreshToken, params, profile, done) => {
  try {
    // Fetch Oura user profile
    const userRes = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const userData = await userRes.json();

    return done(null, {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + params.expires_in * 1000),
      profile: userData,
    });
  } catch (err) {
    return done(err);
  }
}));

// Connect: Redirect to Oura authorization
router.get('/oura/connect', requireAuth, async (req, res, next) => {
  try {
    if (!OURA_CLIENT_ID || !OURA_CLIENT_SECRET) {
      return res.status(500).json({ error: 'Oura OAuth not configured' });
    }

    const state = Buffer.from(`${req.user.userId}:${Date.now()}`).toString('base64');

    // Store state temporarily
    await query(
      `INSERT INTO oauth_states (state, user_id, provider, created_at) 
       VALUES ($1, $2, 'oura', NOW())`,
      [state, req.user.userId]
    );

    const authUrl = new URL('https://cloud.ouraring.com/oauth/authorize');
    authUrl.searchParams.set('client_id', OURA_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'daily heartrate workout tag session spo2');
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  } catch (err) {
    next(err);
  }
});

// Callback: Exchange code for token
router.get('/oura/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=oura_cancelled`);
    }

    // Verify state and get user_id
    const stateResult = await query(
      'SELECT user_id FROM oauth_states WHERE state = $1 AND provider = $2',
      [state, 'oura']
    );

    if (stateResult.rows.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=invalid_state`);
    }

    const userId = stateResult.rows[0].user_id;

    // Exchange code for token
    const tokenRes = await fetch('https://api.ouraring.com/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: OURA_CLIENT_ID,
        client_secret: OURA_CLIENT_SECRET,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.redirect(`${process.env.FRONTEND_URL}/settings?error=token_exchange_failed`);
    }

    // Upsert oauth connection
    await query(
      `INSERT INTO oauth_connections 
       (user_id, provider, access_token, refresh_token, token_expires_at, scopes, sync_status, connected_at)
       VALUES ($1, 'oura', $2, $3, $4, $5, 'ok', NOW())
       ON CONFLICT (user_id, provider) 
       DO UPDATE SET 
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         token_expires_at = EXCLUDED.token_expires_at,
         scopes = EXCLUDED.scopes,
         sync_status = 'ok',
         last_sync_at = NOW()`,
      [
        userId,
        tokenData.access_token,
        tokenData.refresh_token || null,
        new Date(Date.now() + tokenData.expires_in * 1000),
        tokenData.scope?.split(' ') || ['daily'],
      ]
    );

    // Clean up state
    await query('DELETE FROM oauth_states WHERE state = $1', [state]);

    res.redirect(`${process.env.FRONTEND_URL}/settings?oura=connected`);
  } catch (err) {
    logger.error('Oura OAuth callback error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL}/settings?error=oura_failed`);
  }
});

// Disconnect
router.post('/oura/disconnect', requireAuth, async (req, res, next) => {
  try {
    await query(
      'DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2',
      [req.user.userId, 'oura']
    );
    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
