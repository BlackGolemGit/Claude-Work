// Gathers the full upcoming week (events, shifts, deadlines, RSVPs) and asks
// Claude to write a friendly weekly preview, delivered every Sunday.
const { getUser, db, recordSync } = require('../db/db');
const calendarService = require('../services/calendar');
const claude = require('../services/claude');
const { deliverNotification } = require('../routes/notifications');

async function runWeeklyPreview() {
  const user = getUser();
  let events = [];
  let conflicts = [];
  try {
    events = await calendarService.getWeekEvents();
    conflicts = calendarService.findConflicts(events);
  } catch (err) {
    console.error('[weeklyPreview] Could not load calendar (continuing with what we have):', err.message);
  }

  const today = new Date().toISOString().slice(0, 10);
  const weekOut = new Date();
  weekOut.setDate(weekOut.getDate() + 7);
  const weekOutStr = weekOut.toISOString().slice(0, 10);

  const schoolTasks = db
    .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' AND due_date BETWEEN ? AND ? ORDER BY due_date ASC`)
    .all(today, weekOutStr);
  const workShifts = db
    .prepare(`SELECT * FROM work_shifts WHERE date BETWEEN ? AND ? ORDER BY date ASC, start_time ASC`)
    .all(today, weekOutStr);
  const rsvps = db.prepare(`SELECT * FROM rsvps WHERE status = 'pending' ORDER BY detected_at DESC LIMIT 20`).all();

  const preview = await claude.generateWeeklyPreview({
    now: new Date().toString(),
    weekEvents: events,
    schoolTasks,
    workShifts,
    rsvps,
    conflicts,
  });

  const results = await deliverNotification({ subject: 'Your Week Ahead 📅', body: preview });
  recordSync('weekly_preview', `Delivered: ${JSON.stringify(results)}`);
  return { preview, results };
}

module.exports = { runWeeklyPreview };
