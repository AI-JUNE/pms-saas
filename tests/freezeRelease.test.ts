// **절차가 끝난 시각은 적을 자리가 없다**(RUNBOOK §3-22 · §3 7·8단계 · §3-7 · §3-9 · §1-2). 2026-10-30
//
// 이 파일이 지키는 것은 하나다 — **소요시간의 하한을 실측이라고 부르지 않는다.**
//  (1) §3-7 은 2단계 차단 시각을 「해제한 뒤에는 되찾을 수 없다」는 이유로 기록 대상으로
//      승격했는데, **7단계 해제 시각에는 그 승격이 없다** — `frozen: false` 는 평상시와 같은 값이다
//  (2) 그 시각은 §6 표 `소요시간`(= §1-2 가 읽는 **유일한 RTO 실측**)의 끝이고 §3-9 대조 구간의
//      끝인데 표지도 표의 칸도 없다. 하한을 그대로 적으면 **지키지 못한 약속이 `met` 으로 굳는다**
//  (3) 하한의 기준점은 8단계 4번이 **지우라고 지시하는** 표지다(그 지시는 옳다 — §3-14).
//      그래서 새 표지를 만들지 않고, 이미 있는 표지가 해제를 **괄호로 묶는** 데까지만 쓴다
//  (4) 6-2단계 대조는 절차상 **해제 전**이라 꼬리 구간은 어떤 대조에도 들어가지 않는다
// 더해서 실제 `incidentClosure.ts`·헬스 라우트·표지 정본·절차 단위 정본·이 모듈과 RUNBOOK
// 원문을 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_RELEASE_BEFORE_FREEZE, ACTION_RELEASE_FLOOR_ONLY, ACTION_RELEASE_FROZEN,
  ACTION_RELEASE_INVALID_RECORD, ACTION_RELEASE_INVALID_RELEASE, ACTION_RELEASE_MEASURED,
  ACTION_RELEASE_NOT_APPLICABLE, ACTION_RELEASE_UNRECORDED, BRACKET_VERDICTS,
  CAVEAT_FLOOR_IS_NOT_MEASUREMENT, CAVEAT_RELEASE_HAS_NO_MARKER, CAVEAT_TAIL_IS_UNRECONCILED,
  RELEASE_BLIND_SPOTS, RELEASE_BOUNDS, RELEASE_DEPENDENTS, RELEASE_LIMITS, RELEASE_MISREADS,
  RELEASE_RUNBOOK_REF, RELEASE_VERDICTS,
  assessFreezeRelease, auditClosureWiring, auditNoNewEnv, auditNoNewHealthCheck,
  auditReleaseCanon, auditRunbookRelease, auditSelfSource, bracketRelease, freezeReleaseStatus,
  publicRelease, releaseBoundFor, releaseDependentFor, releaseLine, releaseText,
} from '../src/lib/freezeRelease.ts';
import { assessDuration, closureCheck } from '../src/lib/incidentClosure.ts';
import { TIMELINE_MARKERS } from '../src/lib/incidentTimeline.ts';
import { scanEnvReads } from '../src/lib/envRegistry.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'freezeRelease.ts');
const CLOSURE_SRC = read('src', 'lib', 'incidentClosure.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 사건 하루 — 중단 결정 12:05 → 차단 12:30 → 보안 15:00 → 대조 15:20 → 해제 15:40 → 고지 16:10 (KST) */
const STARTED = '2026-10-30T12:05:00+09:00';
const FROZE = '2026-10-30T12:30:00+09:00';
const SECURITY = '2026-10-30T15:00:00+09:00';
const RECONCILED = '2026-10-30T15:20:00+09:00';
const RELEASED = '2026-10-30T15:40:00+09:00';
const NOTICE = '2026-10-30T16:10:00+09:00';
const NOW = new Date('2026-10-30T17:00:00+09:00');

const incident = (over: Record<string, string | undefined> = {}) => ({
  RECOVERY_WRITE_FREEZE_AT: FROZE,
  ...over,
});

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 해제 시각을 쓰는 자리 전건에 영구성·출처·사라지는 때가 적혀 있다', () => {
  assert.deepEqual(auditReleaseCanon(), []);
  assert.equal(RELEASE_DEPENDENTS.length, 4);
  assert.deepEqual(RELEASE_DEPENDENTS.map((d) => d.key), [
    'ledger_duration', 'rto_attainment', 'reconcile_window_end', 'release_performed',
  ]);
  // ⬅ 영구 기록이 되는 자리가 둘이다 — 그래서 하한을 적으면 되돌릴 근거가 없다
  assert.deepEqual(RELEASE_DEPENDENTS.filter((d) => d.durable).map((d) => d.key), ['ledger_duration', 'rto_attainment']);
  // ⬅ 전건이 **인자**다(표지·표 칸에서 가져오지 않는다)
  for (const d of RELEASE_DEPENDENTS) assert.ok(d.nowFrom.length > 0);
  assert.equal(releaseDependentFor('ledger_duration')?.durable, true);
  assert.equal(releaseDependentFor('없는 자리'), null);
});

test('정본: 영구 의존처가 사라지거나 빈 칸이 생기면 CI 에서 걸린다', () => {
  assert.ok(auditReleaseCanon([]).length > 0);
  const notDurable = RELEASE_DEPENDENTS.map((d) => ({ ...d, durable: false }));
  assert.ok(auditReleaseCanon(notDurable).some((p) => p.includes('영구 기록')));
  const blank = [{ ...RELEASE_DEPENDENTS[0], lostWhen: ' ' }];
  assert.ok(auditReleaseCanon(blank).some((p) => p.includes('빈 칸')));
});

test('정본: 표지 여섯이 **전건** 해제 앞뒤로 분류돼 있다 — 새 표지가 생기면 막힌다', () => {
  assert.equal(RELEASE_BOUNDS.length, TIMELINE_MARKERS.length);
  for (const m of TIMELINE_MARKERS) assert.ok(releaseBoundFor(m.key), `${m.key} 가 분류되지 않았다`);
  // ⬅ 괄호의 위쪽은 고지 시각 하나뿐이다(8단계 2번 = 해제 뒤)
  assert.deepEqual(
    RELEASE_BOUNDS.filter((b) => b.side === 'after_release').map((b) => b.key),
    ['RECOVERY_LOSS_NOTICE_AT'],
  );
  // ⬅ 꼬리 구간의 시작은 **대조 시각** 하나다(§3-9)
  assert.deepEqual(RELEASE_BOUNDS.filter((b) => b.tailStart).map((b) => b.key), ['RECOVERY_EXTERNAL_RECONCILED_AT']);
  // 표지가 하나 늘고 분류되지 않으면 CI 가 막는다 — 괄호가 조용히 틀어지는 것을 막는다
  const extra = [...TIMELINE_MARKERS, { key: 'RECOVERY_SOMETHING_NEW_AT' }];
  assert.ok(auditReleaseCanon(undefined, undefined, undefined, undefined, extra).some((p) => p.includes('분류되지 않았다')));
  // 정본에 없는 유령 키도 걸린다
  const ghost = [...RELEASE_BOUNDS, { key: 'RECOVERY_GHOST_AT', side: 'before_release' as const, why: 'x' }];
  assert.ok(auditReleaseCanon(undefined, ghost).some((p) => p.includes('유령 표지')));
  // 뒤쪽 표지를 없애면 괄호의 위쪽이 영구히 열린다
  const noAfter = RELEASE_BOUNDS.map((b) => ({ ...b, side: 'before_release' as const }));
  assert.ok(auditReleaseCanon(undefined, noAfter).some((p) => p.includes('위쪽이 영구히 열린다')));
  // 꼬리의 시작이 둘이 되거나 사라지면 §3-9 구간이 어느 시각에서 시작하는지 모르게 된다
  const twoTails = RELEASE_BOUNDS.map((b) => ({ ...b, tailStart: true as const }));
  assert.ok(auditReleaseCanon(undefined, twoTails).some((p) => p.includes('꼬리 구간의 시작')));
  const noWhy = [{ ...RELEASE_BOUNDS[0], why: ' ' }, ...RELEASE_BOUNDS.slice(1)];
  assert.ok(auditReleaseCanon(undefined, noWhy).some((p) => p.includes('근거가 없다')));
});

test('정본: 거짓이 되는 판정 다섯과 사각지대 여섯이 사유와 함께 있다', () => {
  assert.equal(RELEASE_MISREADS.length, 5);
  assert.deepEqual(RELEASE_MISREADS.map((m) => m.key), [
    'floor_as_measurement', 'now_as_release', 'freeze_at_as_release', 'saved_as_effective', 'reconciled_as_release',
  ]);
  assert.equal(RELEASE_BLIND_SPOTS.length, 6);
  assert.equal(RELEASE_LIMITS.length, 7);
  // 하한을 실측으로 적는 길과 대조 시각을 끝으로 쓰는 길은 **목록에서 사라질 수 없다**
  const without = RELEASE_MISREADS.filter((m) => m.key !== 'floor_as_measurement');
  assert.ok(auditReleaseCanon(undefined, undefined, without).some((p) => p.includes('floor_as_measurement')));
  const without2 = RELEASE_MISREADS.filter((m) => m.key !== 'reconciled_as_release');
  assert.ok(auditReleaseCanon(undefined, undefined, without2).some((p) => p.includes('reconciled_as_release')));
  const dup = [...RELEASE_MISREADS, RELEASE_MISREADS[0]];
  assert.ok(auditReleaseCanon(undefined, undefined, dup).some((p) => p.includes('겹친다')));
  assert.ok(auditReleaseCanon(undefined, undefined, undefined, [{ key: 'x', what: '', why: '' }]).some((p) => p.includes('사각지대')));
});

/* ─────────────────────── 해제 시각의 괄호 ─────────────────────── */

test('괄호: 선행 기록의 **가장 늦은** 시각과 고지 시각이 해제를 묶는다', () => {
  const b = bracketRelease(incident({
    RECOVERY_SECURITY_REAPPLIED_AT: SECURITY,
    RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED,
    RECOVERY_LOSS_NOTICE_AT: NOTICE,
  }));
  assert.equal(b.verdict, 'bracketed');
  // ⬅ 아래쪽은 **가장 늦은** 선행 기록(대조 15:20)이다 — 차단 시각이 아니다
  assert.equal(b.startKey, 'RECOVERY_EXTERNAL_RECONCILED_AT');
  assert.equal(b.endKey, 'RECOVERY_LOSS_NOTICE_AT');
  assert.equal(b.widthMinutes, 50); // 15:20 ~ 16:10
  assert.equal(b.used, 4);
  // 실제 해제(15:40)가 그 안에 있다
  assert.ok(Date.parse(RELEASED) > Date.parse(b.startAt!) && Date.parse(RELEASED) < Date.parse(b.endAt!));
});

test('괄호: 한쪽만 있으면 그 사실을 말하고 폭을 지어내지 않는다', () => {
  const start = bracketRelease(incident());
  assert.equal(start.verdict, 'start_only');
  assert.equal(start.widthMinutes, null);
  const end = bracketRelease({ RECOVERY_LOSS_NOTICE_AT: NOTICE });
  assert.equal(end.verdict, 'end_only');
  assert.equal(end.startAt, null);
  const open = bracketRelease({});
  assert.equal(open.verdict, 'open');
  assert.equal(open.used, 0);
  // 판독 불가는 괄호를 좁히지 못한다 — 「없다」와 같게 센다(값은 고쳐야 한다)
  assert.equal(bracketRelease({ RECOVERY_WRITE_FREEZE_AT: '오후 세시쯤' }).verdict, 'open');
});

test('괄호: 뒤집힌 괄호를 0 으로 깎아 「거의 안다」로 만들지 않는다', () => {
  const b = bracketRelease(incident({ RECOVERY_LOSS_NOTICE_AT: '2026-10-30T11:00:00+09:00' }));
  assert.equal(b.verdict, 'inverted');
  assert.equal(b.widthMinutes, null);
  assert.match(b.note, /옛 사건의 값|타임존/);
  assert.ok(BRACKET_VERDICTS.includes(b.verdict));
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('판정: 차단 중이 **적을 수 있는 유일한 시점**이다', () => {
  const a = assessFreezeRelease({ env: incident({ RECOVERY_WRITE_FREEZE: 'true' }), now: NOW });
  assert.equal(a.verdict, 'frozen');
  assert.equal(a.captureDue, true);
  assert.equal(a.actionable, true);
  assert.equal(a.action, ACTION_RELEASE_FROZEN);
  // 참고용 경과시간은 **소요시간이 아니다**
  assert.equal(a.durationFloorMinutes, null);
  assert.equal(a.elapsedMinutes, 270);
  assert.equal(a.rtoQualified, 'none');
  // 차단 중에 해제 시각을 넘겨도 「아직 끝나지 않았다」가 결론이다(끝을 확정하면 꼬리가 빠진다)
  const early = assessFreezeRelease({ env: incident({ RECOVERY_WRITE_FREEZE: 'true' }), releasedAt: RELEASED, now: NOW });
  assert.equal(early.verdict, 'frozen');
  // 느슨한 스위치 판독을 하지 않는다 — `1` 은 OFF 다
  assert.notEqual(assessFreezeRelease({ env: incident({ RECOVERY_WRITE_FREEZE: '1' }), now: NOW }).verdict, 'frozen');
});

test('판정: 해제했는데 시각이 없으면 **표지를 지우기 전이 마지막 기회**다', () => {
  const a = assessFreezeRelease({ env: incident({ RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED }), now: NOW });
  assert.equal(a.verdict, 'released_unrecorded');
  assert.equal(a.lastChance, true);
  assert.equal(a.captureDue, false);
  assert.equal(a.action, ACTION_RELEASE_UNRECORDED);
  // 수치를 지어내지 않는다 — 말할 수 있는 것은 괄호뿐이다
  assert.equal(a.durationFloorMinutes, null);
  assert.equal(a.durationMinutes, null);
  assert.equal(a.bracket.verdict, 'start_only');
});

test('판정: 두 끝이 모두 있을 때만 **실측**이고, 끝만 있으면 하한이다', () => {
  const measured = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: STARTED, now: NOW });
  assert.equal(measured.verdict, 'measured');
  assert.equal(measured.rtoQualified, 'measurement');
  assert.equal(measured.durationMinutes, 215); // 12:05 ~ 15:40
  assert.equal(measured.durationFloorMinutes, 190); // 12:30 ~ 15:40
  assert.equal(measured.action, ACTION_RELEASE_MEASURED);
  // 할 일이 없으면 상시로 할 일을 내보내지 않는다
  assert.equal(measured.actionable, false);

  const floor = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, now: NOW });
  assert.equal(floor.verdict, 'floor_only');
  assert.equal(floor.rtoQualified, 'floor');
  assert.equal(floor.durationMinutes, null);
  assert.equal(floor.durationFloorMinutes, 190);
  assert.equal(floor.action, ACTION_RELEASE_FLOOR_ONLY);
  // ⬅ **하한은 실측보다 작다** — 그대로 적으면 §1-2 가 `met` 을 낸다
  assert.ok(floor.durationFloorMinutes! < measured.durationMinutes!);
  assert.ok(floor.caveats.includes(CAVEAT_FLOOR_IS_NOT_MEASUREMENT));
  assert.ok(!measured.caveats.includes(CAVEAT_FLOOR_IS_NOT_MEASUREMENT));
});

test('판정: 시작 시각이 차단보다 **뒤**이거나 못 읽히면 실측으로 올리지 않는다', () => {
  const after = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: SECURITY, now: NOW });
  assert.equal(after.verdict, 'floor_only');
  assert.equal(after.startRejected, 'after_freeze');
  assert.equal(after.startedAt, null);
  const bad = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: '어제 점심', now: NOW });
  assert.equal(bad.verdict, 'floor_only');
  assert.equal(bad.startRejected, 'unreadable');
  // 정상 입력에는 거절 사유가 없다
  assert.equal(assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: STARTED, now: NOW }).startRejected, null);
});

test('판정 순서: 못 읽는 값을 「없다」로 세지 않고, 기준점 문제가 먼저다', () => {
  // 기준점(차단 시각)을 못 읽으면 하한으로도 말할 수 없다 — 해제 시각이 있어도 이쪽이 먼저다
  const anchorBad = assessFreezeRelease({ env: { RECOVERY_WRITE_FREEZE_AT: 'x' }, releasedAt: RELEASED, now: NOW });
  assert.equal(anchorBad.verdict, 'invalid_record');
  assert.equal(anchorBad.action, ACTION_RELEASE_INVALID_RECORD);
  // 넘겨받은 해제 시각을 못 읽는 것은 「넣지 않았다」와 할 일이 다르다
  const relBad = assessFreezeRelease({ env: incident(), releasedAt: '오후 세시 사십분', now: NOW });
  assert.equal(relBad.verdict, 'invalid_release');
  assert.equal(relBad.action, ACTION_RELEASE_INVALID_RELEASE);
  // 음수 구간을 0 으로 바꿔 「즉시 복구」로 적지 않는다
  const before = assessFreezeRelease({ env: incident(), releasedAt: '2026-10-30T11:00:00+09:00', now: NOW });
  assert.equal(before.verdict, 'release_before_freeze');
  assert.equal(before.action, ACTION_RELEASE_BEFORE_FREEZE);
  assert.equal(before.durationFloorMinutes, null);
  // 미래 시각은 「아직 해제하지 않았다」일 수 있다
  assert.equal(
    assessFreezeRelease({ env: incident(), releasedAt: '2026-10-31T10:00:00+09:00', now: NOW }).verdict,
    'future_release',
  );
  for (const v of [anchorBad, relBad, before]) assert.ok(RELEASE_VERDICTS.includes(v.verdict));
});

test('판정: 평상시와 **마무리를 끝낸 뒤**를 구분했다고 하지 않는다', () => {
  const a = assessFreezeRelease({ env: {}, now: NOW });
  assert.equal(a.verdict, 'not_applicable');
  assert.equal(a.actionable, false);
  assert.equal(a.action, ACTION_RELEASE_NOT_APPLICABLE);
  assert.match(a.action, /8단계 4번을 마친 뒤도 같은 모습/);
  assert.equal(a.bracket.verdict, 'open');
});

test('꼬리 구간: 6-2 대조와 해제 사이는 **어떤 대조에도 들어가지 않는다**', () => {
  const open = assessFreezeRelease({ env: incident({ RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED }), now: NOW });
  assert.equal(open.tailOpen, true);
  assert.equal(open.tailMinutes, null);
  assert.ok(open.caveats.includes(CAVEAT_TAIL_IS_UNRECONCILED));
  const closed = assessFreezeRelease({
    env: incident({ RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED }),
    releasedAt: RELEASED,
    now: NOW,
  });
  assert.equal(closed.tailOpen, false);
  assert.equal(closed.tailMinutes, 20); // 15:20 ~ 15:40
  // 대조 기록이 없으면 꼬리를 말하지 않는다(없는 구간을 만들지 않는다)
  const none = assessFreezeRelease({ env: incident(), now: NOW });
  assert.equal(none.tailOpen, false);
  assert.equal(none.tailMinutes, null);
});

/* ─────────────────── §3-7 계산의 주인은 그대로다 ─────────────────── */

test('수치 계산을 복제하지 않는다 — §3-7 `assessDuration` 에 두 끝만 넘긴다', () => {
  const a = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: STARTED, now: NOW });
  const d = assessDuration(a.durationInput);
  assert.equal(d.verdict, 'ok');
  assert.equal(d.minutes, a.durationMinutes);
  // 끝만 있으면 그쪽도 산출하지 않는다 — **하한을 칸에 넣는 경로가 코드에 없다**
  const floor = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, now: NOW });
  const d2 = assessDuration(floor.durationInput);
  assert.equal(d2.verdict, 'invalid_start');
  assert.equal(d2.minutes, null);
  assert.equal(d2.cell, '[확인 필요]');
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('출력: 공개 모양에 **시각 좌표가 없다**(§2-3) — 길이만 담는다', () => {
  const a = assessFreezeRelease({
    env: incident({ RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED, RECOVERY_LOSS_NOTICE_AT: NOTICE }),
    releasedAt: RELEASED,
    startedAt: STARTED,
    now: NOW,
  });
  const pub = publicRelease(a);
  const json = JSON.stringify(pub);
  for (const t of [FROZE, RELEASED, STARTED, RECONCILED, NOTICE, '12:30', '15:40']) {
    assert.ok(!json.includes(t), `공개 모양에 시각이 들어 있다: ${t}`);
  }
  assert.equal(pub.verdict, 'measured');
  assert.equal(pub.rtoQualified, 'measurement');
  assert.equal(pub.ref, RELEASE_RUNBOOK_REF);
  // 로그 한 줄에도 좌표를 담지 않는다(수치·판정만)
  const line = releaseLine(a);
  assert.match(line, /^\[freeze-release\] verdict=measured/);
  for (const t of [FROZE, RELEASED, STARTED]) assert.ok(!line.includes(t));
  // 사람이 읽는 요약은 조치를 함께 낸다 — 하한일 때는 「실측이 아니다」를 말한다
  const floorText = releaseText(assessFreezeRelease({ env: incident(), releasedAt: RELEASED, now: NOW }));
  assert.match(floorText, /하한 190분/);
  assert.match(floorText, /실측이 아니다/);
  // 산출할 수 없을 때 수치를 지어내지 않는다 — 괄호와 꼬리만 말한다
  const unknown = releaseText(assessFreezeRelease({
    env: incident({ RECOVERY_EXTERNAL_RECONCILED_AT: RECONCILED, RECOVERY_LOSS_NOTICE_AT: NOTICE }),
    now: NOW,
  }));
  assert.match(unknown, /소요시간을 산출할 수 없다/);
  assert.match(unknown, /꼬리 구간이 확정되지 않았다/);
  assert.match(releaseText(assessFreezeRelease({ env: {}, now: NOW })), /괄호 open/);
  const status = freezeReleaseStatus({ env: incident(), releasedAt: RELEASED, now: NOW });
  assert.equal(status.rtoQualified, 'floor');
  assert.equal(status.dependents, RELEASE_DEPENDENTS.length);
  assert.equal(status.limits, RELEASE_LIMITS.length);
});

test('출력: 표지가 없다는 사실을 판정과 함께 내보낸다', () => {
  const a = assessFreezeRelease({ env: incident(), releasedAt: RELEASED, startedAt: STARTED, now: NOW });
  assert.ok(a.caveats.includes(CAVEAT_RELEASE_HAS_NO_MARKER));
  assert.match(CAVEAT_RELEASE_HAS_NO_MARKER, /§3-14/);
});

/* ─────────────────────── 실제 소스·문서 대조 ─────────────────────── */

test('[실제 소스] 이 모듈은 env 를 읽지 않고 판독을 복제하지 않는다', () => {
  assert.deepEqual(auditSelfSource(SELF_SRC), []);
  assert.deepEqual(auditNoNewEnv(SELF_SRC), []);
  // ⬅ **신규 env 0** — 레지스트리 스캐너로도 읽는 키가 하나도 없다
  assert.deepEqual(scanEnvReads(SELF_SRC), []);
  assert.ok(auditSelfSource('const x = process.env.FOO').length > 0);
  assert.ok(auditSelfSource("import { db } from './db.ts'").length > 0);
  assert.ok(auditSelfSource("import { NextResponse } from 'next/server'").length > 0);
  assert.ok(auditSelfSource('').some((p) => p.includes('readTimeline')));
  assert.ok(auditSelfSource('').some((p) => p.includes('parseInstant')));
  assert.ok(auditSelfSource('').some((p) => p.includes('writeFreezeEnabled')));
  // 판정이 재현되지 않게 되는 길(모듈 안에서 현재 시각을 집어오는 것)도 막는다
  assert.ok(auditSelfSource('const now = Date.now()').some((p) => p.includes('현재 시각')));
  // **신규 사건 표지 0** — 해제 시각 키를 만들면 CI 가 막는다(§3-14)
  assert.ok(auditNoNewEnv("const K = 'RECOVERY_WRITE_FREEZE_LIFTED_AT'").some((p) => p.includes('§3-14')));
  assert.ok(auditNoNewEnv("const K = 'RECOVERY_RELEASE_AT'").length > 0);
  // 이미 있는 표지는 들고 있어도 된다(판독을 재사용하기 위해 키 이름을 적는다)
  assert.deepEqual(auditNoNewEnv("const K = 'RECOVERY_LOSS_NOTICE_AT'"), []);
});

test('[실제 소스] 판정이 `checks.incidentClosure` 응답에 실려 있고 새 체크는 없다', () => {
  assert.deepEqual(auditClosureWiring(CLOSURE_SRC), []);
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  // 배선이 빠지는 길 전부
  assert.ok(auditClosureWiring('').some((p) => p.includes('import')));
  assert.ok(auditClosureWiring("import { assessFreezeRelease } from './freezeRelease.ts';").some((p) => p.includes('호출')));
  assert.ok(
    auditClosureWiring("import { assessFreezeRelease } from './freezeRelease.ts';\nassessFreezeRelease({});")
      .some((p) => p.includes('판정만 하고 버린다')),
  );
  assert.ok(
    auditClosureWiring(
      "import { assessFreezeRelease } from './freezeRelease.ts';\nassessFreezeRelease({});\nreleaseVerdict: release.verdict,\nexport function assessDuration(",
    ).some((p) => p.includes('rtoQualified')),
  );
  // 계산의 주인이 §3-7 에서 사라지면 두 수치가 갈라진다
  assert.ok(
    auditClosureWiring(CLOSURE_SRC.replace('export function assessDuration', 'function assessDuration'))
      .some((p) => p.includes('assessDuration')),
  );
  // 새 체크가 생기는 순간 막는다
  assert.ok(auditNoNewHealthCheck('checks.freezeRelease = releaseCheck();').length > 0);
});

test('[실제 응답] `closureCheck` 가 판정을 담고 어휘·`ok` 는 그대로다', () => {
  const normal = closureCheck({ env: {} });
  assert.equal(normal.detail.state, 'normal');
  assert.equal(normal.detail.releaseVerdict, 'not_applicable');
  assert.equal(normal.detail.releaseCaptureDue, false);
  assert.equal(normal.ok, true);

  const frozen = closureCheck({ env: incident({ RECOVERY_WRITE_FREEZE: 'true' }) });
  assert.equal(frozen.detail.state, 'recorded');
  // ⬅ 판정 어휘와 `ok` 를 바꾸지 않는다 — 달라지는 것은 **다음에 할 일**이다
  assert.equal(frozen.ok, true);
  assert.equal(frozen.detail.releaseVerdict, 'frozen');
  assert.equal(frozen.detail.releaseCaptureDue, true);
  assert.match(String(frozen.detail.note), /해제하는 순간/);

  const stale = closureCheck({ env: incident({ RECOVERY_LOSS_NOTICE_AT: NOTICE }) });
  assert.equal(stale.detail.state, 'stale_record');
  assert.equal(stale.detail.releaseVerdict, 'released_unrecorded');
  assert.equal(stale.detail.releaseBracket, 'bracketed');
  assert.equal(stale.detail.releaseRtoQualified, 'none');
  // 런타임은 해제 시각을 받을 수 없으므로 **실측을 말하지 않는다**
  assert.notEqual(stale.detail.releaseRtoQualified, 'measurement');
  // 공개 응답에 시각 좌표를 더하지 않았다
  const json = JSON.stringify(stale.detail);
  assert.ok(!json.includes('releaseBracketStart'));
  assert.equal(typeof stale.detail.releaseBracketMinutes, 'number');
});

test('[실제 문서] §3-22 절·판정 표·거짓 판정·명령·유도가 있다', () => {
  assert.deepEqual(auditRunbookRelease(RUNBOOK), []);
  assert.ok(auditRunbookRelease('').some((p) => p.includes('§3-22 소절이 없다')));
  assert.ok(auditRunbookRelease(RUNBOOK.replace('`floor_only`', 'x')).some((p) => p.includes('floor_only')));
  assert.ok(auditRunbookRelease(RUNBOOK.replace('`now_as_release`', 'x')).some((p) => p.includes('now_as_release')));
  assert.ok(auditRunbookRelease(RUNBOOK.replace('assessFreezeRelease(', 'x(')).some((p) => p.includes('산출 명령')));
  // 7·8단계에서 유도가 빠지면 적으라고 말하는 자리가 사라진다 — 해제 뒤에는 되찾을 수 없다
  assert.ok(
    auditRunbookRelease(RUNBOOK.replace(/3-22/g, '3-99')).some((p) => p.includes('7단계가')),
    '7단계 유도 회귀를 놓쳤다',
  );
  assert.ok(auditRunbookRelease(RUNBOOK.replace(/3-22/g, '3-99')).some((p) => p.includes('8단계가')));
  // 7단계가 유도하지 않으면 적으라고 말하는 자리가 사라진다 — 해제 뒤에는 되찾을 수 없다
  const sec3 = RUNBOOK.slice(RUNBOOK.indexOf('## 3. DB 복구 절차'), RUNBOOK.indexOf('### 3-1.'));
  const step7 = sec3.indexOf('7. **쓰기 차단 해제**');
  const step8 = sec3.indexOf('8. **사후**');
  assert.ok(step7 > 0 && step8 > step7);
  assert.ok(sec3.slice(step7, step8).includes('3-22'), '7단계가 이 절로 유도하지 않는다');
  assert.ok(sec3.slice(step8).includes('3-22'), '8단계가 이 절로 유도하지 않는다');
  // 8단계 3번(표 기록)이 두 끝을 비고에 적으라고 말하는지 — 표의 칸은 「분」뿐이다
  assert.match(sec3.slice(step8), /비고 칸에 함께 적는다/);
});

test('[실제 문서] 절차 단위 정본에 3-22 가 등록돼 있고 체크리스트가 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-22');
  assert.ok(unit, 'RUNBOOK 소절이 리허설 단위 정본에 없으면 절차는 자라는데 범위 판정은 그대로 ok 가 된다');
  assert.equal(unit!.cited, true);
  assert.ok(unit!.skipped.includes('소요시간'));
  const checklist = RUNBOOK.slice(RUNBOOK.search(/^###\s*리허설 체크리스트/m));
  assert.ok(checklist.includes('3-22'));
  assert.ok(/- \[ \] \*\*해제하기 전에\*\* 그 시각을 적을 준비/.test(checklist), '체크리스트 항목이 비어 있지 않은 칸으로 커밋됐다(§6-9)');
  assert.ok(/releaseRtoQualified/.test(checklist), '소요시간이 실측인지 하한인지 보라는 항목이 없다');
});
