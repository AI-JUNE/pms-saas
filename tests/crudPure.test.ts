import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickInsertFields, missingRequired, pickPatchFields, needsApprove,
  computeJournalChanges, RISK_TRANSFORM, DOCUMENTS_TRANSFORM,
} from '../src/lib/crudPure.ts';

// ---- pickInsertFields (POST) ----
test('insert: undefined·빈문자열 제외, null·0·false 유지', () => {
  const v = pickInsertFields(['a','b','c','d','e','f'], { a: 'x', b: undefined, c: '', d: null, e: 0, f: false });
  assert.deepEqual(v, { a: 'x', d: null, e: 0, f: false });
});

test('insert: fields 목록에 없는 키는 무시(허용 필드 화이트리스트)', () => {
  const v = pickInsertFields(['a'], { a: 1, hack: 'x', orgId: 999 });
  assert.deepEqual(v, { a: 1 });
});

// ---- missingRequired ----
test('required: undefined·빈문자열은 누락, null·0은 통과(기존 동작 보존)', () => {
  assert.deepEqual(missingRequired(['a','b','c','d'], { a: undefined, b: '', c: null, d: 0 }), ['a','b']);
});

test('required: 미지정이면 항상 통과', () => {
  assert.deepEqual(missingRequired(undefined, {}), []);
});

// ---- pickPatchFields (PATCH) ----
test('patch: undefined·null·빈문자열 모두 제외, 0·false 유지', () => {
  const p = pickPatchFields(['a','b','c','d','e'], { a: 'x', b: undefined, c: null, d: '', e: 0 });
  assert.deepEqual(p, { a: 'x', e: 0 });
});

// ---- needsApprove (결재 경계) ----
test('approve: 확정값(approved/rejected)으로 바꾸면 approve 권한 필요', () => {
  const cfg = { field: 'status', values: ['approved','rejected'] };
  assert.equal(needsApprove(cfg, { status: 'approved' }), true);
  assert.equal(needsApprove(cfg, { status: 'rejected' }), true);
});

test('approve: 일반 값·미포함 필드·설정 없음이면 불필요', () => {
  const cfg = { field: 'status', values: ['approved'] };
  assert.equal(needsApprove(cfg, { status: 'draft' }), false);
  assert.equal(needsApprove(cfg, { title: 'x' }), false);
  assert.equal(needsApprove(undefined, { status: 'approved' }), false);
});

// ---- computeJournalChanges (이슈 이력 diff) ----
test('journal: patch에 포함되고 값이 바뀐 필드만 기록', () => {
  const ch = computeJournalChanges(['title','status'], { status: 'closed' },
    { title: 'A', status: 'open' }, { title: 'A', status: 'closed' });
  assert.deepEqual(ch, [{ field: 'status', from: 'open', to: 'closed' }]);
});

test('journal: patch에 없는 필드는 값이 달라도 기록 안 함', () => {
  const ch = computeJournalChanges(['title'], {}, { title: 'A' }, { title: 'B' });
  assert.deepEqual(ch, []);
});

test('journal: null↔빈문자열은 동일 취급(문자열화 비교), from/to는 null 정규화', () => {
  assert.deepEqual(computeJournalChanges(['memo'], { memo: 'x' }, { memo: null }, { memo: '' }), []);
  const ch = computeJournalChanges(['memo'], { memo: 'x' }, { memo: undefined }, { memo: 'x' });
  assert.deepEqual(ch, [{ field: 'memo', from: null, to: 'x' }]);
});

test('journal: 숫자→문자 등 타입이 달라도 문자열화 값이 같으면 무변경', () => {
  assert.deepEqual(computeJournalChanges(['n'], { n: '3' }, { n: 3 }, { n: '3' }), []);
});

// ---- RISK_TRANSFORM ----
test('risk: 경계값 — 15↑ high · 8↑ medium · 그 외 low', () => {
  assert.equal(RISK_TRANSFORM({ probability: 5, impact: 3 }).level, 'high');    // 15
  assert.equal(RISK_TRANSFORM({ probability: 4, impact: 2 }).level, 'medium');  // 8
  assert.equal(RISK_TRANSFORM({ probability: 2, impact: 3 }).level, 'low');     // 6
});

test('risk: 미입력·비정상 값은 기본 3×3=9(medium), 수치 필드 정규화', () => {
  const r = RISK_TRANSFORM({});
  assert.deepEqual(r, { probability: 3, impact: 3, level: 'medium' });
  assert.equal(RISK_TRANSFORM({ probability: 'abc', impact: 5 }).level, 'high'); // 3*5=15
});

// ---- DOCUMENTS_TRANSFORM ----
test('document: approved → 승인일 기록, 반려·회수 → 승인일 해제, 그 외 무변경', () => {
  assert.ok(DOCUMENTS_TRANSFORM({ status: 'approved' }).approvedAt instanceof Date);
  for (const st of ['rejected','draft','review']) {
    assert.deepEqual(DOCUMENTS_TRANSFORM({ status: st }), { approvedAt: null });
  }
  assert.deepEqual(DOCUMENTS_TRANSFORM({ title: 'x' }), {});
});
