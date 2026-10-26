/**
 * wbsRollup.test.ts — WBS 상위 작업 롤업·점검. 2026-10-26 PMS 개편 P0-3
 * 순수 함수만 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { wbsRollup, describeRoll, WBS_ISSUE_LABEL, DRIFT_PP } from '../src/lib/wbsRollup.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

test('하위가 없는 작업은 결과에 없다', () => {
  assert.equal(wbsRollup([{ id: 1, progress: 50 }, { id: 2, progress: 10 }]).size, 0);
  assert.equal(wbsRollup(null as any).size, 0);
});

test('공수가 없으면 동일 가중, 완료 상태는 100%로 본다', () => {
  const m = wbsRollup([
    { id: 1, name: '설계', progress: 50 },
    { id: 2, parentId: 1, progress: 0 },
    { id: 3, parentId: 1, status: 'done', progress: 40 },
  ]);
  const r = m.get(1)!;
  assert.equal(r.rollup, 50); assert.equal(r.children, 2); assert.equal(r.leaves, 2); assert.equal(r.doneLeaves, 1);
  assert.deepEqual(r.issues, []);
});

test('계획 공수가 있으면 공수 가중', () => {
  const r = wbsRollup([
    { id: 1, progress: 75 },
    { id: 2, parentId: 1, progress: 100, plannedHours: 30 },
    { id: 3, parentId: 1, progress: 0, plannedHours: 10 },
  ]).get(1)!;
  assert.equal(r.rollup, 75); assert.equal(r.weight, 40);
});

test('손자까지 재귀로 올라간다', () => {
  const m = wbsRollup([
    { id: 1, progress: 0 },
    { id: 2, parentId: 1, progress: 0 },
    { id: 3, parentId: 2, progress: 100 },
    { id: 4, parentId: 2, progress: 0 },
    { id: 5, parentId: 1, progress: 100 },
  ]);
  assert.equal(m.get(2)!.rollup, 50);
  assert.equal(m.get(1)!.rollup, 75);
  assert.equal(m.get(1)!.leaves, 3);
});

test('점검: 하위 미완료·마감 초과·먼저 시작·진척 불일치', () => {
  const r = wbsRollup([
    { id: 1, status: 'done', progress: 100, startDate: '2026-10-05', endDate: '2026-10-20' },
    { id: 2, parentId: 1, progress: 20, startDate: '2026-10-01', endDate: '2026-10-25' },
  ]).get(1)!;
  assert.deepEqual(r.issues, ['DONE_OPEN', 'OVER_END', 'EARLY_START', 'DRIFT']);
  assert.equal(r.spanStart, '2026-10-01'); assert.equal(r.spanEnd, '2026-10-25');
  const t = describeRoll(r, 100);
  for (const i of r.issues) assert.ok(t.includes(WBS_ISSUE_LABEL[i]), i);
});

test('불일치 기준은 15%p', () => {
  const mk = (own: number) => wbsRollup([{ id: 1, progress: own }, { id: 2, parentId: 1, progress: 50 }]).get(1)!.issues;
  assert.equal(DRIFT_PP, 15);
  assert.deepEqual(mk(64), []); assert.deepEqual(mk(65), ['DRIFT']);
});

test('상위 지정 순환은 끊고 표시한다', () => {
  const m = wbsRollup([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }, { id: 3, parentId: 3 }]);
  assert.deepEqual(m.get(1)!.issues, ['CYCLE']); assert.deepEqual(m.get(2)!.issues, ['CYCLE']); assert.deepEqual(m.get(3)!.issues, ['CYCLE']);
});

test('업무 화면이 롤업을 쓴다', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src', 'app', 'tasks', 'page.tsx'), 'utf8');
  assert.match(page, /wbsRollup\(ts\)/);
  assert.match(page, /describeRoll\(/);
});
