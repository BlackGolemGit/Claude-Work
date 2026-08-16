require('../testSetup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encrypt, decrypt } = require('../services/encryption');

test('encrypt/decrypt round-trips a string', () => {
  const secret = 'sk-super-secret-value-12345';
  const encrypted = encrypt(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decrypt(encrypted), secret);
});

test('encrypt returns null for empty/nullish input', () => {
  assert.equal(encrypt(null), null);
  assert.equal(encrypt(undefined), null);
  assert.equal(encrypt(''), null);
});

test('decrypt returns null (not throw) for garbage input', () => {
  assert.equal(decrypt('not-a-valid-payload'), null);
  assert.equal(decrypt(null), null);
});

test('each encryption uses a random IV, so ciphertext differs run to run', () => {
  const a = encrypt('same-value');
  const b = encrypt('same-value');
  assert.notEqual(a, b);
  assert.equal(decrypt(a), 'same-value');
  assert.equal(decrypt(b), 'same-value');
});
