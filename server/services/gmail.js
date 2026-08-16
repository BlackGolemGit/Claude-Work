// Gmail wrapper: searching/reading messages, decoding bodies (incl. iCal
// attachment detection), and sending/replying to emails.
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./googleAuth');

async function getGmailClient() {
  const auth = await getAuthenticatedClient();
  return google.gmail({ version: 'v1', auth });
}

function friendlyError(err, fallback) {
  const message = err?.response?.data?.error?.message || err.message || fallback;
  const wrapped = new Error(message);
  wrapped.original = err;
  return wrapped;
}

function b64urlDecode(data) {
  if (!data) return '';
  return Buffer.from(data, 'base64').toString('utf8');
}

/** Walks a Gmail message payload and returns { text, html, hasIcs }. */
function extractBody(payload) {
  let text = '';
  let html = '';
  let hasIcs = false;

  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || '';
    const filename = part.filename || '';
    if (mimeType === 'text/plain' && part.body?.data) {
      text += b64urlDecode(part.body.data);
    } else if (mimeType === 'text/html' && part.body?.data) {
      html += b64urlDecode(part.body.data);
    } else if (
      mimeType === 'text/calendar' ||
      filename.endsWith('.ics') ||
      mimeType === 'application/ics'
    ) {
      hasIcs = true;
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return { text, html, hasIcs };
}

function headerValue(headers, name) {
  const h = (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

/**
 * Searches Gmail with a query and returns normalized message summaries
 * (id, threadId, subject, from, date, snippet, text/html body, hasIcs).
 * `afterEpochSeconds` is appended to the query as `after:` to only scan
 * recent mail on each poll.
 */
async function searchMessages(query, maxResults = 25) {
  try {
    const gmail = await getGmailClient();
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });
    const messages = data.messages || [];
    const full = await Promise.all(
      messages.map(async (m) => {
        const { data: msg } = await gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'full',
        });
        const headers = msg.payload?.headers || [];
        const { text, html, hasIcs } = extractBody(msg.payload);
        return {
          id: msg.id,
          threadId: msg.threadId,
          subject: headerValue(headers, 'Subject'),
          from: headerValue(headers, 'From'),
          date: headerValue(headers, 'Date'),
          snippet: msg.snippet,
          text,
          html,
          hasIcs,
        };
      })
    );
    return full;
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to search Gmail.');
  }
}

function buildRawMessage({ to, subject, body, inReplyTo, references, threadId }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  const raw = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmail({ to, subject, body }) {
  try {
    const gmail = await getGmailClient();
    const raw = buildRawMessage({ to, subject, body });
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
    return true;
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to send email.');
  }
}

/** Replies in-thread to an existing message (used for auto Accept/Decline responses). */
async function replyToMessage({ messageId, threadId, to, subject, body }) {
  try {
    const gmail = await getGmailClient();
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    const raw = buildRawMessage({
      to,
      subject: replySubject,
      body,
      inReplyTo: messageId,
      references: messageId,
    });
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });
    return true;
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to send reply email.');
  }
}

module.exports = {
  searchMessages,
  sendEmail,
  replyToMessage,
  headerValue,
};
