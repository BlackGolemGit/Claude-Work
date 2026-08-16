// Settings tab endpoints: preferences, connected-account management
// (multiple Google accounts + generic IMAP/SMTP accounts), and Twilio
// credential storage (AES encrypted at rest).
const express = require('express');
const router = express.Router();
const {
  getUser, updateUser, listEmailAccounts, getEmailAccount, deleteEmailAccount,
  setCalendarPrimary, upsertImapAccount, db,
} = require('../db/db');
const { encrypt } = require('../services/encryption');
const googleAuth = require('../services/googleAuth');
const emailAccounts = require('../services/emailAccounts');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[settings route] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

function sanitize(user) {
  return {
    name: user.name,
    email: user.email,
    twilio_phone: user.twilio_phone,
    morning_brief_time: user.morning_brief_time,
    weekly_preview_time: user.weekly_preview_time,
    notification_preference: user.notification_preference,
    free_time_buffer_hours: user.free_time_buffer_hours,
    timezone: user.timezone,
    school_email_domains: user.school_email_domains,
    school_keywords: user.school_keywords,
    twilio_configured: !!(user.twilio_account_sid && user.twilio_auth_token),
    twilio_from_number: user.twilio_from_number,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  res.json({ settings: sanitize(getUser()) });
}));

router.put('/', asyncHandler(async (req, res) => {
  const {
    name, email, twilio_phone, morning_brief_time, weekly_preview_time,
    notification_preference, free_time_buffer_hours, timezone,
    school_email_domains, school_keywords,
    twilio_account_sid, twilio_auth_token, twilio_from_number,
  } = req.body;

  const patch = {
    name, email, twilio_phone, morning_brief_time, weekly_preview_time,
    notification_preference, free_time_buffer_hours, timezone,
    school_email_domains, school_keywords, twilio_from_number,
  };
  // Only overwrite encrypted Twilio fields when the user actually typed something
  // (the client sends masked/empty values for fields it isn't changing).
  if (twilio_account_sid) patch.twilio_account_sid = encrypt(twilio_account_sid);
  if (twilio_auth_token) patch.twilio_auth_token = encrypt(twilio_auth_token);

  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  const updated = updateUser(patch);
  res.json({ settings: sanitize(updated) });
}));

// ---------------------------------------------------------------------------
// Connected accounts (Google + IMAP)
// ---------------------------------------------------------------------------

router.get('/accounts', asyncHandler(async (req, res) => {
  const accounts = listEmailAccounts({ activeOnly: false }).map(emailAccounts.describeAccount);
  res.json({ accounts });
}));

router.get('/google/auth-url', asyncHandler(async (req, res) => {
  res.json({ url: googleAuth.getAuthUrl() });
}));

router.get('/google/callback', asyncHandler(async (req, res) => {
  const { code, error } = req.query;
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  if (error) {
    return res.redirect(`${clientUrl}/?tab=settings&google=error`);
  }
  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }
  await googleAuth.handleOAuthCallback(code);
  res.redirect(`${clientUrl}/?tab=settings&google=connected`);
}));

router.post('/accounts/imap', asyncHandler(async (req, res) => {
  const { id, email, label, imap, smtp } = req.body;
  if (!email || !imap?.host || !imap?.username) {
    return res.status(400).json({ error: 'Email, IMAP host, and IMAP username are required.' });
  }
  const account = upsertImapAccount({
    id,
    email,
    label,
    imap: {
      host: imap.host,
      port: imap.port ? Number(imap.port) : 993,
      secure: imap.secure !== false,
      username: imap.username,
      password: imap.password ? encrypt(imap.password) : undefined,
    },
    smtp: {
      host: smtp?.host || '',
      port: smtp?.port ? Number(smtp.port) : 465,
      secure: smtp?.secure !== false,
      username: smtp?.username || imap.username,
      password: smtp?.password ? encrypt(smtp.password) : undefined,
    },
  });
  res.json({ account: emailAccounts.describeAccount(account) });
}));

router.post('/accounts/:id/test', asyncHandler(async (req, res) => {
  const account = getEmailAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  const result = await emailAccounts.testConnection(account);
  res.json(result);
}));

router.post('/accounts/:id/set-primary-calendar', asyncHandler(async (req, res) => {
  const account = getEmailAccount(req.params.id);
  if (!account || account.provider !== 'google') {
    return res.status(400).json({ error: 'Only a connected Google account can be the calendar account.' });
  }
  setCalendarPrimary(account.id);
  res.json({ success: true });
}));

router.post('/accounts/:id/toggle-active', asyncHandler(async (req, res) => {
  const account = getEmailAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  db.prepare('UPDATE email_accounts SET is_active = ? WHERE id = ?').run(account.is_active ? 0 : 1, account.id);
  res.json({ success: true });
}));

router.delete('/accounts/:id', asyncHandler(async (req, res) => {
  const account = getEmailAccount(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });
  deleteEmailAccount(account.id);
  res.json({ success: true });
}));

module.exports = router;
