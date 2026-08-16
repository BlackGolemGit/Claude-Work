// Generic IMAP (read) / SMTP (send) wrapper for non-Google email accounts
// (Outlook, Yahoo, school-hosted IMAP, etc.), authenticated with a stored
// username + app-password rather than OAuth. Mirrors the shape of
// services/gmail.js so jobs/routes can treat both providers interchangeably
// via services/emailAccounts.js.
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { decrypt } = require('./encryption');

function friendlyError(err, fallback) {
  const wrapped = new Error(err.message || fallback);
  wrapped.original = err;
  return wrapped;
}

function imapCredentials(account) {
  const password = decrypt(account.imap_password);
  if (!account.imap_host || !account.imap_username || !password) {
    throw new Error(`IMAP is not fully configured for ${account.email}. Check the account's settings.`);
  }
  return {
    host: account.imap_host,
    port: account.imap_port || 993,
    secure: !!account.imap_secure,
    auth: { user: account.imap_username, pass: password },
    logger: false,
  };
}

function smtpCredentials(account) {
  const password = decrypt(account.smtp_password) || decrypt(account.imap_password);
  const host = account.smtp_host;
  const user = account.smtp_username || account.imap_username;
  if (!host || !user || !password) {
    throw new Error(`SMTP is not configured for ${account.email}. Add SMTP settings to send/reply from this account.`);
  }
  return {
    host,
    port: account.smtp_port || 465,
    secure: !!account.smtp_secure,
    auth: { user, pass: password },
  };
}

/**
 * Fetches recent INBOX messages (last `sinceDays` days), normalized to the
 * same shape services/gmail.js produces. Unlike Gmail's rich query
 * operators, IMAP SEARCH doesn't support keyword/domain boolean queries, so
 * callers (jobs/gmailPoller.js, jobs/hotschedulesSync.js) fetch everything
 * recent and apply keyword/domain filtering client-side in JS.
 */
async function searchMessages(account, { sinceDays = 5, maxResults = 50 } = {}) {
  let client;
  try {
    client = new ImapFlow(imapCredentials(account));
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - sinceDays * 86400000);
      const uids = await client.search({ since }, { uid: true });
      const selected = (uids || []).slice(-maxResults); // most recent N
      const results = [];
      for (const uid of selected) {
        try {
          const msg = await client.fetchOne(uid, { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const hasIcs = (parsed.attachments || []).some(
            (a) => a.contentType === 'text/calendar' || (a.filename || '').endsWith('.ics')
          );
          results.push({
            id: String(uid),
            threadId: null,
            messageIdHeader: parsed.messageId || '',
            subject: parsed.subject || '',
            from: parsed.from?.text || '',
            date: parsed.date ? parsed.date.toString() : '',
            snippet: (parsed.text || '').slice(0, 200),
            text: parsed.text || '',
            html: parsed.html || '',
            hasIcs,
          });
        } catch (err) {
          console.error(`[imap] Failed to parse message uid ${uid} for ${account.email}:`, err.message);
        }
      }
      return results;
    } finally {
      lock.release();
    }
  } catch (err) {
    throw friendlyError(err, `Failed to read IMAP inbox for ${account.email}.`);
  } finally {
    try {
      if (client) await client.logout();
    } catch {
      // connection may already be closed — ignore
    }
  }
}

async function sendEmail(account, { to, subject, body }) {
  try {
    const transporter = nodemailer.createTransport(smtpCredentials(account));
    await transporter.sendMail({ from: account.email, to, subject, text: body });
    return true;
  } catch (err) {
    throw friendlyError(err, `Failed to send email from ${account.email}.`);
  }
}

async function replyToMessage(account, { messageIdHeader, to, subject, body }) {
  try {
    const transporter = nodemailer.createTransport(smtpCredentials(account));
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    await transporter.sendMail({
      from: account.email,
      to,
      subject: replySubject,
      text: body,
      inReplyTo: messageIdHeader || undefined,
      references: messageIdHeader || undefined,
    });
    return true;
  } catch (err) {
    throw friendlyError(err, `Failed to send reply email from ${account.email}.`);
  }
}

/** Verifies both IMAP and SMTP credentials work — used by the Settings "Test Connection" action. */
async function testConnection(account) {
  const result = { imap: null, smtp: null };
  try {
    const client = new ImapFlow(imapCredentials(account));
    await client.connect();
    await client.logout();
    result.imap = 'ok';
  } catch (err) {
    result.imap = `failed: ${err.message}`;
  }
  try {
    const transporter = nodemailer.createTransport(smtpCredentials(account));
    await transporter.verify();
    result.smtp = 'ok';
  } catch (err) {
    result.smtp = `failed: ${err.message}`;
  }
  return result;
}

module.exports = { searchMessages, sendEmail, replyToMessage, testConnection };
