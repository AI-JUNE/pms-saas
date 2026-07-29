import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLine, log, MONITORING_ENABLED } from '../src/lib/logger.ts';

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
