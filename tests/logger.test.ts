import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLine, log, MONITORING_ENABLED, redact, newRequestId, ALERTS_ENABLED, parseDsn, buildEnvelope } from '../src/lib/logger.ts';

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

test('parseDsn builds the Sentry envelope endpoint from a DSN', () => {
  const t = parseDsn('https://abc123@o55.ingest.sentry.io/4507')!;
  assert.equal(t.publicKey, 'abc123');
  assert.equal(t.projectId, '4507');
  assert.equal(t.envelopeUrl, 'https://o55.ingest.sentry.io/api/4507/envelope/');
});

test('parseDsn returns null for missing/garbage DSNs (stays no-op)', () => {
  for (const bad of [undefined, null, '', 'not-a-url', 'https://o55.ingest.sentry.io/4507', 'https://key@host/abc']) {
    assert.equal(parseDsn(bad as any), null, `expected null for ${String(bad)}`);
  }
});

test('buildEnvelope emits 3 NDJSON lines with matching event_id', () => {
  const lines = buildEnvelope(new Error('boom'), { path: '/api/x' }, 'a'.repeat(32)).split('\n');
  assert.equal(lines.length, 3);
  const header = JSON.parse(lines[0]);
  const itemHeader = JSON.parse(lines[1]);
  const event = JSON.parse(lines[2]);
  assert.equal(header.event_id, 'a'.repeat(32));
  assert.equal(itemHeader.type, 'event');
  assert.equal(event.event_id, 'a'.repeat(32));
  assert.equal(event.level, 'error');
  assert.equal(event.exception.values[0].type, 'Error');
  assert.equal(event.exception.values[0].value, 'boom');
  assert.equal(event.extra.path, '/api/x');
});

test('buildEnvelope redacts PII in context before transport', () => {
  const event = JSON.parse(buildEnvelope(new Error('x'), { email: 'a@b.com', durMs: 5 }).split('\n')[2]);
  assert.equal(event.extra.email, '[redacted]');
  assert.equal(event.extra.durMs, 5);
});
