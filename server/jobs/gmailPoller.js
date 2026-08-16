// Two Gmail/IMAP polling jobs, scheduled at different intervals from
// index.js, each looping across every connected email account:
//  - pollRsvps: every 30 minutes, scans for event invitations.
//  - pollSchoolEmails: every hour, scans configured school domains/keywords.
const { db, getUser, recordSync, isEmailProcessed, markEmailProcessed } = require('../db/db');
const emailAccounts = require('../services/emailAccounts');
const claude = require('../services/claude');
const calendarService = require('../services/calendar');

function stripHtml(html) {
  return (html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function bodyOf(message) {
  return message.text?.trim() ? message.text : stripHtml(message.html);
}

const RSVP_GMAIL_QUERY =
  '(subject:"you\'re invited" OR subject:invite OR subject:invited OR subject:RSVP OR "invited you to" OR filename:ics) newer_than:5d';
const RSVP_PATTERN = /invit|rsvp/i;

function rsvpMatchPredicate(message) {
  return message.hasIcs || RSVP_PATTERN.test(`${message.subject} ${message.snippet}`);
}

async function pollRsvps() {
  const accounts = emailAccounts.listAllAccounts();
  let totalScanned = 0;
  let totalDetected = 0;

  for (const account of accounts) {
    let messages = [];
    try {
      messages = await emailAccounts.fetchCandidateMessages(account, {
        gmailQuery: RSVP_GMAIL_QUERY,
        sinceDays: 5,
        maxResults: 30,
        matchPredicate: rsvpMatchPredicate,
      });
    } catch (err) {
      console.error(`[gmailPoller] RSVP scan failed for ${account.email}:`, err.message);
      continue;
    }
    totalScanned += messages.length;

    for (const message of messages) {
      if (isEmailProcessed(account.id, message.id, 'rsvp')) continue;
      try {
        if (!rsvpMatchPredicate(message)) {
          markEmailProcessed(account.id, message.id, 'rsvp');
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
              `INSERT INTO rsvps (account_id, message_id, message_id_header, event_title, event_date, event_time, event_location, organizer_email)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(account.id, message.id, message.messageIdHeader || null, parsed.title, parsed.date, parsed.time, parsed.location, organizerEmail);
            totalDetected += 1;
          } catch (err) {
            if (!/UNIQUE constraint/.test(err.message)) throw err;
          }
        }
      } catch (err) {
        console.error(`[gmailPoller] Failed to process RSVP candidate ${message.id} (${account.email}):`, err.message);
      } finally {
        markEmailProcessed(account.id, message.id, 'rsvp');
      }
    }
  }

  recordSync('rsvp', `Scanned ${totalScanned} email(s) across ${accounts.length} account(s), detected ${totalDetected} new invite(s)`);
  return { scanned: totalScanned, detected: totalDetected };
}

/** Builds a Gmail search query + IMAP keyword predicate from the user's configured school domains + keywords. */
function buildSchoolFilters(user) {
  const domains = (user.school_email_domains || '').split(',').map((d) => d.trim()).filter(Boolean);
  const keywords = (user.school_keywords || '').split(',').map((k) => k.trim()).filter(Boolean);
  const defaultDomains = ['instructure.com', 'blackboard.com', 'classroom.google.com'];
  const allDomains = [...new Set([...defaultDomains, ...domains])];
  const allKeywords = keywords.length ? keywords : ['assignment', 'homework', 'due', 'exam', 'quiz'];

  const domainClause = allDomains.map((d) => `from:${d}`).join(' OR ');
  const keywordClause = allKeywords.map((k) => `"${k}"`).join(' OR ');
  const gmailQuery = `((${domainClause}) OR (${keywordClause})) newer_than:2d`;

  const domainRegexes = allDomains.map((d) => new RegExp(d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const keywordRegexes = allKeywords.map((k) => new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const matchPredicate = (message) => {
    const haystack = `${message.subject} ${message.from} ${message.snippet}`;
    return domainRegexes.some((r) => r.test(message.from)) || keywordRegexes.some((r) => r.test(haystack));
  };

  return { gmailQuery, matchPredicate };
}

async function pollSchoolEmails() {
  const user = getUser();
  const { gmailQuery, matchPredicate } = buildSchoolFilters(user);
  const accounts = emailAccounts.listAllAccounts();
  let totalScanned = 0;
  let totalDetected = 0;

  for (const account of accounts) {
    let messages = [];
    try {
      messages = await emailAccounts.fetchCandidateMessages(account, {
        gmailQuery,
        sinceDays: 2,
        maxResults: 30,
        matchPredicate,
      });
    } catch (err) {
      console.error(`[gmailPoller] School scan failed for ${account.email}:`, err.message);
      continue;
    }
    totalScanned += messages.length;

    for (const message of messages) {
      if (isEmailProcessed(account.id, message.id, 'school')) continue;
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
            `INSERT INTO school_tasks (title, course, type, due_date, calendar_event_id, message_id, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(task.title, task.course || null, task.type || 'homework', task.due_date, calendarEventId, message.id, account.id);
          totalDetected += 1;
        }
      } catch (err) {
        console.error(`[gmailPoller] Failed to process school email ${message.id} (${account.email}):`, err.message);
      } finally {
        markEmailProcessed(account.id, message.id, 'school');
      }
    }
  }

  recordSync('school', `Scanned ${totalScanned} email(s) across ${accounts.length} account(s), detected ${totalDetected} new task(s)`);

  if (totalDetected > 0) {
    try {
      const { runCalendarAnalysis } = require('../routes/calendar');
      await runCalendarAnalysis();
    } catch (err) {
      console.error('[gmailPoller] Post-sync analysis failed:', err.message);
    }
  }

  return { scanned: totalScanned, detected: totalDetected };
}

module.exports = { pollRsvps, pollSchoolEmails };
