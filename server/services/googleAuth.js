// Handles Google OAuth 2.0 for potentially several connected Google
// accounts: consent URL generation, code exchange, and automatic
// refresh-token based renewal of access tokens for Calendar + Gmail.
const { google } = require('googleapis');
const {
  listEmailAccounts,
  getEmailAccount,
  upsertGoogleAccount,
  updateGoogleAccountTokens,
  getCalendarPrimaryAccount,
} = require('../db/db');
const { encrypt, decrypt } = require('./encryption');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/** Generates the consent URL. Always forces the account chooser so adding a
 *  second/third Google account doesn't silently reuse the last session. */
function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account', // ensures a refresh_token is returned every time, and lets the user pick which Google account
    scope: SCOPES,
  });
}

async function handleOAuthCallback(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ auth: client, version: 'v2' });
  const { data } = await oauth2.userinfo.get();
  const email = data.email;

  const account = upsertGoogleAccount({
    email,
    label: email,
    accessToken: encrypt(tokens.access_token),
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    expiry: tokens.expiry_date || null,
  });

  return { email, accountId: account.id };
}

/**
 * Returns an OAuth2 client authenticated for a specific email_accounts row,
 * refreshing the access token automatically (and persisting the new one)
 * whenever it's missing or expired.
 */
async function getClientForAccount(account) {
  if (!account || account.provider !== 'google') {
    const err = new Error('That account is not a connected Google account.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }
  const refreshToken = decrypt(account.google_refresh_token);
  if (!refreshToken) {
    const err = new Error(`Google account ${account.email} is missing a refresh token — please reconnect it in Settings.`);
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const client = createOAuthClient();
  client.setCredentials({
    access_token: decrypt(account.google_access_token),
    refresh_token: refreshToken,
    expiry_date: account.google_token_expiry,
  });

  const isExpired = !account.google_token_expiry || Date.now() >= account.google_token_expiry - 60000;
  if (isExpired) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);
    updateGoogleAccountTokens(account.id, {
      accessToken: encrypt(credentials.access_token),
      refreshToken: credentials.refresh_token ? encrypt(credentials.refresh_token) : null,
      expiry: credentials.expiry_date || null,
    });
  }

  client.on('tokens', (tokens) => {
    if (!tokens.access_token && !tokens.refresh_token) return;
    updateGoogleAccountTokens(account.id, {
      accessToken: tokens.access_token ? encrypt(tokens.access_token) : decrypt(account.google_access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      expiry: tokens.expiry_date || account.google_token_expiry,
    });
  });

  return client;
}

/** All connected Google accounts (used by the Gmail-polling jobs to scan every inbox). */
function listGoogleAccounts() {
  return listEmailAccounts({ provider: 'google' });
}

/** The single Google account Calendar operations go through. */
async function getAuthenticatedClient() {
  const account = getCalendarPrimaryAccount();
  if (!account) {
    const err = new Error('No Google account is connected. Connect one from Settings.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }
  return getClientForAccount(account);
}

module.exports = {
  getAuthUrl,
  handleOAuthCallback,
  getClientForAccount,
  listGoogleAccounts,
  getAuthenticatedClient,
  SCOPES,
};
