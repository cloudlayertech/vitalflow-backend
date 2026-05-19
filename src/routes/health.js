const express = require('express');
const { query } = require('../config/database');
const { ValidationError } = require('../lib/errors');

const router = express.Router();

// GET /api/health-data/daily?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/daily', async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      throw new ValidationError('start and end date parameters are required (YYYY-MM-DD)');
    }

    const result = await query(
      `SELECT 
        id,
        date,
        steps,
        distance_meters,
        calories_burned,
        active_minutes,
        sleep_minutes,
        sleep_score,
        resting_hr,
        hrv_score,
        readiness_score,
        spo2_avg,
        respiratory_rate,
        skin_temp_c,
        wellness_score,
        weight_kg,
        fat_percentage,
        muscle_mass_kg,
        bone_mass_kg,
        bmr,
        hydration_percent
      FROM daily_summaries
      WHERE date >= $1 AND date <= $2
      ORDER BY date ASC`,
      [start, end]
    );

    res.json({
      data: result.rows,
      count: result.rows.length,
      start,
      end,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/health-data/readiness
router.get('/readiness', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT 
        date,
        readiness_score,
        sleep_score,
        hrv_score,
        resting_hr,
        recovery_index
      FROM daily_summaries
      WHERE date >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY date ASC`
    );

    // Calculate readiness trend
    const avgReadiness = result.rows.length > 0
      ? Math.round(result.rows.reduce((sum, r) => sum + (r.readiness_score || 0), 0) / result.rows.length)
      : null;

    const latest = result.rows.length > 0 ? result.rows[result.rows.length - 1] : null;

    res.json({
      data: result.rows,
      summary: {
        averageReadiness: avgReadiness,
        latestReadiness: latest?.readiness_score || null,
        trend: latest?.readiness_score > avgReadiness ? 'improving' : 'stable',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
