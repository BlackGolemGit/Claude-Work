const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'scheduler.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema (idempotent — every statement uses CREATE TABLE IF NOT EXISTS)
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

// Ensure the singleton user row (id = 1) always exists so every route can
// assume `getUser()` returns a record.
const existingUser = db.prepare('SELECT id FROM users WHERE id = 1').get();
if (!existingUser) {
  db.prepare(
    `INSERT INTO users (id, name, email) VALUES (1, 'You', NULL)`
  ).run();
}

function getUser() {
  return db.prepare('SELECT * FROM users WHERE id = 1').get();
}

function updateUser(fields) {
  const allowed = [
    'name', 'email', 'twilio_phone', 'morning_brief_time', 'weekly_preview_time',
    'notification_preference', 'free_time_buffer_hours', 'timezone',
    'school_email_domains', 'school_keywords',
    'google_access_token', 'google_refresh_token', 'google_token_expiry',
    'google_email', 'google_connected',
    'twilio_account_sid', 'twilio_auth_token', 'twilio_from_number',
  ];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return getUser();
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = 1`).run(fields);
  return getUser();
}

function recordSync(source, detail = null) {
  db.prepare('INSERT INTO sync_log (source, detail) VALUES (?, ?)').run(source, detail);
}

function getLastSync(source) {
  return db
    .prepare('SELECT * FROM sync_log WHERE source = ? ORDER BY last_synced_at DESC LIMIT 1')
    .get(source);
}

function isEmailProcessed(gmailMessageId, category) {
  const row = db
    .prepare('SELECT id FROM processed_emails WHERE gmail_message_id = ? AND category = ?')
    .get(gmailMessageId, category);
  return !!row;
}

function markEmailProcessed(gmailMessageId, category) {
  db.prepare(
    'INSERT OR IGNORE INTO processed_emails (gmail_message_id, category) VALUES (?, ?)'
  ).run(gmailMessageId, category);
}

module.exports = {
  db,
  getUser,
  updateUser,
  recordSync,
  getLastSync,
  isEmailProcessed,
  markEmailProcessed,
};
