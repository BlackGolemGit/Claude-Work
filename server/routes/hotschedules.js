// HotSchedules work-shift sync endpoints.
const express = require('express');
const router = express.Router();
const { db, getLastSync } = require('../db/db');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[hotschedules route] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

router.get('/shifts', asyncHandler(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM work_shifts WHERE date >= date('now', '-1 day') ORDER BY date ASC, start_time ASC LIMIT 50`).all();
  res.json({ shifts: rows, lastSynced: getLastSync('hotschedules')?.last_synced_at || null });
}));

router.get('/shifts/next', asyncHandler(async (req, res) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentTime = now.toTimeString().slice(0, 5);
  const next = db
    .prepare(
      `SELECT * FROM work_shifts
       WHERE date > ? OR (date = ? AND end_time > ?)
       ORDER BY date ASC, start_time ASC LIMIT 1`
    )
    .get(today, today, currentTime);
  res.json({ shift: next || null });
}));

router.post('/sync', asyncHandler(async (req, res) => {
  const { syncNow } = require('../jobs/hotschedulesSync');
  const result = await syncNow();
  res.json({ success: true, ...result });
}));

module.exports = router;
