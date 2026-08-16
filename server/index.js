require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const REQUIRED_ENV = ['ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'ENCRYPTION_SECRET'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.warn(`[startup] Warning: missing environment variables: ${missing.join(', ')}. See server/.env.example.`);
}

const { getUser } = require('./db/db'); // also ensures the DB + schema are initialized

const calendarRoutes = require('./routes/calendar');
const gmailRoutes = require('./routes/gmail');
const hotschedulesRoutes = require('./routes/hotschedules');
const schoolRoutes = require('./routes/school');
const chatRoutes = require('./routes/chat');
const settingsRoutes = require('./routes/settings');
const notificationsRoutes = require('./routes/notifications');

const { pollRsvps, pollSchoolEmails } = require('./jobs/gmailPoller');
const { syncNow: syncHotSchedules } = require('./jobs/hotschedulesSync');
const { runMorningBrief } = require('./jobs/morningBrief');
const { runWeeklyPreview } = require('./jobs/weeklyPreview');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/calendar', calendarRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/hotschedules', hotschedulesRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/notifications', notificationsRoutes);

// Optionally serve a production client build if one has been built
// (`npm run build` inside /client). Local dev instead runs the Vite dev
// server separately on port 5173.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Centralized error handler — guarantees the app never crashes on an
// unhandled route error and always returns friendly JSON.
app.use((err, req, res, next) => {
  console.error('[unhandled error]', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

function safeRun(name, fn) {
  fn().catch((err) => console.error(`[cron] ${name} failed:`, err.message));
}

// RSVP detection — every 30 minutes.
cron.schedule('*/30 * * * *', () => safeRun('pollRsvps', pollRsvps));

// School/homework email scan — every hour.
cron.schedule('0 * * * *', () => safeRun('pollSchoolEmails', pollSchoolEmails));

// HotSchedules scan — once daily at 6:00am server time.
cron.schedule('0 6 * * *', () => safeRun('syncHotSchedules', syncHotSchedules));

// Morning briefing and weekly preview run on user-configured times of day.
// Rather than re-creating a cron job whenever Settings changes, we check
// every minute whether "now" matches the user's configured HH:MM, guarding
// against double-firing within the same minute.
let lastBriefKey = null;
let lastPreviewKey = null;

cron.schedule('* * * * *', () => {
  const user = getUser();
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const dateKey = now.toISOString().slice(0, 10);

  if (user.morning_brief_time === hhmm && lastBriefKey !== dateKey) {
    lastBriefKey = dateKey;
    safeRun('runMorningBrief', runMorningBrief);
  }

  // Sunday = 0
  if (now.getDay() === 0 && user.weekly_preview_time === hhmm && lastPreviewKey !== dateKey) {
    lastPreviewKey = dateKey;
    safeRun('runWeeklyPreview', runWeeklyPreview);
  }
});

app.listen(PORT, () => {
  console.log(`AI Scheduling Agent server listening on http://localhost:${PORT}`);
});
