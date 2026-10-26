/**
 * undoQueue.test.ts — 목록 지연 삭제(7초 되돌리기)·열 너비 저장값. 2026-10-26 PMS 개편 P0-4
 * 순수 함수만 — 네트워크·DB 미사용. 타이머는 가짜로 돌린다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUndoQueue, cleanWidths, UNDO_MS } from '../src/lib/undoQueue.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

function fakeTimer() {
  let now = 0; const jobs = new Map<number, { at: number; fn: () => void }>(); let n = 0;
  return {
    timer: { set: (fn: () => void, ms: number) => { jobs.set(++n, { at: now + ms, fn }); return n; }, clear: (h: unknown) => { jobs.delete(h as number); } },
    tick(ms: number) { now += ms; for (const [h, j] of Array.from(jobs)) if (j.at <= now) { jobs.delete(h); j.fn(); } },
    count: () => jobs.size,
  };
}

test('기본 지연은 7초', () => { assert.equal(UNDO_MS, 7000); });

test('7초가 지나면 그때 삭제 요청을 보낸다', () => {
  const ft = fakeTimer(); const sent: number[][] = [];
  const q = createUndoQueue((ids) => { sent.push(ids); }, { timer: ft.timer });
  const e = q.schedule([3, 4], '2건')!;
  assert.deepEqual(e.ids, [3, 4]); assert.deepEqual(Array.from(q.pendingIds()), [3, 4]);
  ft.tick(6999); assert.deepEqual(sent, []);
  ft.tick(1); assert.deepEqual(sent, [[3, 4]]); assert.equal(q.size(), 0);
});

test('되돌리기를 누르면 요청 자체를 보내지 않는다', () => {
  const ft = fakeTimer(); const sent: number[][] = [];
  const q = createUndoQueue((ids) => { sent.push(ids); }, { timer: ft.timer });
  const e = q.schedule([9])!;
  assert.equal(q.undo(e.token), true); assert.equal(q.undo(e.token), false);
  ft.tick(10000); assert.deepEqual(sent, []); assert.equal(ft.count(), 0);
});

test('화면을 떠나면 남은 예약을 즉시 보낸다', async () => {
  const ft = fakeTimer(); const sent: number[][] = [];
  const q = createUndoQueue(async (ids) => { sent.push(ids); }, { timer: ft.timer });
  q.schedule([1]); q.schedule([2]);
  await q.flush();
  assert.deepEqual(sent, [[1], [2]]); assert.equal(q.size(), 0); assert.equal(ft.count(), 0);
  ft.tick(10000); assert.equal(sent.length, 2);
});

test('이미 대기 중인 id 는 다시 넣지 않고, 빈 목록은 null', () => {
  const ft = fakeTimer();
  const q = createUndoQueue(() => {}, { timer: ft.timer });
  q.schedule([1, 2]);
  assert.deepEqual(q.schedule([2, 3, 3])!.ids, [3]);
  assert.equal(q.schedule([1, 2]), null); assert.equal(q.schedule([]), null);
  assert.equal(q.schedule([NaN]), null);
});

test('열 너비 저장값: 숫자만, 60~800 으로 자른다', () => {
  assert.deepEqual(cleanWidths({ a: 120.4, b: 10, c: 9999, d: 'x', '': 100 }), { a: 120, b: 60, c: 800 });
  assert.deepEqual(cleanWidths(null), {}); assert.deepEqual(cleanWidths([1, 2]), {});
});

test('목록 공통 화면이 지연 삭제·되돌리기·열 너비 조절을 쓴다', () => {
  const v = fs.readFileSync(path.join(ROOT, 'src', 'components', 'ResourceView.tsx'), 'utf8');
  assert.match(v, /createUndoQueue\(/);
  assert.match(v, /되돌리기/);
  assert.match(v, /pms\.colw\./);
  assert.doesNotMatch(v, /confirm\(`삭제하시겠습니까/);
});
