-- ============================================
-- VitalFlow Test Data
-- Login: ed@cloudlayertech.com / TestPass123!
-- ============================================

-- 1. Test user (password hash for 'TestPass123!')
INSERT INTO users (email, password_hash, first_name, last_name, created_at, updated_at)
VALUES (
  'ed@cloudlayertech.com',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewKyNiAYMyzJ/IzK',
  'Ed',
  'Testuser',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO NOTHING;

-- Get user ID
DO $$
DECLARE
  v_user_id INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE email = 'ed@cloudlayertech.com';

  -- 2. 30 days of daily summaries
  IF v_user_id IS NOT NULL THEN
    INSERT INTO daily_summaries (
      user_id, date, steps, distance_meters, calories_burned, active_minutes,
      sleep_minutes, sleep_score, resting_hr, hrv_score, readiness_score,
      spo2_avg, respiratory_rate, skin_temp_c, wellness_score, weight_kg,
      fat_percentage, muscle_mass_kg, bone_mass_kg, bmr, hydration_percent
    )
    SELECT
      v_user_id,
      CURRENT_DATE - (n || ' days')::INTERVAL,
      6000 + (n * 7 + 13) % 10000,                          -- steps
      (6000 + (n * 7 + 13) % 10000) * 0.762,               -- distance_meters
      1800 + (n * 7 + 13) % 800,                            -- calories_burned
      30 + (n * 7 + 13) % 90,                               -- active_minutes
      360 + (n * 7 + 13) % 120,                             -- sleep_minutes
      45 + (n * 7 + 13) % 45,                               -- sleep_score
      55 + (n * 7 + 13) % 15,                               -- resting_hr
      40 + (n * 7 + 13) % 50,                               -- hrv_score
      50 + (n * 7 + 13) % 40,                               -- readiness_score
      96 + (n * 7 + 13) % 3,                                -- spo2_avg
      14 + (n * 7 + 13) % 4,                                -- respiratory_rate
      35.5 + ((n * 7 + 13) % 10) / 10.0,                    -- skin_temp_c
      50 + (n * 7 + 13) % 40,                               -- wellness_score
      75 + (n * 7 + 13) % 15,                               -- weight_kg
      15 + (n * 7 + 13) % 8,                                -- fat_percentage
      35 + (n * 7 + 13) % 10,                               -- muscle_mass_kg
      3.2 + ((n * 7 + 13) % 5) / 10.0,                      -- bone_mass_kg
      1600 + (n * 7 + 13) % 200,                            -- bmr
      55 + (n * 7 + 13) % 15                                -- hydration_percent
    FROM generate_series(0, 29) AS n
    ON CONFLICT (user_id, date) DO NOTHING;

    -- 3. 10 activities
    INSERT INTO activities (
      user_id, external_id, name, type, start_date, timezone,
      duration_seconds, distance_meters, elevation_gain_meters, calories,
      avg_hr, max_hr, avg_power, max_power, avg_speed_ms, max_speed_ms,
      avg_cadence, avg_temp_c, suffer_score, training_load, intensity,
      summary_polyline, location_city, location_country, weather_temp_c,
      created_at, updated_at
    )
    SELECT
      v_user_id,
      'strava_' || (1000000000 + n),
      (ARRAY['Morning Commute', 'Lunch Run', 'Pool Session', 'Evening Ride',
             'Trail Run', 'Weekend Long Ride', 'Tempo Run', 'Open Water Swim',
             'Recovery Ride', 'Park Loop'])[n + 1],
      (ARRAY['Ride', 'Run', 'Swim', 'Ride', 'Run', 'Ride', 'Run', 'Swim', 'Ride', 'Run'])[n + 1],
      CURRENT_DATE - ((n * 3 + 1) || ' days')::INTERVAL,
      'Europe/London',
      1800 + (n * 11 + 7) % 7200,
      5000 + (n * 11 + 7) % 45000,
      50 + (n * 11 + 7) % 450,
      200 + (n * 11 + 7) % 800,
      130 + (n * 11 + 7) % 40,
      160 + (n * 11 + 7) % 30,
      150 + (n * 11 + 7) % 100,
      300 + (n * 11 + 7) % 250,
      5 + (n * 11 + 7) % 10,
      12 + (n * 11 + 7) % 8,
      80 + (n * 11 + 7) % 20,
      18 + (n * 11 + 7) % 10,
      30 + (n * 11 + 7) % 70,
      50 + (n * 11 + 7) % 150,
      0.60 + ((n * 11 + 7) % 40) / 100.0,
      '_p~iF~ps|U',
      'London',
      'United Kingdom',
      15 + (n * 11 + 7) % 15,
      NOW(),
      NOW()
    FROM generate_series(0, 9) AS n
    ON CONFLICT DO NOTHING;

    -- 4. 30 days of training metrics
    INSERT INTO training_metrics (
      user_id, date, ctl, atl, tsb, weekly_tss, weekly_hours,
      monotony, strain, acwr, fitness_trend, form_trend
    )
    SELECT
      v_user_id,
      CURRENT_DATE - (n || ' days')::INTERVAL,
      ROUND((30 + (29 - n) * 1.5 + (n * 13 + 3) % 10)::NUMERIC, 2),
      ROUND((25 + (29 - n) * 2 + (n * 13 + 3) % 15)::NUMERIC, 2),
      ROUND((30 + (29 - n) * 1.5 + (n * 13 + 3) % 10) - (25 + (29 - n) * 2 + (n * 13 + 3) % 15)),
      200 + (n * 13 + 3) % 300,
      ROUND((5 + (n * 13 + 3) % 10)::NUMERIC, 2),
      ROUND((1.2 + ((n * 13 + 3) % 20) / 100.0)::NUMERIC, 2),
      50 + (n * 13 + 3) % 200,
      ROUND((0.8 + ((n * 13 + 3) % 40) / 100.0)::NUMERIC, 2),
      CASE WHEN (30 + (29 - n) * 1.5) > 50 THEN 'increasing' ELSE 'building' END,
      CASE
        WHEN (30 + (29 - n) * 1.5 + (n * 13 + 3) % 10) - (25 + (29 - n) * 2 + (n * 13 + 3) % 15) > 10 THEN 'positive'
        WHEN (30 + (29 - n) * 1.5 + (n * 13 + 3) % 10) - (25 + (29 - n) * 2 + (n * 13 + 3) % 15) < -20 THEN 'negative'
        ELSE 'neutral'
      END
    FROM generate_series(0, 29) AS n
    ON CONFLICT (user_id, date) DO NOTHING;

    -- 5. 5 alerts
    INSERT INTO alerts (user_id, alert_type, severity, title, message, source_table, triggered_at, created_at)
    VALUES
      (v_user_id, 'readiness', 'high', 'Low Readiness Score', 'Your readiness score dropped below 50 for 3 consecutive days.', 'daily_summaries', NOW() - INTERVAL '1 day', NOW()),
      (v_user_id, 'sleep', 'medium', 'Sleep Debt Accumulating', 'You have averaged less than 6 hours of sleep over the past week.', 'daily_summaries', NOW() - INTERVAL '2 days', NOW()),
      (v_user_id, 'hrv', 'medium', 'HRV Trend Declining', 'Your HRV score has been declining for 5 consecutive days.', 'daily_summaries', NOW() - INTERVAL '3 days', NOW()),
      (v_user_id, 'load', 'low', 'High Training Load', 'Weekly training load exceeded 500 TSS. Consider adding recovery.', 'training_metrics', NOW() - INTERVAL '4 days', NOW()),
      (v_user_id, 'recovery', 'high', 'Overreaching Detected', 'TSB below -30 for 2 consecutive days. Prioritize recovery.', 'training_metrics', NOW() - INTERVAL '5 days', NOW())
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
