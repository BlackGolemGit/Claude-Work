// Notification delivery: fans a message out to email (Gmail API) and/or SMS
// (Twilio) based on the user's notification_preference. Used by the
// morning-brief and weekly-preview cron jobs, and exposed here for a
// Settings "send test notification" action.
const express = require('express');
const router = express.Router();
const { getUser, getNotificationAccount } = require('../db/db');
const emailAccounts = require('../services/emailAccounts');
const twilioService = require('../services/twilio');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[notifications route] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

/**
 * Sends `body` via whichever channel(s) the user has configured. Failures on
 * one channel don't block the other — both errors (if any) are collected and
 * returned so callers/cron jobs can log them without crashing.
 */
async function deliverNotification({ subject, body }) {
  const user = getUser();
  const pref = user.notification_preference || 'email';
  const results = { email: null, sms: null };

  if (pref === 'email' || pref === 'both') {
    try {
      const account = getNotificationAccount();
      if (!account) throw new Error('No email account is connected.');
      if (!user.email) throw new Error('No destination email address on file (set it in Settings).');
      await emailAccounts.sendEmail(account, { to: user.email, subject, body });
      results.email = `sent via ${account.email}`;
    } catch (err) {
      results.email = `failed: ${err.message}`;
      console.error('[notifications] Email delivery failed:', err.message);
    }
  }

  if (pref === 'sms' || pref === 'both') {
    try {
      await twilioService.sendSms(body.length > 1500 ? `${body.slice(0, 1490)}…` : body);
      results.sms = 'sent';
    } catch (err) {
      results.sms = `failed: ${err.message}`;
      console.error('[notifications] SMS delivery failed:', err.message);
    }
  }

  return results;
}

router.post('/test', asyncHandler(async (req, res) => {
  const results = await deliverNotification({
    subject: 'AI Scheduling Agent — Test Notification',
    body: 'This is a test notification from your AI Scheduling Agent. If you received this, your notification settings are working!',
  });
  res.json({ success: true, results });
}));

module.exports = router;
module.exports.deliverNotification = deliverNotification;
