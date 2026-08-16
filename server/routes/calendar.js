// Calendar tab + Dashboard endpoints: reading events, CRUD on events,
// conflict detection, and the "life balance" free-time suggestion engine.
const express = require('express');
const router = express.Router();
const calendarService = require('../services/calendar');
const claude = require('../services/claude');
const { db, getUser, recordSync, getLastSync, listMemories } = require('../db/db');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[calendar route] ${req.method} ${req.originalUrl}:`, err.message);
    const status = err.code === 'GOOGLE_NOT_CONNECTED' ? 409 : 500;
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });
}

router.get('/today', asyncHandler(async (req, res) => {
  const user = getUser();
  const events = await calendarService.getTodayEvents(user.timezone);
  const conflicts = calendarService.findConflicts(events);
  res.json({ events, conflicts, lastSynced: getLastSync('calendar')?.last_synced_at || null });
}));

router.get('/week', asyncHandler(async (req, res) => {
  const events = await calendarService.getWeekEvents();
  const conflicts = calendarService.findConflicts(events);
  res.json({ events, conflicts, lastSynced: getLastSync('calendar')?.last_synced_at || null });
}));

router.post('/event', asyncHandler(async (req, res) => {
  const { title, description, location, start, end, allDay } = req.body;
  if (!title || !start || !end) {
    return res.status(400).json({ error: 'title, start, and end are required.' });
  }
  const event = await calendarService.createEvent({ title, description, location, start, end, allDay });
  recordSync('calendar', `Created event "${title}"`);
  res.json({ event });
}));

router.put('/event/:id', asyncHandler(async (req, res) => {
  const event = await calendarService.updateEvent(req.params.id, req.body);
  recordSync('calendar', `Updated event "${event.title}"`);
  res.json({ event });
}));

router.delete('/event/:id', asyncHandler(async (req, res) => {
  await calendarService.deleteEvent(req.params.id);
  recordSync('calendar', `Deleted event ${req.params.id}`);
  res.json({ success: true });
}));

/**
 * Computes open (unbooked) blocks over the next 7 days between 8am and
 * 10pm local time, subtracting any events already on the calendar.
 */
function computeFreeBlocks(events, bufferHours) {
  const dayStartHour = 8;
  const dayEndHour = 22;
  const blocks = [];
  const now = new Date();

  for (let d = 0; d < 7; d++) {
    const day = new Date(now);
    day.setDate(now.getDate() + d);
    const dayStart = new Date(day);
    dayStart.setHours(dayStartHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(dayEndHour, 0, 0, 0);
    if (d === 0 && dayStart < now) dayStart.setTime(now.getTime());

    const dayEvents = events
      .filter((e) => !e.allDay)
      .map((e) => ({ start: new Date(e.start), end: new Date(e.end) }))
      .filter((e) => e.start < dayEnd && e.end > dayStart)
      .sort((a, b) => a.start - b.start);

    let cursor = dayStart;
    for (const ev of dayEvents) {
      if (ev.start > cursor) {
        const freeMs = ev.start - cursor;
        if (freeMs / 3600000 >= 0.5) {
          blocks.push({ date: day.toISOString().slice(0, 10), start: cursor.toISOString(), end: ev.start.toISOString(), hours: +(freeMs / 3600000).toFixed(1) });
        }
      }
      if (ev.end > cursor) cursor = ev.end;
    }
    if (cursor < dayEnd) {
      const freeMs = dayEnd - cursor;
      if (freeMs / 3600000 >= 0.5) {
        blocks.push({ date: day.toISOString().slice(0, 10), start: cursor.toISOString(), end: dayEnd.toISOString(), hours: +(freeMs / 3600000).toFixed(1) });
      }
    }
  }
  return blocks.filter((b) => b.hours >= (bufferHours ? Math.min(1, bufferHours) : 0.5));
}

/**
 * Runs the full post-sync analysis: conflict detection (with Claude-suggested
 * resolutions) and life-balance free-time suggestions. Called after every
 * calendar-affecting sync (RSVP accept, HotSchedules sync, school task add,
 * manual event changes) — exported so other routes/jobs can trigger it.
 */
async function runCalendarAnalysis() {
  const user = getUser();
  const events = await calendarService.getWeekEvents();
  const conflictPairs = calendarService.findConflicts(events);

  // Store newly-detected conflicts with a Claude-suggested resolution.
  // Skip pairs that already have an active (non-dismissed) suggestion.
  const existingConflicts = db
    .prepare(`SELECT * FROM suggestions WHERE type = 'conflict_resolution' AND dismissed = 0`)
    .all();
  const existingPairKeys = new Set(
    existingConflicts.map((s) => {
      try {
        const meta = JSON.parse(s.metadata || '{}');
        return [meta.eventAId, meta.eventBId].sort().join('|');
      } catch {
        return '';
      }
    })
  );

  for (const pair of conflictPairs) {
    const key = [pair.eventA.id, pair.eventB.id].sort().join('|');
    if (existingPairKeys.has(key)) continue;
    let resolution = null;
    try {
      resolution = await claude.suggestConflictResolution(pair);
    } catch (err) {
      console.error('[calendar] Claude conflict resolution failed:', err.message);
    }
    const content = resolution?.explanation
      ? resolution.explanation
      : `"${pair.eventA.title}" overlaps with "${pair.eventB.title}".`;
    db.prepare(
      `INSERT INTO suggestions (type, content, suggested_for_date, metadata)
       VALUES ('conflict_resolution', ?, ?, ?)`
    ).run(
      content,
      pair.eventA.start.slice(0, 10),
      JSON.stringify({
        eventAId: pair.eventA.id,
        eventATitle: pair.eventA.title,
        eventBId: pair.eventB.id,
        eventBTitle: pair.eventB.title,
        moveEventId: resolution?.moveEventId || null,
        newStart: resolution?.newStart || null,
        newEnd: resolution?.newEnd || null,
      })
    );
  }

  // Refresh life-balance suggestions from current free time + pending work.
  db.prepare(`DELETE FROM suggestions WHERE type = 'life_balance' AND dismissed = 0 AND added_to_calendar = 0`).run();
  const freeBlocks = computeFreeBlocks(events, user.free_time_buffer_hours);
  const schoolTasks = db
    .prepare(`SELECT * FROM school_tasks WHERE status = 'pending' ORDER BY due_date ASC LIMIT 10`)
    .all();
  try {
    const { suggestions } = await claude.generateLifeBalanceSuggestions({
      freeBlocks,
      schoolTasks,
      upcomingEvents: events.slice(0, 20),
      freeTimeBufferHours: user.free_time_buffer_hours,
      memories: listMemories(),
    });
    for (const s of suggestions || []) {
      db.prepare(
        `INSERT INTO suggestions (type, content, suggested_for_date, metadata) VALUES ('life_balance', ?, ?, ?)`
      ).run(
        s.content,
        s.suggested_for_date || null,
        JSON.stringify({ title: s.title, start_time: s.start_time, end_time: s.end_time, suggested_for_date: s.suggested_for_date })
      );
    }
  } catch (err) {
    console.error('[calendar] Claude life-balance suggestions failed:', err.message);
  }

  recordSync('calendar', `Analyzed ${events.length} events, found ${conflictPairs.length} conflict(s)`);
  return { events, conflicts: conflictPairs };
}

router.post('/sync', asyncHandler(async (req, res) => {
  const result = await runCalendarAnalysis();
  res.json({ success: true, conflictCount: result.conflicts.length, eventCount: result.events.length });
}));

router.get('/suggestions', asyncHandler(async (req, res) => {
  const rows = db.prepare(`SELECT * FROM suggestions WHERE dismissed = 0 ORDER BY created_at DESC`).all();
  const parsed = rows.map((r) => ({ ...r, metadata: r.metadata ? JSON.parse(r.metadata) : null }));
  res.json({
    lifeBalance: parsed.filter((s) => s.type === 'life_balance'),
    conflicts: parsed.filter((s) => s.type === 'conflict_resolution'),
  });
}));

router.post('/suggestions/:id/dismiss', asyncHandler(async (req, res) => {
  db.prepare(`UPDATE suggestions SET dismissed = 1 WHERE id = ?`).run(req.params.id);
  res.json({ success: true });
}));

router.post('/suggestions/:id/add-to-calendar', asyncHandler(async (req, res) => {
  const suggestion = db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found.' });
  const meta = suggestion.metadata ? JSON.parse(suggestion.metadata) : {};
  const date = meta.suggested_for_date || suggestion.suggested_for_date;
  if (!date || !meta.start_time || !meta.end_time) {
    return res.status(400).json({ error: 'This suggestion is missing scheduling details.' });
  }
  const start = `${date}T${meta.start_time}:00`;
  const end = `${date}T${meta.end_time}:00`;
  const event = await calendarService.createEvent({
    title: meta.title || 'Suggested activity',
    description: suggestion.content,
    start,
    end,
  });
  db.prepare(`UPDATE suggestions SET added_to_calendar = 1, dismissed = 1 WHERE id = ?`).run(req.params.id);
  res.json({ success: true, event });
}));

router.post('/conflicts/:id/accept', asyncHandler(async (req, res) => {
  const suggestion = db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(req.params.id);
  if (!suggestion) return res.status(404).json({ error: 'Conflict suggestion not found.' });
  const meta = suggestion.metadata ? JSON.parse(suggestion.metadata) : {};
  if (!meta.moveEventId || !meta.newStart || !meta.newEnd) {
    return res.status(400).json({ error: 'No automatic resolution is available for this conflict — please resolve it manually.' });
  }
  const event = await calendarService.updateEvent(meta.moveEventId, { start: meta.newStart, end: meta.newEnd });
  db.prepare(`UPDATE suggestions SET dismissed = 1, added_to_calendar = 1 WHERE id = ?`).run(req.params.id);
  res.json({ success: true, event });
}));

module.exports = router;
module.exports.runCalendarAnalysis = runCalendarAnalysis;
