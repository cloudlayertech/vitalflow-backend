const express = require('express');
const { query } = require('../config/database');

const router = express.Router();

// GET /api/dashboard/overview
router.get('/overview', async (req, res, next) => {
  try {
    // Get today's daily summary
    const todayResult = await query(
      `SELECT 
        date,
        steps,
        calories_burned,
        active_minutes,
        sleep_score,
        readiness_score,
        resting_hr,
        hrv_score,
        wellness_score,
        weight_kg,
        hydration_percent
      FROM daily_summaries
      WHERE date = CURRENT_DATE`
    );

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
      WHERE start_date >= CURRENT_DATE - INTERVAL '7 days'`
    );

    // Get latest training metrics
    const trainingResult = await query(
      `SELECT ctl, atl, tsb, weekly_tss
      FROM training_metrics
      WHERE date = CURRENT_DATE`
    );

    // Get active alerts count
    const alertsResult = await query(
      `SELECT COUNT(*) as active_alerts
      FROM alerts
      WHERE dismissed_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())`
    );

    res.json({
      today: todayResult.rows[0] || null,
      thisWeek: weekResult.rows[0] || null,
      fitness: trainingResult.rows[0] || null,
      activeAlerts: parseInt(alertsResult.rows[0]?.active_alerts || '0', 10),
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
