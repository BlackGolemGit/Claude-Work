// HTTP-level tests against the real Express app (no real Google/Twilio/
// Anthropic calls are made — every assertion here only exercises endpoints
// that either need no external service, or verifies the app degrades to a
// friendly error instead of crashing when an external service isn't
// configured, matching how a fresh install actually behaves.
require('../testSetup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../index');

test('GET /api/health', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('GET /api/settings returns defaults on a fresh install', async () => {
  const res = await request(app).get('/api/settings');
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.notification_preference, 'email');
  assert.equal(res.body.settings.twilio_configured, false);
});

test('PUT /api/settings persists changes', async () => {
  const res = await request(app)
    .put('/api/settings')
    .send({ name: 'Jordan', free_time_buffer_hours: 3, timezone: 'America/Chicago' });
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.name, 'Jordan');
  assert.equal(res.body.settings.free_time_buffer_hours, 3);

  const check = await request(app).get('/api/settings');
  assert.equal(check.body.settings.name, 'Jordan');
});

test('PUT /api/settings never persists a blank Twilio secret over a saved one', async () => {
  await request(app).put('/api/settings').send({ twilio_account_sid: 'ACtest123', twilio_auth_token: 'tokentest' });
  const first = await request(app).get('/api/settings');
  assert.equal(first.body.settings.twilio_configured, true);

  // Sending an unrelated update with no twilio fields must not wipe them.
  await request(app).put('/api/settings').send({ name: 'Still Jordan' });
  const second = await request(app).get('/api/settings');
  assert.equal(second.body.settings.twilio_configured, true);
});

test('GET /api/settings/accounts starts empty and never leaks secrets', async () => {
  const res = await request(app).get('/api/settings/accounts');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.accounts, []);
});

test('POST /api/settings/accounts/imap adds an account without echoing the password', async () => {
  const res = await request(app)
    .post('/api/settings/accounts/imap')
    .send({
      email: 'me@outlook.com',
      label: 'Outlook',
      imap: { host: 'outlook.office365.com', port: 993, secure: true, username: 'me@outlook.com', password: 'super-secret-app-password' },
      smtp: { host: 'smtp.office365.com', port: 587, secure: false, username: 'me@outlook.com', password: 'super-secret-app-password' },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.account.provider, 'imap');
  assert.equal(res.body.account.email, 'me@outlook.com');
  assert.equal(JSON.stringify(res.body.account).includes('super-secret-app-password'), false);

  const list = await request(app).get('/api/settings/accounts');
  assert.equal(list.body.accounts.length, 1);
});

test('POST /api/settings/accounts/imap rejects a missing host', async () => {
  const res = await request(app)
    .post('/api/settings/accounts/imap')
    .send({ email: 'me@outlook.com', imap: { username: 'me@outlook.com' } });
  assert.equal(res.status, 400);
});

test('memory CRUD via HTTP', async () => {
  const create = await request(app).post('/api/memory').send({ content: 'Prefers evening study sessions', category: 'preference' });
  assert.equal(create.status, 200);
  const id = create.body.memory.id;

  const list = await request(app).get('/api/memory');
  assert.ok(list.body.memories.some((m) => m.id === id));

  const pin = await request(app).put(`/api/memory/${id}`).send({ pinned: true });
  assert.equal(pin.body.memory.pinned, 1);

  const del = await request(app).delete(`/api/memory/${id}`);
  assert.equal(del.status, 200);
  const after = await request(app).get('/api/memory');
  assert.ok(!after.body.memories.some((m) => m.id === id));
});

test('memory creation rejects empty content', async () => {
  const res = await request(app).post('/api/memory').send({ content: '   ' });
  assert.equal(res.status, 400);
});

test('GET /api/calendar/today returns a friendly 409 with no Google account connected (never a 500/crash)', async () => {
  const res = await request(app).get('/api/calendar/today');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Google account/i);
});

test('GET /api/school/tasks and /api/hotschedules/shifts return empty arrays, not errors, on a fresh install', async () => {
  const school = await request(app).get('/api/school/tasks?filter=all');
  assert.equal(school.status, 200);
  assert.deepEqual(school.body.tasks, []);

  const shifts = await request(app).get('/api/hotschedules/shifts');
  assert.equal(shifts.status, 200);
  assert.deepEqual(shifts.body.shifts, []);
});

test('GET /api/chat/history returns an empty array on a fresh install', async () => {
  const res = await request(app).get('/api/chat/history');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.history, []);
});

test('POST /api/notifications/test degrades gracefully with no accounts configured', async () => {
  const res = await request(app).post('/api/notifications/test');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.results.email, /failed/);
});

test('unknown route returns 404, not a crash', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
});

test('malformed JSON body is rejected with 4xx, not a 500', async () => {
  const res = await request(app)
    .put('/api/settings')
    .set('Content-Type', 'application/json')
    .send('{not valid json');
  assert.ok(res.status >= 400 && res.status < 500);
});
