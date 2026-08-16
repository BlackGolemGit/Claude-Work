// Scans every connected email account for HotSchedules shift notification
// emails, parses them with Claude, and syncs each shift into Google Calendar
// as a hard-blocked event. Runs once daily via cron, and on demand from the
// "Sync Now" button.
const { db, recordSync, isEmailProcessed, markEmailProcessed } = require('../db/db');
const emailAccounts = require('../services/emailAccounts');
const claude = require('../services/claude');
const calendarService = require('../services/calendar');

function stripHtml(html) {
  return (html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function bodyOf(message) {
  return message.text?.trim() ? message.text : stripHtml(message.html);
}

const GMAIL_QUERY = '(from:hotschedules.com OR subject:HotSchedules OR subject:schedule OR subject:shift OR subject:"upcoming shifts") newer_than:10d';
const HOTSCHEDULES_PATTERN = /hotschedules|schedule|shift/i;

function matchPredicate(message) {
  return HOTSCHEDULES_PATTERN.test(`${message.subject} ${message.from}`);
}

async function syncNow() {
  const accounts = emailAccounts.listAllAccounts();
  let totalScanned = 0;
  let totalShifts = 0;

  for (const account of accounts) {
    let messages = [];
    try {
      messages = await emailAccounts.fetchCandidateMessages(account, {
        gmailQuery: GMAIL_QUERY,
        sinceDays: 10,
        maxResults: 20,
        matchPredicate,
      });
    } catch (err) {
      console.error(`[hotschedulesSync] Scan failed for ${account.email}:`, err.message);
      continue;
    }
    totalScanned += messages.length;

    for (const message of messages) {
      if (isEmailProcessed(account.id, message.id, 'hotschedules')) continue;
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
              description: `Synced from HotSchedules email (${account.email}).${shift.location ? ` Location: ${shift.location}` : ''}`,
              location: shift.location || '',
              start: `${shift.date}T${shift.start_time}:00`,
              end: `${shift.date}T${shift.end_time}:00`,
            });
            calendarEventId = event.id;
          } catch (err) {
            console.error('[hotschedulesSync] Failed to create calendar event for shift:', err.message);
          }

          db.prepare(
            `INSERT INTO work_shifts (date, start_time, end_time, role, location, calendar_event_id, message_id, account_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(shift.date, shift.start_time, shift.end_time, shift.role || null, shift.location || null, calendarEventId, message.id, account.id);
          totalShifts += 1;
        }
      } catch (err) {
        console.error(`[hotschedulesSync] Failed to process email ${message.id} (${account.email}):`, err.message);
      } finally {
        markEmailProcessed(account.id, message.id, 'hotschedules');
      }
    }
  }

  recordSync('hotschedules', `Scanned ${totalScanned} email(s) across ${accounts.length} account(s), synced ${totalShifts} shift(s)`);

  if (totalShifts > 0) {
    try {
      const { runCalendarAnalysis } = require('../routes/calendar');
      await runCalendarAnalysis();
    } catch (err) {
      console.error('[hotschedulesSync] Post-sync analysis failed:', err.message);
    }
  }

  return { scanned: totalScanned, shiftsSynced: totalShifts };
}

module.exports = { syncNow };
