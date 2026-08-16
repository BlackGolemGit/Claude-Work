#!/usr/bin/env node
// Backend concurrency/load test. Boots the real Express app in-process
// against an isolated throwaway SQLite DB (never the developer's real one)
// and hammers it with autocannon. This deliberately does NOT touch live
// Google/Gmail/Twilio/Anthropic APIs — those calls fail fast with a
// friendly error when unconfigured, which is exactly the path this
// exercises under concurrency (routes must degrade gracefully, never
// crash or hang, when hit hard).
//
// Usage: npm run loadtest  (from /server)
const path = require('path');
const fs = require('fs');

const TEST_DB = path.join(__dirname, 'loadtest.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(TEST_DB + suffix); } catch { /* fine */ }
}

process.env.ENCRYPTION_SECRET = 'loadtest-encryption-secret';
process.env.ANTHROPIC_API_KEY = 'sk-ant-loadtest-dummy';
process.env.GOOGLE_CLIENT_ID = 'loadtest-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'loadtest-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/settings/google/callback';
process.env.DB_PATH = TEST_DB;
process.env.CLIENT_URL = 'http://localhost:5173';

const autocannon = require('autocannon');
const app = require('../index');

const PORT = 3097;
const DURATION_SECONDS = Number(process.argv[2] || 15);
const CONNECTIONS = Number(process.argv[3] || 50);

const ENDPOINTS = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/settings' },
  { method: 'GET', path: '/api/settings/accounts' },
  { method: 'GET', path: '/api/memory' },
  { method: 'GET', path: '/api/school/tasks?filter=all' },
  { method: 'GET', path: '/api/hotschedules/shifts' },
  { method: 'GET', path: '/api/gmail/rsvps' },
  { method: 'GET', path: '/api/chat/history' },
  { method: 'GET', path: '/api/calendar/today' }, // expected to 409 fast (no Google connected) — proves graceful degradation under load
];

async function run() {
  const server = app.listen(PORT);
  console.log(`\nLoad-testing the backend at http://localhost:${PORT}`);
  console.log(`Duration: ${DURATION_SECONDS}s per endpoint · Connections: ${CONNECTIONS}\n`);

  const results = [];
  for (const endpoint of ENDPOINTS) {
    process.stdout.write(`→ ${endpoint.method} ${endpoint.path} ... `);
    const result = await autocannon({
      url: `http://localhost:${PORT}${endpoint.path}`,
      method: endpoint.method,
      connections: CONNECTIONS,
      duration: DURATION_SECONDS,
    });
    results.push({ endpoint: endpoint.path, ...result });
    const errorRate = ((result.non2xx + result.errors) / result.requests.total * 100).toFixed(2);
    console.log(
      `${result.requests.total} reqs · ${result.requests.average.toFixed(0)} req/s avg · ` +
      `p50 ${result.latency.p50}ms · p99 ${result.latency.p99}ms · ${errorRate}% non-2xx/error`
    );
  }

  console.log('\n=== Summary ===');
  let anyFailed = false;
  for (const r of results) {
    const total = r.requests.total;
    const bad = r.non2xx + r.errors;
    const errorRate = total ? (bad / total) * 100 : 0;
    // A high error rate under load, or the process timing out/crashing (which
    // would show up as connection errors), is the real failure signal here —
    // 409s from unconfigured Google/etc are expected and already 2xx-excluded
    // is fine since we're checking the process stayed responsive, not that
    // every route succeeded functionally.
    if (r.errors > 0) {
      anyFailed = true;
      console.log(`✗ ${r.endpoint}: ${r.errors} connection errors (timeouts/resets) — investigate`);
    } else {
      console.log(`✓ ${r.endpoint}: stayed responsive under load (0 connection errors, p99 ${r.latency.p99}ms)`);
    }
  }

  server.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TEST_DB + suffix); } catch { /* fine */ }
  }

  if (anyFailed) {
    console.log('\nLoad test found connection-level failures under concurrency.');
    process.exit(1);
  }
  console.log('\nAll endpoints stayed responsive under concurrent load. ✅');
}

run().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
