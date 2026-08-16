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

// ---------------------------------------------------------------------------
// Lightweight migrations for anyone upgrading a pre-multi-account database.
// CREATE TABLE IF NOT EXISTS above won't touch tables that already exist
// with the old column names, so we patch them in place here. Every step is
// defensive (checks PRAGMA table_info first) so this is a safe no-op on a
// fresh database that already matches schema.sql.
// ---------------------------------------------------------------------------
function tableColumns(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function renameColumnIfNeeded(table, oldName, newName) {
  const cols = tableColumns(table);
  if (cols.includes(oldName) && !cols.includes(newName)) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`);
  }
}

function addColumnIfNeeded(table, name, type) {
  const cols = tableColumns(table);
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

function dropColumnIfExists(table, name) {
  const cols = tableColumns(table);
  if (cols.includes(name)) {
    try {
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
    } catch (err) {
      console.error(`[db migration] Could not drop ${table}.${name}:`, err.message);
    }
  }
}

try {
  renameColumnIfNeeded('rsvps', 'gmail_message_id', 'message_id');
  addColumnIfNeeded('rsvps', 'message_id_header', 'TEXT');
  addColumnIfNeeded('rsvps', 'account_id', 'INTEGER');

  renameColumnIfNeeded('work_shifts', 'gmail_message_id', 'message_id');
  addColumnIfNeeded('work_shifts', 'account_id', 'INTEGER');

  renameColumnIfNeeded('school_tasks', 'gmail_message_id', 'message_id');
  addColumnIfNeeded('school_tasks', 'account_id', 'INTEGER');

  renameColumnIfNeeded('processed_emails', 'gmail_message_id', 'message_id');
  addColumnIfNeeded('processed_emails', 'account_id', 'INTEGER');

  // Migrate a legacy single-account `users.google_*` credential set (from
  // before multi-account support) into a proper email_accounts row.
  const userCols = tableColumns('users');
  if (userCols.includes('google_access_token')) {
    const legacyUser = db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (legacyUser && legacyUser.google_connected && legacyUser.google_refresh_token) {
      try {
        db.prepare(
          `INSERT OR IGNORE INTO email_accounts
             (provider, label, email, is_calendar_primary, google_access_token, google_refresh_token, google_token_expiry)
           VALUES ('google', 'Primary Google Account', ?, 1, ?, ?, ?)`
        ).run(
          legacyUser.google_email || `legacy-account-${Date.now()}`,
          legacyUser.google_access_token,
          legacyUser.google_refresh_token,
          legacyUser.google_token_expiry
        );
        console.log('[db migration] Migrated legacy single Google account into email_accounts.');
      } catch (err) {
        console.error('[db migration] Failed to migrate legacy Google account:', err.message);
      }
    }
    ['google_access_token', 'google_refresh_token', 'google_token_expiry', 'google_email', 'google_connected'].forEach(
      (col) => dropColumnIfExists('users', col)
    );
  }
} catch (err) {
  console.error('[db migration] Non-fatal migration error:', err.message);
}

// Ensure the singleton user row (id = 1) always exists so every route can
// assume `getUser()` returns a record.
const existingUser = db.prepare('SELECT id FROM users WHERE id = 1').get();
if (!existingUser) {
  db.prepare(`INSERT INTO users (id, name, email) VALUES (1, 'You', NULL)`).run();
}

function getUser() {
  return db.prepare('SELECT * FROM users WHERE id = 1').get();
}

function updateUser(fields) {
  const allowed = [
    'name', 'email', 'twilio_phone', 'morning_brief_time', 'weekly_preview_time',
    'notification_preference', 'free_time_buffer_hours', 'timezone',
    'school_email_domains', 'school_keywords',
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
  // last_synced_at has only 1-second resolution, so two syncs recorded in
  // the same second would tie on that column alone — order by id (strictly
  // increasing with insertion order) as a tiebreaker so this is always the
  // actual most recent sync, not whichever tied row SQLite happens to return.
  return db
    .prepare('SELECT * FROM sync_log WHERE source = ? ORDER BY last_synced_at DESC, id DESC LIMIT 1')
    .get(source);
}

function isEmailProcessed(accountId, messageId, category) {
  const row = db
    .prepare('SELECT id FROM processed_emails WHERE account_id IS ? AND message_id = ? AND category = ?')
    .get(accountId, messageId, category);
  return !!row;
}

function markEmailProcessed(accountId, messageId, category) {
  db.prepare(
    'INSERT OR IGNORE INTO processed_emails (account_id, message_id, category) VALUES (?, ?, ?)'
  ).run(accountId, messageId, category);
}

// ---------------------------------------------------------------------------
// email_accounts
// ---------------------------------------------------------------------------

function listEmailAccounts({ activeOnly = true, provider = null } = {}) {
  let sql = 'SELECT * FROM email_accounts WHERE 1=1';
  const params = [];
  if (activeOnly) sql += ' AND is_active = 1';
  if (provider) {
    sql += ' AND provider = ?';
    params.push(provider);
  }
  sql += ' ORDER BY id ASC';
  return db.prepare(sql).all(...params);
}

function getEmailAccount(id) {
  return db.prepare('SELECT * FROM email_accounts WHERE id = ?').get(id);
}

function upsertGoogleAccount({ email, label, accessToken, refreshToken, expiry }) {
  const existing = db.prepare(`SELECT * FROM email_accounts WHERE provider = 'google' AND email = ?`).get(email);
  if (existing) {
    db.prepare(
      `UPDATE email_accounts SET google_access_token = ?, google_refresh_token = COALESCE(?, google_refresh_token), google_token_expiry = ?, is_active = 1 WHERE id = ?`
    ).run(accessToken, refreshToken, expiry, existing.id);
    return getEmailAccount(existing.id);
  }
  const anyGoogle = db.prepare(`SELECT id FROM email_accounts WHERE provider = 'google'`).get();
  const info = db
    .prepare(
      `INSERT INTO email_accounts (provider, label, email, is_calendar_primary, google_access_token, google_refresh_token, google_token_expiry)
       VALUES ('google', ?, ?, ?, ?, ?, ?)`
    )
    .run(label || email, email, anyGoogle ? 0 : 1, accessToken, refreshToken, expiry);
  return getEmailAccount(info.lastInsertRowid);
}

function updateGoogleAccountTokens(id, { accessToken, refreshToken, expiry }) {
  db.prepare(
    `UPDATE email_accounts SET google_access_token = ?, google_refresh_token = COALESCE(?, google_refresh_token), google_token_expiry = ? WHERE id = ?`
  ).run(accessToken, refreshToken, expiry, id);
}

function upsertImapAccount({ id, email, label, imap, smtp }) {
  if (id) {
    db.prepare(
      `UPDATE email_accounts SET label = ?, email = ?,
         imap_host = ?, imap_port = ?, imap_secure = ?, imap_username = ?, imap_password = COALESCE(?, imap_password),
         smtp_host = ?, smtp_port = ?, smtp_secure = ?, smtp_username = ?, smtp_password = COALESCE(?, smtp_password)
       WHERE id = ? AND provider = 'imap'`
    ).run(
      label || email, email,
      imap.host, imap.port, imap.secure ? 1 : 0, imap.username, imap.password,
      smtp.host, smtp.port, smtp.secure ? 1 : 0, smtp.username, smtp.password,
      id
    );
    return getEmailAccount(id);
  }
  const info = db
    .prepare(
      `INSERT INTO email_accounts
         (provider, label, email, imap_host, imap_port, imap_secure, imap_username, imap_password,
          smtp_host, smtp_port, smtp_secure, smtp_username, smtp_password)
       VALUES ('imap', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      label || email, email,
      imap.host, imap.port, imap.secure ? 1 : 0, imap.username, imap.password,
      smtp.host, smtp.port, smtp.secure ? 1 : 0, smtp.username, smtp.password
    );
  return getEmailAccount(info.lastInsertRowid);
}

function deleteEmailAccount(id) {
  const account = getEmailAccount(id);
  db.prepare('DELETE FROM email_accounts WHERE id = ?').run(id);
  // If we just deleted the primary calendar account, promote the next
  // remaining Google account (if any) so calendar features keep working.
  if (account?.is_calendar_primary) {
    const next = db.prepare(`SELECT id FROM email_accounts WHERE provider = 'google' ORDER BY id ASC LIMIT 1`).get();
    if (next) db.prepare('UPDATE email_accounts SET is_calendar_primary = 1 WHERE id = ?').run(next.id);
  }
}

function setCalendarPrimary(id) {
  const tx = db.transaction((accountId) => {
    db.prepare(`UPDATE email_accounts SET is_calendar_primary = 0 WHERE provider = 'google'`).run();
    db.prepare(`UPDATE email_accounts SET is_calendar_primary = 1 WHERE id = ?`).run(accountId);
  });
  tx(id);
}

function getCalendarPrimaryAccount() {
  return (
    db.prepare(`SELECT * FROM email_accounts WHERE provider = 'google' AND is_calendar_primary = 1 AND is_active = 1`).get() ||
    db.prepare(`SELECT * FROM email_accounts WHERE provider = 'google' AND is_active = 1 ORDER BY id ASC LIMIT 1`).get() ||
    null
  );
}

/** The account used to send briefings/previews/test notifications from — the
 *  calendar-primary Google account if there is one, else the first active
 *  account of any provider. */
function getNotificationAccount() {
  return (
    getCalendarPrimaryAccount() ||
    db.prepare('SELECT * FROM email_accounts WHERE is_active = 1 ORDER BY id ASC LIMIT 1').get() ||
    null
  );
}

// ---------------------------------------------------------------------------
// user_memory
// ---------------------------------------------------------------------------

function listMemories({ category = null } = {}) {
  let sql = 'SELECT * FROM user_memory WHERE 1=1';
  const params = [];
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY pinned DESC, updated_at DESC';
  return db.prepare(sql).all(...params);
}

function addMemory({ content, category = 'general', source = 'manual' }) {
  const info = db
    .prepare('INSERT INTO user_memory (content, category, source) VALUES (?, ?, ?)')
    .run(content, category, source);
  return db.prepare('SELECT * FROM user_memory WHERE id = ?').get(info.lastInsertRowid);
}

function updateMemory(id, fields) {
  const allowed = ['content', 'category', 'pinned'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return db.prepare('SELECT * FROM user_memory WHERE id = ?').get(id);
  const setClause = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE user_memory SET ${setClause}, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id });
  return db.prepare('SELECT * FROM user_memory WHERE id = ?').get(id);
}

function deleteMemory(id) {
  db.prepare('DELETE FROM user_memory WHERE id = ?').run(id);
}

module.exports = {
  db,
  getUser,
  updateUser,
  recordSync,
  getLastSync,
  isEmailProcessed,
  markEmailProcessed,
  listEmailAccounts,
  getEmailAccount,
  upsertGoogleAccount,
  updateGoogleAccountTokens,
  upsertImapAccount,
  deleteEmailAccount,
  setCalendarPrimary,
  getCalendarPrimaryAccount,
  getNotificationAccount,
  listMemories,
  addMemory,
  updateMemory,
  deleteMemory,
};
