-- ============================================
-- VitalFlow Schema - Complete
-- ============================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth connections (Strava, etc.)
CREATE TABLE IF NOT EXISTS oauth_connections (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider           VARCHAR(50) NOT NULL,
  provider_athlete_id VARCHAR(100),
  access_token       TEXT NOT NULL,
  refresh_token      TEXT,
  token_expires_at   TIMESTAMPTZ,
  scope              TEXT,
  connected_at       TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at       TIMESTAMPTZ,
  sync_status        VARCHAR(50) DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, provider)
);

-- Daily health summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  steps            INTEGER DEFAULT 0,
  distance_meters  NUMERIC(10,2) DEFAULT 0,
  calories_burned  INTEGER DEFAULT 0,
  active_minutes   INTEGER DEFAULT 0,
  sleep_minutes    INTEGER DEFAULT 0,
  sleep_score      INTEGER DEFAULT 0,
  resting_hr       INTEGER DEFAULT 0,
  hrv_score        INTEGER DEFAULT 0,
  readiness_score  INTEGER DEFAULT 0,
  spo2_avg         NUMERIC(5,2) DEFAULT 0,
  respiratory_rate NUMERIC(5,2) DEFAULT 0,
  skin_temp_c      NUMERIC(5,2) DEFAULT 0,
  wellness_score   INTEGER DEFAULT 0,
  weight_kg        NUMERIC(6,2) DEFAULT 0,
  fat_percentage   NUMERIC(5,2) DEFAULT 0,
  muscle_mass_kg   NUMERIC(6,2) DEFAULT 0,
  bone_mass_kg     NUMERIC(5,2) DEFAULT 0,
  bmr              INTEGER DEFAULT 0,
  hydration_percent NUMERIC(5,2) DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Activities (workouts)
CREATE TABLE IF NOT EXISTS activities (
  id                    SERIAL PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id           VARCHAR(100),
  name                  VARCHAR(255) NOT NULL,
  type                  VARCHAR(50) NOT NULL,
  start_date            TIMESTAMPTZ NOT NULL,
  timezone              VARCHAR(100),
  duration_seconds      INTEGER DEFAULT 0,
  distance_meters       NUMERIC(12,2) DEFAULT 0,
  elevation_gain_meters NUMERIC(10,2) DEFAULT 0,
  calories              INTEGER DEFAULT 0,
  avg_hr                INTEGER DEFAULT 0,
  max_hr                INTEGER DEFAULT 0,
  avg_power             INTEGER DEFAULT 0,
  max_power             INTEGER DEFAULT 0,
  avg_speed_ms          NUMERIC(8,4) DEFAULT 0,
  max_speed_ms          NUMERIC(8,4) DEFAULT 0,
  avg_cadence           INTEGER DEFAULT 0,
  avg_temp_c            NUMERIC(5,2) DEFAULT 0,
  suffer_score          INTEGER DEFAULT 0,
  training_load         NUMERIC(10,2) DEFAULT 0,
  intensity             NUMERIC(4,2) DEFAULT 0,
  tcx_url               TEXT,
  summary_polyline      TEXT,
  gear_id               VARCHAR(50),
  commute               BOOLEAN DEFAULT FALSE,
  private               BOOLEAN DEFAULT FALSE,
  manual                BOOLEAN DEFAULT FALSE,
  device_name           VARCHAR(100),
  location_city         VARCHAR(100),
  location_state        VARCHAR(100),
  location_country      VARCHAR(100),
  weather_temp_c        NUMERIC(5,2),
  weather_conditions    VARCHAR(100),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, external_id)
);

-- Activity streams (time-series data)
CREATE TABLE IF NOT EXISTS activity_streams (
  id           SERIAL PRIMARY KEY,
  activity_id  INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  stream_type  VARCHAR(50) NOT NULL,
  data_points  JSONB NOT NULL DEFAULT '[]',
  resolution   VARCHAR(20) DEFAULT 'high',
  series_type  VARCHAR(20) DEFAULT 'distance',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Training metrics (CTL/ATL/TSB)
CREATE TABLE IF NOT EXISTS training_metrics (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  ctl           NUMERIC(8,2) DEFAULT 0,
  atl           NUMERIC(8,2) DEFAULT 0,
  tsb           INTEGER DEFAULT 0,
  weekly_tss    INTEGER DEFAULT 0,
  weekly_hours  NUMERIC(6,2) DEFAULT 0,
  monotony      NUMERIC(5,2) DEFAULT 0,
  strain        INTEGER DEFAULT 0,
  acwr          NUMERIC(5,2) DEFAULT 0,
  fitness_trend VARCHAR(20) DEFAULT 'neutral',
  form_trend    VARCHAR(20) DEFAULT 'neutral',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Routes (saved routes)
CREATE TABLE IF NOT EXISTS routes (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id      VARCHAR(100),
  name             VARCHAR(255) NOT NULL,
  distance_meters  NUMERIC(12,2) DEFAULT 0,
  elevation_gain_m NUMERIC(10,2) DEFAULT 0,
  polyline         TEXT,
  type             VARCHAR(50) DEFAULT 'ride',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Sync jobs
CREATE TABLE IF NOT EXISTS sync_jobs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type     VARCHAR(50) NOT NULL,
  status       VARCHAR(20) DEFAULT 'pending',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  records_synced INTEGER DEFAULT 0,
  error_message TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_type       VARCHAR(50) NOT NULL,
  severity         VARCHAR(20) NOT NULL DEFAULT 'medium',
  title            VARCHAR(255) NOT NULL,
  message          TEXT NOT NULL,
  source_table     VARCHAR(50),
  source_record_id VARCHAR(100),
  field_name       VARCHAR(50),
  field_value      NUMERIC(10,2),
  threshold_value  NUMERIC(10,2),
  triggered_at     TIMESTAMPTZ DEFAULT NOW(),
  dismissed_at     TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_user_start ON activities(user_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type);
CREATE INDEX IF NOT EXISTS idx_activities_start_date ON activities(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_training_metrics_user_date ON training_metrics(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user_triggered ON alerts(user_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_dismissed ON alerts(dismissed_at) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oauth_connections_user ON oauth_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_user ON sync_jobs(user_id);
