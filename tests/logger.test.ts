import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLine, log, MONITORING_ENABLED, redact, newRequestId, ALERTS_ENABLED } from '../src/lib/logger.ts';

test('formatLine emits valid JSON with required keys', () => {
  const obj = JSON.parse(formatLine('info', 'hello', { a: 1 }));
  assert.equal(obj.level, 'info');
  assert.equal(obj.msg, 'hello');
  assert.equal(obj.a, 1);
  assert.ok(typeof obj.ts === 'string' && obj.ts.includes('T'));
});

test('formatLine drops undefined fields', () => {
  const obj = JSON.parse(formatLine('warn', 'm', { keep: 'y', skip: undefined }));
  assert.equal(obj.keep, 'y');
  assert.ok(!('skip' in obj));
});

test('monitoring is OFF by default (no env)', () => {
  assert.equal(MONITORING_ENABLED, false);
});

test('log object exposes all levels', () => {
  for (const k of ['debug', 'info', 'warn', 'error'] as const) {
    assert.equal(typeof (log as any)[k], 'function');
  }
});

test('redact masks PII-looking field names, keeps others', () => {
  const out = redact({ email: 'a@b.com', password: 'x', token: 't', durMs: 12, path: '/api/x' })!;
  assert.equal(out.email, '[redacted]');
  assert.equal(out.password, '[redacted]');
  assert.equal(out.token, '[redacted]');
  assert.equal(out.durMs, 12);
  assert.equal(out.path, '/api/x');
});

test('redact matches case/separator variants and drops undefined', () => {
  const out = redact({ Access_Token: 'v', 'billing-key': 'k', gone: undefined })!;
  assert.equal(out.Access_Token, '[redacted]');
  assert.equal(out['billing-key'], '[redacted]');
  assert.ok(!('gone' in out));
});

test('newRequestId reuses safe incoming ids and rejects unsafe ones', () => {
  assert.equal(newRequestId('abc-123_XY.z'), 'abc-123_XY.z');
  assert.notEqual(newRequestId('bad id with spaces'), 'bad id with spaces');
  assert.notEqual(newRequestId('x'.repeat(200)).length, 200);
  assert.ok(newRequestId().length > 0);
  assert.notEqual(newRequestId(), newRequestId());
});

test('alerting is OFF by default (build now, activate on approval)', () => {
  assert.equal(ALERTS_ENABLED, false);
  assert.equal(MONITORING_ENABLED, false);
});
