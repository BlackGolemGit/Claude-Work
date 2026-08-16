// Provider-agnostic email account abstraction. Jobs and routes call these
// functions instead of talking to services/gmail.js or services/imap.js
// directly, so RSVP/school/HotSchedules scanning works the same way across
// every connected Google and IMAP account.
const { google } = require('googleapis');
const gmailService = require('./gmail');
const imapService = require('./imap');
const { getClientForAccount } = require('./googleAuth');
const { listEmailAccounts } = require('../db/db');

function listAllAccounts() {
  return listEmailAccounts({ activeOnly: true });
}

/**
 * Fetches candidate messages for a poller to inspect. Google accounts use
 * Gmail's native query syntax (`gmailQuery`); IMAP accounts have no
 * equivalent query language, so we instead pull everything from the last
 * `sinceDays` days and run `matchPredicate(message)` in JS to narrow it down
 * before anything is sent to Claude.
 */
async function fetchCandidateMessages(account, { gmailQuery, sinceDays = 5, maxResults = 30, matchPredicate }) {
  if (account.provider === 'google') {
    return gmailService.searchMessages(account, gmailQuery, maxResults);
  }
  const all = await imapService.searchMessages(account, { sinceDays, maxResults: maxResults * 3 });
  const filtered = matchPredicate ? all.filter(matchPredicate) : all;
  return filtered.slice(0, maxResults);
}

async function sendEmail(account, payload) {
  if (account.provider === 'google') return gmailService.sendEmail(account, payload);
  return imapService.sendEmail(account, payload);
}

async function replyToMessage(account, payload) {
  if (account.provider === 'google') return gmailService.replyToMessage(account, payload);
  return imapService.replyToMessage(account, payload);
}

/** Used by the Settings "Test Connection" button and startup smoke tests. */
async function testConnection(account) {
  if (account.provider === 'google') {
    try {
      const auth = await getClientForAccount(account);
      const gmail = google.gmail({ version: 'v1', auth });
      await gmail.users.getProfile({ userId: 'me' });
      return { status: 'ok' };
    } catch (err) {
      return { status: 'failed', error: err.message };
    }
  }
  const result = await imapService.testConnection(account);
  const ok = result.imap === 'ok' && (result.smtp === 'ok' || !account.smtp_host);
  return { status: ok ? 'ok' : 'failed', detail: result };
}

/** Strips secrets before an account record is ever sent to the client. */
function describeAccount(account) {
  return {
    id: account.id,
    provider: account.provider,
    label: account.label,
    email: account.email,
    isActive: !!account.is_active,
    isCalendarPrimary: !!account.is_calendar_primary,
    imapHost: account.imap_host || null,
    smtpHost: account.smtp_host || null,
    createdAt: account.created_at,
  };
}

module.exports = {
  listAllAccounts,
  fetchCandidateMessages,
  sendEmail,
  replyToMessage,
  testConnection,
  describeAccount,
};
