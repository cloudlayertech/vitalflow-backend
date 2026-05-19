require('dotenv').config();

const bcrypt = require('bcrypt');
const { pool, query } = require('../config/database');
const logger = require('../lib/logger');

const SALT_ROUNDS = 12;

async function seed() {
  try {
    logger.info('Starting seed...');

    // 1. Create test user (password: TestPass123!)
    const passwordHash = await bcrypt.hash('TestPass123!', SALT_ROUNDS);

    const userResult = await query(`
      INSERT INTO users (email, password_hash, first_name, last_name, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        updated_at = NOW()
      RETURNING id
    `, ['ed@cloudlayertech.com', passwordHash, 'Ed', 'Testuser']);

    const userId = userResult.rows[0].id;
    logger.info(`User created/updated: ed@cloudlayertech.com (ID: ${userId})`);

    // 2. Insert 30 days of daily summaries with realistic data
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      // Deterministic "random" values based on day
      const seed = i * 7 + 13;
      const steps = 6000 + (seed % 10000);
      const readinessScore = 50 + (seed % 40);
      const sleepScore = 45 + (seed % 45);
      const hrvScore = 40 + (seed % 50);
      const restingHr = 55 + (seed % 15);
      const activeMin = 30 + (seed % 90);

      await query(`
        INSERT INTO daily_summaries (
          user_id, date, steps, distance_meters, calories_burned, active_minutes,
          sleep_minutes, sleep_score, resting_hr, hrv_score, readiness_score,
          spo2_avg, respiratory_rate, skin_temp_c, wellness_score, weight_kg,
          fat_percentage, muscle_mass_kg, bone_mass_kg, bmr, hydration_percent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (user_id, date) DO UPDATE SET
          steps = EXCLUDED.steps,
          readiness_score = EXCLUDED.readiness_score,
          updated_at = NOW()
      `, [
        userId, dateStr, steps, steps * 0.762, 1800 + (seed % 800), activeMin,
        360 + (seed % 120), sleepScore, restingHr, hrvScore, readinessScore,
        96 + (seed % 3), 14 + (seed % 4), 35.5 + (seed % 10) / 10,
        Math.round((readinessScore + sleepScore + hrvScore) / 3),
        75 + (seed % 15), 15 + (seed % 8), 35 + (seed % 10),
        3.2 + (seed % 5) / 10, 1600 + (seed % 200), 55 + (seed % 15),
      ]);
    }
    logger.info('Inserted 30 daily summaries');

    // 3. Insert 10 activities
    const activityTypes = ['Ride', 'Run', 'Swim', 'Ride', 'Run', 'Ride', 'Run', 'Swim', 'Ride', 'Run'];
    const activityNames = [
      'Morning Commute', 'Lunch Run', 'Pool Session', 'Evening Ride',
      'Trail Run', 'Weekend Long Ride', 'Tempo Run', 'Open Water Swim',
      'Recovery Ride', 'Park Loop',
    ];

    for (let i = 0; i < 10; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (i * 3 + 1));
      const seed = i * 11 + 7;

      await query(`
        INSERT INTO activities (
          user_id, external_id, name, type, start_date, timezone,
          duration_seconds, distance_meters, elevation_gain_meters, calories,
          avg_hr, max_hr, avg_power, max_power, avg_speed_ms, max_speed_ms,
          avg_cadence, avg_temp_c, suffer_score, training_load, intensity,
          summary_polyline, location_city, location_country, weather_temp_c,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, [
        userId,
        `strava_${1000000000 + i}`,
        activityNames[i],
        activityTypes[i],
        date.toISOString(),
        'Europe/London',
        1800 + (seed % 7200),                    // duration_seconds
        5000 + (seed % 45000),                   // distance_meters
        50 + (seed % 450),                       // elevation_gain_meters
        200 + (seed % 800),                      // calories
        130 + (seed % 40),                       // avg_hr
        160 + (seed % 30),                       // max_hr
        150 + (seed % 100),                      // avg_power
        300 + (seed % 250),                      // max_power
        5 + (seed % 10),                         // avg_speed_ms
        12 + (seed % 8),                         // max_speed_ms
        80 + (seed % 20),                        // avg_cadence
        18 + (seed % 10),                        // avg_temp_c
        30 + (seed % 70),                        // suffer_score
        50 + (seed % 150),                       // training_load
        (0.6 + (seed % 40) / 100).toFixed(2),    // intensity
        '_p~iF~ps|U',                            // summary_polyline (placeholder)
        'London',                                // location_city
        'United Kingdom',                        // location_country
        15 + (seed % 15),                        // weather_temp_c
      ]);
    }
    logger.info('Inserted 10 activities');

    // 4. Insert 30 days of training metrics
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const seed = i * 13 + 3;

      // Build up CTL/ATL gradually
      const ctl = 30 + (29 - i) * 1.5 + (seed % 10);
      const atl = 25 + (29 - i) * 2 + (seed % 15);
      const tsb = Math.round(ctl - atl);

      await query(`
        INSERT INTO training_metrics (
          user_id, date, ctl, atl, tsb, weekly_tss, weekly_hours,
          monotony, strain, acwr, fitness_trend, form_trend
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (user_id, date) DO UPDATE SET
          ctl = EXCLUDED.ctl,
          atl = EXCLUDED.atl,
          tsb = EXCLUDED.tsb
      `, [
        userId,
        dateStr,
        Math.round(ctl * 10) / 10,
        Math.round(atl * 10) / 10,
        tsb,
        200 + (seed % 300),                     // weekly_tss
        (5 + (seed % 10)).toFixed(1),           // weekly_hours
        (1.2 + (seed % 20) / 100).toFixed(2),   // monotony
        50 + (seed % 200),                       // strain
        (0.8 + (seed % 40) / 100).toFixed(2),   // acwr
        ctl > 50 ? 'increasing' : 'building',   // fitness_trend
        tsb > 10 ? 'positive' : tsb < -20 ? 'negative' : 'neutral', // form_trend
      ]);
    }
    logger.info('Inserted 30 training metrics');

    // 5. Insert 5 alerts
    const alerts = [
      { type: 'readiness', severity: 'high', title: 'Low Readiness Score', message: 'Your readiness score dropped below 50 for 3 consecutive days.' },
      { type: 'sleep', severity: 'medium', title: 'Sleep Debt Accumulating', message: 'You have averaged less than 6 hours of sleep over the past week.' },
      { type: 'hrv', severity: 'medium', title: 'HRV Trend Declining', message: 'Your HRV score has been declining for 5 consecutive days.' },
      { type: 'load', severity: 'low', title: 'High Training Load', message: 'Weekly training load exceeded 500 TSS. Consider adding recovery.' },
      { type: 'recovery', severity: 'high', title: 'Overreaching Detected', message: 'TSB below -30 for 2 consecutive days. Prioritize recovery.' },
    ];

    for (let i = 0; i < alerts.length; i++) {
      const alert = alerts[i];
      await query(`
        INSERT INTO alerts (
          user_id, alert_type, severity, title, message,
          source_table, triggered_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${i + 1} days', NOW())
        ON CONFLICT DO NOTHING
      `, [
        userId,
        alert.type,
        alert.severity,
        alert.title,
        alert.message,
        'daily_summaries',
      ]);
    }
    logger.info('Inserted 5 alerts');

    logger.info('Seed complete!');
    logger.info('Login with: ed@cloudlayertech.com / TestPass123!');
  } catch (err) {
    logger.error('Seed failed', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
