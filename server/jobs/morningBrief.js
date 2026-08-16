// Gathers today's schedule context, asks Claude to write a friendly morning
// briefing, and delivers it via the user's configured notification channel(s).
const { getUser, db, recordSync } = require('../db/db');
const calendarService = require('../services/calendar');
const claude = require('../services/claude');
const { deliverNotification } = require('../routes/notifications');

async function runMorningBrief() {
  const user = getUser();
  let events = [];
  let conflicts = [];
  try {
    events = await calendarService.getTodayEvents(user.timezone);
    conflicts = calendarService.findConflicts(events);
  } catch (err) {
    console.error('[morningBrief] Could not load calendar (continuing with what we have):', err.message);
  }

  const today = new Date().toISOString().slice(0, 10);
  const schoolTasks = db
    .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' AND due_date <= date(?, '+2 day') ORDER BY due_date ASC LIMIT 10`)
    .all(today);
  const workShifts = db
    .prepare(`SELECT * FROM work_shifts WHERE date = ? ORDER BY start_time ASC`)
    .all(today);
  const rsvps = db.prepare(`SELECT * FROM rsvps WHERE status = 'pending' ORDER BY detected_at DESC LIMIT 10`).all();

  const brief = await claude.generateMorningBrief({
    now: new Date().toString(),
    timezone: user.timezone,
    userName: user.name,
    todayEvents: events,
    schoolTasks,
    workShifts,
    rsvps,
    conflicts,
  });

  const results = await deliverNotification({ subject: 'Your Morning Briefing ☀️', body: brief });
  recordSync('morning_brief', `Delivered: ${JSON.stringify(results)}`);
  return { brief, results };
}

module.exports = { runMorningBrief };
