// 근거 보존을 **수행했는가** 테스트(RUNBOOK §3-15·§3-5). 2026-10-25
//
// 이 파일이 지키는 것은 하나다 — **되돌릴 수 없는 두 일 중 한쪽에만 수행 근거가 있었다.**
//  (1) 5단계 전환은 재생성 불가능한 감사 이력을 되돌리는데, §3-5 보존에는 표지가 없었다
//  (2) 그래서 그 보존본을 **유일한 출처**로 삼는 6-1단계 2·3번이 「수행됨」으로 보인다
//      (시각은 적을 수 있고, §3-14 귀속까지 통과한다)
//  (3) 보존을 차단 **전에** 받으면 유실 구간의 **끝부분**이 보존본에서 빠지는데
//      절차는 순서를 2단계 기준으로 못박지 않았다
//  (4) 그러면서도 `state`·`ok` 어휘를 바꾸지 않는다 — 보존은 사람이 하는 일이고,
//      미기록으로 `ok` 를 내리면 복구일에 거짓 차단이 된다
//  (5) 구분할 수 없는 것(차단보다 앞선 시각)을 구분했다고 하지 않는다
// 더해서 실제 모듈·정본·`/api/health` 라우트·RUNBOOK 원문을 대조해 배선과 문서가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_PRESERVE_BEFORE_ANCHOR, ACTION_PRESERVE_INVALID, ACTION_PRESERVE_NORMAL,
  ACTION_PRESERVE_PENDING, ACTION_PRESERVE_RECORDED, ACTION_PRESERVE_STALE,
  ACTION_PRESERVE_UNANCHORED, CAVEAT_CLAIM_NOT_PROOF, CAVEAT_CROSS_TENANT_BLIND,
  CAVEAT_OUTSIDE_DB_UNKNOWN, CAVEAT_TRUNCATION_UNKNOWN,
  COVERAGE_VERDICTS, EVIDENCE_AVAILABILITIES, EVIDENCE_DEPENDENTS, EVIDENCE_SOURCES,
  PRESERVATION_LIMITS, PRESERVATION_RUNBOOK_REF, PRESERVATION_STATES, PRESERVED_AT_ENV,
  assessPreservation, auditClosureWiring, auditMarkerCoverage, auditNoNewHealthCheck,
  auditPreservationCanon, auditRunbookPreservation, auditSecurityWiring, auditTimelineCoverage,
  auditTransientCoverage, coverageGap, evidenceAvailability, preservationLine, preservationStatus,
  preservationText, preservedAtFromEnv, publicPreservation,
} from '../src/lib/evidencePreservation.ts';
import { FREEZE_AT_ENV, closureCheck } from '../src/lib/incidentClosure.ts';
import { SECURITY_REAPPLIED_ENV, securityReapplyCheck } from '../src/lib/postRestoreSecurity.ts';
import { ANCHOR_ENV, TIMELINE_MARKERS } from '../src/lib/incidentTimeline.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseChecklistBoxes, unitItemLoad } from '../src/lib/rehearsalChecklist.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const MODULE_SRC = read('src', 'lib', 'evidencePreservation.ts');
const CLOSURE_SRC = read('src', 'lib', 'incidentClosure.ts');
const SECURITY_SRC = read('src', 'lib', 'postRestoreSecurity.ts');
const ROUTE_SRC = read('src', 'app', 'api', 'health', 'route.ts');

/** 한 사건의 정상 순서 — 2단계 차단 → §3-5 보존 → 6-1단계 재적용 */
const T_FREEZE = '2026-10-25T02:10:00+09:00';
const T_PRESERVE = '2026-10-25T02:25:00+09:00';
const T_SECURITY = '2026-10-25T03:00:00+09:00';
/** 차단 **전에** 받은 보존(15분 구간이 보존본에서 빠진다) */
const T_EARLY = '2026-10-25T01:55:00+09:00';
/** 지난 복구(몇 달 전)가 남긴 값 */
const T_OLD = '2026-07-02T11:00:00+09:00';

const FROZEN: Record<string, string | undefined> = {
  RECOVERY_WRITE_FREEZE: 'true',
  [ANCHOR_ENV]: T_FREEZE,
  [PRESERVED_AT_ENV]: T_PRESERVE,
};

/* ─────────────────────────────── 정본 ─────────────────────────────── */

test('정본: 출처·의존 단계가 사유와 함께 적혀 있고 모양 점검을 통과한다', () => {
  assert.deepEqual(auditPreservationCanon(), []);
  assert.ok(EVIDENCE_SOURCES.length >= 2, '감사로그와 보안 이벤트 두 출처가 모두 있어야 한다');
  assert.ok(EVIDENCE_SOURCES.some((s) => s.path.includes('/api/audit')));
  assert.ok(EVIDENCE_SOURCES.some((s) => s.path.includes('security-events')));
  assert.ok(EVIDENCE_DEPENDENTS.length >= 5, '보존본에 매달린 단계 목록이 줄었다');
  // ⬅ 이 장치의 전제: 보존을 거른 복구에서 **아무 검증도 실패하지 않는다**
  for (const d of EVIDENCE_DEPENDENTS) assert.equal(d.failsLoudly, false, `${d.step} 이 시끄럽게 실패한다고 선언됐다`);
  assert.ok(EVIDENCE_DEPENDENTS.some((d) => d.step.includes('6-1단계 2번')), '6-1단계 2번이 목록에서 빠졌다');
});

test('정본 모양 점검: 설명이 빈 칸과 「시끄럽게 실패한다」 선언을 잡는다', () => {
  const blank = EVIDENCE_SOURCES.map((s) => ({ ...s, completeness: '' }));
  assert.ok(auditPreservationCanon(blank).some((p) => p.includes('끝까지 받았는지')));
  const loud = EVIDENCE_DEPENDENTS.map((d) => ({ ...d, failsLoudly: true }));
  assert.ok(
    auditPreservationCanon(EVIDENCE_SOURCES, loud).some((p) => p.includes('failsLoudly')),
    '실패하는 검증이 있다고 선언해도 통과했다 — 그러면 이 모듈이 아니라 그 검증을 가리켜야 한다',
  );
  assert.ok(auditPreservationCanon([], EVIDENCE_DEPENDENTS).some((p) => p.includes('비었다')));
});

test('정본: 한계 목록이 **주장과 사실**을 구분해 적어 둔다', () => {
  assert.ok(PRESERVATION_LIMITS.length >= 7, '사각지대를 줄였다');
  for (const c of [
    CAVEAT_CLAIM_NOT_PROOF, CAVEAT_TRUNCATION_UNKNOWN, CAVEAT_OUTSIDE_DB_UNKNOWN, CAVEAT_CROSS_TENANT_BLIND,
  ]) {
    assert.ok(PRESERVATION_LIMITS.includes(c), '한계 하나가 목록에서 빠졌다');
  }
  assert.match(PRESERVATION_RUNBOOK_REF, /3-15/);
});

/* ─────────────────────────────── 판독 ─────────────────────────────── */

test('preservedAtFromEnv: 미설정·공백은 미설정, 판독 불가는 **「없다」로 세지 않는다**', () => {
  assert.deepEqual(preservedAtFromEnv({}), { raw: null, at: null });
  assert.deepEqual(preservedAtFromEnv({ [PRESERVED_AT_ENV]: '   ' }), { raw: null, at: null });
  const bad = preservedAtFromEnv({ [PRESERVED_AT_ENV]: '어제 오후' });
  assert.equal(bad.at, null);
  assert.equal(bad.raw, '어제 오후', '읽을 수 없는 값이 들어 있다는 사실까지 버렸다');
  assert.equal(preservedAtFromEnv({ [PRESERVED_AT_ENV]: T_PRESERVE }).at, new Date(T_PRESERVE).toISOString());
  // 기본값을 만들지 않는다
  assert.equal(preservedAtFromEnv({ RECOVERY_WRITE_FREEZE: 'true' }).at, null);
});

/* ─────────────────────────────── 보존 범위 ─────────────────────────────── */

test('coverageGap: 차단 뒤 보존은 `ok`, 차단 앞 보존은 **덮지 못한 구간을 분으로** 낸다', () => {
  assert.deepEqual(coverageGap(T_PRESERVE, T_FREEZE).verdict, 'ok');
  assert.equal(coverageGap(T_PRESERVE, T_FREEZE).minutes, null, '정상인데 수치를 지어냈다');

  const gap = coverageGap(T_EARLY, T_FREEZE);
  assert.equal(gap.verdict, 'uncovered');
  assert.equal(gap.minutes, 15);
  assert.match(gap.text, /끝부분/);

  // 같은 시각이면 덮은 것으로 본다(차단 실효와 동시 내보내기)
  assert.equal(coverageGap(T_FREEZE, T_FREEZE).verdict, 'ok');
  // 한쪽을 못 읽으면 「덮었다」로 올리지 않는다
  for (const pair of [[null, T_FREEZE], [T_PRESERVE, null], ['어제', T_FREEZE]] as const) {
    const u = coverageGap(pair[0], pair[1]);
    assert.deepEqual([u.verdict, u.minutes], ['unknown', null]);
  }
});

/* ─────────────────────────────── 판정 ─────────────────────────────── */

test('assessPreservation: 평상시는 `normal` — 차단도 기록도 없는 것이 정상이다', () => {
  const a = assessPreservation({ env: {} });
  assert.deepEqual([a.state, a.recorded, a.actionable], ['normal', false, false]);
  assert.equal(a.action, ACTION_PRESERVE_NORMAL);
  assert.equal(a.basis, 'absent');
  assert.equal(a.coverage.verdict, 'unknown');
});

test('assessPreservation: 차단 중 미기록이 `pending` ⬅ 기록할 수 있는 **마지막 시점**이다', () => {
  const a = assessPreservation({ env: { RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE } });
  assert.deepEqual([a.state, a.actionable], ['pending', true]);
  assert.equal(a.action, ACTION_PRESERVE_PENDING);
  assert.equal(a.dependentCount, EVIDENCE_DEPENDENTS.length);
});

test('assessPreservation: 차단 뒤 보존은 `recorded` + 귀속 가능 + 범위 `ok`', () => {
  const a = assessPreservation({ env: FROZEN });
  assert.deepEqual([a.state, a.corroborated, a.basis], ['recorded', true, 'anchor']);
  assert.deepEqual([a.coverage.verdict, a.actionable], ['ok', false]);
  assert.equal(a.action, ACTION_PRESERVE_RECORDED);
  assert.match(a.action, /완전성은 이 값이 말해 주지 않는다|capture\.verdict/, '완전성을 보장한 것처럼 말한다');
});

test('assessPreservation: 차단 **앞** 보존과 옛 표지는 **같은 모습**이다 — 구분했다고 하지 않는다', () => {
  const early = assessPreservation({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_EARLY } });
  const old = assessPreservation({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_OLD } });
  for (const a of [early, old]) {
    assert.equal(a.state, 'recorded', 'state 어휘를 바꿨다');
    assert.equal(a.corroborated, false);
    assert.equal(a.basis, 'carried_over');
    assert.equal(a.coverage.verdict, 'uncovered');
    assert.equal(a.actionable, true);
    // 할 일은 **하나**다 — 세 가능성을 구분하는 척하지 않고, 어느 쪽이든 끝은 같다
    assert.equal(a.action, ACTION_PRESERVE_BEFORE_ANCHOR);
  }
  assert.equal(early.coverage.minutes, 15);
  assert.ok((old.coverage.minutes ?? 0) > 15 * 60, '옛 값은 간격이 크다');
  assert.ok(
    PRESERVATION_LIMITS.some((c) => c.includes('지난 사건의 표지')),
    '구분할 수 없다는 사실을 사각지대로 내보내지 않았다',
  );
});

test('assessPreservation: 앵커가 없으면 **귀속을 말하지 않는다**(「했다」도 「안 했다」도 아니다)', () => {
  const a = assessPreservation({ env: { RECOVERY_WRITE_FREEZE: 'true', [PRESERVED_AT_ENV]: T_PRESERVE } });
  assert.deepEqual([a.state, a.corroborated, a.basis], ['recorded', false, 'unanchored']);
  assert.equal(a.action, ACTION_PRESERVE_UNANCHORED);
  assert.equal(a.coverage.verdict, 'unknown', '기준점이 없는데 범위를 단정했다');
});

test('assessPreservation: 평상시에 남은 값은 `stale_record` ⬅ 지우는 것이 다음 사건의 게이트를 살린다', () => {
  const a = assessPreservation({ env: { [ANCHOR_ENV]: T_FREEZE, [PRESERVED_AT_ENV]: T_PRESERVE } });
  assert.deepEqual([a.state, a.actionable], ['stale_record', true]);
  assert.equal(a.action, ACTION_PRESERVE_STALE);

  // 앵커까지 지워 이 키만 남은 경우에도 할 일은 「지운다」다 — `unanchored`(= 「지금 적어라」)로
  // 뒤집히면 평상시에 사건 표지를 **넣으라고** 안내하게 된다.
  const alone = assessPreservation({ env: { [PRESERVED_AT_ENV]: T_PRESERVE } });
  assert.equal(alone.state, 'stale_record');
  assert.equal(alone.action, ACTION_PRESERVE_STALE);
});

test('assessPreservation: 판독 불가는 어느 쪽으로도 세지 않는다', () => {
  const a = assessPreservation({ env: { ...FROZEN, [PRESERVED_AT_ENV]: '2026-13-45' } });
  assert.deepEqual([a.state, a.recorded, a.preservedAt], ['invalid_record', false, null]);
  assert.equal(a.action, ACTION_PRESERVE_INVALID);
  assert.equal(a.actionable, true);
});

/* ───────────────────────── 6-1단계가 받는 한 칸 ───────────────────────── */

test('evidenceAvailability: 「시각을 적을 수 있었다」와 「대상을 추릴 수 있었다」를 가른다', () => {
  const of = (env: Record<string, string | undefined>) => evidenceAvailability(assessPreservation({ env })).availability;
  assert.equal(of(FROZEN), 'available');
  assert.equal(of({ RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE }), 'unrecorded');
  assert.equal(of({ ...FROZEN, [PRESERVED_AT_ENV]: T_OLD }), 'carried_over');
  assert.equal(of({ ...FROZEN, [PRESERVED_AT_ENV]: '어제' }), 'unreadable');
  // 6-1단계는 차단 중에만 하는 일이다 — 평상시에 남은 표지를 「출처가 있다」로 돌려주지 않는다
  assert.equal(of({}), 'not_applicable');
  assert.equal(of({ [ANCHOR_ENV]: T_FREEZE, [PRESERVED_AT_ENV]: T_PRESERVE }), 'not_applicable');
  for (const v of EVIDENCE_AVAILABILITIES) assert.ok(v.length > 0);
});

/* ─────────────────────────────── 출력 ─────────────────────────────── */

test('출력: 로그·공개 필터는 **시각을 담지 않는다**', () => {
  const a = assessPreservation({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_EARLY } });
  const line = preservationLine(a);
  assert.match(line, /evidence=recorded/);
  assert.match(line, /coverage=uncovered/);
  assert.match(line, /uncoveredMin=15/);
  assert.ok(!line.includes('2026-10-25T'), '로그에 시각이 들어갔다');

  const pub = publicPreservation(a);
  assert.deepEqual(
    [pub.state, pub.coverage, pub.uncoveredMinutes, pub.corroborated],
    ['recorded', 'uncovered', 15, false],
  );
  assert.ok(!JSON.stringify(pub).includes('2026-10-25T'), '공개 응답에 시각이 들어갔다');
  // 보관 위치·티켓 번호·행위자는 애초에 담지 않는다 — 담을 칸 자체가 없다
  assert.ok(!Object.keys(pub).some((k) => /location|ticket|owner|url/i.test(k)));
});

test('출력: 사람이 읽는 요약은 할 일과 사각지대를 함께 낸다', () => {
  const txt = preservationText(assessPreservation({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_OLD } }));
  assert.ok(txt.startsWith('[recorded]'), '`state` 어휘를 바꿨다');
  assert.ok(txt.includes('carried_over'));
  assert.ok(txt.includes(CAVEAT_CLAIM_NOT_PROOF), '사각지대를 떼고 내보냈다');
  assert.ok(txt.includes('조용히'), '보존을 거른 복구가 조용하다는 사실을 숨겼다');

  const s = preservationStatus(FROZEN);
  assert.deepEqual([s.state, s.recordKey, s.dependents], ['recorded', PRESERVED_AT_ENV, EVIDENCE_DEPENDENTS.length]);
  assert.equal(s.limits, PRESERVATION_LIMITS.length);
  assert.equal(preservationStatus({}).state, 'normal');
});

/* ─────────────────────────────── 배선 ─────────────────────────────── */

test('incidentClosure: `state`·`ok` 어휘는 그대로이고 보존 판정만 더해진다', () => {
  const recorded = closureCheck({ env: FROZEN });
  assert.deepEqual([recorded.detail.state, recorded.ok, recorded.required], ['recorded', true, false]);
  assert.equal(recorded.detail.evidenceState, 'recorded');
  assert.equal(recorded.detail.evidenceCorroborated, true);
  assert.equal(recorded.detail.evidenceCoverage, 'ok');
  assert.equal(recorded.detail.evidenceUncoveredMinutes, null);

  // 보존을 거른 채 차단만 기록한 상태 — 차단 쪽 판정은 `recorded`·`ok` 그대로다
  const unpreserved = closureCheck({ env: { RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE } });
  assert.deepEqual([unpreserved.detail.state, unpreserved.ok], ['recorded', true]);
  assert.equal(unpreserved.detail.evidenceState, 'pending');
  assert.ok(String(unpreserved.detail.note).includes('§3-5'), '같은 칸에서 할 일을 말하지 않았다');

  // 차단 앞에 받은 보존 — 덮지 못한 구간이 수치로 나온다
  const early = closureCheck({ env: { ...FROZEN, [PRESERVED_AT_ENV]: T_EARLY } });
  assert.equal(early.detail.evidenceCoverage, 'uncovered');
  assert.equal(early.detail.evidenceUncoveredMinutes, 15);
  assert.equal(early.ok, true, '보존 판정이 ok 를 끌어내렸다 — 복구일에 거짓 차단이 된다');

  // 평상시에는 한 글자도 더 달라지지 않는다
  const normal = closureCheck({ env: {} });
  assert.deepEqual([normal.detail.state, normal.detail.evidenceState], ['normal', 'normal']);
  assert.ok(!String(normal.detail.note).includes('§3-5'));
});

test('postRestoreSecurity: 「추릴 출처가 있었는가」를 자기 칸에서 함께 말한다', () => {
  const env = { ...FROZEN, [SECURITY_REAPPLIED_ENV]: T_SECURITY };
  const ok = securityReapplyCheck({ env });
  assert.deepEqual([ok.detail.state, ok.ok], ['recorded', true]);
  assert.equal(ok.detail.evidenceAvailable, 'available');

  // ⬅ 이 장치의 핵심: 보존을 거르면 2·3번은 **할 수 없었는데** `recorded` + 귀속까지 통과한다
  const noSource = securityReapplyCheck({
    env: { RECOVERY_WRITE_FREEZE: 'true', [ANCHOR_ENV]: T_FREEZE, [SECURITY_REAPPLIED_ENV]: T_SECURITY },
  });
  assert.deepEqual([noSource.detail.state, noSource.ok], ['recorded', true], '어휘·ok 를 바꿨다');
  assert.equal(noSource.detail.recordCorroborated, true, '귀속만으로는 못 잡는다는 전제가 깨졌다');
  assert.equal(noSource.detail.evidenceAvailable, 'unrecorded');
  assert.ok(String(noSource.detail.note).includes('출처'), '같은 칸에서 말하지 않으면 응답에만 남는다');

  const carried = securityReapplyCheck({ env: { ...env, [PRESERVED_AT_ENV]: T_OLD } });
  assert.equal(carried.detail.evidenceAvailable, 'carried_over');
  assert.equal(securityReapplyCheck({ env: {} }).detail.evidenceAvailable, 'not_applicable');
});

test('[실제 소스] 두 모듈이 판정을 **응답에 실어 보낸다**', () => {
  assert.deepEqual(auditClosureWiring(CLOSURE_SRC), []);
  assert.deepEqual(auditSecurityWiring(SECURITY_SRC), []);

  assert.ok(auditClosureWiring('export function closureCheck(){}').length >= 4, 'import 누락을 놓쳤다');
  const discarded = CLOSURE_SRC.replace(/evidenceCorroborated\s*:/g, 'unusedCorroborated:');
  assert.ok(
    auditClosureWiring(discarded).some((p) => p.includes('evidenceCorroborated')),
    '판정만 하고 버리는 꼴을 놓쳤다',
  );
  const dropped = SECURITY_SRC.replace(/evidenceAvailable\s*:/g, 'unused:');
  assert.ok(auditSecurityWiring(dropped).some((p) => p.includes('6-1단계 2번의 출처')));
  assert.ok(auditSecurityWiring('').length >= 3, 'import·호출·배선 누락을 모두 잡지 못했다');
  const noCall = SECURITY_SRC.replace(/evidenceAvailability\(/g, 'somethingElse(');
  assert.ok(auditSecurityWiring(noCall).some((p) => p.includes('evidenceAvailability()')));
});

test('[실제 소스] `/api/health` 에 **새 체크가 생기지 않았다**', () => {
  assert.deepEqual(auditNoNewHealthCheck(ROUTE_SRC), []);
  assert.ok(auditNoNewHealthCheck("import { x } from '@/lib/evidencePreservation';").length > 0);
  assert.ok(auditNoNewHealthCheck('checks.evidencePreservation = x();').length > 0);
  assert.ok(!/checks\.evidencePreservation/.test(ROUTE_SRC));
});

/* ─────────────────────────────── 정본 대조 ─────────────────────────────── */

test('[실제 정본] 표지·임시 키·시각 기록 세 정본에 **모두** 등록돼 있다', () => {
  assert.deepEqual(auditMarkerCoverage(INCIDENT_MARKERS), []);
  assert.deepEqual(auditTransientCoverage(TRANSIENT_KEYS), []);
  assert.deepEqual(auditTimelineCoverage(TIMELINE_MARKERS), []);
  assert.ok(ENV_VARS.some((v) => v.key === PRESERVED_AT_ENV), '§4 레지스트리에 키가 없다');
  assert.equal(ANCHOR_ENV, FREEZE_AT_ENV, '앵커가 §3-7 의 구간 끝 키와 갈라졌다');
});

test('정본 대조 점검: 한 곳에서만 빠져도 잡는다', () => {
  assert.ok(auditMarkerCoverage(INCIDENT_MARKERS.filter((m) => m.key !== PRESERVED_AT_ENV)).length > 0);
  assert.ok(auditMarkerCoverage([{ key: PRESERVED_AT_ENV, kind: 'switch' }]).some((p) => p.includes('판독 방식')));
  assert.ok(auditTransientCoverage(TRANSIENT_KEYS.filter((k) => k !== PRESERVED_AT_ENV)).length > 0);
  assert.ok(auditTimelineCoverage(TIMELINE_MARKERS.filter((m) => m.key !== PRESERVED_AT_ENV)).length > 0);
  // 보존은 차단 **뒤에** 하는 일이다 — 관계가 깨지면 옛 값을 가려낼 수 없다
  const wrong = TIMELINE_MARKERS.map((m) =>
    m.key === PRESERVED_AT_ENV ? { ...m, relation: 'before_anchor', detectable: false } : m,
  );
  const problems = auditTimelineCoverage(wrong);
  assert.ok(problems.some((p) => p.includes('after_anchor')));
  assert.ok(problems.some((p) => p.includes('detectable')));
  // 목록을 못 읽을 때 「문제 없음」으로 올리지 않는다
  for (const audit of [auditMarkerCoverage, auditTransientCoverage, auditTimelineCoverage]) {
    assert.ok(audit([]).length > 0 && audit('목록아님').length > 0);
  }
});

/* ─────────────────────────────── 문서 ─────────────────────────────── */

test('RUNBOOK: §3-15 와 그것을 가리키는 1·2단계가 함께 남아 있다', () => {
  assert.deepEqual(auditRunbookPreservation(RUNBOOK), []);

  assert.ok(auditRunbookPreservation(RUNBOOK.replace(/^### 3-15\./m, '### 9-9.')).some((p) => p.includes('3-15')));
  const noCmd = RUNBOOK.replace(/preservationText\(/g, '보고(').replace(/assessPreservation\(/g, '보고(');
  assert.ok(auditRunbookPreservation(noCmd).some((p) => p.includes('산출 명령')));
  const noRow = RUNBOOK.replace(/`uncovered`/g, '덮지 못함');
  assert.ok(auditRunbookPreservation(noRow).some((p) => p.includes('uncovered')));
  const noField = RUNBOOK.replace(/evidenceAvailable/g, '그 칸');
  assert.ok(auditRunbookPreservation(noField).some((p) => p.includes('evidenceAvailable')));
  // 1단계가 §3-15 로 유도하지 않으면 담당자는 기록할 자리를 모르고, 2단계가 키를 다루지 않으면
  // 「차단 뒤에 보존한다」는 순서가 사라져 구간의 끝부분이 보존본에서 빠진다.
  const noStep1 = RUNBOOK.replace(/아래 \*\*3-15\*\*/g, '아래 절');
  assert.ok(auditRunbookPreservation(noStep1).some((p) => p.includes('1단계')), '1단계의 유도가 빠져도 통과했다');

  // 2단계에서 키가 빠지면 「차단 뒤에 보존한다」는 순서가 사라진다 — 문서의 다른 절에는 그대로
  // 남아 있어 눈으로는 멀쩡해 보인다.
  const sec3Start = RUNBOOK.search(/^## 3\. /m);
  const step3Start = RUNBOOK.search(/^### 3-1\. /m);
  const noStep2 = RUNBOOK.slice(0, sec3Start)
    + RUNBOOK.slice(sec3Start, step3Start).replace(new RegExp(PRESERVED_AT_ENV, 'g'), 'OTHER_KEY_NAME')
    + RUNBOOK.slice(step3Start);
  assert.ok(auditRunbookPreservation(noStep2).some((p) => p.includes('2단계')), '2단계의 순서가 빠져도 통과했다');

  // 문서 구조를 못 읽으면 「문제 없음」으로 올리지 않는다
  assert.ok(
    auditRunbookPreservation(RUNBOOK.replace(/^## 3\. .*$/m, '## 삼. DB 복구')).some((p) => p.includes('§3 본문')),
    '§3 을 찾지 못한 것을 통과로 올렸다',
  );
});

test('RUNBOOK: 8단계 4번이 **여섯 키 전건** 삭제를 지시한다', () => {
  const step8 = RUNBOOK.slice(RUNBOOK.search(/^8\. \*\*사후\*\*/m)).split(/\n>/)[0];
  assert.ok(step8.includes(PRESERVED_AT_ENV), '8단계 4번에 보존 표지가 없다 — 다음 사건의 근거로 남는다');
  assert.ok(/여섯 키 전건을 지운다/.test(step8));
});

test('절차 단위 3-15 가 등록되고 체크리스트가 **빈 칸으로** 그것을 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-15');
  assert.ok(unit, '§3-15 가 절차 단위 정본에 없다 — 리허설 범위에서 빠진다');
  assert.equal(unit?.cited, true);
  assert.ok((unit?.skipped ?? '').length > 0, '건너뛸 때 생기는 일이 적혀 있지 않다');

  const boxes = parseChecklistBoxes(RUNBOOK);
  assert.ok(boxes, '체크리스트 구간을 찾지 못했다');
  const load = unitItemLoad(boxes ?? []).find((l) => l.unit === '3-15');
  assert.ok((load?.items.length ?? 0) >= 2, '§3-15 를 인용하는 체크리스트 항목이 모자라다');
  assert.equal(load?.checked, 0, '체크된 칸이 커밋됐다(§6-9)');
});

/* ─────────────────────────────── 규율 ─────────────────────────────── */

test('순수 모듈: DB·next·fs·`process.env` 미접근 · 신규 조회·쓰기·DDL 0', () => {
  const body = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(body), 'env 는 인자로만 받는다');
  assert.ok(!/from\s+['"](next|drizzle|node:fs|@\/db)/.test(body));
  assert.ok(!/\b(select|insert|update|delete|create table|alter table)\b/i.test(MODULE_SRC));
  // 판정 어휘를 다른 두 체크와 **같게** 두었다(담당자가 보는 자리가 같다)
  assert.deepEqual([...PRESERVATION_STATES], ['normal', 'pending', 'recorded', 'invalid_record', 'stale_record']);
  assert.deepEqual([...COVERAGE_VERDICTS], ['ok', 'uncovered', 'unknown']);
});
