const express = require('express');
const logger = require('../lib/logger');

const router = express.Router();

// Strava webhook verification (GET /webhooks/strava)
router.get('/strava', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // The verify token should match a secret you configure
  const expectedToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'vitalflow-verify';

  if (mode === 'subscribe' && token === expectedToken) {
    logger.info('Strava webhook verification successful');
    res.json({ 'hub.challenge': challenge });
  } else {
    logger.warn('Strava webhook verification failed');
    res.status(403).json({ error: 'Verification failed' });
  }
});

// Strava webhook event receiver (POST /webhooks/strava)
router.post('/strava', async (req, res) => {
  try {
    const event = req.body;
    logger.info('Strava webhook received', { object_type: event.object_type, aspect_type: event.aspect_type });

    // Acknowledge immediately (Strava expects 200 within 2 seconds)
    res.status(200).json({ received: true });

    // Process asynchronously
    processStravaEvent(event);
  } catch (err) {
    logger.error('Strava webhook error', err.message);
    // Still return 200 to prevent Strava from retrying
    res.status(200).json({ received: true, error: true });
  }
});

// Async event processing
async function processStravaEvent(event) {
  try {
    if (event.object_type === 'activity' && event.aspect_type === 'create') {
      logger.info(`New activity created: ${event.object_id} for athlete ${event.owner_id}`);
      // TODO: Queue a sync job to fetch the full activity data
      // await queueSyncJob('activity', event.object_id, event.owner_id);
    } else if (event.object_type === 'activity' && event.aspect_type === 'update') {
      logger.info(`Activity updated: ${event.object_id}`);
      // TODO: Handle activity updates (title changes, etc.)
    } else if (event.object_type === 'activity' && event.aspect_type === 'delete') {
      logger.info(`Activity deleted: ${event.object_id}`);
      // TODO: Handle activity deletion
    } else if (event.object_type === 'athlete' && event.aspect_type === 'update') {
      logger.info(`Athlete updated: ${event.object_id}`);
      // TODO: Handle athlete profile updates (deauth, etc.)
    }
  } catch (err) {
    logger.error('Error processing Strava event', err.message);
  }
}

module.exports = router;
