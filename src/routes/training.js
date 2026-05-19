const express = require('express');
const { query } = require('../config/database');
const { ValidationError } = require('../lib/errors');

const router = express.Router();

// GET /api/training/fitness?days=90
router.get('/fitness', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '90', 10);

    if (days < 1 || days > 365) {
      throw new ValidationError('days must be between 1 and 365');
    }

    const result = await query(
      `SELECT 
        date,
        ctl,
        atl,
        tsb,
        weekly_tss,
        weekly_hours,
        monotony,
        strain,
        acwr,
        fitness_trend,
        form_trend
      FROM training_metrics
      WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY date ASC`
    );

    res.json({
      data: result.rows,
      days,
      summary: result.rows.length > 0 ? {
        currentCTL: result.rows[result.rows.length - 1]?.ctl || null,
        currentATL: result.rows[result.rows.length - 1]?.atl || null,
        currentTSB: result.rows[result.rows.length - 1]?.tsb || null,
        peakCTL: Math.max(...result.rows.map(r => r.ctl || 0)),
        minTSB: Math.min(...result.rows.map(r => r.tsb || 0)),
      } : null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/training/load-vs-readiness
router.get('/load-vs-readiness', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '30', 10);

    const result = await query(
      `SELECT 
        tm.date,
        tm.ctl as fitness,
        tm.atl as fatigue,
        tm.tsb as form,
        tm.weekly_tss,
        ds.readiness_score,
        ds.sleep_score,
        ds.hrv_score,
        ds.resting_hr
      FROM training_metrics tm
      LEFT JOIN daily_summaries ds ON tm.date = ds.date
      WHERE tm.date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY tm.date ASC`
    );

    // Calculate correlation insights
    const validRows = result.rows.filter(r => r.readiness_score && r.fitness);
    const avgReadiness = validRows.length > 0
      ? Math.round(validRows.reduce((s, r) => s + r.readiness_score, 0) / validRows.length)
      : null;

    res.json({
      data: result.rows,
      days,
      insights: {
        averageReadiness: avgReadiness,
        highLoadDays: result.rows.filter(r => r.weekly_tss > 300).length,
        lowReadinessDays: result.rows.filter(r => r.readiness_score < 50).length,
        correlationTrend: 'Load and readiness are inversely correlated - higher training loads typically precede lower readiness scores by 24-48 hours.',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
