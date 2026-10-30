// **복구를 거친 DB 는 하한이 둘이다**(RUNBOOK §3-21 · §3 1·3단계 · §3-6). 2026-10-30
//
// 이 파일이 지키는 것은 하나다 — **분기 시점보다 이전인 복구 시점을 `ok` 로 내보내지 않는다.**
//  (1) §3-6 은 보존 창의 하한을 `현재 - 보존기간` **하나로만** 세는데, 복구를 한 번 끝내면
//      운영이 보는 DB 는 **분기 시점을 가진 자식 브랜치**로 바뀐다(3단계가 새 브랜치를 만들고
//      5단계가 그것을 운영으로 승격시킨다)
//  (2) 그래서 두 번째 사건에서 `ok`·미래 `deadline`·`expired` 의 대안 셋 다 틀릴 수 있고,
//      담당자는 그 말을 믿고 **2단계 쓰기 차단(전 사용자 저장 503)**을 건 뒤에야 복구 불가를 안다
//  (3) 하한을 아는 값은 8단계 4번이 **지우라고 지시하는** 표지이므로(그 지시는 옳다 — §3-14)
//      판정은 **env 를 하나도 읽지 않고** §6 표의 영구 기록이나 콘솔 확인값에서 도출한다
//  (4) 모르면 `floor_unknown` 이고 **통과가 아니다**. `below_floor` 는 거짓 차단일 수 있으므로
//      「콘솔이 정본」이라는 사실을 판정과 함께 내보낸다
// 더해서 실제 §3-6 원문·헬스 라우트·절차 단위 정본·이 모듈과 RUNBOOK 원문을 대조해 문서와
// 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_FLOOR_CLEAR, ACTION_FLOOR_FUTURE, ACTION_FLOOR_INVALID, ACTION_FLOOR_NOT_APPLICABLE,
  ACTION_FLOOR_UNKNOWN, ACTION_FLOOR_ZONELESS, CAVEAT_CONSOLE_IS_CANON, CAVEAT_FLOOR_AMBIGUOUS,
  CAVEAT_FLOOR_FROM_RECORD, CAVEAT_FLOOR_IS_FIXED, FLOOR_BLIND_SPOTS, FLOOR_LIMITS,
  FLOOR_MISREADS, FLOOR_RUNBOOK_REF, FLOOR_SOURCES, FLOOR_VERDICTS,
  assessBranchFloor, auditFloorCanon, auditNoNewEnv, auditNoNewHealthCheck, auditRunbookFloor,
  auditSelfSource, auditWindowSource, branchFloorStatus, floorFromLedger, floorLine, floorSourceFor,
  floorText, publicBranchFloor, recoveryWindowWithFloor, windowWithFloorText,
} from '../src/lib/branchFloor.ts';
import { parseLedgerTable, type LedgerRow } from '../src/lib/rehearsalLedger.ts';
import { scanEnvReads } from '../src/lib/envRegistry.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'branchFloor.ts');
const WINDOW_SRC = read('src', 'lib', 'recoveryWindow.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 지금은 2026-10-30, 보존기간 168시간 → 설정 창 하한은 2026-10-23T00:00:00Z */
const NOW = new Date('2026-10-30T00:00:00Z');
const RETENTION = 168;
const WINDOW_START = '2026-10-23T00:00:00.000Z';

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  row: 1,
  date: '2026-09-18',
  kind: 'incident',
  kindRaw: '사건',
  target: '2026-09-18T04:12:00+09:00',
  durationMin: 90,
  result: 'pass',
  owner: '담당',
  note: '',
  scope: '',
  unpassed: '',
  ...over,
});

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 하한의 자리 셋이 영구성·코드 판독 여부·사라지는 때와 함께 적혀 있다', () => {
  assert.deepEqual(auditFloorCanon(), []);
  assert.equal(FLOOR_SOURCES.length, 3);
  assert.deepEqual(FLOOR_SOURCES.map((s) => s.key), ['restore_point_marker', 'ledger_target', 'neon_console']);
  // ⬅ 표지는 **영구 기록이 아니다** — 8단계 4번이 지우라고 지시한다(그 지시는 옳다)
  assert.equal(floorSourceFor('restore_point_marker')?.durable, false);
  // ⬅ 영구하면서 코드가 읽는 자리는 §6 표뿐이다
  assert.deepEqual(FLOOR_SOURCES.filter((s) => s.durable && s.readableByCode).map((s) => s.key), ['ledger_target']);
  // ⬅ 정본은 콘솔이고 코드가 보지 못한다
  assert.equal(floorSourceFor('neon_console')?.readableByCode, false);
  assert.equal(floorSourceFor('없는 자리'), null);
});

test('정본: 표지를 영구로 적거나 콘솔을 지우면 CI 에서 걸린다', () => {
  assert.ok(auditFloorCanon([]).length > 0);
  const durableMarker = FLOOR_SOURCES.map((s) => (s.key === 'restore_point_marker' ? { ...s, durable: true } : s));
  assert.ok(auditFloorCanon(durableMarker).some((p) => p.includes('RECOVERY_RESTORE_POINT')));
  const noConsole = FLOOR_SOURCES.filter((s) => s.readableByCode);
  assert.ok(auditFloorCanon(noConsole).some((p) => p.includes('콘솔')));
  const noDurable = FLOOR_SOURCES.map((s) => ({ ...s, durable: false }));
  assert.ok(auditFloorCanon(noDurable).some((p) => p.includes('영구')));
  assert.ok(auditFloorCanon(FLOOR_SOURCES.map((s) => ({ ...s, lostWhen: ' ' }))).length > 0);
});

test('정본: 거짓이 되는 판정 다섯과 사각지대가 사유 없이 비어 있지 않다', () => {
  assert.equal(FLOOR_MISREADS.length, 5);
  assert.ok(FLOOR_MISREADS.some((m) => m.key === 'marker_is_not_the_floor'));
  assert.ok(auditFloorCanon(FLOOR_SOURCES, []).some((p) => p.includes('marker_is_not_the_floor')));
  assert.ok(auditFloorCanon(FLOOR_SOURCES, FLOOR_MISREADS.map((m) => ({ ...m, why: ' ' }))).length > 0);
  const dup = [...FLOOR_MISREADS, FLOOR_MISREADS[0]];
  assert.ok(auditFloorCanon(FLOOR_SOURCES, dup).some((p) => p.includes('겹친다')));
  assert.ok(FLOOR_BLIND_SPOTS.length >= 6);
  assert.ok(auditFloorCanon(FLOOR_SOURCES, FLOOR_MISREADS, [{ key: 'x', what: '', why: '' }]).length > 0);
  assert.ok(FLOOR_LIMITS.length >= 6);
});

/* ───────────────────── §6 표에서 하한 도출 ───────────────────── */

test('표 도출: 사건 행 중 **가장 늦은** 시점이 하한이다', () => {
  const f = floorFromLedger([
    row({ row: 1, date: '2026-09-18', target: '2026-09-18T04:12:00+09:00' }),
    row({ row: 2, date: '2026-10-05', target: '2026-10-05T11:00:00+09:00' }),
  ]);
  assert.equal(f.recorded, true);
  assert.equal(f.at, '2026-10-05T02:00:00.000Z');
  assert.equal(f.row, 2);
  assert.equal(f.ambiguous, false);
  assert.deepEqual(f.skipped, [{ row: 1, date: '2026-09-18', reason: 'earlier' }]);
});

test('표 도출: 앞선 행이 더 늦은 시점이면 뒤 행이 `earlier` 로 빠진다', () => {
  const f = floorFromLedger([
    row({ row: 1, date: '2026-10-05', target: '2026-10-05T11:00:00+09:00' }),
    row({ row: 2, date: '2026-09-18', target: '2026-09-18T04:12:00+09:00' }),
  ]);
  assert.equal(f.row, 1);
  assert.deepEqual(f.skipped, [{ row: 2, date: '2026-09-18', reason: 'earlier' }]);
});

test('표 도출: 연습 행은 하한을 옮기지 않는다 — 전환하지 않고 정리되기 때문이다', () => {
  const f = floorFromLedger([row({ row: 1, kind: 'periodic', kindRaw: '정기', target: '2026-10-20T00:00:00Z' })]);
  assert.equal(f.recorded, false);
  assert.equal(f.ambiguous, false, '연습 행은 하한을 모르게 만들지도 않는다');
  assert.deepEqual(f.skipped.map((s) => s.reason), ['rehearsal']);
  // ⬅ 이 선택의 한계(전환까지 한 리허설)는 사각지대로 적어 둔다
  assert.ok(FLOOR_BLIND_SPOTS.some((b) => b.key === 'rehearsal_not_a_floor'));
});

test('표 도출: 유형을 읽을 수 없는 행이 시점을 들고 있으면 하한을 **단정하지 않는다**', () => {
  const unread = floorFromLedger([
    row({ row: 1, target: '2026-09-18T04:12:00+09:00' }),
    row({ row: 2, kind: 'unknown', kindRaw: '???', target: '2026-10-20T00:00:00Z' }),
  ]);
  assert.equal(unread.at, '2026-09-17T19:12:00.000Z');
  assert.equal(unread.ambiguous, true, '그쪽이 더 늦은 하한일 수 있다');
  // 유형도 못 읽고 시점도 비었으면 하한 판단에 아무 영향이 없다
  const empty = floorFromLedger([row({ row: 1, kind: 'unknown', kindRaw: '???', target: '' })]);
  assert.equal(empty.ambiguous, false);
  assert.deepEqual(empty.skipped.map((s) => s.reason), ['kind_unreadable']);
});

test('표 도출: 판독 불가 칸은 `unreadable_target` 으로 남고 하한을 단정하지 못하게 한다', () => {
  const f = floorFromLedger([row({ row: 1, target: '어제 밤' })]);
  assert.equal(f.recorded, false);
  assert.equal(f.ambiguous, true);
  assert.deepEqual(f.skipped.map((s) => s.reason), ['unreadable_target']);
  // 시점을 적지 않은 사건 행은 **이유와 함께** 빠진다(§6-7 이 `ephemeral_only` 로 따로 판정한다)
  const none = floorFromLedger([row({ row: 1, target: '' })]);
  assert.deepEqual(none.skipped.map((s) => s.reason), ['no_target']);
  assert.equal(none.ambiguous, false);
  assert.equal(floorFromLedger().recorded, false);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('판정: 분기 시점보다 이전이면 **만들 수 없다** — 설정 창 안이어도 그렇다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-25T00:00:00Z',
    floorAt: '2026-10-26T00:00:00Z',
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(a.verdict, 'below_floor');
  assert.equal(a.recoverable, false);
  assert.equal(a.basis, 'given');
  assert.ok(a.action?.includes('콘솔'), '거짓 차단일 수 있으므로 정본 확인을 먼저 말한다');
  assert.ok(a.action?.includes('3-18'), '원본 브랜치가 더 이른 히스토리를 가진다는 사실로 유도한다');
  // 설정 창 하한(10-23)보다 뒤인 시점인데도 막힌다 — 하한이 둘이라는 것이 이 절의 전제다
  assert.ok(a.restorePoint! > WINDOW_START);
});

test('판정: 하한이 설정 창보다 늦으면 `narrowed` — 실효 하한과 좁아진 시간을 수치로 적는다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    floorAt: '2026-10-26T00:00:00Z',
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(a.verdict, 'narrowed');
  assert.equal(a.recoverable, true);
  assert.equal(a.configuredWindowStart, WINDOW_START);
  assert.equal(a.effectiveWindowStart, '2026-10-26T00:00:00.000Z');
  assert.equal(a.narrowedByHours, 72);
  assert.ok(a.action?.includes('가장 이른 시점은 창 하한이 아니라'));
});

test('판정: 설정 창 하한이 더 늦으면 `clear` — 실효 하한은 창 하한이다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    floorAt: '2026-10-20T00:00:00Z',
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(a.verdict, 'clear');
  assert.equal(a.recoverable, true);
  assert.equal(a.effectiveWindowStart, WINDOW_START);
  assert.equal(a.narrowedByHours, null);
  assert.equal(a.action, ACTION_FLOOR_CLEAR);
});

test('판정 순서: 타임존 없는 하한보다도 이전인 시점은 **그대로 막는다**', () => {
  // 날짜만 적힌 칸은 UTC 00:00 으로 읽혀 실제보다 **이르다** — 그보다 이전이면 어느 판독에서도 막힌다
  const blocked = assessBranchFloor({
    restorePoint: '2026-10-25T00:00:00Z',
    rows: [row({ target: '2026-10-26' })],
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(blocked.verdict, 'below_floor');
  assert.equal(blocked.zoneless, true);
  // 그보다 뒤라면 판독을 믿을 수 없으므로 **통과시키지 않는다**
  const held = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    rows: [row({ target: '2026-10-26' })],
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(held.verdict, 'zoneless_floor');
  assert.equal(held.recoverable, null, '보류는 「막지 않는다」가 아니다');
  assert.equal(held.action, ACTION_FLOOR_ZONELESS);
  assert.equal(held.effectiveWindowStart, WINDOW_START, '신뢰할 수 없는 하한을 실효 하한으로 적지 않는다');
  assert.equal(held.narrowedByHours, null);
});

test('판정 순서: 하한을 단정할 수 없어도 그보다 이전인 시점은 막힌다', () => {
  const rows = [row({ row: 1, target: '2026-10-26T00:00:00Z' }), row({ row: 2, target: '읽을 수 없음' })];
  const blocked = assessBranchFloor({ restorePoint: '2026-10-25T00:00:00Z', rows, retentionHours: RETENTION, now: NOW });
  assert.equal(blocked.verdict, 'below_floor');
  assert.ok(blocked.caveats.includes(CAVEAT_FLOOR_AMBIGUOUS));
  const held = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', rows, retentionHours: RETENTION, now: NOW });
  assert.equal(held.verdict, 'floor_unknown');
  assert.equal(held.recoverable, null);
  assert.equal(held.ambiguous, true);
});

test('판정: 하한을 모르면 보류이고 **통과가 아니다**', () => {
  const a = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', retentionHours: RETENTION, now: NOW });
  assert.equal(a.verdict, 'floor_unknown');
  assert.equal(a.basis, 'none');
  assert.equal(a.recoverable, null);
  assert.equal(a.floorAt, null);
  assert.equal(a.action, ACTION_FLOOR_UNKNOWN);
  assert.ok(a.action.includes('옮겨 적'), '다음 사건이 다시 모르는 상태로 시작하지 않게 한다');
  assert.ok(!a.caveats.includes(CAVEAT_FLOOR_FROM_RECORD), '표에서 도출하지 않았다는 사실을 섞지 않는다');
});

test('판정: 넘겨받은 하한을 못 읽는 것과 적지 않은 것은 할 일이 다르다', () => {
  const invalid = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', floorAt: '2026년 9월쯤', now: NOW });
  assert.equal(invalid.verdict, 'invalid_floor');
  assert.equal(invalid.action, ACTION_FLOOR_INVALID);
  assert.equal(invalid.recoverable, null);
  // 표의 판독 불가는 §6-7 이 판정하는 자리이므로 여기서는 `floor_unknown` 으로만 남는다
  const fromTable = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', rows: [row({ target: '어제' })], now: NOW });
  assert.equal(fromTable.verdict, 'floor_unknown');
});

test('판정: 미래 하한은 모든 시점을 막기 전에 오타를 말한다', () => {
  const a = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', floorAt: '2026-11-20T00:00:00Z', now: NOW });
  assert.equal(a.verdict, 'future_floor');
  assert.equal(a.action, ACTION_FLOOR_FUTURE);
  assert.equal(a.recoverable, null, '오타로 복구를 막지 않는다');
});

test('판정: 복구 시점이 없으면 하한을 견주지 않는다', () => {
  const a = assessBranchFloor({ floorAt: '2026-10-26T00:00:00Z', retentionHours: RETENTION, now: NOW });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.action, ACTION_FLOOR_NOT_APPLICABLE);
  assert.equal(a.restorePoint, null);
  assert.equal(a.recoverable, null);
});

test('판정: 콘솔에서 확인한 값이 표보다 우선한다 — 정본이 콘솔이다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    floorAt: '2026-10-26T00:00:00Z',
    rows: [row({ target: '2026-09-18T04:12:00+09:00' })],
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(a.basis, 'given');
  assert.equal(a.floorAt, '2026-10-26T00:00:00.000Z');
  assert.equal(a.floorRow, null);
  assert.equal(a.floorDate, null);
  // 표에서 도출했을 때는 그 행을 적고 「사람이 적은 기록」이라는 사실을 함께 낸다
  const fromTable = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    rows: [row({ row: 3, date: '2026-10-26', target: '2026-10-26T00:00:00Z' })],
    retentionHours: RETENTION,
    now: NOW,
  });
  assert.equal(fromTable.basis, 'ledger');
  assert.equal(fromTable.floorRow, 3);
  assert.equal(fromTable.floorDate, '2026-10-26');
  assert.ok(fromTable.caveats.includes(CAVEAT_FLOOR_FROM_RECORD));
  assert.ok(fromTable.caveats.includes(CAVEAT_FLOOR_IS_FIXED));
  assert.ok(fromTable.caveats.includes(CAVEAT_CONSOLE_IS_CANON));
});

test('판정: 보존기간을 모르면 창 하한을 **지어내지 않는다**', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    floorAt: '2026-10-26T00:00:00Z',
    retentionHours: null,
    now: NOW,
  });
  assert.equal(a.verdict, 'clear', '좁아졌는지는 설정 창을 알아야만 말할 수 있다');
  assert.equal(a.configuredWindowStart, null);
  assert.equal(a.effectiveWindowStart, '2026-10-26T00:00:00.000Z');
  assert.equal(a.narrowedByHours, null);
  // 범위 밖·정수 아닌 보존기간도 설정값으로 인정하지 않는다(§3-6 과 같은 규율)
  assert.equal(assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', retentionHours: 0, now: NOW }).retentionHours, null);
  assert.equal(assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', retentionHours: 1.5, now: NOW }).retentionHours, null);
  assert.equal(assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', retentionHours: 99999, now: NOW }).retentionHours, null);
});

test('판정: 전 판정이 조치 문구를 가지고 보류는 recoverable 을 올리지 않는다', () => {
  const seen = new Set<string>();
  const cases = [
    { restorePoint: '2026-10-28T00:00:00Z', floorAt: '2026-10-20T00:00:00Z' },
    { restorePoint: '2026-10-28T00:00:00Z', floorAt: '2026-10-26T00:00:00Z' },
    { restorePoint: '2026-10-25T00:00:00Z', floorAt: '2026-10-26T00:00:00Z' },
    { restorePoint: '2026-10-28T00:00:00Z', rows: [row({ target: '2026-10-26' })] },
    { restorePoint: '2026-10-28T00:00:00Z' },
    { restorePoint: '2026-10-28T00:00:00Z', floorAt: '적지 않음' },
    { restorePoint: '2026-10-28T00:00:00Z', floorAt: '2026-11-20T00:00:00Z' },
    {},
  ];
  for (const c of cases) {
    const a = assessBranchFloor({ ...c, retentionHours: RETENTION, now: NOW });
    seen.add(a.verdict);
    assert.ok(a.action && a.action.trim().length > 0, `${a.verdict} 에 조치 문구가 없다`);
    if (a.verdict !== 'clear' && a.verdict !== 'narrowed' && a.verdict !== 'below_floor') {
      assert.equal(a.recoverable, null, `${a.verdict} 는 보류다`);
    }
  }
  assert.deepEqual([...seen].sort(), [...FLOOR_VERDICTS].sort(), '판정 전건을 시험하지 않았다');
});

/* ───────────────────── §3-6 산출과 합친 결론 ───────────────────── */

test('합친 결론: 설정 창과 하한 **둘 다** 통과해야 만들 수 있다', () => {
  const env = { RECOVERY_PITR_RETENTION_HOURS: String(RETENTION) };
  const ok = recoveryWindowWithFloor({
    damageAt: '2026-10-28T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-10-20T00:00:00Z',
    env,
    now: NOW,
  });
  assert.equal(ok.window.verdict, 'ok');
  assert.equal(ok.floor.verdict, 'clear');
  assert.equal(ok.canCreate, true);
  // 하한이 막으면 **막는 쪽**이 결론이고 조치도 그쪽의 것이다
  const blocked = recoveryWindowWithFloor({
    damageAt: '2026-10-25T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-10-26T00:00:00Z',
    env,
    now: NOW,
  });
  assert.equal(blocked.window.verdict, 'ok', '설정 창만 보면 통과다 — 그것이 이 절의 출발점이다');
  assert.equal(blocked.floor.verdict, 'below_floor');
  assert.equal(blocked.canCreate, false);
  assert.equal(blocked.action, blocked.floor.action);
});

test('합친 결론: 어느 한쪽이 보류면 「만들 수 있다」로 올리지 않는다', () => {
  // 보존기간 미설정 → §3-6 은 `unknown_window`(보류)
  const held = recoveryWindowWithFloor({
    damageAt: '2026-10-28T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-10-20T00:00:00Z',
    env: {},
    now: NOW,
  });
  assert.equal(held.window.verdict, 'unknown_window');
  assert.equal(held.canCreate, null);
  assert.equal(held.action, held.window.action, '보류일 때는 창 쪽 조치를 그대로 보여 준다');
  // 하한만 보류여도 올리지 않는다
  const floorHeld = recoveryWindowWithFloor({
    damageAt: '2026-10-28T09:10:00+09:00',
    epsilonMinutes: 10,
    env: { RECOVERY_PITR_RETENTION_HOURS: String(RETENTION) },
    now: NOW,
  });
  assert.equal(floorHeld.window.verdict, 'ok');
  assert.equal(floorHeld.floor.verdict, 'floor_unknown');
  assert.equal(floorHeld.canCreate, null);
  assert.equal(floorHeld.action, floorHeld.floor.action);
});

test('합친 결론: 설정 창이 막으면 하한을 보기 전에 그쪽이 결론이다', () => {
  const r = recoveryWindowWithFloor({
    damageAt: '2026-10-01T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-09-01T00:00:00Z',
    env: { RECOVERY_PITR_RETENTION_HOURS: String(RETENTION) },
    now: NOW,
  });
  assert.equal(r.window.verdict, 'expired');
  assert.equal(r.canCreate, false);
  assert.equal(r.action, r.window.action);
  // §3-6 가 멈춘 입력에서는 하한을 견주지 않는다
  const noPoint = recoveryWindowWithFloor({ damageAt: '어제', env: {}, now: NOW });
  assert.equal(noPoint.floor.verdict, 'not_applicable');
  assert.equal(noPoint.canCreate, null);
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('출력: 공개 필터에 **시각 좌표가 없다** — 그 구간의 쓰기를 노리는 데 쓰인다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-25T00:00:00Z',
    floorAt: '2026-10-26T00:00:00Z',
    retentionHours: RETENTION,
    now: NOW,
  });
  const pub = publicBranchFloor(a);
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('2026-10-26'), '분기 시점이 공개 모양에 들어 있다');
  assert.ok(!text.includes('2026-10-25'), '복구 시점이 공개 모양에 들어 있다');
  assert.ok(!text.includes('2026-10-23'), '창 하한이 공개 모양에 들어 있다');
  assert.equal(pub.verdict, 'below_floor');
  assert.equal(pub.recoverable, false);
  assert.equal(pub.ref, FLOOR_RUNBOOK_REF);
});

test('출력: 로그·사람용 요약은 판정과 수치만 담는다', () => {
  const a = assessBranchFloor({
    restorePoint: '2026-10-28T00:00:00Z',
    rows: [row({ row: 2, target: '2026-10-26T00:00:00Z' })],
    retentionHours: RETENTION,
    now: NOW,
  });
  const line = floorLine(a);
  assert.ok(line.startsWith('[branch-floor] verdict=narrowed basis=ledger'));
  assert.ok(line.includes('narrowed_h=72'));
  assert.ok(line.includes('recoverable=true'));
  const text = floorText(a);
  assert.ok(text.includes('§6 표 2행'));
  assert.ok(text.includes('가장 이른 시점'));
  // 보류는 사람에게도 「통과가 아니다」로 보인다
  const held = floorText(assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', now: NOW }));
  assert.ok(held.includes('하한을 모른다'));
  assert.ok(held.includes('판정 보류'));
  assert.ok(floorLine(assessBranchFloor({ now: NOW })).includes('verdict=not_applicable'));
  assert.ok(floorLine(assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', rows: [row({ target: '읽기 불가' })], now: NOW })).includes('ambiguous=true'));
});

test('출력: §3-21 명령은 두 문단과 합친 결론을 함께 낸다', () => {
  const r = recoveryWindowWithFloor({
    damageAt: '2026-10-25T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-10-26T00:00:00Z',
    env: { RECOVERY_PITR_RETENTION_HOURS: String(RETENTION) },
    now: NOW,
  });
  const out = windowWithFloorText(r);
  assert.ok(out.includes('복구 시점(T-ε)'), '§3-6 산출이 그대로 나온다');
  assert.ok(out.includes('분기 시점 하한 판정'));
  assert.ok(out.includes('[두 하한을 합친 결론] 만들 수 없다'));
  const held = windowWithFloorText(recoveryWindowWithFloor({ damageAt: '2026-10-28T09:10:00+09:00', epsilonMinutes: 10, env: {}, now: NOW }));
  assert.ok(held.includes('판정 보류(통과가 아니다)'));
  const canDo = windowWithFloorText(recoveryWindowWithFloor({
    damageAt: '2026-10-28T09:10:00+09:00',
    epsilonMinutes: 10,
    floorAt: '2026-10-20T00:00:00Z',
    env: { RECOVERY_PITR_RETENTION_HOURS: String(RETENTION) },
    now: NOW,
  }));
  assert.ok(canDo.includes('[두 하한을 합친 결론] 만들 수 있다'));
});

test('출력: 상태 요약은 정본·사각지대·한계를 함께 내보낸다', () => {
  const s = branchFloorStatus({ restorePoint: '2026-10-28T00:00:00Z', retentionHours: RETENTION, now: NOW });
  assert.equal(s.verdict, 'floor_unknown');
  assert.equal(s.sources, FLOOR_SOURCES);
  assert.equal(s.misreads, FLOOR_MISREADS);
  assert.equal(s.blindSpots, FLOOR_BLIND_SPOTS);
  assert.equal(s.limits, FLOOR_LIMITS);
  assert.equal(s.ref, FLOOR_RUNBOOK_REF);
});

/* ─────────────────────── 실제 소스·문서 대조 ─────────────────────── */

test('[실제 소스] 이 모듈은 env 를 읽지 않고 판독을 복제하지 않는다', () => {
  assert.deepEqual(auditSelfSource(SELF_SRC), []);
  assert.deepEqual(auditNoNewEnv(SELF_SRC), []);
  // ⬅ **신규 env 0** — env 레지스트리 스캐너로도 읽는 키가 하나도 없다
  assert.deepEqual(scanEnvReads(SELF_SRC), []);
  // 위반은 전부 잡힌다
  assert.ok(auditSelfSource('const x = process.env.FOO').length > 0);
  assert.ok(auditSelfSource("import { db } from './db.ts'").length > 0);
  assert.ok(auditSelfSource("import { NextResponse } from 'next/server'").length > 0);
  assert.ok(auditSelfSource("import fs from 'node:fs'").length > 0);
  assert.ok(auditSelfSource('').some((p) => p.includes('parseRecordedInstant')));
  assert.ok(auditSelfSource('').some((p) => p.includes('kindState')));
  assert.ok(auditSelfSource('').some((p) => p.includes('§3-6')));
  assert.ok(auditNoNewEnv('const x = process.env.FOO').length > 0);
  assert.ok(auditNoNewEnv('const x = env.RECOVERY_RESTORE_POINT').length > 0);
  assert.ok(auditNoNewEnv("const x = env['RECOVERY_RESTORE_POINT']").length > 0);
});

test('[실제 소스] /api/health 에 새 체크를 만들지 않았다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.ok(auditNoNewHealthCheck('checks.branchFloor = branchFloorCheck()').length > 0);
});

test('[실제 소스] §3-6 은 여전히 하한을 하나로 세고, 그 한계를 선언해 두고 있다', () => {
  assert.deepEqual(auditWindowSource(WINDOW_SRC), []);
  assert.ok(auditWindowSource('const windowStartMs = branchFloorMs;').length > 0);
  assert.ok(auditWindowSource('const windowStartMs = nowMs - retention * MS_HOUR;').some((p) => p.includes('사각지대')));
});

test('[실제 문서] RUNBOOK 에 §3-21 과 판정 표·명령이 있고 1·3단계와 §3-6 이 유도한다', () => {
  assert.deepEqual(auditRunbookFloor(RUNBOOK), []);
  assert.ok(auditRunbookFloor('## 3. DB 복구 절차\n### 3-1.').length > 0);
  // 유도가 빠지는 두 자리를 따로 잡는다 — 둘 다 빠져도 응답은 그대로 200 이다
  assert.ok(auditRunbookFloor(RUNBOOK.replace(/3-21/g, '3-99')).some((p) => p.includes('§3 3단계')));
  const noSec6 = RUNBOOK.replace(/- ⚠️ \*\*이 판정은 하한을 하나로만 센다\*\*[\s\S]*?canCreate` 로 합쳐 준다\./, '');
  assert.ok(auditRunbookFloor(noSec6).some((p) => p.includes('§3-6 이 3-21 로 유도하지 않는다')));
  // 1단계(차단 전)·3단계 양쪽에서 이 절로 닿을 수 있어야 한다 — 차단을 건 뒤에 알면 늦다
  const sec3 = RUNBOOK.slice(RUNBOOK.indexOf('## 3. DB 복구 절차'), RUNBOOK.indexOf('### 3-1.'));
  const step2 = sec3.indexOf('2. **쓰기 차단**');
  assert.ok(sec3.indexOf('3-21') < step2 && sec3.indexOf('3-21') > 0, '차단을 걸기 전에 하한을 보라고 말하는 자리가 없다');
  assert.ok(sec3.slice(step2).includes('3-21'), '3단계가 이 절로 유도하지 않는다');
});

test('[실제 문서] 절차 단위 정본에 3-21 이 등록돼 있고 체크리스트가 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-21');
  assert.ok(unit, 'RUNBOOK 소절이 리허설 단위 정본에 없으면 절차는 자라는데 범위 판정은 그대로 ok 가 된다');
  assert.equal(unit!.cited, true);
  assert.ok(unit!.skipped.includes('분기 시점'));
  const checklist = RUNBOOK.slice(RUNBOOK.search(/^###\s*리허설 체크리스트/m));
  assert.ok(checklist.includes('3-21'));
  assert.ok(/- \[ \] \*\*차단을 걸기 전에\*\* 두 번째 하한/.test(checklist), '체크리스트 항목이 비어 있지 않은 칸으로 커밋됐다(§6-9)');
});

test('[실제 문서] 코드는 §6 표를 채우지 않는다 — 지금 표에서는 하한이 도출되지 않는다', () => {
  const rows = parseLedgerTable(RUNBOOK).rows;
  const f = floorFromLedger(rows);
  assert.equal(f.recorded, false, '표에 사건 행 복구 시점이 적히면 이 테스트를 함께 고친다(그때가 하한이 생긴 때다)');
  const a = assessBranchFloor({ restorePoint: '2026-10-28T00:00:00Z', rows, retentionHours: RETENTION, now: NOW });
  assert.equal(a.verdict, 'floor_unknown');
  assert.equal(a.recoverable, null, '표가 비었다는 것이 「하한이 없다」가 아니다');
});
