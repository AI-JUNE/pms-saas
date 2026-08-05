import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskEmail } from '../src/lib/mask.ts';

test('maskEmail: 일반 이메일은 앞 1~2자만 남기고 마스킹', () => {
  assert.equal(maskEmail('hong.gildong@example.com'), 'ho***@example.com');
  assert.equal(maskEmail('ab@x.io'), 'a***@x.io');
});
test('maskEmail: 로컬 1자는 그 1자만 노출', () => {
  assert.equal(maskEmail('a@b.com'), 'a***@b.com');
});
test('maskEmail: 이메일 형식이 아니면 원문 미노출(***)', () => {
  assert.equal(maskEmail('notanemail'), '***');
  assert.equal(maskEmail('@nodomain'), '***');
});
test('maskEmail: 공백/undefined/null은 빈 문자열', () => {
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail(undefined), '');
  assert.equal(maskEmail(null), '');
  assert.equal(maskEmail('  '), '');
});
