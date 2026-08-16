-- Personal AI Scheduling Agent — SQLite schema
-- This is a single-user personal app; the `users` table holds one row (id = 1)
-- representing the app owner's preferences. Email/calendar credentials live
-- in `email_accounts` instead, since the user can connect multiple inboxes
-- (several Google accounts and/or generic IMAP/SMTP accounts).

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

  -- Twilio credentials (encrypted at rest)
  twilio_account_sid TEXT,
  twilio_auth_token TEXT,
  twilio_from_number TEXT,

  created_at TEXT DEFAULT (datetime('now'))
);

-- Every connected inbox the agent watches. 'google' accounts authenticate via
-- OAuth2 (access/refresh tokens); 'imap' accounts authenticate via a stored
-- IMAP/SMTP username+app-password. All secrets are AES-256-GCM encrypted at
-- rest (see services/encryption.js). Exactly one Google account can be
-- flagged is_calendar_primary — that's the account Google Calendar reads and
-- writes go through (IMAP accounts have no calendar of their own).
CREATE TABLE IF NOT EXISTS email_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'imap')),
  label TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  is_calendar_primary INTEGER DEFAULT 0,

  -- Google OAuth
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expiry INTEGER,

  -- Generic IMAP (read) / SMTP (send)
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_secure INTEGER DEFAULT 1,
  imap_username TEXT,
  imap_password TEXT,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 465,
  smtp_secure INTEGER DEFAULT 1,
  smtp_username TEXT,
  smtp_password TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, email)
);

CREATE TABLE IF NOT EXISTS school_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  course TEXT,
  type TEXT DEFAULT 'homework' CHECK (type IN ('homework', 'exam', 'quiz', 'project', 'other')),
  due_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  calendar_event_id TEXT,
  message_id TEXT,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
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
  -- multiple rows legitimately share a message_id. Re-processing the
  -- same email is instead prevented via the processed_emails table.
  message_id TEXT,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rsvps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  message_id_header TEXT, -- RFC822 Message-ID, used for proper In-Reply-To/References threading
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,
  event_title TEXT NOT NULL,
  event_date TEXT,
  event_time TEXT,
  event_location TEXT,
  organizer_email TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  calendar_event_id TEXT,
  detected_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_id, message_id)
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

-- Long-term personal memory: durable facts/preferences/routines the agent
-- has learned about the user, so context (chat, briefings, suggestions)
-- keeps getting better-informed over time. Populated both by the user
-- directly (Memory tab) and by Claude via the `remember` chat tool.
CREATE TABLE IF NOT EXISTS user_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('preference', 'fact', 'routine', 'people', 'goal', 'general')),
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'chat', 'inferred')),
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tracks every message id already processed by a given poller, per account,
-- so the same email is never re-parsed (RSVP / school / hotschedules
-- pollers each tag their own category).
CREATE TABLE IF NOT EXISTS processed_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('rsvp', 'school', 'hotschedules')),
  processed_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_id, message_id, category)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, -- 'calendar' | 'rsvp' | 'school' | 'hotschedules' | 'morning_brief' | 'weekly_preview'
  last_synced_at TEXT DEFAULT (datetime('now')),
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_school_tasks_due_date ON school_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_work_shifts_date ON work_shifts(date);
CREATE INDEX IF NOT EXISTS idx_rsvps_status ON rsvps(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_dismissed ON suggestions(dismissed);
CREATE INDEX IF NOT EXISTS idx_user_memory_category ON user_memory(category);
CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active);
