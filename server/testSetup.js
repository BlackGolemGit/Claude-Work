// Required as the very first line of every test/*.test.js file (before any
// require of server code) so env vars and an isolated test DB are in place
// before anything reads them. Deliberately kept outside the test/ directory
// so Node's test runner doesn't also try to run it as a test file itself.
const path = require('path');
const fs = require('fs');

process.env.ENCRYPTION_SECRET = 'test-encryption-secret-do-not-use-in-prod';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-dummy-key';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3001/api/settings/google/callback';
process.env.PORT = '3098';
process.env.CLIENT_URL = 'http://localhost:5173';

const TEST_DB = path.join(__dirname, 'test.sqlite');
process.env.DB_PATH = TEST_DB;

for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.unlinkSync(TEST_DB + suffix);
  } catch {
    // fine if it doesn't exist yet
  }
}
