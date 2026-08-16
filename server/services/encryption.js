// AES-256-GCM encryption for credentials/tokens stored at rest in SQLite
// (Google OAuth tokens, Twilio Account SID / Auth Token).
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM
const SALT = 'ai-scheduling-agent-static-salt'; // fine for a local single-user key derivation

function getKey() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      'ENCRYPTION_SECRET is not set. Add it to your server/.env file before storing credentials.'
    );
  }
  return crypto.scryptSync(secret, SALT, 32);
}

/**
 * Encrypts a plaintext string into a single base64 payload: iv + authTag + ciphertext.
 * Returns null when given a null/undefined/empty value (so optional fields stay empty).
 */
function encrypt(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return null;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Reverses encrypt(). Returns null for empty input, and null (rather than
 * throwing) if the payload is malformed/undecryptable, so callers can treat
 * a broken/missing credential the same as a missing one.
 */
function decrypt(payload) {
  if (payload === null || payload === undefined || payload === '') return null;
  try {
    const key = getKey();
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
    const encrypted = buf.subarray(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[encryption] Failed to decrypt payload:', err.message);
    return null;
  }
}

module.exports = { encrypt, decrypt };
