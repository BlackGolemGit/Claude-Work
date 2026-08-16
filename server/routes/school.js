// School & Homework tracking endpoints.
const express = require('express');
const router = express.Router();
const { db, getLastSync } = require('../db/db');
const calendarService = require('../services/calendar');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[school route] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

router.get('/tasks', asyncHandler(async (req, res) => {
  const { filter } = req.query; // all | week | overdue | complete
  let rows;
  const today = new Date().toISOString().slice(0, 10);
  if (filter === 'week') {
    const weekOut = new Date();
    weekOut.setDate(weekOut.getDate() + 7);
    rows = db
      .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' AND due_date BETWEEN ? AND ? ORDER BY due_date ASC`)
      .all(today, weekOut.toISOString().slice(0, 10));
  } else if (filter === 'overdue') {
    rows = db
      .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' AND due_date < ? ORDER BY due_date ASC`)
      .all(today);
  } else if (filter === 'complete') {
    rows = db.prepare(`SELECT * FROM school_tasks WHERE status = 'complete' ORDER BY due_date DESC`).all();
  } else {
    rows = db.prepare(`SELECT * FROM school_tasks ORDER BY due_date ASC`).all();
  }
  res.json({ tasks: rows, lastSynced: getLastSync('school')?.last_synced_at || null });
}));

router.get('/tasks/upcoming', asyncHandler(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date();
  weekOut.setDate(weekOut.getDate() + 7);
  const rows = db
    .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' AND due_date BETWEEN ? AND ? ORDER BY due_date ASC`)
    .all(today, weekOut.toISOString().slice(0, 10));
  res.json({ tasks: rows });
}));

router.post('/tasks/:id/complete', asyncHandler(async (req, res) => {
  const task = db.prepare(`SELECT * FROM school_tasks WHERE id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  db.prepare(`UPDATE school_tasks SET status = 'complete' WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
}));

router.post('/tasks/:id/reopen', asyncHandler(async (req, res) => {
  db.prepare(`UPDATE school_tasks SET status = 'pending' WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
}));

router.delete('/tasks/:id', asyncHandler(async (req, res) => {
  const task = db.prepare(`SELECT * FROM school_tasks WHERE id = ?`).get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  if (task.calendar_event_id) {
    try {
      await calendarService.deleteEvent(task.calendar_event_id);
    } catch (err) {
      console.error('[school] Failed to remove calendar event:', err.message);
    }
  }
  db.prepare(`DELETE FROM school_tasks WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
}));

router.post('/scan', asyncHandler(async (req, res) => {
  const { pollSchoolEmails } = require('../jobs/gmailPoller');
  const result = await pollSchoolEmails();
  res.json({ success: true, ...result });
}));

module.exports = router;
