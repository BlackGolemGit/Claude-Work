// Two Gmail polling jobs, scheduled at different intervals from index.js:
//  - pollRsvps: every 30 minutes, scans for event invitations.
//  - pollSchoolEmails: every hour, scans configured school domains/keywords.
const { db, getUser, recordSync, isEmailProcessed, markEmailProcessed } = require('../db/db');
const gmailService = require('../services/gmail');
const claude = require('../services/claude');
const calendarService = require('../services/calendar');

function stripHtml(html) {
  return (html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function bodyOf(message) {
  return message.text?.trim() ? message.text : stripHtml(message.html);
}

async function pollRsvps() {
  const query = '(subject:"you\'re invited" OR subject:invite OR subject:invited OR subject:RSVP OR "invited you to" OR filename:ics) newer_than:5d';
  let messages = [];
  try {
    messages = await gmailService.searchMessages(query, 30);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') {
      console.log('[gmailPoller] Skipping RSVP scan — Google not connected.');
      return { scanned: 0, detected: 0 };
    }
    throw err;
  }

  let detected = 0;
  for (const message of messages) {
    if (isEmailProcessed(message.id, 'rsvp')) continue;
    try {
      const looksLikeInvite =
        message.hasIcs ||
        /invit|rsvp/i.test(`${message.subject} ${message.snippet}`);
      if (!looksLikeInvite) {
        markEmailProcessed(message.id, 'rsvp');
        continue;
      }
      const parsed = await claude.parseRsvpEmail({
        subject: message.subject,
        from: message.from,
        text: bodyOf(message),
      });
      if (parsed.isInvite && parsed.title) {
        const organizerMatch = message.from.match(/<(.+)>/);
        const organizerEmail = organizerMatch ? organizerMatch[1] : message.from;
        try {
          db.prepare(
            `INSERT INTO rsvps (gmail_message_id, event_title, event_date, event_time, event_location, organizer_email)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(message.id, parsed.title, parsed.date, parsed.time, parsed.location, organizerEmail);
          detected += 1;
        } catch (err) {
          if (!/UNIQUE constraint/.test(err.message)) throw err;
        }
      }
    } catch (err) {
      console.error(`[gmailPoller] Failed to process RSVP candidate ${message.id}:`, err.message);
    } finally {
      markEmailProcessed(message.id, 'rsvp');
    }
  }

  recordSync('rsvp', `Scanned ${messages.length} email(s), detected ${detected} new invite(s)`);
  return { scanned: messages.length, detected };
}

/** Builds a Gmail search query from the user's configured school domains + keywords. */
function buildSchoolQuery(user) {
  const domains = (user.school_email_domains || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  const keywords = (user.school_keywords || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  const defaultDomains = ['instructure.com', 'blackboard.com', 'classroom.google.com'];
  const allDomains = [...new Set([...defaultDomains, ...domains])];

  const domainClause = allDomains.map((d) => `from:${d}`).join(' OR ');
  const keywordClause = keywords.length
    ? keywords.map((k) => `"${k}"`).join(' OR ')
    : '"assignment" OR "homework" OR "due" OR "exam" OR "quiz"';

  return `((${domainClause}) OR (${keywordClause})) newer_than:2d`;
}

async function pollSchoolEmails() {
  const user = getUser();
  const query = buildSchoolQuery(user);
  let messages = [];
  try {
    messages = await gmailService.searchMessages(query, 30);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') {
      console.log('[gmailPoller] Skipping school scan — Google not connected.');
      return { scanned: 0, detected: 0 };
    }
    throw err;
  }

  let detected = 0;
  for (const message of messages) {
    if (isEmailProcessed(message.id, 'school')) continue;
    try {
      const parsed = await claude.parseSchoolEmail({
        subject: message.subject,
        from: message.from,
        text: bodyOf(message),
        keywords: user.school_keywords,
        domains: user.school_email_domains,
      });
      for (const task of parsed.tasks || []) {
        if (!task.title || !task.due_date) continue;
        const existing = db
          .prepare(`SELECT id FROM school_tasks WHERE title = ? AND due_date = ? AND IFNULL(course,'') = IFNULL(?, '')`)
          .get(task.title, task.due_date, task.course || null);
        if (existing) continue;

        const emoji = task.type === 'exam' ? '📝' : '📚';
        const label = task.type === 'exam' ? `Exam: ${task.title}` : `HW Due: ${task.title}`;
        let calendarEventId = null;
        try {
          // "Morning of" reminder approximated as 9am same day, assuming the
          // deadline itself lands at end-of-day (23:59) when no time is given.
          const event = await calendarService.createEvent({
            title: `${emoji} ${label}`,
            description: `${task.course || ''} ${task.type || ''}`.trim(),
            start: `${task.due_date}T23:59:00`,
            end: `${task.due_date}T23:59:00`,
            reminders: [
              { method: 'popup', minutes: 4320 }, // 3 days before
              { method: 'popup', minutes: 1440 }, // 1 day before
              { method: 'popup', minutes: 899 },  // ~9am the morning of
            ],
          });
          calendarEventId = event.id;
        } catch (err) {
          console.error('[gmailPoller] Failed to create calendar event for school task:', err.message);
        }

        db.prepare(
          `INSERT INTO school_tasks (title, course, type, due_date, calendar_event_id, gmail_message_id) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(task.title, task.course || null, task.type || 'homework', task.due_date, calendarEventId, message.id);
        detected += 1;
      }
    } catch (err) {
      console.error(`[gmailPoller] Failed to process school email ${message.id}:`, err.message);
    } finally {
      markEmailProcessed(message.id, 'school');
    }
  }

  recordSync('school', `Scanned ${messages.length} email(s), detected ${detected} new task(s)`);

  if (detected > 0) {
    try {
      const { runCalendarAnalysis } = require('../routes/calendar');
      await runCalendarAnalysis();
    } catch (err) {
      console.error('[gmailPoller] Post-sync analysis failed:', err.message);
    }
  }

  return { scanned: messages.length, detected };
}

module.exports = { pollRsvps, pollSchoolEmails };
