import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';

test('round-trip: hashed password verifies', () => {
  const h = hashPassword('correct horse battery');
  assert.equal(verifyPassword('correct horse battery', h), true);
});

test('wrong password fails verification', () => {
  const h = hashPassword('secret-123');
  assert.equal(verifyPassword('secret-124', h), false);
  assert.equal(verifyPassword('', h), false);
});

test('same password hashes differently (random salt) but both verify', () => {
  const a = hashPassword('dup-pass'); const b = hashPassword('dup-pass');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('dup-pass', a), true);
  assert.equal(verifyPassword('dup-pass', b), true);
});

test('malformed stored values fail closed (no throw)', () => {
  for (const bad of ['', ':', 'nocolon', 'salt:', ':hash']) {
    assert.equal(verifyPassword('anything', bad), false, `should reject "${bad}"`);
  }
});

test('stored format is salt:hash hex', () => {
  const h = hashPassword('fmt-check');
  const [salt, hash] = h.split(':');
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.match(hash, /^[0-9a-f]{128}$/);
});
