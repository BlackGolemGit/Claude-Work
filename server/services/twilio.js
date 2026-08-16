// Twilio SMS wrapper. Uses per-user stored credentials (encrypted in SQLite)
// when present, falling back to the server's .env credentials otherwise.
const twilio = require('twilio');
const { getUser } = require('../db/db');
const { decrypt } = require('./encryption');

function resolveCredentials() {
  const user = getUser();
  const accountSid = decrypt(user.twilio_account_sid) || process.env.TWILIO_ACCOUNT_SID;
  const authToken = decrypt(user.twilio_auth_token) || process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = user.twilio_from_number || process.env.TWILIO_FROM_NUMBER;
  const toNumber = user.twilio_phone;
  return { accountSid, authToken, fromNumber, toNumber };
}

async function sendSms(body) {
  const { accountSid, authToken, fromNumber, toNumber } = resolveCredentials();

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio is not configured. Add your Account SID, Auth Token, and From number in Settings.');
  }
  if (!toNumber) {
    throw new Error('No phone number on file. Add your phone number in Settings to receive SMS notifications.');
  }

  try {
    const client = twilio(accountSid, authToken);
    await client.messages.create({
      body,
      from: fromNumber,
      to: toNumber,
    });
    return true;
  } catch (err) {
    console.error('[twilio] Failed to send SMS:', err.message);
    throw new Error(`Failed to send SMS: ${err.message}`);
  }
}

module.exports = { sendSms };
