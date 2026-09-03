import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ruleFor, validateOne, validateValues, summarizeErrors,
  isDateLike, isNumberLike, MAX_TEXT, MAX_LONGTEXT,
} from '../src/lib/validate.ts';

// ---- ruleFor: 필드명 규약 추론 ----
test('ruleFor: 날짜/숫자/퍼센트/긴텍스트/이메일 추론', () => {
  assert.equal(ruleFor('dueDate').kind, 'date');
  assert.equal(ruleFor('startDate').kind, 'date');
  assert.equal(ruleFor('baselineEnd').kind, 'date');
  assert.equal(ruleFor('progress').kind, 'percent');
  assert.equal(ruleFor('qty').kind, 'int');
  assert.equal(ruleFor('unitPrice').kind, 'number');
  assert.equal(ruleFor('description').kind, 'longtext');
  assert.equal(ruleFor('email').kind, 'email');
  assert.equal(ruleFor('title').kind, 'text');
});

// ---- 비움 값은 통과(필수 검사는 required가 따로 담당) ----
test('빈 값(null·undefined·빈문자열)은 통과', () => {
  for (const v of [null, undefined, '']) {
    assert.equal(validateOne('dueDate', v), null);
    assert.equal(validateOne('qty', v), null);
  }
});

// ---- 날짜 ----
test('날짜: YYYY-MM-DD·ISO 통과, 쓰레기 문자열 차단', () => {
  assert.equal(validateOne('dueDate', '2026-09-03'), null);
  assert.equal(validateOne('dueDate', '2026-09-03T12:00:00Z'), null);
  assert.equal(validateOne('dueDate', 'not-a-date')?.code, 'TYPE');
  assert.equal(isDateLike('2026-01-01'), true);
  assert.equal(isDateLike('zzz'), false);
});

// ---- 숫자 ----
test('숫자: 숫자문자열 허용, 비숫자 차단', () => {
  assert.equal(validateOne('unitPrice', '1500'), null);
  assert.equal(validateOne('unitPrice', 1500), null);
  assert.equal(validateOne('unitPrice', 'abc')?.code, 'TYPE');
  assert.equal(isNumberLike('12.5'), true);
  assert.equal(isNumberLike('  '), false);
});

test('정수 필드: 소수 차단', () => {
  assert.equal(validateOne('qty', 3), null);
  assert.equal(validateOne('qty', 2.5)?.code, 'TYPE');
});

test('퍼센트: 0~100 범위 강제', () => {
  assert.equal(validateOne('progress', 0), null);
  assert.equal(validateOne('progress', 100), null);
  assert.equal(validateOne('progress', 101)?.code, 'RANGE');
  assert.equal(validateOne('progress', -1)?.code, 'RANGE');
});

// ---- 길이 ----
test('길이 한도: 짧은 텍스트/긴 텍스트 각각 적용', () => {
  assert.equal(validateOne('title', 'a'.repeat(MAX_TEXT)), null);
  assert.equal(validateOne('title', 'a'.repeat(MAX_TEXT + 1))?.code, 'LENGTH');
  assert.equal(validateOne('description', 'a'.repeat(MAX_TEXT + 1)), null);
  assert.equal(validateOne('description', 'a'.repeat(MAX_LONGTEXT + 1))?.code, 'LENGTH');
});

// ---- 이메일 ----
test('이메일: 형식 검사', () => {
  assert.equal(validateOne('email', 'a@b.co'), null);
  assert.equal(validateOne('email', 'a@b')?.code, 'TYPE');
});

// ---- 타입 방어(객체 주입) ----
test('텍스트 필드에 객체를 넣으면 TYPE 위반', () => {
  assert.equal(validateOne('title', { $ne: 1 } as unknown)?.code, 'TYPE');
});

// ---- 묶음 검증 + 요약 ----
test('validateValues: 위반만 모아 반환', () => {
  const errs = validateValues({ title: 'ok', progress: 200, dueDate: 'xx' });
  assert.equal(errs.length, 2);
  assert.deepEqual(errs.map((e) => e.field).sort(), ['dueDate', 'progress']);
});

test('validateValues: 정상 입력은 빈 배열', () => {
  const errs = validateValues({ title: '요구사항', progress: 50, dueDate: '2026-09-03', description: '설명' });
  assert.deepEqual(errs, []);
});

test('summarizeErrors: 1건은 그대로, 다건은 "외 N건"', () => {
  assert.equal(summarizeErrors([]), '');
  const one = validateValues({ progress: 200 });
  assert.equal(summarizeErrors(one), one[0].message);
  const two = validateValues({ progress: 200, dueDate: 'xx' });
  assert.match(summarizeErrors(two), /외 1건$/);
});
