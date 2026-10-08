/**
 * incidentEvidence.test.ts — RUNBOOK §3 1단계(손상 범위·시각 T 특정)의 근거 보전. 2026-10-08
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 1단계는 「감사로그로 T 직전 관리 작업 이력을 확인한다」고 지시하지만,
 *  (1) `/api/audit` 는 결과가 limit 에서 잘려도 **아무 말을 하지 않았고** 화면은 `limit=200`
 *      단발 조회였다. 정렬이 `desc(audit_log.id)` 이므로 잘리는 쪽은 가장 오래된 쪽 —
 *      즉 보라고 한 「T 직전」이다. 대량 삭제는 1건당 감사 1행이라 200건을 쉽게 넘긴다.
 *  (2) 그 `audit_log` 는 복구 대상과 같은 DB 에 있어 5단계 전환이 손상 구간 기록을 함께 되돌린다.
 *      `CORE_TABLE_ROLES` 는 이 테이블을 「재생성 불가·법적 보존 대상」이라 선언해 두었는데도
 *      §3 에는 전환 전 보존 단계가 없었다.
 *
 * 그래서 (a) 절단 판정 자체와 (b) 배선(라우트 응답·화면 페이징·정렬)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_CAPTURE_EMPTY,
  ACTION_CAPTURE_TRUNCATED,
  ACTION_CAPTURE_UNREADABLE,
  CAPTURE_VERDICTS,
  CAVEAT_DISCARDED_BY_SWITCH,
  CAVEAT_NO_CURSOR,
  CAVEAT_UNBOUNDED,
  EVIDENCE_LIMITS,
  EVIDENCE_TABLE,
  assessCapture,
  auditAuditRouteWiring,
  auditAuditScreenWiring,
  captureStatus,
  discardWindow,
  evidenceLogLine,
  oldestIdOf,
  parseInstant,
} from '../src/lib/incidentEvidence.ts';
import { CORE_TABLES } from '../src/lib/recoveryVerify.ts';
import { AUDIT_LIMIT_DEFAULT } from '../src/lib/auditQuery.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('assessCapture: limit 에 닿으면 truncated — 「더 없다」로 올리지 않는다', () => {
  const a = assessCapture({ rowCount: 200, limit: 200, oldestId: 4812, bounded: true });
  assert.equal(a.verdict, 'truncated');
  assert.equal(a.reachedLimit, true);
  assert.equal(a.nextCursor, 4812);
  // 잘리는 쪽이 가장 오래된 쪽이라는 사실이 판정에 남아 있어야 한다(= 사건 직전이 빠졌다).
  assert.equal(a.droppedEnd, 'oldest');
  assert.equal(a.action, ACTION_CAPTURE_TRUNCATED);
  assert.ok(a.caveats.includes(CAVEAT_DISCARDED_BY_SWITCH));

  // 한 건이라도 모자라면 조건 범위 안에서는 전건이다.
  const b = assessCapture({ rowCount: 199, limit: 200, oldestId: 4812, bounded: true });
  assert.equal(b.verdict, 'complete');
  assert.equal(b.nextCursor, null);
  assert.equal(b.droppedEnd, null);
  // complete 여도 「전환하면 사라진다」는 사실은 같다.
  assert.ok(b.caveats.includes(CAVEAT_DISCARDED_BY_SWITCH));
});

test('assessCapture: 0건은 empty — 「일어나지 않았다」가 아니다', () => {
  const a = assessCapture({ rowCount: 0, limit: 200, bounded: true });
  assert.equal(a.verdict, 'empty');
  assert.equal(a.action, ACTION_CAPTURE_EMPTY);
  assert.match(a.action, /일어나지 않았다/);
  assert.equal(a.nextCursor, null);
  // 기간을 지정하지 않았으면 그 사실을 함께 말한다.
  assert.ok(assessCapture({ rowCount: 0, limit: 200 }).caveats.includes(CAVEAT_UNBOUNDED));
});

test('assessCapture: 수치를 못 읽으면 unreadable — 추측해서 complete 로 만들지 않는다', () => {
  for (const bad of [{ rowCount: 'x', limit: 200 }, { rowCount: 10, limit: 0 }, { rowCount: -1, limit: 200 }, { rowCount: 1.5, limit: 200 }, { rowCount: 10, limit: 'all' }]) {
    const a = assessCapture(bad as never);
    assert.equal(a.verdict, 'unreadable', JSON.stringify(bad));
    assert.equal(a.action, ACTION_CAPTURE_UNREADABLE);
    assert.equal(a.nextCursor, null);
  }
  // 판정값은 선언한 목록 밖으로 나가지 않는다.
  assert.ok(CAPTURE_VERDICTS.includes(assessCapture({ rowCount: 5, limit: 10 }).verdict));
});

test('assessCapture: 커서를 낼 수 없으면 그 사실을 말한다(조용히 끝으로 처리하지 않는다)', () => {
  const a = assessCapture({ rowCount: 200, limit: 200, oldestId: null, bounded: true });
  assert.equal(a.verdict, 'truncated');
  assert.equal(a.nextCursor, null);
  assert.ok(a.caveats.includes(CAVEAT_NO_CURSOR));
  // limit 을 넘겨 받은 경우(드라이버 이상)도 잘린 것으로 본다.
  assert.equal(assessCapture({ rowCount: 201, limit: 200, oldestId: 3 }).verdict, 'truncated');
});

test('oldestIdOf: 가장 작은 id — 판독 불가한 행은 건너뛴다', () => {
  assert.equal(oldestIdOf([{ id: 9 }, { id: 3 }, { id: 7 }]), 3);
  assert.equal(oldestIdOf([{ id: 9 }, { id: null }, { id: 'x' }]), 9);
  assert.equal(oldestIdOf([]), null);
  assert.equal(oldestIdOf(null), null);
  assert.equal(oldestIdOf([{}, { id: 0 }, { id: -4 }]), null);
});

test('captureStatus: 응답에 한계 목록이 함께 실린다(한계를 숨기지 않는다)', () => {
  const s = captureStatus({ rowCount: 200, limit: 200, oldestId: 11, bounded: false });
  assert.equal(s.table, EVIDENCE_TABLE);
  assert.ok(s.limits.length >= 5);
  // 전 테넌트 사각지대와 「전환이 지운다」는 사실이 반드시 들어 있어야 한다.
  assert.ok(s.limits.some((l) => l.includes('다른 조직')), s.limits.join('|'));
  assert.ok(s.limits.includes(CAVEAT_DISCARDED_BY_SWITCH));
  assert.ok(s.limits.some((l) => l.includes('DATABASE_URL')));
  // 행 내용은 담지 않는다 — 수치·판정만.
  assert.equal(JSON.stringify(s).includes('detail'), false);
  assert.match(evidenceLogLine(s), /^\[evidence\] verdict=truncated rows=200 limit=200 bounded=false nextCursor=11 dropped=oldest$/);
});

test('parseInstant: 엄격 파서 — 형식 밖·비실존 날짜는 null', () => {
  assert.equal(parseInstant('2026-10-08')?.toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(parseInstant('2026-10-08T03:30:00Z')?.toISOString(), '2026-10-08T03:30:00.000Z');
  assert.equal(parseInstant('2026-10-08 03:30')?.toISOString(), '2026-10-08T03:30:00.000Z');
  for (const bad of ['2026-02-30', '2026-13-01', '어제', '', null, '08/10/2026', '2026-10-08T99:00Z']) {
    assert.equal(parseInstant(bad as never), null, String(bad));
  }
});

test('discardWindow: 전환이 지울 감사 이력 구간을 수치로 — 못 읽으면 지어내지 않는다', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const w = discardWindow('2026-10-08T03:00:00Z', now);
  assert.equal(w.verdict, 'ok');
  assert.equal(w.hours, 9);
  assert.equal(w.days, 1);
  assert.ok(w.text.includes(EVIDENCE_TABLE) && w.text.includes('9시간분'));

  const f = discardWindow('2026-10-09T00:00:00Z', now);
  assert.equal(f.verdict, 'future');
  assert.equal(f.hours, null);

  const i = discardWindow('언젠가', now);
  assert.equal(i.verdict, 'invalid');
  assert.equal(i.restorePoint, null);
  assert.equal(i.hours, null);
});

test('auditAuditRouteWiring: 실제 라우트가 판정을 응답에 싣고, 정렬을 유지한다', () => {
  assert.deepEqual(auditAuditRouteWiring(read('src', 'app', 'api', 'audit', 'route.ts')), []);

  // 가드가 가드 역할을 하는지 — 빠뜨리는 꼴을 실제로 잡아야 한다.
  assert.ok(auditAuditRouteWiring('').length > 0);
  // import 만 하고 호출하지 않으면 거기서 멈춘다(절단 판정 자체가 없다).
  assert.deepEqual(auditAuditRouteWiring("import { captureStatus } from '@/lib/incidentEvidence';"),
    ['captureStatus() 를 호출하지 않는다 — 절단 여부를 판정하지 않는다']);
  // 판정만 하고 응답에 싣지 않으면(= 화면이 절단을 알 수 없다) 걸린다.
  const silent = `import { captureStatus } from '@/lib/incidentEvidence';
    const c = captureStatus({ rowCount: rows.length, limit: f.limit, oldestId: 1, bounded: true });
    return ok({ rows });`;
  assert.ok(auditAuditRouteWiring(silent).some((p) => p.includes('capture 필드')));
  // 정렬이 createdAt 으로 바뀌면 커서가 조용히 어긋난다 — 그 회귀를 잡는다.
  const reordered = read('src', 'app', 'api', 'audit', 'route.ts').replace('orderBy(desc(auditLog.id))', 'orderBy(desc(auditLog.createdAt))');
  assert.ok(auditAuditRouteWiring(reordered).some((p) => p.includes('커서 페이징')));
  // 적용된 limit 대신 상수를 넘기면 절단 판정이 틀어진다.
  const fixedLimit = read('src', 'app', 'api', 'audit', 'route.ts').replace('limit: f.limit', 'limit: 100');
  assert.ok(auditAuditRouteWiring(fixedLimit).some((p) => p.includes('f.limit')));
});

test('auditAuditScreenWiring: 화면이 절단을 드러내고 이어 받는다(단발 조회 회귀 차단)', () => {
  assert.deepEqual(auditAuditScreenWiring(read('src', 'app', 'audit', 'page.tsx')), []);

  assert.ok(auditAuditScreenWiring('').length >= 4);
  // 커서를 넘기지 않으면 잘린 뒤를 받을 수 없다 — 화면은 그대로 돌기 때문에 눈으로는 못 잡는다.
  const single = read('src', 'app', 'audit', 'page.tsx').replace(/set\(\s*'cursor'/g, "set('cursorX'");
  assert.ok(auditAuditScreenWiring(single).some((p) => p.includes('단발 조회')));
});

test('audit_log 는 핵심 테이블이고, RUNBOOK §3-5 가 전환 전 보존을 지시한다', () => {
  // 「재생성 불가·법적 보존 대상」이라 선언한 테이블을 복구가 되돌린다 — 그 모순을 문서가 다뤄야 한다.
  assert.ok(CORE_TABLES.includes(EVIDENCE_TABLE));
  const runbook = read('RUNBOOK.md');
  assert.match(runbook, /### 3-5\./);
  assert.ok(runbook.includes('discardWindow'), '소실 구간 산출 명령이 RUNBOOK 에 없다');
  assert.ok(runbook.includes('capture.verdict'), '절단 확인 수단이 RUNBOOK 에 적혀 있지 않다');
  // 보존 위치 규율: 같은 DB 안에 두면 함께 사라진다.
  assert.match(runbook, /DB 밖/);
  // 자동화가 보존을 대신했다고 말하지 않는다(실행·보관은 사람 몫).
  assert.match(runbook, /\[사람 수행 필요\]/);
  // 1단계가 절단 확인을 지시해야 한다.
  const step1 = runbook.slice(runbook.indexOf('1. **중단 결정**'), runbook.indexOf('2. **쓰기 차단**'));
  assert.ok(step1.includes('3-5'), '1단계가 §3-5 로 유도하지 않는다');
});

test('기본 limit 과 화면 limit 이 판정 전제와 맞는다', () => {
  // 화면이 명시적으로 넘기는 limit 이 바뀌면 안내 문구(200건씩)와 어긋난다.
  const page = read('src', 'app', 'audit', 'page.tsx');
  assert.match(page, /set\('limit',\s*'200'\)/);
  assert.match(page, /200건씩/);
  // 라우트 기본값은 auditQuery 상수를 그대로 쓴다(여기서 다시 정하지 않는다).
  assert.equal(AUDIT_LIMIT_DEFAULT, 100);
  // 모듈은 자체 기본 limit 을 들고 있지 않다 — limit 을 모르면 판정을 보류한다(임의 수치로 세지 않는다).
  assert.equal(assessCapture({ rowCount: 10 } as never).verdict, 'unreadable');
  assert.equal(assessCapture({ rowCount: 10, limit: undefined } as never).limit, null);
  // EVIDENCE_LIMITS 는 비어 있지 않고 전부 문자열이다.
  assert.ok(EVIDENCE_LIMITS.every((l) => typeof l === 'string' && l.length > 10));
});
