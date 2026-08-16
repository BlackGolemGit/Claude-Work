// RSVP detection & management endpoints (Dashboard Accept/Decline buttons).
const express = require('express');
const router = express.Router();
const { db, recordSync, getLastSync, getEmailAccount } = require('../db/db');
const calendarService = require('../services/calendar');
const emailAccounts = require('../services/emailAccounts');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[gmail route] ${req.method} ${req.originalUrl}:`, err.message);
    const status = err.code === 'GOOGLE_NOT_CONNECTED' ? 409 : 500;
    res.status(status).json({ error: err.message || 'Something went wrong.' });
  });
}

router.get('/rsvps', asyncHandler(async (req, res) => {
  const rows = db
    .prepare(
      `SELECT rsvps.*, email_accounts.email AS account_email
       FROM rsvps LEFT JOIN email_accounts ON email_accounts.id = rsvps.account_id
       ORDER BY (rsvps.status = 'pending') DESC, rsvps.detected_at DESC LIMIT 100`
    )
    .all();
  res.json({ rsvps: rows, lastSynced: getLastSync('rsvp')?.last_synced_at || null });
}));

router.post('/scan', asyncHandler(async (req, res) => {
  // Lazy-required to avoid a require cycle at module load time.
  const { pollRsvps } = require('../jobs/gmailPoller');
  const result = await pollRsvps();
  res.json({ success: true, ...result });
}));

async function replyFromAccount(rsvp, body) {
  if (!rsvp.organizer_email || !rsvp.account_id) return;
  const account = getEmailAccount(rsvp.account_id);
  if (!account) return;
  try {
    await emailAccounts.replyToMessage(account, {
      threadId: rsvp.message_id,
      messageIdHeader: rsvp.message_id_header,
      to: rsvp.organizer_email,
      subject: rsvp.event_title,
      body,
    });
  } catch (err) {
    console.error(`[gmail] Failed to send RSVP reply from ${account.email}:`, err.message);
  }
}

router.post('/rsvps/:id/accept', asyncHandler(async (req, res) => {
  const rsvp = db.prepare(`SELECT * FROM rsvps WHERE id = ?`).get(req.params.id);
  if (!rsvp) return res.status(404).json({ error: 'RSVP not found.' });
  if (rsvp.status !== 'pending' && !req.body.force) {
    return res.status(400).json({ error: `This RSVP was already ${rsvp.status}.` });
  }

  const force = !!req.body.force;
  if (rsvp.event_date && rsvp.event_time) {
    const start = `${rsvp.event_date}T${rsvp.event_time}:00`;
    const end = new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString();
    const weekEvents = await calendarService.getWeekEvents();
    const conflict = calendarService.hasConflict(weekEvents, start, end);
    if (conflict && !force) {
      return res.status(409).json({
        conflict: true,
        message: `"${rsvp.event_title}" overlaps with something already on your calendar.`,
      });
    }
    const event = await calendarService.createEvent({
      title: rsvp.event_title,
      location: rsvp.event_location,
      description: `Accepted via AI Scheduling Agent. Organizer: ${rsvp.organizer_email || 'unknown'}`,
      start,
      end,
    });
    db.prepare(`UPDATE rsvps SET status = 'accepted', calendar_event_id = ? WHERE id = ?`).run(event.id, rsvp.id);
  } else {
    // All-day / time-unspecified event
    const day = rsvp.event_date || new Date().toISOString().slice(0, 10);
    const event = await calendarService.createEvent({
      title: rsvp.event_title,
      location: rsvp.event_location,
      description: `Accepted via AI Scheduling Agent. Organizer: ${rsvp.organizer_email || 'unknown'}`,
      start: day,
      end: day,
      allDay: true,
    });
    db.prepare(`UPDATE rsvps SET status = 'accepted', calendar_event_id = ? WHERE id = ?`).run(event.id, rsvp.id);
  }

  await replyFromAccount(rsvp, `Hi,\n\nI'm happy to confirm — I'll be attending "${rsvp.event_title}".\n\nSee you there!`);

  recordSync('rsvp', `Accepted "${rsvp.event_title}"`);
  res.json({ success: true });
}));

router.post('/rsvps/:id/decline', asyncHandler(async (req, res) => {
  const rsvp = db.prepare(`SELECT * FROM rsvps WHERE id = ?`).get(req.params.id);
  if (!rsvp) return res.status(404).json({ error: 'RSVP not found.' });

  if (rsvp.calendar_event_id) {
    try {
      await calendarService.deleteEvent(rsvp.calendar_event_id);
    } catch (err) {
      console.error('[gmail] Failed to remove calendar event on decline:', err.message);
    }
  }
  db.prepare(`UPDATE rsvps SET status = 'declined', calendar_event_id = NULL WHERE id = ?`).run(rsvp.id);

  await replyFromAccount(rsvp, `Hi,\n\nThanks for the invite to "${rsvp.event_title}" — unfortunately I won't be able to make it this time.\n\nBest,`);

  recordSync('rsvp', `Declined "${rsvp.event_title}"`);
  res.json({ success: true });
}));

module.exports = router;
