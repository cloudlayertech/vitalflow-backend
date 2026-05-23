const express = require('express');
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard/overview
router.get('/overview', async (req, res, next) => {
  try {
    const userId = req.user ? req.user.userId : null;

    // Get latest Oura health data (sleep, readiness, hrv)
    const healthResult = await query(
      `SELECT metric_type, value, date
       FROM health_data
       WHERE ${userId ? 'user_id = $1 AND' : ''} date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY date DESC`
    , userId ? [userId] : []);

    // Build aggregated KPIs from health_data
    const kpis = { sleepScore: null, sleepTotal: null, hrv: null, readinessScore: null, steps: null, calories: null };
    for (const row of healthResult.rows) {
      if (row.metric_type === 'sleep_score' && !kpis.sleepScore) kpis.sleepScore = Math.round(row.value);
      if (row.metric_type === 'sleep_total' && !kpis.sleepTotal) kpis.sleepTotal = Math.round(row.value / 60) + 'h ' + Math.round(row.value % 60) + 'm';
      if (row.metric_type === 'hrv' && !kpis.hrv) kpis.hrv = Math.round(row.value);
      if (row.metric_type === 'readiness_score' && !kpis.readinessScore) kpis.readinessScore = Math.round(row.value);
      if (row.metric_type === 'steps' && !kpis.steps) kpis.steps = Math.round(row.value);
      if (row.metric_type === 'calories' && !kpis.calories) kpis.calories = Math.round(row.value);
    }

    // Get this week's activity totals
    const weekResult = await query(
      `SELECT 
        COUNT(*) as activity_count,
        COALESCE(SUM(distance_meters), 0) as total_distance_m,
        COALESCE(SUM(duration_seconds), 0) as total_duration_sec,
        COALESCE(SUM(calories), 0) as total_calories,
        COALESCE(SUM(elevation_gain_meters), 0) as total_elevation_m,
        COALESCE(SUM(training_load), 0) as total_training_load
      FROM activities
      WHERE ${userId ? 'user_id = $1 AND' : ''} start_date >= CURRENT_DATE - INTERVAL '7 days'`
    , userId ? [userId] : []);

    // Weekly load from activities
    const weeklyLoad = Math.round(weekResult.rows[0]?.total_training_load || 0);

    // Count active connections
    const connResult = await query(
      `SELECT provider FROM oauth_connections WHERE ${userId ? 'user_id = $1' : 'TRUE'}`,
      userId ? [userId] : []
    );

    res.json({
      sleepScore: kpis.sleepScore,
      hrv: kpis.hrv,
      readinessScore: kpis.readinessScore,
      weeklyLoad: weeklyLoad || weekResult.rows[0]?.activity_count * 50,
      steps: kpis.steps,
      calories: kpis.calories,
      thisWeek: weekResult.rows[0] || null,
      connections: connResult.rows.map(r => r.provider),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/trends
router.get('/trends', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '30', 10);

    // Daily summaries trend
    const healthTrend = await query(
      `SELECT 
        date,
        steps,
        readiness_score,
        sleep_score,
        hrv_score,
        resting_hr,
        wellness_score
      FROM daily_summaries
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY date ASC`
    );

    // Weekly activity trend
    const activityTrend = await query(
      `SELECT 
        DATE_TRUNC('week', start_date) as week,
        COUNT(*) as activity_count,
        COALESCE(SUM(distance_meters), 0) as total_distance_m,
        COALESCE(SUM(duration_seconds), 0) as total_duration_sec,
        COALESCE(SUM(calories), 0) as total_calories,
        COALESCE(SUM(training_load), 0) as total_training_load
      FROM activities
      WHERE start_date >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY week
      ORDER BY week ASC`
    );

    // Fitness trend
    const fitnessTrend = await query(
      `SELECT 
        date,
        ctl,
        atl,
        tsb,
        weekly_tss
      FROM training_metrics
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY date ASC`
    );

    res.json({
      days,
      health: healthTrend.rows,
      activities: activityTrend.rows,
      fitness: fitnessTrend.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/dashboard/alerts
router.get('/alerts', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        id,
        alert_type,
        severity,
        title,
        message,
        source_table,
        source_record_id,
        field_name,
        field_value,
        threshold_value,
        triggered_at,
        dismissed_at,
        expires_at
      FROM alerts
      WHERE dismissed_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY severity DESC, triggered_at DESC`
    );

    res.json({
      alerts: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
