require('../testSetup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/db');

test('getUser returns the singleton row with defaults', () => {
  const user = db.getUser();
  assert.equal(user.id, 1);
  assert.equal(user.notification_preference, 'email');
  assert.equal(user.free_time_buffer_hours, 2);
});

test('updateUser only touches allowlisted fields', () => {
  const updated = db.updateUser({ name: 'Alex', free_time_buffer_hours: 4, id: 999, google_connected: 1 });
  assert.equal(updated.name, 'Alex');
  assert.equal(updated.free_time_buffer_hours, 4);
  assert.equal(updated.id, 1); // ignored — not in the allowlist
});

test('email_accounts: upsertGoogleAccount inserts then updates, first account becomes calendar-primary', () => {
  const first = db.upsertGoogleAccount({ email: 'alex@gmail.com', label: 'Personal', accessToken: 'enc-access', refreshToken: 'enc-refresh', expiry: 123 });
  assert.equal(first.is_calendar_primary, 1);

  const second = db.upsertGoogleAccount({ email: 'alex.work@gmail.com', label: 'Work', accessToken: 'enc-access-2', refreshToken: 'enc-refresh-2', expiry: 456 });
  assert.equal(second.is_calendar_primary, 0); // a primary already exists

  const reupserted = db.upsertGoogleAccount({ email: 'alex@gmail.com', label: 'Personal', accessToken: 'enc-access-new', refreshToken: null, expiry: 789 });
  assert.equal(reupserted.id, first.id);
  assert.equal(reupserted.google_access_token, 'enc-access-new');
  assert.equal(reupserted.google_refresh_token, 'enc-refresh'); // preserved since null was passed

  const accounts = db.listEmailAccounts({ provider: 'google' });
  assert.equal(accounts.length, 2);
});

test('setCalendarPrimary flips exactly one google account', () => {
  const accounts = db.listEmailAccounts({ provider: 'google' });
  db.setCalendarPrimary(accounts[1].id);
  const after = db.listEmailAccounts({ provider: 'google' });
  const primaries = after.filter((a) => a.is_calendar_primary);
  assert.equal(primaries.length, 1);
  assert.equal(primaries[0].id, accounts[1].id);
});

test('deleteEmailAccount promotes another google account to primary if the primary is removed', () => {
  const accounts = db.listEmailAccounts({ provider: 'google' });
  const primary = accounts.find((a) => a.is_calendar_primary);
  db.deleteEmailAccount(primary.id);
  const remaining = db.listEmailAccounts({ provider: 'google' });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].is_calendar_primary, 1);
});

test('upsertImapAccount inserts an IMAP account with imap+smtp fields', () => {
  const account = db.upsertImapAccount({
    email: 'me@outlook.com',
    label: 'Outlook',
    imap: { host: 'outlook.office365.com', port: 993, secure: true, username: 'me@outlook.com', password: 'enc-pw' },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false, username: 'me@outlook.com', password: 'enc-pw' },
  });
  assert.equal(account.provider, 'imap');
  assert.equal(account.imap_host, 'outlook.office365.com');
  assert.equal(account.smtp_host, 'smtp.office365.com');
});

test('isEmailProcessed / markEmailProcessed dedupe per account+category', () => {
  const accounts = db.listEmailAccounts({ activeOnly: false });
  const accountId = accounts[0].id;
  assert.equal(db.isEmailProcessed(accountId, 'msg-1', 'rsvp'), false);
  db.markEmailProcessed(accountId, 'msg-1', 'rsvp');
  assert.equal(db.isEmailProcessed(accountId, 'msg-1', 'rsvp'), true);
  // Different category for the same message id is independent.
  assert.equal(db.isEmailProcessed(accountId, 'msg-1', 'school'), false);
});

test('user_memory CRUD', () => {
  const memory = db.addMemory({ content: 'Likes morning workouts', category: 'routine', source: 'manual' });
  assert.equal(memory.pinned, 0);

  const updated = db.updateMemory(memory.id, { pinned: 1 });
  assert.equal(updated.pinned, 1);

  const list = db.listMemories({ category: 'routine' });
  assert.ok(list.some((m) => m.id === memory.id));

  db.deleteMemory(memory.id);
  const afterDelete = db.listMemories({ category: 'routine' });
  assert.ok(!afterDelete.some((m) => m.id === memory.id));
});

test('recordSync / getLastSync tracks the most recent sync per source', () => {
  db.recordSync('rsvp', 'first sync');
  db.recordSync('rsvp', 'second sync');
  const last = db.getLastSync('rsvp');
  assert.equal(last.detail, 'second sync');
});
