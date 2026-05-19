const express = require('express');
const { query } = require('../config/database');
const { NotFoundError } = require('../lib/errors');

const router = express.Router();

// GET /api/activities?start=...&end=...&type=...
router.get('/', async (req, res, next) => {
  try {
    const { start, end, type, limit = 50, offset = 0 } = req.query;

    let sql = `
      SELECT 
        a.id,
        a.external_id,
        a.name,
        a.type,
        a.start_date,
        a.timezone,
        a.duration_seconds,
        a.distance_meters,
        a.elevation_gain_meters,
        a.calories,
        a.avg_hr,
        a.max_hr,
        a.avg_power,
        a.max_power,
        a.avg_speed_ms,
        a.max_speed_ms,
        a.avg_cadence,
        a.avg_temp_c,
        a.suffer_score,
        a.training_load,
        a.intensity,
        a.tcx_url,
        a.summary_polyline,
        a.gear_id,
        a.commute,
        a.private,
        a.manual,
        a.device_name,
        a.location_city,
        a.location_state,
        a.location_country,
        a.weather_temp_c,
        a.weather_conditions,
        a.created_at,
        a.updated_at,
        u.first_name as athlete_first_name,
        u.last_name as athlete_last_name
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (start) {
      sql += ` AND a.start_date >= $${paramIdx}`;
      params.push(start);
      paramIdx++;
    }

    if (end) {
      sql += ` AND a.start_date <= $${paramIdx}`;
      params.push(end);
      paramIdx++;
    }

    if (type) {
      sql += ` AND a.type = $${paramIdx}`;
      params.push(type);
      paramIdx++;
    }

    sql += ` ORDER BY a.start_date DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await query(sql, params);

    res.json({
      data: result.rows,
      count: result.rows.length,
      filters: { start, end, type },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/activities/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT 
        a.id,
        a.external_id,
        a.name,
        a.type,
        a.start_date,
        a.timezone,
        a.duration_seconds,
        a.distance_meters,
        a.elevation_gain_meters,
        a.calories,
        a.avg_hr,
        a.max_hr,
        a.avg_power,
        a.max_power,
        a.avg_speed_ms,
        a.max_speed_ms,
        a.avg_cadence,
        a.avg_temp_c,
        a.suffer_score,
        a.training_load,
        a.intensity,
        a.tcx_url,
        a.summary_polyline,
        a.gear_id,
        a.commute,
        a.private,
        a.manual,
        a.device_name,
        a.location_city,
        a.location_state,
        a.location_country,
        a.weather_temp_c,
        a.weather_conditions,
        a.created_at,
        a.updated_at,
        u.first_name as athlete_first_name,
        u.last_name as athlete_last_name
      FROM activities a
      JOIN users u ON a.user_id = u.id
      WHERE a.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Activity not found: ${id}`);
    }

    // Also fetch streams if available
    const streamsResult = await query(
      `SELECT 
        stream_type,
        data_points,
        resolution,
        series_type
      FROM activity_streams
      WHERE activity_id = $1`,
      [id]
    );

    res.json({
      activity: result.rows[0],
      streams: streamsResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
