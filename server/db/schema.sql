-- Personal AI Scheduling Agent — SQLite schema
-- This is a single-user personal app; the `users` table holds one row (id = 1)
-- representing the app owner and all of their stored/encrypted credentials.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT DEFAULT 'You',
  email TEXT,
  twilio_phone TEXT,
  morning_brief_time TEXT DEFAULT '07:00',
  weekly_preview_time TEXT DEFAULT '18:00',
  notification_preference TEXT DEFAULT 'email' CHECK (notification_preference IN ('email', 'sms', 'both')),
  free_time_buffer_hours INTEGER DEFAULT 2,
  timezone TEXT DEFAULT 'America/New_York',
  school_email_domains TEXT DEFAULT '',
  school_keywords TEXT DEFAULT 'assignment,homework,due,exam,quiz,syllabus,grade posted',

  -- Google OAuth (tokens are AES-256-GCM encrypted at rest, see services/encryption.js)
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry INTEGER,
  google_email TEXT,
  google_connected INTEGER DEFAULT 0,

  -- Twilio credentials (encrypted at rest)
  twilio_account_sid TEXT,
  twilio_auth_token TEXT,
  twilio_from_number TEXT,

  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS school_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT,
  type TEXT DEFAULT 'homework' CHECK (type IN ('homework', 'exam', 'quiz', 'project', 'other')),
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  calendar_event_id TEXT,
  gmail_message_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS work_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  role TEXT,
  location TEXT,
  calendar_event_id TEXT,
  -- Not UNIQUE: one HotSchedules email typically lists several shifts, so
  -- multiple rows legitimately share a gmail_message_id. Re-processing the
  -- same email is instead prevented via the processed_emails table.
  gmail_message_id TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT UNIQUE,
  event_title TEXT NOT NULL,
  event_date TEXT,
  event_time TEXT,
  event_location TEXT,
  organizer_email TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  calendar_event_id TEXT,
  detected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT DEFAULT 'life_balance' CHECK (type IN ('life_balance', 'conflict_resolution')),
  content TEXT NOT NULL,
  suggested_for_date TEXT,
  metadata TEXT,
  dismissed INTEGER DEFAULT 0,
  added_to_calendar INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Tracks every Gmail message id already processed by a given poller so the
-- same email is never re-parsed (RSVP / school / hotschedules pollers each
-- tag their own category).
CREATE TABLE IF NOT EXISTS processed_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('rsvp', 'school', 'hotschedules')),
  processed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(gmail_message_id, category)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, -- 'calendar' | 'rsvp' | 'school' | 'hotschedules'
  last_synced_at TEXT DEFAULT (datetime('now')),
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_school_tasks_due_date ON school_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_work_shifts_date ON work_shifts(date);
CREATE INDEX IF NOT EXISTS idx_rsvps_status ON rsvps(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_dismissed ON suggestions(dismissed);
