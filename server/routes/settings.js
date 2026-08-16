// Settings tab endpoints: preferences, Google OAuth connect/disconnect,
// and Twilio credential storage (AES encrypted at rest).
const express = require('express');
const router = express.Router();
const { getUser, updateUser } = require('../db/db');
const { encrypt, decrypt } = require('../services/encryption');
const googleAuth = require('../services/googleAuth');

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
    google_connected: !!user.google_connected,
    google_email: user.google_email,
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

router.post('/google/disconnect', asyncHandler(async (req, res) => {
  googleAuth.disconnectGoogle();
  res.json({ success: true });
}));

module.exports = router;
