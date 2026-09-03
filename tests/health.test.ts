import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeError,
  shortCommit,
  buildInfo,
  summarize,
  statusCode,
  buildHealthBody,
  type Checks,
} from '../src/lib/health.ts';

test('sanitizeError removes connection strings and credentials', () => {
  const msg = sanitizeError(new Error('connect ECONNREFUSED postgres://admin:s3cret@db.internal:5432/pms'));
  assert.ok(!msg.includes('s3cret'), '비밀번호가 남아 있으면 안 된다');
  assert.ok(!msg.includes('db.internal'), '내부 호스트가 남아 있으면 안 된다');
  assert.ok(msg.includes('[redacted-url]'));
});

test('sanitizeError redacts long tokens and truncates', () => {
  const token = 'a'.repeat(40);
  assert.ok(sanitizeError(`key ${token} invalid`).includes('[redacted-token]'));
  const long = sanitizeError('x'.repeat(500));
  assert.ok(long.length <= 161, `길이 제한 초과: ${long.length}`);
});

test('sanitizeError falls back for empty/unknown input', () => {
  assert.equal(sanitizeError(undefined), '오류');
  assert.equal(sanitizeError('   '), '오류');
});

test('shortCommit trims to 7 chars and handles null', () => {
  assert.equal(shortCommit('0123456789abcdef'), '0123456');
  assert.equal(shortCommit(null), null);
  assert.equal(shortCommit(''), null);
});

test('buildInfo reads version/commit/branch/env/region from env', () => {
  const info = buildInfo({
    APP_VERSION: '1.2.3',
    VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
    VERCEL_GIT_COMMIT_REF: 'main',
    VERCEL_ENV: 'production',
    VERCEL_REGION: 'icn1',
  });
  assert.deepEqual(info, {
    version: '1.2.3',
    commit: 'abcdef1',
    branch: 'main',
    env: 'production',
    region: 'icn1',
  });
});

test('buildInfo never invents missing metadata', () => {
  const info = buildInfo({});
  assert.equal(info.commit, null);
  assert.equal(info.branch, null);
  assert.equal(info.region, null);
});

test('summarize: required failure => down, optional failure => degraded', () => {
  const allOk: Checks = { db: { ok: true, required: true }, billing: { ok: true, required: false } };
  assert.equal(summarize(allOk), 'ok');

  const optionalBad: Checks = { db: { ok: true, required: true }, billing: { ok: false, required: false } };
  assert.equal(summarize(optionalBad), 'degraded');

  const requiredBad: Checks = { db: { ok: false, required: true }, billing: { ok: false, required: false } };
  assert.equal(summarize(requiredBad), 'down');
});

test('statusCode maps down->503 and ok/degraded->200', () => {
  assert.equal(statusCode('ok'), 200);
  assert.equal(statusCode('degraded'), 200);
  assert.equal(statusCode('down'), 503);
});

test('buildHealthBody assembles a stable public shape', () => {
  const body = buildHealthBody({
    checks: { db: { ok: true, required: true, latencyMs: 3 } },
    uptimeSec: 12.6,
    now: new Date('2026-09-03T00:00:00.000Z'),
    env: { APP_VERSION: '0.12.0', GIT_COMMIT_SHA: 'deadbeefcafe', NODE_ENV: 'test' },
  });
  assert.equal(body.ok, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'prism-pms');
  assert.equal(body.version, '0.12.0');
  assert.equal(body.commit, 'deadbee');
  assert.equal(body.env, 'test');
  assert.equal(body.uptimeSec, 13);
  assert.equal(body.time, '2026-09-03T00:00:00.000Z');
  assert.equal(body.checks.db?.latencyMs, 3);
});

test('buildHealthBody reports ok:false only when a required check fails', () => {
  const down = buildHealthBody({
    checks: { db: { ok: false, required: true, error: 'x' } },
    uptimeSec: 0,
    env: {},
  });
  assert.equal(down.ok, false);
  assert.equal(statusCode(down.status), 503);

  const degraded = buildHealthBody({
    checks: { db: { ok: true, required: true }, billing: { ok: false, required: false } },
    uptimeSec: 0,
    env: {},
  });
  assert.equal(degraded.ok, true);
  assert.equal(degraded.status, 'degraded');
  assert.equal(statusCode(degraded.status), 200);
});
