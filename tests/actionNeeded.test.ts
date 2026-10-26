/**
 * actionNeeded.test.ts — 대시보드 「조치 필요」 묶음. 2026-10-26 PMS 개편 P0-1
 * 순수 함수만 — 네트워크·DB 미사용.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_KINDS, ACTION_META, actionNeeded, actionTotal, isDelayed, isHighRisk, isUrgentBug, ymd, todayYmd, daysBetween,
} from '../src/lib/actionNeeded.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const TODAY = '2026-10-26';
const grp = (gs: ReturnType<typeof actionNeeded>, k: string) => gs.find((g) => g.kind === k)!;

test('묶음 7종은 순서가 고정이고 모두 라벨·링크가 있다', () => {
  assert.deepEqual([...ACTION_KINDS], ['delayed', 'approval', 'risk', 'bug', 'untested', 'failedTest', 'change']);
  for (const k of ACTION_KINDS) { assert.ok(ACTION_META[k].label, k); assert.ok(fs.existsSync(path.join(ROOT, 'src', 'app', ACTION_META[k].href.slice(1))), ACTION_META[k].href); }
});

test('날짜 도우미', () => {
  assert.equal(ymd('2026-10-01T09:00:00Z'), '2026-10-01');
  assert.equal(ymd('10/01'), ''); assert.equal(ymd(null), '');
  assert.equal(todayYmd(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(daysBetween('2026-10-20', '2026-10-26'), 6);
  assert.equal(daysBetween('', '2026-10-26'), 0);
});

test('지연: 종료일 지남 + 미완료만, 오늘 마감은 지연 아님', () => {
  assert.equal(isDelayed({ endDate: '2026-10-25', status: 'doing', progress: 40 }, TODAY), true);
  assert.equal(isDelayed({ endDate: '2026-10-26', status: 'doing' }, TODAY), false);
  assert.equal(isDelayed({ endDate: '2026-10-01', status: 'done' }, TODAY), false);
  assert.equal(isDelayed({ endDate: '2026-10-01', status: 'doing', progress: 100 }, TODAY), false);
  assert.equal(isDelayed({ endDate: null, status: 'todo' }, TODAY), false);
});

test('높은 리스크: 등급 또는 점수 15 이상, 닫힌 것 제외', () => {
  assert.equal(isHighRisk({ level: 'high', status: 'identified' }), true);
  assert.equal(isHighRisk({ level: 'medium', probability: 5, impact: 3 }), true);
  assert.equal(isHighRisk({ level: 'medium', probability: 3, impact: 4 }), false);
  assert.equal(isHighRisk({ level: 'critical', status: 'closed' }), false);
});

test('긴급 결함: 유형 bug(빈 값 포함) + 긴급·높음 + 미해결', () => {
  assert.equal(isUrgentBug({ type: 'bug', priority: 'critical', status: 'open' }), true);
  assert.equal(isUrgentBug({ priority: 'high', status: 'in_progress' }), true);
  assert.equal(isUrgentBug({ type: 'task', priority: 'critical', status: 'open' }), false);
  assert.equal(isUrgentBug({ type: 'bug', priority: 'high', status: 'resolved' }), false);
  assert.equal(isUrgentBug({ type: 'bug', priority: 'medium', status: 'open' }), false);
});

test('actionNeeded: 묶음별 건수·정렬·자르기', () => {
  const gs = actionNeeded({
    tasks: [
      { id: 1, code: 'T1', name: '설계', endDate: '2026-10-24', status: 'doing', assignee: '김' },
      { id: 2, code: 'T2', name: '개발', endDate: '2026-10-10', status: 'todo' },
      { id: 3, code: 'T3', name: '완료', endDate: '2026-10-10', status: 'done' },
    ],
    documents: [{ id: 7, title: '설계서', status: 'review', approver: '박' }, { id: 8, title: '계획서', status: 'approved' }],
    requirements: [
      { id: 1, code: 'R1', title: '로그인', status: 'approved' },
      { id: 2, code: 'R2', title: '조회', status: 'approved' },
      { id: 3, code: 'R3', title: '검토중', status: 'review' },
    ],
    issues: [
      { id: 1, code: 'I1', title: '높음', type: 'bug', priority: 'high', status: 'open' },
      { id: 2, code: 'I2', title: '긴급', type: 'bug', priority: 'critical', status: 'open' },
      { id: 3, code: 'C1', title: '화면 변경', type: 'change', status: 'open' },
      { id: 4, code: 'C2', title: '닫힌 변경', type: 'change', status: 'closed' },
    ],
    risks: [{ id: 1, title: '일정', level: 'medium', probability: 5, impact: 4 }, { id: 2, title: '인력', level: 'high', probability: 3, impact: 3 }],
    tests: [{ id: 1, code: 'TC1', reqCode: 'R1', title: '로그인 시험', result: 'fail' }, { id: 2, reqCode: 'R1', title: '차단', result: 'blocked' }, { id: 3, reqCode: 'R1', result: 'pass', title: 'ok' }],
  }, { today: TODAY });

  assert.equal(gs.length, 7);
  const d = grp(gs, 'delayed'); assert.equal(d.count, 2); assert.equal(d.items[0].code, 'T2'); assert.equal(d.items[0].sub, '16일 지연'); assert.equal(d.items[1].sub, '2일 지연 · 김');
  const a = grp(gs, 'approval'); assert.equal(a.count, 2); assert.deepEqual(a.items.map((x) => x.id), ['d7', 'r3']);
  const r = grp(gs, 'risk'); assert.equal(r.count, 2); assert.equal(r.items[0].title, '일정');
  const b = grp(gs, 'bug'); assert.deepEqual(b.items.map((x) => x.code), ['I2', 'I1']);
  assert.deepEqual(grp(gs, 'untested').items.map((x) => x.code), ['R2']);
  assert.deepEqual(grp(gs, 'failedTest').items.map((x) => x.sub), ['실패', '차단']);
  assert.deepEqual(grp(gs, 'change').items.map((x) => x.code), ['C1']);
  assert.equal(actionTotal(gs), 2 + 2 + 2 + 2 + 1 + 2 + 1);
});

test('limit 은 1~50 으로 자르고 건수는 전체를 센다', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => ({ id: i, name: 't' + i, endDate: '2026-10-01', status: 'todo' }));
  const g = grp(actionNeeded({ tasks }, { today: TODAY, limit: 3 }), 'delayed');
  assert.equal(g.count, 12); assert.equal(g.items.length, 3);
  assert.equal(grp(actionNeeded({ tasks }, { today: TODAY, limit: 0 }), 'delayed').items.length, 1);
});

test('빈 입력·이상한 값에도 깨지지 않는다', () => {
  const gs = actionNeeded({ tasks: null as any, issues: [null, 3, 'x'] as any }, { today: TODAY });
  assert.equal(actionTotal(gs), 0);
  assert.equal(actionTotal(actionNeeded({})), 0);
});

test('대시보드 API 는 시험 목록을 내려주고 화면은 조치 필요 판을 그린다', () => {
  const api = read('src', 'app', 'api', 'dashboard', 'route.ts');
  assert.match(api, /from\(tests\)/);
  const page = read('src', 'app', 'dashboard', 'page.tsx');
  assert.match(page, /actionNeeded\(/);
  assert.match(page, /조치 필요/);
});
