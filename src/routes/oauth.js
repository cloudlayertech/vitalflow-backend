const express = require('express');
const https = require('https');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { ValidationError, NotFoundError } = require('../lib/errors');
const logger = require('../lib/logger');

const router = express.Router();

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;

// GET /api/oauth/strava/connect
router.get('/strava/connect', requireAuth, (req, res) => {
  if (!STRAVA_CLIENT_ID) {
    return res.status(500).json({ error: 'Strava integration not configured' });
  }

  const redirectUri = `${API_URL}/api/oauth/strava/callback`;
  const state = Buffer.from(JSON.stringify({ userId: req.user.userId })).toString('base64');

  const authUrl = `https://www.strava.com/oauth/authorize?` +
    `client_id=${STRAVA_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=read,activity:read_all,profile:read_all&` +
    `state=${encodeURIComponent(state)}`;

  res.redirect(authUrl);
});

// GET /api/oauth/strava/callback
router.get('/strava/callback', async (req, res, next) => {
  try {
    const { code, state, error: stravaError } = req.query;

    if (stravaError) {
      logger.error(`Strava auth error: ${stravaError}`);
      return res.redirect(`${FRONTEND_URL}/settings?error=strava_denied`);
    }

    if (!code) {
      throw new ValidationError('Authorization code missing');
    }

    // Decode state to get userId
    let userId;
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = stateData.userId;
    } catch {
      throw new ValidationError('Invalid state parameter');
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      throw new ValidationError('Strava credentials not configured');
    }

    // Exchange code for token
    const tokenData = await stravaTokenRequest(code);

    // Upsert oauth connection
    await query(
      `INSERT INTO oauth_connections 
        (user_id, provider, provider_athlete_id, access_token, refresh_token, token_expires_at, scope, connected_at, created_at, updated_at)
       VALUES ($1, 'strava', $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
       ON CONFLICT (user_id, provider) 
       DO UPDATE SET
        provider_athlete_id = EXCLUDED.provider_athlete_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expires_at = EXCLUDED.token_expires_at,
        scope = EXCLUDED.scope,
        connected_at = EXCLUDED.connected_at,
        updated_at = NOW()`,
      [
        userId,
        tokenData.athlete.id.toString(),
        tokenData.access_token,
        tokenData.refresh_token,
        new Date(Date.now() + tokenData.expires_in * 1000),
        'read,activity:read_all,profile:read_all',
      ]
    );

    logger.info(`Strava connected for user ${userId}`);
    res.redirect(`${FRONTEND_URL}/settings?success=strava_connected`);
  } catch (err) {
    next(err);
  }
});

// POST /api/oauth/strava/disconnect
router.post('/strava/disconnect', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      'DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2 RETURNING id',
      [req.user.userId, 'strava']
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Strava connection not found');
    }

    logger.info(`Strava disconnected for user ${req.user.userId}`);
    res.json({ message: 'Strava account disconnected' });
  } catch (err) {
    next(err);
  }
});

// GET /api/oauth/connections
router.get('/connections', requireAuth, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        id,
        provider,
        provider_athlete_id,
        scope,
        connected_at,
        last_sync_at,
        sync_status,
        created_at,
        updated_at
      FROM oauth_connections
      WHERE user_id = $1
      ORDER BY provider ASC`,
      [req.user.userId]
    );

    res.json({
      connections: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

// Helper: exchange Strava code for tokens
function stravaTokenRequest(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      code,
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
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors || parsed.message) {
            reject(new Error(parsed.message || 'Strava token exchange failed'));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Invalid response from Strava'));
        }
      });
    });

    request.on('error', (err) => reject(err));
    request.write(postData);
    request.end();
  });
}

module.exports = router;
