/**
 * identityPhase.test.ts — 기준 지문이 **어느 국면의 기준인가**(RUNBOOK §3-12). 2026-10-24
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * `RECOVERY_EXPECTED_DB` 한 값에 세 정본이 서로 다른 뜻을 부여하고 있었다 —
 * §3-4 는 「복구 뒤 지워도 되고 **남겨도 된다**」, §2 월 점검 4번은 「**남겨 두었다면** 매월
 * `match` 를 본다」(= 평상시에 설정돼 있다), `deployRollback.rollbackPhase()` 는 「설정돼 있으면
 * **§3 5단계 전환 이후**(`after_switch`)」. 게다가 §3 8단계 4번의 표지 삭제 목록에 **이 키가
 * 없어서**, 남기는 운용에서는 국면이 평상시로 **돌아오지 않는다** — §5 0단계의 Promote 금지가
 * 평상시에 늘 떠 있고, 정작 사건 중에 응답이 달라지지 않는다.
 *
 * 그래서 (a) 판정의 경계(표지 0 을 「평상시」로 **올리지 않는다**), (b) 구분되지 않는 국면에서
 * **Promote 를 열어 주지 않는다**는 규율, (c) 세 정본과의 양방향 대조(사건 표지·env 레지스트리·
 * §2 점검 정본), (d) 배선(구분 여부가 응답에 실리는가·§3 8단계 4번의 처분·§3-12 문서·
 * **새 런타임 체크를 만들지 않았다는 사실**)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_PHASE_ABSENT,
  ACTION_PHASE_INCIDENT,
  ACTION_PHASE_INDISTINGUISHABLE,
  ACTION_PHASE_UNREADABLE,
  PHASE_BASES,
  PHASE_CLAIMS,
  PHASE_CONFLICTS,
  PHASE_LIMITS,
  PHASE_MARKERS,
  PHASE_MISREADS,
  PHASE_RUNBOOK_REF,
  PHASE_VERDICTS,
  activePhaseMarkers,
  assessIdentityPhase,
  auditClearStepCoverage,
  auditMarkerCanon,
  auditNoNewHealthCheck,
  auditPeriodicStep,
  auditRegistryNote,
  auditRollbackBasis,
  auditRunbookPhaseSection,
  conflictFor,
  identityPhaseLine,
  identityPhaseStatus,
  identityPhaseText,
  misreadFor,
  phaseMarkerFor,
  publicIdentityPhase,
} from '../src/lib/identityPhase.ts';
import {
  ACTION_RISK_AFTER_SWITCH,
  ACTION_RISK_AFTER_SWITCH_UNCORROBORATED,
  ACTION_RISK_FROZEN,
  ACTION_RISK_NORMAL,
  CAVEAT_PHASE_UNCORROBORATED,
  ROLLBACK_LIMITS,
  assessRollbackRisk,
  auditRunbookRollback,
  deployPinCheck,
  deployRollbackStatus,
  rollbackText,
} from '../src/lib/deployRollback.ts';
import { EXPECTED_DB_ENV } from '../src/lib/dbIdentity.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { INCIDENT_MARKERS } from '../src/lib/healthDisclosure.ts';
import { MONTHLY_STEPS } from '../src/lib/periodicCheck.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const ROLLBACK_SRC = read('src', 'lib', 'deployRollback.ts');
const HEALTH_ROUTE = read('src', 'app', 'api', 'health', 'route.ts');

/** 지문 모양 — 12자리 16진수(값은 어디에도 나가지 않아야 한다) */
const FP = 'a1b2c3d4e5f6';

/* ───────────────────────────── 판정의 경계 ───────────────────────────── */

test('미설정은 absent — §2 4번의 확인 대상이 없다는 사실까지 말한다', () => {
  const a = assessIdentityPhase({ env: {} });
  assert.equal(a.verdict, 'absent');
  assert.equal(a.present, false);
  assert.equal(a.readable, false);
  assert.equal(a.basis, 'none');
  // 지문으로 국면을 주장하지 않으므로 「근거가 어긋날 일」이 없다.
  assert.equal(a.corroborated, true);
  assert.match(a.action, /아무것도 말하지 않는다/);
  assert.equal(a.key, EXPECTED_DB_ENV);
  assert.equal(a.runbook, PHASE_RUNBOOK_REF);
});

test('지문만 있으면 indistinguishable — 「평상시다」로도 「사건이다」로도 올리지 않는다', () => {
  const a = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: FP } });
  assert.equal(a.verdict, 'indistinguishable');
  assert.equal(a.present, true);
  assert.equal(a.readable, true);
  assert.equal(a.corroborated, false, '지문 밖의 근거가 없다');
  assert.equal(a.basis, 'fingerprint_only');
  assert.deepEqual(a.markers, []);
  assert.match(a.action, /구분할 수 없다/);
  assert.match(a.action, /Promote/, '구분되지 않는 동안의 조치를 적지 않았다');
  assert.match(a.action, /사람/, '처분 확정이 사람 몫이라는 사실을 적지 않았다');
});

test('표지가 따로 있으면 incident — 표지 쪽을 근거로 삼는다(더 위험한 쪽)', () => {
  const frozen = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: FP, RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(frozen.verdict, 'incident');
  assert.equal(frozen.corroborated, true);
  assert.equal(frozen.basis, 'markers');
  assert.deepEqual(frozen.markers, ['RECOVERY_WRITE_FREEZE']);

  const recorded = assessIdentityPhase({
    env: { [EXPECTED_DB_ENV]: FP, RECOVERY_RESTORE_POINT: '2026-10-24T01:00:00+09:00' },
  });
  assert.equal(recorded.verdict, 'incident');
  assert.deepEqual(recorded.markers, ['RECOVERY_RESTORE_POINT']);
});

test('느슨한 스위치 판독을 하지 않는다 — RECOVERY_WRITE_FREEZE=1 은 표지가 아니다', () => {
  const a = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: FP, RECOVERY_WRITE_FREEZE: '1' } });
  assert.deepEqual(a.markers, [], '차단이 걸리지 않는 값을 표지로 세면 평상시가 사건이 된다');
  assert.equal(a.verdict, 'indistinguishable');
  assert.deepEqual(activePhaseMarkers({ RECOVERY_REHEARSAL_ACTIVE: 'yes' }), []);
  assert.deepEqual(activePhaseMarkers({ RECOVERY_REHEARSAL_ACTIVE: 'true' }), ['RECOVERY_REHEARSAL_ACTIVE']);
});

test('읽을 수 없는 지문은 unreadable — 고정으로도 사건으로도 세지 않는다', () => {
  const malformed = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: 'nope' } });
  assert.equal(malformed.verdict, 'unreadable');
  assert.equal(malformed.readable, false);
  assert.equal(malformed.basis, 'unreadable_value');
  // 연결 문자열은 지문으로 받지 않는다(§3-4 — 비밀번호가 한 벌 더 복제된다).
  const conn = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: 'postgres://u:p@h.neon.tech/db' } });
  assert.equal(conn.verdict, 'unreadable');
  // 표지가 함께 있으면 국면 쪽이 먼저다 — 값이 깨진 것과 사건인 것은 다른 이야기다.
  const both = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: 'nope', RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(both.verdict, 'incident');
  assert.equal(both.readable, false, '읽을 수 없다는 사실은 그대로 내보낸다');
});

test('빈 문자열·공백은 미설정으로 본다 — 실제 읽는 쪽과 같은 경계', () => {
  assert.equal(assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: '   ' } }).verdict, 'absent');
  assert.equal(assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: '' } }).present, false);
});

test('표지 없이 지문도 없는데 표지만 있으면 absent 이지만 근거는 markers 다', () => {
  const a = assessIdentityPhase({ env: { RECOVERY_WRITE_FREEZE: 'true' } });
  assert.equal(a.verdict, 'absent', '지문이 없으면 지문의 국면을 말할 수 없다');
  assert.equal(a.basis, 'markers', '그래도 사건 표지는 들어 있다는 사실을 적는다');
  assert.equal(a.corroborated, true);
});

test('markerKeys 를 좁혀 넘기면 그 키들만 표지로 센다(정본 대조용)', () => {
  const env = { [EXPECTED_DB_ENV]: FP, RECOVERY_WRITE_FREEZE: 'true', RECOVERY_RESTORE_POINT: 'x' };
  assert.deepEqual(assessIdentityPhase({ env, markerKeys: ['RECOVERY_RESTORE_POINT'] }).markers, [
    'RECOVERY_RESTORE_POINT',
  ]);
  assert.equal(assessIdentityPhase({ env, markerKeys: [] }).verdict, 'indistinguishable');
});

/* ───────────────────────────── 정본과 어휘 ───────────────────────────── */

test('판정·근거 어휘를 늘리지 않았다 — 달라지는 것은 다음에 할 일이다', () => {
  assert.deepEqual([...PHASE_VERDICTS], ['absent', 'incident', 'unreadable', 'indistinguishable']);
  assert.deepEqual([...PHASE_BASES], ['none', 'markers', 'fingerprint_only', 'unreadable_value']);
  for (const a of [ACTION_PHASE_ABSENT, ACTION_PHASE_INCIDENT, ACTION_PHASE_UNREADABLE, ACTION_PHASE_INDISTINGUISHABLE]) {
    assert.ok(a.length > 40, '조치 문구가 비어 있다');
  }
});

test('세 정본이 이 키에 부여한 뜻을 전부 적어 둔다 — 어느 하나를 틀렸다고 단정하지 않는다', () => {
  const sources = PHASE_CLAIMS.map((c) => c.source).join('\n');
  assert.match(sources, /§3-4/);
  assert.match(sources, /§2 월 점검 4번/);
  assert.match(sources, /deployRollback/);
  assert.match(sources, /8단계 4번/);
  for (const c of PHASE_CLAIMS) {
    assert.ok(c.says.length > 10 && c.whenSet.length > 5 && c.whenUnset.length > 5, `정본 설명이 비어 있다: ${c.source}`);
  }
  assert.ok(PHASE_CLAIMS.length >= 5);
});

test('어긋남 3방향과 그 결과를 적어 둔다 — 전부 응답 200 인 고장이다', () => {
  const keys = PHASE_CONFLICTS.map((c) => c.key);
  assert.deepEqual(keys, ['normal_pin_reads_as_incident', 'no_clear_step', 'two_normals']);
  for (const c of PHASE_CONFLICTS) {
    assert.equal(c.between.length, 2);
    assert.ok(c.why.length > 10);
    assert.ok(c.effect.length > 20, '어긋남의 결과를 적지 않았다');
    assert.equal(conflictFor(c.key), c);
  }
  assert.equal(conflictFor('없는키'), null);
});

test('거짓이 되는 판정을 열거한다 — 특히 phase 가 normal 로 돌아오지 않는다는 사실', () => {
  assert.ok(PHASE_MISREADS.length >= 5);
  const dump = JSON.stringify(PHASE_MISREADS);
  assert.match(dump, /영원히 돌아오지 않는다/);
  assert.match(dump, /unset/, '§3-4 판정 표의 `unset` 해석도 거짓이 되는 길이다');
  for (const m of PHASE_MISREADS) {
    assert.ok(m.butWhen.length > 5 && m.instead.length > 10, `오독 설명이 비어 있다: ${m.reads}`);
    assert.equal(misreadFor(m.reads), m);
  }
  assert.equal(misreadFor('없음'), null);
});

test('사각지대를 판정과 함께 내보낸다 — 표지 0 이 「사건 아님」이 아니라는 사실 포함', () => {
  const a = assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: FP } });
  assert.equal(a.caveats, PHASE_LIMITS);
  const lim = PHASE_LIMITS.join('\n');
  assert.match(lim, /언제·왜 들어갔는지가 없다/);
  assert.match(lim, /사건이 아니다/);
  assert.match(lim, /코드가 고르지 않는다|코드가 한쪽을 고르지/);
  assert.match(lim, /사건 표지에 넣지 않았다/);
  assert.ok(PHASE_LIMITS.length >= 6);
});

/* ───────────────────────────── 출력 ───────────────────────────── */

test('출력에 지문 값·연결 문자열이 섞여 나가지 않는다 — 공개 응답에 닿는 값이다', () => {
  const a = assessIdentityPhase({
    env: { [EXPECTED_DB_ENV]: FP, RECOVERY_WRITE_FREEZE_AT: '2026-10-24T01:00:00+09:00' },
  });
  const dump = [identityPhaseLine(a), identityPhaseText(a), JSON.stringify(publicIdentityPhase(a))].join('\n');
  assert.ok(!dump.includes(FP), '지문 값이 출력에 섞였다');
  assert.ok(!/2026-10-24T01:00/.test(dump), '표지 값(시각)이 출력에 섞였다');
  assert.ok(!/postgres:\/\/|neon\.tech|password|secret/i.test(dump));
  // 키 이름과 개수는 담는다 — 그것이 담당자가 다음 단계를 찾는 단서다.
  assert.match(identityPhaseText(a), new RegExp('RECOVERY_WRITE_FREEZE_AT'));
  assert.equal(publicIdentityPhase(a).markerCount, 1);
  assert.equal(publicIdentityPhase(a).verdict, 'incident');
});

test('사람이 읽는 출력에 어긋남 3방향과 한계가 함께 나온다', () => {
  const text = identityPhaseText(assessIdentityPhase({ env: { [EXPECTED_DB_ENV]: FP } }));
  for (const c of PHASE_CONFLICTS) assert.ok(text.includes(c.key), `어긋남 ${c.key} 가 출력에 없다`);
  assert.ok(text.split('\n').length > PHASE_LIMITS.length);
  const st = identityPhaseStatus({ [EXPECTED_DB_ENV]: FP });
  assert.equal(st.verdict, 'indistinguishable');
  assert.equal(st.corroborated, false);
  assert.equal(st.conflicts, PHASE_CONFLICTS.length);
  assert.equal(st.limits, PHASE_LIMITS.length);
});

test('표지 정본 조회 — 모르는 키는 null(지어내지 않는다)', () => {
  assert.equal(phaseMarkerFor('RECOVERY_WRITE_FREEZE')?.kind, 'switch');
  assert.equal(phaseMarkerFor('RECOVERY_RESTORE_POINT')?.kind, 'record');
  assert.equal(phaseMarkerFor(EXPECTED_DB_ENV), null, '지문 키는 표지가 아니다');
  assert.equal(phaseMarkerFor(undefined), null);
  for (const m of PHASE_MARKERS) assert.ok(m.means.length > 10 && typeof m.clearedAtStep8 === 'boolean');
});

/* ─────────────────── §5 판정과의 합성(구분되지 않는 국면) ─────────────────── */

test('지문 단독 after_switch 에서 조치가 달라진다 — 판정 어휘 phase 는 그대로다', () => {
  const after = assessRollbackRisk({ [EXPECTED_DB_ENV]: FP });
  assert.equal(after.phase, 'after_switch', '판정 어휘를 늘리지 않았다');
  assert.equal(after.phaseCorroborated, false);
  assert.equal(after.phaseBasis, 'fingerprint_only');
  assert.equal(after.action, ACTION_RISK_AFTER_SWITCH_UNCORROBORATED);
  assert.ok(after.caveats.includes(CAVEAT_PHASE_UNCORROBORATED));
  // 구분되지 않아도 Promote 를 열어 주지 않는다 — 표지를 적지 않은 복구도 같은 모습이다.
  assert.match(after.action, /Promote 를 쓰지 않고|Promote 를 쓰지 않는다/);
  assert.equal(after.codeOnly, false);
});

test('표지가 함께 있으면 종전 조치로 돌아간다 — 그때는 「전환 이후」가 참이다', () => {
  const corroborated = assessRollbackRisk({ [EXPECTED_DB_ENV]: FP, RECOVERY_RESTORE_POINT: 'x' });
  assert.equal(corroborated.phase, 'after_switch');
  assert.equal(corroborated.phaseCorroborated, true);
  assert.equal(corroborated.action, ACTION_RISK_AFTER_SWITCH);
  assert.ok(!corroborated.caveats.includes(CAVEAT_PHASE_UNCORROBORATED));

  const frozen = assessRollbackRisk({ RECOVERY_WRITE_FREEZE: 'true', [EXPECTED_DB_ENV]: FP });
  assert.equal(frozen.action, ACTION_RISK_FROZEN, '차단 중이 가장 위험하다 — 그 조치가 먼저다');
  assert.equal(frozen.phaseCorroborated, true);

  const normal = assessRollbackRisk({});
  assert.equal(normal.action, ACTION_RISK_NORMAL);
  assert.equal(normal.phaseCorroborated, true, '지문이 없으면 어긋날 근거가 없다');
  assert.equal(normal.phaseBasis, 'none');
});

test('구분 여부가 /api/health 응답과 1줄 출력에 함께 실린다', () => {
  const check = deployPinCheck({ env: { [EXPECTED_DB_ENV]: FP, VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40) } });
  assert.equal(check.required, false, 'required:false — 국면은 장애가 아니다');
  assert.equal(check.detail.phase, 'after_switch');
  assert.equal(check.detail.phaseCorroborated, false);
  assert.equal(check.detail.phaseBasis, 'fingerprint_only');
  // 공개 엔드포인트다 — 지문 값이 섞이지 않는다.
  assert.ok(!JSON.stringify(check.detail).includes(FP));

  const text = rollbackText(deployRollbackStatus({ [EXPECTED_DB_ENV]: FP }));
  assert.match(text, /구분되지 않음/);
  assert.match(text, /basis=fingerprint_only/);
  assert.match(ROLLBACK_LIMITS.join('\n'), /phaseCorroborated/, '한계 목록이 이 사실을 적지 않는다');
});

/* ───────────────────────────── 정본 양방향 대조 ───────────────────────────── */

test('사건 표지 정본과 양방향으로 맞는다 — 지문 키는 어느 쪽에도 표지로 들어가지 않는다', () => {
  assert.deepEqual(auditMarkerCanon(INCIDENT_MARKERS), []);
  // 모양을 읽을 수 없으면 조용히 통과하지 않는다.
  assert.ok(auditMarkerCanon([]).length > 0);
  // 지문 키가 표지로 들어가면 평상시 고정이 무인증 응답에서 사건으로 공표된다.
  const bad = [...INCIDENT_MARKERS, { key: EXPECTED_DB_ENV, kind: 'record', means: '' }];
  assert.ok(auditMarkerCanon(bad).some((p) => p.includes(EXPECTED_DB_ENV)));
  // 판독 방식이 갈리면 표지 수가 달라진다.
  const loose = INCIDENT_MARKERS.map((m) =>
    m.key === 'RECOVERY_WRITE_FREEZE' ? { ...m, kind: 'record' } : m,
  );
  assert.ok(auditMarkerCanon(loose).some((p) => p.includes('판독 방식')));
  // 정본에서 표지가 빠지면 잡는다.
  assert.ok(auditMarkerCanon(INCIDENT_MARKERS.filter((m) => m.key !== 'RECOVERY_RESTORE_POINT')).length > 0);
  // 이 모듈의 정본에 지문 키를 넣어도 잡는다 — 자기 자신을 근거로 쓰는 꼴이 된다.
  assert.ok(
    PHASE_MARKERS.every((m) => m.key !== EXPECTED_DB_ENV),
    '표지 정본에 지문 키가 들어갔다 — auditMarkerCanon 이 이 경우를 잡는다',
  );
});

test('env 레지스트리 설명이 「미설정이 평상시」 단정으로 되돌아가면 실패한다', () => {
  assert.deepEqual(auditRegistryNote(ENV_VARS), []);
  const regressed = ENV_VARS.map((d) =>
    d.key === EXPECTED_DB_ENV ? { ...d, note: '전환 확인용 지문. 미설정이 평상시 — 유실 시 확인할 수 없다' } : d,
  );
  const problems = auditRegistryNote(regressed);
  assert.ok(problems.length >= 1);
  assert.ok(problems.join('\n').includes(EXPECTED_DB_ENV));
  assert.ok(auditRegistryNote([]).length > 0, '레지스트리에서 키가 빠지면 복구 목록에서 조용히 빠진다');
});

test('§2 월 점검 정본이 이 키를 계속 다룬다 — 평상시 고정의 확인 지점', () => {
  assert.deepEqual(auditPeriodicStep(MONTHLY_STEPS), []);
  assert.ok(auditPeriodicStep(MONTHLY_STEPS.filter((s) => s.supplies !== EXPECTED_DB_ENV)).length > 0);
});

test('절차 단위 3-12 가 등록돼 있고 체크리스트가 인용한다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '3-12');
  assert.ok(unit, '§3-12 가 절차 단위 정본에 없다 — 리허설 범위에서 조용히 빠진다');
  assert.equal(unit?.cited, true);
  assert.ok(String(unit?.skipped ?? '').length > 30, '건너뛰면 무엇이 틀리는지 적지 않았다');
});

/* ───────────────────────────── 배선 정적 점검 ───────────────────────────── */

test('deployRollback 원문: 구분 여부를 판정하고 응답에 싣는다', () => {
  assert.deepEqual(auditRollbackBasis(ROLLBACK_SRC), []);
  assert.ok(auditRollbackBasis('// 빈 파일').length >= 3);
  // 판정만 하고 버리는 꼴도 잡는다.
  assert.ok(auditRollbackBasis(ROLLBACK_SRC.replace(/phaseCorroborated/g, 'x')).length > 0);
  assert.ok(auditRollbackBasis(ROLLBACK_SRC.replace(/phaseBasis/g, 'x')).length > 0);
  // 구분되지 않은 국면에서 평상시 조치를 내는 쪽으로 되돌아가면 잡는다 —
  // 그 회귀는 Promote 를 열어 주고, Promote 는 복구를 조용히 무효화한다.
  const opened = ROLLBACK_SRC.replace(
    "phase === 'after_switch' && !ip.corroborated",
    "phase === 'after_switch' && !ip.corroborated ? ACTION_RISK_NORMAL : false && false",
  );
  assert.ok(auditRollbackBasis(opened).some((p) => p.includes('Promote')));
});

test('§3 8단계 4번이 지문의 처분을 적는다 — 적지 않은 것이 이 고장의 원인이었다', () => {
  assert.deepEqual(auditClearStepCoverage(RUNBOOK), []);
  const regressed = RUNBOOK.split('\n')
    .filter((l) => !l.includes('(기준 지문)의 처분을 여기서 확정한다'))
    .join('\n');
  const problems = auditClearStepCoverage(regressed);
  assert.ok(problems.length > 0, '처분이 빠져도 통과한다');
  assert.ok(problems.join('\n').includes(EXPECTED_DB_ENV));
  assert.ok(auditClearStepCoverage('# 빈 문서').length > 0);
  // 8단계 자체가 사라져도 「처분이 적혀 있다」로 통과하지 않는다 — 구조가 바뀐 사실을 말한다.
  const noStep8 = ['## 3. DB 복구 절차', '1. 중단 결정', '### 3-1. 빈 DB'].join('\n');
  assert.ok(auditClearStepCoverage(noStep8).some((p) => p.includes('8단계')));
});

test('§3-12 절이 판정 표·어긋남·산출 명령·사람 몫을 적는다', () => {
  assert.deepEqual(auditRunbookPhaseSection(RUNBOOK), []);
  assert.ok(auditRunbookPhaseSection('# 빈 문서').length > 0);
  // 본문에서 언급만 하고 **판정 표의 행**이 빠지면 할 일을 찾을 수 없다 — 그것도 잡는다.
  const noRow = RUNBOOK.replace('| `indistinguishable` | 지문만 있다 |', '| (지움) | 지문만 있다 |');
  assert.ok(noRow !== RUNBOOK, '판정 표 행의 모양이 바뀌었으면 이 가드를 함께 볼 것');
  assert.ok(auditRunbookPhaseSection(noRow).some((p) => p.includes('indistinguishable')));
  // 어긋남 표가 빠지는 경우도 잡는다.
  const noConflict = RUNBOOK.replace(/normal_pin_reads_as_incident/g, 'xx');
  assert.ok(auditRunbookPhaseSection(noConflict).length > 0);
});

test('§5 가 국면이 구분되지 않는 경우를 가리킨다 — 평상시 경고를 사건으로 읽지 않게', () => {
  assert.deepEqual(auditRunbookRollback(RUNBOOK), []);
  const noRef = RUNBOOK.replace(/phaseCorroborated/g, 'xx');
  assert.ok(auditRunbookRollback(noRef).length > 0);
});

test('새 런타임 체크를 만들지 않았다 — 같은 국면을 두 번 보고하지 않는다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_ROUTE), []);
  assert.ok(auditNoNewHealthCheck('checks.identityPhase = x();').length > 0);
});

test('이 모듈은 순수하다 — DB·next·fs·process.env 를 건드리지 않는다', () => {
  const src = read('src', 'lib', 'identityPhase.ts');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/process\.env/.test(body), 'env 는 인자로만 받는다');
  assert.ok(!/from\s+['"](next|drizzle|node:fs|@\/db)/.test(body));
  assert.ok(!/create\s+table|insert\s+into|delete\s+from|update\s+/i.test(body), '쓰기·DDL 0');
  // 순환을 만들지 않는다 — deployRollback 쪽이 이 모듈을 쓴다.
  assert.ok(!/from\s+['"]\.\/deployRollback\.ts['"]/.test(body));
  assert.ok(!/from\s+['"]\.\/healthDisclosure\.ts['"]/.test(body), '표지 정본 대조는 테스트가 한다');
});
