// Scans Gmail for HotSchedules shift notification emails, parses them with
// Claude, and syncs each shift into Google Calendar as a hard-blocked event.
// Runs once daily via cron, and on demand from the "Sync Now" button.
const { db, recordSync, isEmailProcessed, markEmailProcessed } = require('../db/db');
const gmailService = require('../services/gmail');
const claude = require('../services/claude');
const calendarService = require('../services/calendar');

function stripHtml(html) {
  return (html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function bodyOf(message) {
  return message.text?.trim() ? message.text : stripHtml(message.html);
}

const QUERY = '(from:hotschedules.com OR subject:HotSchedules OR subject:schedule OR subject:shift OR subject:"upcoming shifts") newer_than:10d';

async function syncNow() {
  let messages = [];
  try {
    messages = await gmailService.searchMessages(QUERY, 20);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') {
      console.log('[hotschedulesSync] Skipping — Google not connected.');
      return { scanned: 0, shiftsSynced: 0 };
    }
    throw err;
  }

  let shiftsSynced = 0;
  for (const message of messages) {
    if (isEmailProcessed(message.id, 'hotschedules')) continue;
    try {
      const parsed = await claude.parseHotSchedulesEmail({
        subject: message.subject,
        text: bodyOf(message),
      });
      for (const shift of parsed.shifts || []) {
        if (!shift.date || !shift.start_time || !shift.end_time) continue;
        const existing = db
          .prepare(`SELECT id FROM work_shifts WHERE date = ? AND start_time = ? AND end_time = ?`)
          .get(shift.date, shift.start_time, shift.end_time);
        if (existing) continue;

        let calendarEventId = null;
        try {
          const event = await calendarService.createEvent({
            title: `🏢 Work Shift — ${shift.role || 'Shift'}`,
            description: `Synced from HotSchedules email.${shift.location ? ` Location: ${shift.location}` : ''}`,
            location: shift.location || '',
            start: `${shift.date}T${shift.start_time}:00`,
            end: `${shift.date}T${shift.end_time}:00`,
          });
          calendarEventId = event.id;
        } catch (err) {
          console.error('[hotschedulesSync] Failed to create calendar event for shift:', err.message);
        }

        db.prepare(
          `INSERT INTO work_shifts (date, start_time, end_time, role, location, calendar_event_id, gmail_message_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(shift.date, shift.start_time, shift.end_time, shift.role || null, shift.location || null, calendarEventId, message.id);
        shiftsSynced += 1;
      }
    } catch (err) {
      console.error(`[hotschedulesSync] Failed to process email ${message.id}:`, err.message);
    } finally {
      markEmailProcessed(message.id, 'hotschedules');
    }
  }

  recordSync('hotschedules', `Scanned ${messages.length} email(s), synced ${shiftsSynced} shift(s)`);

  if (shiftsSynced > 0) {
    try {
      const { runCalendarAnalysis } = require('../routes/calendar');
      await runCalendarAnalysis();
    } catch (err) {
      console.error('[hotschedulesSync] Post-sync analysis failed:', err.message);
    }
  }

  return { scanned: messages.length, shiftsSynced };
}

module.exports = { syncNow };
