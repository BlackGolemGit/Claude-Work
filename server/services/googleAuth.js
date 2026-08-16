// Handles Google OAuth 2.0: consent URL generation, code exchange, and
// automatic refresh-token based renewal of access tokens for Calendar + Gmail.
const { google } = require('googleapis');
const { getUser, updateUser } = require('../db/db');
const { encrypt, decrypt } = require('./encryption');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures a refresh_token is returned every time
    scope: SCOPES,
  });
}

async function handleOAuthCallback(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Fetch the connected Google account's email for display in Settings.
  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  let email = null;
  try {
    const { data } = await oauth2.userinfo.get();
    email = data.email;
  } catch (err) {
    console.error('[googleAuth] Failed to fetch userinfo:', err.message);
  }

  updateUser({
    google_access_token: encrypt(tokens.access_token),
    google_refresh_token: tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : getUser().google_refresh_token, // keep existing refresh token if Google didn't send a new one
    google_token_expiry: tokens.expiry_date || null,
    google_email: email,
    google_connected: 1,
  });

  return { email };
}

function disconnectGoogle() {
  updateUser({
    google_access_token: null,
    google_refresh_token: null,
    google_token_expiry: null,
    google_email: null,
    google_connected: 0,
  });
}

/**
 * Returns an OAuth2 client authenticated for the current user, refreshing
 * the access token automatically (and persisting the new one) whenever it's
 * missing or expired. Throws a friendly error if Google isn't connected.
 */
async function getAuthenticatedClient() {
  const user = getUser();
  if (!user.google_connected || !user.google_refresh_token) {
    const err = new Error('Google account is not connected. Connect it from Settings.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const client = createOAuthClient();
  const refreshToken = decrypt(user.google_refresh_token);
  const accessToken = decrypt(user.google_access_token);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: user.google_token_expiry,
  });

  const isExpired = !user.google_token_expiry || Date.now() >= user.google_token_expiry - 60000;
  if (isExpired) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    updateUser({
      google_access_token: encrypt(credentials.access_token),
      google_token_expiry: credentials.expiry_date || null,
      google_refresh_token: credentials.refresh_token
        ? encrypt(credentials.refresh_token)
        : user.google_refresh_token,
    });
  }

  // Keep client refreshed transparently on any future 401s too.
  client.on('tokens', (tokens) => {
    const patch = {};
    if (tokens.access_token) patch.google_access_token = encrypt(tokens.access_token);
    if (tokens.expiry_date) patch.google_token_expiry = tokens.expiry_date;
    if (tokens.refresh_token) patch.google_refresh_token = encrypt(tokens.refresh_token);
    if (Object.keys(patch).length) updateUser(patch);
  });

  return client;
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  disconnectGoogle,
  getAuthenticatedClient,
};
