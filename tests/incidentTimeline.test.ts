// 표지가 **이번 사건의 것인가** 테스트(RUNBOOK §3-14). 2026-10-25
//
// 이 파일이 지키는 것은 하나다 — **표지는 값이 읽히는 것만으로 「했다」가 되지 않는다.**
//  (1) 지난 복구가 남긴 시각은 평상시 `stale_record` 로만 떠 있다가 **차단을 켜는 순간
//      `recorded` 로 뒤집힌다** — 경고가 정작 쓸모 있어지는 순간에 사라진다
//  (2) 그래서 7단계 선행 조건이 몇 달 전 시각으로 통과한다(세션·플랜·고지가 모두 「완료」)
//  (3) 그러면서도 `state`·`ok` 어휘를 바꾸지 않는다 — 타임존 누락과 미수행을 코드가 구분할 수
//      없고(둘 다 고쳐야 한다), `ok` 를 내리면 복구일에 거짓 차단이 된다
//  (4) 구분할 수 없는 것(T-ε·앵커 자신)을 구분했다고 하지 않는다
// 더해서 실제 모듈·`/api/health` 라우트·RUNBOOK 원문을 대조해 배선과 문서가 함께 낡지 않도록 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_TL_ABSENT, ACTION_TL_CARRIED_OVER, ACTION_TL_CONSISTENT, ACTION_TL_OUT_OF_ORDER,
  ACTION_TL_UNANCHORED, ACTION_TL_UNREADABLE,
  ANCHOR_ENV, CAVEAT_TL_ANCHOR_UNCHECKED, CAVEAT_TL_RESTORE_POINT_BLIND,
  CORROBORATION_BASES, TIMELINE_LIMITS, TIMELINE_MARKERS, TIMELINE_MISREADS,
  TIMELINE_RUNBOOK_REF, TIMELINE_VERDICTS,
  assessTimeline, auditExternalWiring, auditNoNewHealthCheck, auditRunbookTimeline,
  auditSecurityWiring, auditTimelineRegistry, markerCorroboration, markerOf,
  publicTimeline, readTimeline, recordKeys, timelineLine, timelineStatus, timelineText,
} from '../src/lib/incidentTimeline.ts';
import { FREEZE_AT_ENV } from '../src/lib/incidentClosure.ts';
import { NOTICE_AT_ENV, RESTORE_POINT_ENV } from '../src/lib/lossNotice.ts';
import { SECURITY_REAPPLIED_ENV, securityReapplyCheck } from '../src/lib/postRestoreSecurity.ts';
import { EXTERNAL_RECONCILED_ENV, externalStateCheck } from '../src/lib/externalReconcile.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const MODULE_SRC = read('src', 'lib', 'incidentTimeline.ts');
const SECURITY_SRC = read('src', 'lib', 'postRestoreSecurity.ts');
const EXTERNAL_SRC = read('src', 'lib', 'externalReconcile.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 한 사건의 정상 타임라인 — 2단계 → 3단계(T-ε 은 앞) → 6-1 → 6-2 → 8단계 2번 */
const T_RESTORE = '2026-10-25T01:40:00+09:00';
const T_FREEZE = '2026-10-25T02:10:00+09:00';
const T_SECURITY = '2026-10-25T03:00:00+09:00';
const T_EXTERNAL = '2026-10-25T03:30:00+09:00';
const T_NOTICE = '2026-10-25T04:10:00+09:00';
/** 지난 복구(몇 달 전)가 남긴 값 */
const T_OLD = '2026-07-02T11:00:00+09:00';

const FULL: Record<string, string | undefined> = {
  RECOVERY_WRITE_FREEZE: 'true',
  [ANCHOR_ENV]: T_FREEZE,
  [RESTORE_POINT_ENV]: T_RESTORE,
  [SECURITY_REAPPLIED_ENV]: T_SECURITY,
  [EXTERNAL_RECONCILED_ENV]: T_EXTERNAL,
  [NOTICE_AT_ENV]: T_NOTICE,
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 시각 기록 5건 · 앵커 1건 · 모양 점검 통과', () => {
  assert.equal(TIMELINE_MARKERS.length, 5);
  assert.deepEqual(auditTimelineRegistry(), []);
  assert.equal(TIMELINE_MARKERS.filter((m) => m.relation === 'anchor').length, 1);
  assert.equal(ANCHOR_ENV, FREEZE_AT_ENV, '앵커가 §3-7 의 구간 끝 키와 갈라졌다');
  assert.deepEqual(recordKeys().sort(), [
    EXTERNAL_RECONCILED_ENV, NOTICE_AT_ENV, RESTORE_POINT_ENV, SECURITY_REAPPLIED_ENV,
  ].sort());
  // 사각지대 선언 — 앵커와 T-ε 은 대조 상대가 없다(그 사실을 숨기지 않는다)
  assert.equal(markerOf(ANCHOR_ENV)?.detectable, false);
  assert.equal(markerOf(RESTORE_POINT_ENV)?.detectable, false);
  assert.equal(markerOf(SECURITY_REAPPLIED_ENV)?.detectable, true);
  assert.equal(markerOf('없는키'), null);
});

test('정본: `healthDisclosure.INCIDENT_MARKERS` 의 record 키와 **양방향** 대조', () => {
  const disclosed = INCIDENT_MARKERS.filter((m) => m.kind === 'record').map((m) => m.key).sort();
  const mine = TIMELINE_MARKERS.map((m) => m.key).sort();
  assert.deepEqual(mine, disclosed, '사건 표지 정본이 두 곳에서 갈라졌다 — 한쪽만 늘면 귀속에서 빠진다');
  // 스위치(시각이 없는 표지)는 귀속을 말할 수 없으므로 들어와서는 안 된다
  for (const m of INCIDENT_MARKERS.filter((x) => x.kind === 'switch')) {
    assert.equal(markerOf(m.key), null, `스위치 ${m.key} 가 시각 기록 정본에 들어왔다`);
  }
});

test('정본: 거짓이 되는 판정 목록은 전건 실재 키이고 자리·말·사실을 모두 적는다', () => {
  assert.ok(TIMELINE_MISREADS.length >= 5);
  for (const r of TIMELINE_MISREADS) {
    assert.ok(markerOf(r.key), `정본 밖 키: ${r.key}`);
    assert.ok(r.where.includes('checks.'), '판정이 나오는 자리가 적혀 있지 않다');
    assert.ok(r.says.trim().length > 0 && r.truth.trim().length > 0);
  }
  assert.ok(TIMELINE_LIMITS.length >= 7, '사각지대를 줄였다');
  assert.ok(TIMELINE_LIMITS.includes(CAVEAT_TL_ANCHOR_UNCHECKED));
  assert.ok(TIMELINE_LIMITS.includes(CAVEAT_TL_RESTORE_POINT_BLIND));
});

test('정본 모양 점검: 앵커가 둘이거나 order·키가 중복이면 잡는다', () => {
  const dup = [...TIMELINE_MARKERS, { ...TIMELINE_MARKERS[0] }];
  assert.ok(auditTimelineRegistry(dup).some((p) => p.includes('앵커가')));
  const liar = TIMELINE_MARKERS.map((m) => (m.key === RESTORE_POINT_ENV ? { ...m, detectable: true } : m));
  assert.ok(
    auditTimelineRegistry(liar).some((p) => p.includes('detectable: true')),
    '구분할 수 없는 키를 구분할 수 있다고 선언해도 통과했다',
  );
});

/* ─────────────────────────────── 판독 ─────────────────────────────── */

test('readTimeline: 미설정·공백은 미설정으로, 판독 불가는 **「없다」로 세지 않는다**', () => {
  const r = readTimeline({ [ANCHOR_ENV]: '  ', [SECURITY_REAPPLIED_ENV]: '어제', [NOTICE_AT_ENV]: T_NOTICE });
  const by = new Map(r.map((x) => [x.key, x]));
  assert.deepEqual(
    [by.get(ANCHOR_ENV)?.present, by.get(ANCHOR_ENV)?.unreadable],
    [false, false],
    '공백을 「들어 있다」로 세었다',
  );
  assert.deepEqual([by.get(SECURITY_REAPPLIED_ENV)?.present, by.get(SECURITY_REAPPLIED_ENV)?.unreadable], [true, true]);
  assert.equal(by.get(SECURITY_REAPPLIED_ENV)?.at, null, '못 읽는 값으로 시각을 지어냈다');
  assert.equal(by.get(NOTICE_AT_ENV)?.at, new Date(T_NOTICE).toISOString());
  assert.equal(readTimeline({}).filter((x) => x.present).length, 0);
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('assessTimeline: 표지가 없으면 평상시(`absent`)다', () => {
  const a = assessTimeline({ env: {} });
  assert.equal(a.verdict, 'absent');
  assert.equal(a.action, ACTION_TL_ABSENT);
  assert.deepEqual([a.carried, a.outOfOrder, a.unanchoredKeys, a.unreadableKeys], [[], [], [], []]);
  assert.equal(a.anchorAt, null);
  assert.equal(a.recordCount, 0);
});

test('assessTimeline: 한 사건의 정상 타임라인은 `consistent`', () => {
  const a = assessTimeline({ env: FULL });
  assert.equal(a.verdict, 'consistent');
  assert.equal(a.action, ACTION_TL_CONSISTENT);
  assert.equal(a.recordCount, 4);
  assert.equal(a.frozen, true);
  // T-ε 은 앵커보다 앞이고 그것이 정상이다 — 그러나 「옛 값이 아니다」까지는 말하지 못한다
  assert.deepEqual(a.indistinguishable.sort(), [ANCHOR_ENV, RESTORE_POINT_ENV].sort());
});

test('assessTimeline: 지난 복구가 남긴 사후 기록은 `carried_over`(= 이번 사건의 것일 수 없다)', () => {
  const a = assessTimeline({ env: { ...FULL, [SECURITY_REAPPLIED_ENV]: T_OLD } });
  assert.equal(a.verdict, 'carried_over');
  assert.deepEqual(a.carried, [SECURITY_REAPPLIED_ENV]);
  assert.equal(a.action, ACTION_TL_CARRIED_OVER);
  assert.ok(/지우거나 다시 적은/.test(a.action));
  // 옛 값은 **순서 문제로 중복 계상하지 않는다** — 할 일이 「순서를 확인한다」로 덮인다
  assert.deepEqual(a.outOfOrder, []);
});

test('assessTimeline: 앵커가 없으면 `unanchored` — `carried_over` 보다 **앞선다**', () => {
  const a = assessTimeline({ env: { [SECURITY_REAPPLIED_ENV]: T_OLD, [NOTICE_AT_ENV]: T_NOTICE } });
  assert.equal(a.verdict, 'unanchored', '기준점 없이 「앞섰다」를 셌다');
  assert.deepEqual(a.carried, [], '기준점이 없는데 옛 값을 단정했다');
  assert.deepEqual(a.unanchoredKeys.sort(), [NOTICE_AT_ENV, SECURITY_REAPPLIED_ENV].sort());
  assert.equal(a.action, ACTION_TL_UNANCHORED);
  // 앵커만 있고 기록이 없으면 2단계만 밟은 상태다 — 어긋남이 아니다
  assert.equal(assessTimeline({ env: { [ANCHOR_ENV]: T_FREEZE } }).verdict, 'consistent');
});

test('assessTimeline: 판독 불가가 있어도 **다른 표지의 신호는 계산된다**', () => {
  const a = assessTimeline({ env: { ...FULL, [NOTICE_AT_ENV]: '어제', [SECURITY_REAPPLIED_ENV]: T_OLD } });
  assert.equal(a.verdict, 'unreadable');
  assert.deepEqual(a.unreadableKeys, [NOTICE_AT_ENV]);
  assert.equal(a.action, ACTION_TL_UNREADABLE);
  assert.deepEqual(
    a.carried,
    [SECURITY_REAPPLIED_ENV],
    '한 값이 판독 불가면 다른 표지의 옛 값이 조용히 「정합」으로 보고됐다',
  );
});

test('assessTimeline: 순서 어긋남 — T-ε 이 차단보다 뒤 · 6-2 가 6-1 보다 앞', () => {
  const late = assessTimeline({ env: { ...FULL, [RESTORE_POINT_ENV]: '2026-10-25T02:40:00+09:00' } });
  assert.equal(late.verdict, 'out_of_order');
  assert.deepEqual(late.outOfOrder, [{ earlier: RESTORE_POINT_ENV, later: ANCHOR_ENV }]);

  const swapped = assessTimeline({ env: { ...FULL, [EXTERNAL_RECONCILED_ENV]: '2026-10-25T02:20:00+09:00' } });
  assert.equal(swapped.verdict, 'out_of_order');
  assert.deepEqual(swapped.outOfOrder, [{ earlier: SECURITY_REAPPLIED_ENV, later: EXTERNAL_RECONCILED_ENV }]);
  assert.equal(swapped.action, ACTION_TL_OUT_OF_ORDER);
  assert.ok(/하지 않았다」는 뜻이 아니라/.test(swapped.action), '순서 어긋남을 「미수행」으로 단정했다');
});

test('assessTimeline: 판정 어휘는 선언된 6건뿐이다', () => {
  const seen = new Set<string>();
  for (const env of [
    {}, FULL, { ...FULL, [SECURITY_REAPPLIED_ENV]: T_OLD }, { [NOTICE_AT_ENV]: T_NOTICE },
    { ...FULL, [NOTICE_AT_ENV]: 'x' }, { ...FULL, [EXTERNAL_RECONCILED_ENV]: T_FREEZE, [SECURITY_REAPPLIED_ENV]: T_NOTICE },
  ]) {
    seen.add(assessTimeline({ env }).verdict);
  }
  for (const v of seen) assert.ok((TIMELINE_VERDICTS as readonly string[]).includes(v), `선언 밖 판정: ${v}`);
  assert.equal(seen.size, 6, '여섯 판정이 모두 도달하지 않는다');
});

/* ──────────────────────── 체크가 말하는 한 칸 ──────────────────────── */

test('markerCorroboration: 귀속은 `anchor` 하나로만 성립한다', () => {
  const ok = markerCorroboration(SECURITY_REAPPLIED_ENV, assessTimeline({ env: FULL }));
  assert.deepEqual([ok.corroborated, ok.basis], [true, 'anchor']);
  assert.ok(/수행 여부는 아니다/.test(ok.note), '귀속을 수행으로 읽히게 적었다');

  const carried = markerCorroboration(
    SECURITY_REAPPLIED_ENV,
    assessTimeline({ env: { ...FULL, [SECURITY_REAPPLIED_ENV]: T_OLD } }),
  );
  assert.deepEqual([carried.corroborated, carried.basis], [false, 'carried_over']);

  const absent = markerCorroboration(SECURITY_REAPPLIED_ENV, assessTimeline({ env: {} }));
  assert.deepEqual([absent.corroborated, absent.basis], [false, 'absent']);

  const blind = markerCorroboration(RESTORE_POINT_ENV, assessTimeline({ env: FULL }));
  assert.deepEqual([blind.corroborated, blind.basis], [false, 'indistinguishable']);

  assert.equal(markerCorroboration('RECOVERY_MADE_UP', assessTimeline({ env: FULL })).basis, 'unknown_key');
  for (const b of CORROBORATION_BASES) assert.ok(String(b).length > 0);
});

test('markerCorroboration: 앵커를 못 읽는 동안 들어 있는 기록을 `absent` 로 보고하지 않는다', () => {
  const a = assessTimeline({ env: { ...FULL, [ANCHOR_ENV]: '어제' } });
  const c = markerCorroboration(SECURITY_REAPPLIED_ENV, a);
  assert.notEqual(c.basis, 'absent', '들어 있는 값을 「없다」로 말했다 — 비어 있음과 귀속 불가가 같은 말이 됐다');
  assert.equal(c.basis, 'unanchored');
  assert.equal(c.corroborated, false);
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('출력: 로그·공개 필터는 **시각을 담지 않는다**', () => {
  const a = assessTimeline({ env: { ...FULL, [SECURITY_REAPPLIED_ENV]: T_OLD } });
  const line = timelineLine(a);
  const pub = JSON.stringify(publicTimeline(a));
  for (const t of [T_FREEZE, T_OLD, T_RESTORE, T_NOTICE, new Date(T_FREEZE).toISOString()]) {
    assert.ok(!line.includes(t), `로그에 시각이 들어갔다: ${t}`);
    assert.ok(!pub.includes(t), `공개 필터에 시각이 들어갔다: ${t}`);
  }
  assert.ok(line.includes('timeline=carried_over') && line.includes('anchor=set'));
  assert.deepEqual(publicTimeline(a).carried, [SECURITY_REAPPLIED_ENV]);
  assert.equal(publicTimeline(a).anchorRecorded, true);
  assert.equal(publicTimeline(a).runbook, TIMELINE_RUNBOOK_REF);
  assert.equal(publicTimeline(assessTimeline({ env: {} })).anchorRecorded, false);
});

test('출력: 사람이 읽는 요약은 할 일과 사각지대를 함께 낸다', () => {
  const txt = timelineText(assessTimeline({ env: { ...FULL, [SECURITY_REAPPLIED_ENV]: T_OLD } }));
  assert.ok(txt.startsWith('[carried_over]'));
  assert.ok(txt.includes(SECURITY_REAPPLIED_ENV));
  assert.ok(txt.includes(CAVEAT_TL_ANCHOR_UNCHECKED), '사각지대를 떼고 내보냈다');
  assert.ok(txt.includes('구분 불가(사각지대)'), 'T-ε 의 한계를 숨겼다');

  const s = timelineStatus(FULL);
  assert.deepEqual([s.verdict, s.anchorKey, s.markers], ['consistent', ANCHOR_ENV, 5]);
  assert.equal(s.limits, TIMELINE_LIMITS.length);
  assert.equal(timelineStatus({}).verdict, 'absent');
});

/* ─────────────────────────────── 배선 ─────────────────────────────── */

test('postRestoreSecurity: `state`·`ok` 어휘는 그대로이고 귀속만 더해진다', () => {
  const recorded = securityReapplyCheck({ env: FULL });
  assert.deepEqual([recorded.detail.state, recorded.ok], ['recorded', true]);
  assert.equal(recorded.detail.recordCorroborated, true);
  assert.equal(recorded.detail.recordBasis, 'anchor');
  assert.equal(recorded.detail.timelineVerdict, 'consistent');

  // 지난 복구의 시각이 남은 채 차단을 켠 순간 — `state` 는 `recorded` 로 **뒤집히지만**
  // 귀속은 그것이 이번 사건의 것이 아니라고 말한다. ok 는 내리지 않는다(거짓 차단 금지).
  const carried = securityReapplyCheck({
    env: { RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE, [SECURITY_REAPPLIED_ENV]: T_OLD },
  });
  assert.deepEqual([carried.detail.state, carried.ok, carried.required], ['recorded', true, false]);
  assert.equal(carried.detail.recordCorroborated, false);
  assert.equal(carried.detail.recordBasis, 'carried_over');
  assert.ok(String(carried.detail.note).includes('지우거나 다시 적은'), '같은 칸에서 할 일을 말하지 않았다');

  // 평상시에는 한 글자도 더 달라지지 않는다
  const normal = securityReapplyCheck({ env: {} });
  assert.deepEqual([normal.detail.state, normal.detail.recordCorroborated, normal.detail.timelineVerdict], [
    'normal', false, 'absent',
  ]);
  assert.equal(normal.detail.recordBasis, 'absent');
});

test('externalState: 같은 칸을 같은 규율로 더한다', () => {
  const live = { BILLING_APPLY_LIVE: 'true', PAYMENTS_LIVE: 'true' };
  const recorded = externalStateCheck({ env: { ...live, ...FULL } });
  assert.deepEqual([recorded.detail.state, recorded.ok], ['recorded', true]);
  assert.equal(recorded.detail.recordCorroborated, true);

  const carried = externalStateCheck({
    env: { ...live, RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE, [EXTERNAL_RECONCILED_ENV]: T_OLD },
  });
  assert.deepEqual([carried.detail.state, carried.ok], ['recorded', true]);
  assert.equal(carried.detail.recordCorroborated, false);
  assert.equal(carried.detail.recordBasis, 'carried_over');
  assert.ok(String(carried.detail.note).includes('지우거나 다시 적은'));

  const off = externalStateCheck({ env: {} });
  assert.deepEqual([off.detail.state, off.detail.recordBasis], ['not_applicable', 'absent']);
});

test('배선 점검: 실제 두 모듈 원문이 귀속을 **응답에 실어 보낸다**', () => {
  assert.deepEqual(auditSecurityWiring(SECURITY_SRC), []);
  assert.deepEqual(auditExternalWiring(EXTERNAL_SRC), []);

  assert.ok(auditSecurityWiring('export function securityReapplyCheck(){}').length >= 3, 'import 누락을 놓쳤다');
  const discarded = SECURITY_SRC.replace(/recordCorroborated\s*:/g, 'unusedCorroborated:');
  assert.ok(
    auditSecurityWiring(discarded).some((p) => p.includes('판정만 하고 버린다')),
    '판정만 하고 버리는 꼴을 놓쳤다',
  );
  const wrongKey = EXTERNAL_SRC.replace(/markerCorroboration\(EXTERNAL_RECONCILED_ENV/g, 'markerCorroboration(FREEZE_AT_ENV');
  assert.ok(auditExternalWiring(wrongKey).some((p) => p.includes('자기 표지 키')));
});

test('배선 점검: `/api/health` 에 **새 체크가 생기지 않았다**', () => {
  assert.deepEqual(auditNoNewHealthCheck(ROUTE_SRC), []);
  assert.ok(
    auditNoNewHealthCheck("import { assessTimeline } from '@/lib/incidentTimeline';").length > 0,
    '라우트가 직접 판정하는 꼴을 놓쳤다',
  );
  assert.ok(auditNoNewHealthCheck('checks.incidentTimeline = x();').length > 0);
  assert.ok(!/checks\.incidentTimeline/.test(ROUTE_SRC));
});

/* ─────────────────────────────── 문서 ─────────────────────────────── */

test('RUNBOOK: §3-14 와 그것을 가리키는 단계가 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookTimeline(RUNBOOK), []);

  assert.ok(auditRunbookTimeline(RUNBOOK.replace(/^### 3-14\./m, '### 9-9.')).some((p) => p.includes('3-14')));
  const noCmd = RUNBOOK.replace(/timelineText\(/g, '보고(').replace(/assessTimeline\(/g, '보고(');
  assert.ok(auditRunbookTimeline(noCmd).some((p) => p.includes('산출 명령')));
  const noRow = RUNBOOK.replace(/`out_of_order`/g, '순서 어긋남');
  assert.ok(auditRunbookTimeline(noRow).some((p) => p.includes('out_of_order')));
  const noField = RUNBOOK.replace(/recordCorroborated/g, '그 칸');
  assert.ok(auditRunbookTimeline(noField).some((p) => p.includes('recordCorroborated')));
});

test('RUNBOOK: 8단계 4번이 표지 **전건** 삭제를 지시한다', () => {
  const step8 = RUNBOOK.slice(RUNBOOK.search(/^8\. \*\*사후\*\*/m)).split(/\n>/)[0];
  for (const m of TIMELINE_MARKERS) assert.ok(step8.includes(m.key), `8단계 4번에 ${m.key} 가 없다`);
  assert.ok(/전건을 지운다/.test(step8));

  // 「전건」이라는 낱말은 8단계 2번(「통로는 전건 수동이다」)에도 있다 — 지시가 사라진 것을
  // 그 낱말로 가릴 수 없게 고정한다.
  const loosened = RUNBOOK.replace(/\*\*다섯 키 전건을 지운다\.\*\* /, '');
  assert.ok(
    auditRunbookTimeline(loosened).some((p) => p.includes('전건')),
    '전건 삭제 지시가 사라져도 통과했다 — 남은 표지가 다음 사건의 근거가 된다',
  );
  // 키 하나가 4번 목록에서 빠지면(문서의 다른 절에는 그대로 있어 눈으로는 멀쩡해 보인다) 잡는다.
  const droppedKey = RUNBOOK.replace('`RECOVERY_SECURITY_REAPPLIED_AT`·`RECOVERY_EXTERNAL_RECONCILED_AT` 도 지운다 —', '');
  assert.ok(
    auditRunbookTimeline(droppedKey).some((p) => p.includes('처분을 다루지 않는다')),
    '4번 목록에서 표지 하나가 빠져도 통과했다',
  );
});

test('절차 단위 3-14 가 등록되고 체크리스트가 **빈 칸으로** 그것을 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-14');
  assert.ok(unit, '§3-14 가 절차 단위 정본에 없다 — 리허설 범위에서 빠진다');
  assert.equal(unit?.cited, true);
  assert.ok((unit?.skipped ?? '').length > 0, '건너뛸 때 생기는 일이 적혀 있지 않다');

  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes, '체크리스트 구간을 찾지 못했다');
  const load = unitItemLoad(boxes ?? []).find((l) => l.unit === '3-14');
  assert.ok((load?.items.length ?? 0) >= 2, '§3-14 를 인용하는 체크리스트 항목이 모자라다');
  assert.equal(load?.checked, 0, '체크된 칸이 커밋됐다(§6-9)');
});

/* ─────────────────────────────── 규율 ─────────────────────────────── */

test('순수 모듈: `process.env`·DB·next·fs 미접근 · 신규 env 0', () => {
  // 주석은 걷어 낸다 — 이 모듈은 자기 규율을 주석으로도 적어 두었다.
  const body = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(body), 'env 는 인자로만 받는다');
  assert.ok(!/from\s+['"](next|drizzle|node:fs|@\/db)/.test(body));
  // 새 키를 만들지 않았다 — 정본의 다섯 키는 모두 다른 모듈이 이미 쓰는 키다
  const owned = [FREEZE_AT_ENV, RESTORE_POINT_ENV, SECURITY_REAPPLIED_ENV, EXTERNAL_RECONCILED_ENV, NOTICE_AT_ENV];
  for (const m of TIMELINE_MARKERS) {
    assert.ok(owned.includes(m.key), `${m.key} 는 이 모듈이 새로 만든 키다 — §4 레지스트리에 함께 등록해야 한다`);
  }
  // 읽기·쓰기·DDL 0 — SQL 동사가 들어오면 이 모듈의 성격이 바뀐 것이다
  assert.ok(!/\b(select|insert|update|delete|create table|alter table)\b/i.test(MODULE_SRC));
});
