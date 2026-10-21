/**
 * rehearsalKind.test.ts — 「연습」과 「사건」의 구분(RUNBOOK §6·§6-6). 2026-10-21
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6 표 둘째 열 `유형(정기/사건)` 과 `RECOVERY_LAST_REHEARSAL_KIND` 는 줄곧 적혀 있었고
 * `lib/recovery.ts` 가 표·env 양쪽에서 받아 적고 있었는데 **읽는 판정이 하나도 없었다**
 * (§6-4 기록 정본이 `judgedBy: null` 로 그 사실을 적어 두었다). 그래서
 * (가) 사건 복구가 **리허설 기한을 리셋**하고(신선도는 일자·결과만 본다) 정기 리허설 없이도
 * `checks.recovery` 가 `ok` 였고, (나) 런타임 RPO 실측은 체크리스트가 **채우라고 지시하는**
 * 두 키만 보므로 **리허설 중의 구간**이 그대로 `met`·`exceeded`(→ 종합 `breached`)가 됐고,
 * (다) §1-2 의 표 대조는 그 행이 연습인지 사건인지 말하지 않았고, (라) §6-5 의 해소는 사건 행이
 * 미통과 단위를 지웠다.
 *
 * 그래서 (a) 유형의 경계와 판정 순서, (b) 값을 지어내지 않는 규율(임의 귀속 금지·중복 보고 금지),
 * (c) 표 이력의 기한 근거·해소 귀속, (d) 배선(health 응답·관측 정본·§6-4 기록 정본·§1-2 게이트·
 * §6-6 문서·체크리스트)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  KIND_COLUMN,
  KIND_DRIFTS,
  KIND_ENV,
  KIND_LIMITS,
  KIND_MISREADS,
  KIND_ROLES,
  KIND_RUNBOOK_REF,
  KIND_VERDICTS,
  WINDOW_KEYS,
  assessKind,
  auditHealthWiring,
  auditKindSeparation,
  auditKindShape,
  auditKindSource,
  auditLedgerKindJudge,
  auditObjectivesGate,
  auditRunbookKind,
  intervalBasis,
  intervalText,
  kindLogLine,
  kindState,
  kindText,
  lastOfKind,
  measurementOrigin,
  rehearsalKindCheck,
  rehearsalKindStatus,
  resolutionKinds,
  roleFor,
} from '../src/lib/rehearsalKind.ts';
import { LEDGER_FIELDS, TABLE_COLUMNS, parseLedgerTable } from '../src/lib/rehearsalLedger.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { CHECK_OBSERVATIONS, parseVocabulary } from '../src/lib/rehearsalObservation.ts';
import {
  INCIDENT_HAS_LOSS,
  KIND_UNREAD_NOTE,
  REHEARSAL_HAS_NO_LOSS,
  assessObjectives,
  rehearsalAttainment,
} from '../src/lib/recoveryObjectives.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const NOW = new Date('2026-11-05T12:00:00Z');

/** 표 한 장(열 순서는 §6-4 정본과 같다) */
const tableOf = (...rows: string[]): string =>
  [
    '## 6. 복구 리허설 기록',
    '',
    `| ${TABLE_COLUMNS.join(' | ')} |`,
    `| ${TABLE_COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
  ].join('\n');

/** 일자·유형·복구시점·소요시간·결과·담당·비고·범위·미통과 */
const row = (
  date: string,
  kind: string,
  duration: string,
  result: string,
  scope = '',
  unpassed = '',
): string => `| ${date} | ${kind} | T-5m | ${duration} | ${result} | 담당 | | ${scope} | ${unpassed} |`;

/** 사건 중 env 한 벌(구간 두 키가 채워져 있다) */
const windowEnv = {
  RECOVERY_RESTORE_POINT: '2026-11-01T09:00:00+09:00',
  RECOVERY_WRITE_FREEZE_AT: '2026-11-01T11:00:00+09:00',
};

/* ─────────────────────────── 정본 ─────────────────────────── */

test('정본: 구분하지 않으면 거짓이 되는 판정이 전건 적혀 있다 ⬅ 이 모듈의 존재 이유다', () => {
  assert.deepEqual(auditKindShape(), [], `정본 위반: ${auditKindShape().join(' / ')}`);
  assert.ok(KIND_MISREADS.length >= 5, '잘못 읽히는 판정이 줄었다');
  const keys = KIND_MISREADS.map((m) => m.key);
  assert.ok(keys.includes('interval_reset_by_incident'), '사건이 기한을 리셋하는 사실을 적어 둔다');
  assert.ok(keys.includes('rpo_from_rehearsal'), '연습 구간이 약속 실측이 되는 사실을 적어 둔다');
  assert.ok(keys.includes('rto_basis_unknown'), '표 소요시간의 출처가 없던 사실을 적어 둔다');
  assert.ok(keys.includes('resolution_by_incident'), '사건 행이 미통과를 해소하는 사실을 적어 둔다');
  assert.ok(keys.includes('ledger_field_unread'), '§6-4 가 judgedBy: null 로 적어 둔 그 칸이다');
  assert.equal(KIND_DRIFTS.length, 3, '어긋남은 세 방향이다');
  assert.ok(KIND_LIMITS.length >= 6, '보장하지 못하는 것이 줄었다');
  assert.match(KIND_RUNBOOK_REF, /6-6/);
});

test('정본: 두 유형의 자격이 **다르다** — 같아지면 구분이 사라진다', () => {
  const regular = roleFor('regular');
  const incident = roleFor('incident');
  assert.ok(regular && incident);
  assert.equal(regular.resetsInterval, true, '정기 리허설은 기한을 리셋한다');
  assert.equal(incident.resetsInterval, false, '사건은 절차의 사용이고 검증이 아니다');
  assert.equal(regular.rtoEvidence, 'lower_bound', '리허설 소요시간은 하한이다');
  assert.equal(incident.rtoEvidence, 'measurement', '사건만 약속의 실측이다');
  assert.equal(incident.resolvesUnpassed, false, '사건은 통과 판정을 한 적이 없다');
  assert.equal(roleFor('unreadable'), null, '모르는 유형은 자격을 지어내지 않는다');

  // 가드가 살아 있는지(자격이 같아지면 잡아낸다)
  const flattened = KIND_ROLES.map((r) => ({ ...r, resetsInterval: true, rtoEvidence: 'measurement' as const }));
  assert.ok(auditKindShape(flattened).length >= 2, '두 유형의 자격이 같아졌는데 아무 말도 하지 않는다');
});

/* ─────────────────────────── 유형 판독 ─────────────────────────── */

test('유형 판독: 빈 칸·판독 불가를 **정기로 올리지 않는다**', () => {
  assert.equal(kindState('정기'), 'regular');
  assert.equal(kindState('정기 리허설'), 'regular');
  assert.equal(kindState('periodic'), 'regular');
  assert.equal(kindState('사건'), 'incident');
  assert.equal(kindState('장애 대응'), 'incident');
  assert.equal(kindState('incident'), 'incident');
  assert.equal(kindState(''), 'absent');
  assert.equal(kindState('   '), 'absent');
  assert.equal(kindState(undefined), 'absent');
  assert.equal(kindState('아마도'), 'unreadable', '모르는 문구는 판독 불가다(정기가 아니다)');
  assert.equal(kindState('unknown'), 'unreadable', '표 파서가 돌려준 unknown 도 판독 불가다');
});

/* ─────────────────────── 실측의 출처(두 축의 결합) ─────────────────────── */

test('실측 출처: 선언이 켜져 있으면 그 구간을 **약속 대조에서 뺀다**', () => {
  const incident = measurementOrigin({ env: { ...windowEnv } });
  assert.equal(incident.origin, 'incident');
  assert.equal(incident.trusted, true);
  assert.equal(incident.measurement, 'used');

  const drill = measurementOrigin({ env: { ...windowEnv, RECOVERY_REHEARSAL_ACTIVE: 'true' } });
  assert.equal(drill.origin, 'rehearsal');
  assert.equal(drill.trusted, false);
  assert.equal(drill.measurement, 'withheld');
  assert.match(drill.why, /연습값/);

  // 선언을 판독할 수 없으면 「사건이다」로 올리지 않는다(판정 보류가 통과보다 앞이다)
  const malformed = measurementOrigin({ env: { ...windowEnv, RECOVERY_REHEARSAL_ACTIVE: '1' } });
  assert.equal(malformed.origin, 'unreadable_declaration');
  assert.equal(malformed.measurement, 'withheld');

  // 구간이 없으면 뺄 것도 없다
  const half = measurementOrigin({ env: { RECOVERY_RESTORE_POINT: windowEnv.RECOVERY_RESTORE_POINT } });
  assert.equal(half.hasWindow, false);
  assert.equal(half.measurement, 'none');
  assert.equal(half.withheld, false);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('판정: 기록이 없으면 판정 보류(미실시는 checks.recovery 가 말한다 — 중복 보고 금지)', () => {
  const a = assessKind({ env: {}, now: NOW });
  assert.equal(a.verdict, 'no_record');
  assert.equal(a.resetsInterval, null, '유형을 모르면 자격을 지어내지 않는다');
  assert.equal(a.measurementEligible, null);
});

test('판정: 기록은 있는데 유형이 비면 `unknown_kind` — **통과가 아니다**', () => {
  const a = assessKind({ env: { RECOVERY_LAST_REHEARSAL: '2026-11-01' }, now: NOW });
  assert.equal(a.verdict, 'unknown_kind');
  assert.match(a.action, /정기/);
  assert.equal(rehearsalKindCheck({ env: { RECOVERY_LAST_REHEARSAL: '2026-11-01' }, now: NOW }).ok, false);
});

test('판정: 기록이 `사건` 이면 기한이 사건으로 리셋된 상태를 드러낸다', () => {
  const a = assessKind({
    env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '사건' },
    now: NOW,
  });
  assert.equal(a.verdict, 'interval_reset_by_incident');
  assert.equal(a.resetsInterval, false);
  assert.equal(a.measurementEligible, true, '사건의 소요시간·구간은 약속의 실측이다');
  assert.match(a.action, /마지막 정기 리허설/);
});

test('판정: 기록은 `사건` 인데 배포가 리허설 선언 중이면 두 축의 모순이다', () => {
  const a = assessKind({
    env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '사건', RECOVERY_REHEARSAL_ACTIVE: 'true' },
    now: NOW,
  });
  assert.equal(a.verdict, 'contradicts_declaration');
});

test('판정: 리허설 선언 중의 구간은 `rehearsal_measure`(게이트가 작동한 상태)', () => {
  const env = {
    RECOVERY_LAST_REHEARSAL: '2026-11-01',
    [KIND_ENV]: '정기',
    RECOVERY_REHEARSAL_ACTIVE: 'true',
    ...windowEnv,
  };
  assert.equal(assessKind({ env, now: NOW }).verdict, 'rehearsal_measure');

  // 기록이 없어도 **선언 중의 구간**은 말한다(그 구간이 약속 대조에 들어가려던 값이다)
  assert.equal(
    assessKind({ env: { RECOVERY_REHEARSAL_ACTIVE: 'true', ...windowEnv }, now: NOW }).verdict,
    'rehearsal_measure',
  );

  // 구간 키를 지우면(체크리스트 마지막) ok 로 돌아온다
  const cleared = { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '정기', RECOVERY_REHEARSAL_ACTIVE: 'true' };
  assert.equal(assessKind({ env: cleared, now: NOW }).verdict, 'ok');
});

test('판정: 유형이 적혀 있고 선언과 어긋나지 않으면 ok', () => {
  const a = assessKind({ env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '정기' }, now: NOW });
  assert.equal(a.verdict, 'ok');
  assert.equal(a.resetsInterval, true);
  assert.equal(a.measurementEligible, false, '리허설 소요시간은 하한이다');
  assert.ok(KIND_VERDICTS.includes(a.verdict));
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('응답: 평상시 ok, required: false, **구간 값·수치를 담지 않는다**', () => {
  const normal = rehearsalKindCheck({ env: {}, now: NOW });
  assert.equal(normal.ok, true);
  assert.equal(normal.required, false);

  const drill = rehearsalKindCheck({
    env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '정기', RECOVERY_REHEARSAL_ACTIVE: 'true', ...windowEnv },
    now: NOW,
  });
  assert.equal(drill.ok, false, '연습 구간을 뺐다는 사실은 degraded 로 드러낸다');
  assert.equal(drill.detail.measurement, 'withheld');
  assert.deepEqual(drill.detail.windowKeys, WINDOW_KEYS);
  const dump = JSON.stringify(drill.detail);
  assert.ok(!dump.includes(windowEnv.RECOVERY_RESTORE_POINT), '구간 값이 응답에 들어갔다');
  assert.ok(!dump.includes('11:00'), '구간 끝 시각이 응답에 들어갔다');
  assert.ok(!/분\b/.test(String(drill.detail.note ?? '')), '구간 분이 응답에 들어갔다');
});

test('출력: 로그·요약에 구간 값이 없고 판정 어휘만 있다', () => {
  const a = assessKind({
    env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '사건', ...windowEnv },
    now: NOW,
  });
  const line = kindLogLine(a);
  assert.match(line, /\[rehearsalKind\] verdict=interval_reset_by_incident/);
  assert.ok(!line.includes(windowEnv.RECOVERY_RESTORE_POINT));
  const text = kindText(a).join('\n');
  assert.match(text, /유형=incident/);
  assert.ok(!text.includes(windowEnv.RECOVERY_WRITE_FREEZE_AT));

  const status = rehearsalKindStatus({ RECOVERY_LAST_REHEARSAL: '2026-11-01', [KIND_ENV]: '정기' });
  assert.equal(status.verdict, 'ok');
  assert.equal(status.limits, KIND_LIMITS.length);
});

/* ─────────────────── 표의 이력: 기한의 근거 ─────────────────── */

test('표 이력: 기한의 근거는 **정기 행**이고 사건 행이 리셋한 사실을 함께 적는다', () => {
  const md = tableOf(row('2026-05-01', '정기', '90분', '정상'), row('2026-11-01', '사건', '180분', '정상'));
  const rows = parseLedgerTable(md).rows;
  const r = intervalBasis({ rows, intervalDays: 180, now: NOW });
  assert.equal(r.basis, 'regular');
  assert.equal(r.regularDate, '2026-05-01');
  assert.equal(r.dueDate, '2026-10-28');
  assert.equal(r.overdue, true, '정기 기준으로는 기한을 넘겼다 — 신선도는 사건 일자로 ok 였다');
  assert.deepEqual(r.shadowedBy, ['2026-11-01']);

  // 주기를 모르면 기한을 지어내지 않는다
  const noInterval = intervalBasis({ rows, intervalDays: null, now: NOW });
  assert.equal(noInterval.dueDate, null);
  assert.equal(noInterval.overdue, null);
});

test('표 이력: 사건 행만 있으면 `incident_only`(정기 리허설 기록이 없다)', () => {
  const only = parseLedgerTable(tableOf(row('2026-11-01', '사건', '180분', '정상'))).rows;
  assert.equal(intervalBasis({ rows: only, intervalDays: 180, now: NOW }).basis, 'incident_only');
  assert.equal(intervalBasis({ rows: [], now: NOW }).basis, 'none');

  const unreadable = parseLedgerTable(tableOf(row('2026-11-01', '아마도', '180분', '정상'))).rows;
  const u = intervalBasis({ rows: unreadable, intervalDays: 180, now: NOW });
  assert.equal(u.basis, 'unknown', '유형을 읽을 수 없는 행을 정기로 세지 않는다');
  assert.deepEqual(u.unreadableRows, ['2026-11-01']);
});

test('표 이력: 미래 일자는 기록이 아니다', () => {
  const rows = parseLedgerTable(tableOf(row('2027-01-01', '정기', '90분', '정상'))).rows;
  assert.equal(lastOfKind(rows, 'regular', NOW), null);
  assert.equal(intervalBasis({ rows, intervalDays: 180, now: NOW }).basis, 'none');
});

/* ─────────────────── 표의 이력: 해소의 귀속 ─────────────────── */

test('표 이력: **사건 행이 해소한** 미통과 단위를 드러낸다(사건은 통과 판정을 하지 않는다)', () => {
  const md = tableOf(
    row('2026-05-01', '정기', '90분', '부분 통과', 'asOf=2026-05-01;units=3-6,3-7', 'asOf=2026-05-01;units=3-6'),
    row('2026-11-01', '사건', '180분', '정상', 'asOf=2026-11-01;units=3-6,3-7', ''),
  );
  const res = resolutionKinds(parseLedgerTable(md).rows, NOW);
  assert.deepEqual(res.byIncident, ['3-6']);
  assert.equal(res.resolutions[0]?.resolvedBy, 'incident');
  assert.match(res.note, /다음 \*\*정기\*\* 리허설 범위/);

  const text = intervalText({ rows: parseLedgerTable(md).rows, intervalDays: 180, now: NOW }).join('\n');
  assert.match(text, /사건 행이 해소한 미통과 단위: 3-6/);
});

test('표 이력: 정기 행이 해소하면 사건 목록에 들어가지 않는다', () => {
  const md = tableOf(
    row('2026-05-01', '정기', '90분', '부분 통과', 'asOf=2026-05-01;units=3-6', 'asOf=2026-05-01;units=3-6'),
    row('2026-09-01', '정기', '95분', '정상', 'asOf=2026-09-01;units=3-6', ''),
  );
  const res = resolutionKinds(parseLedgerTable(md).rows, NOW);
  assert.deepEqual(res.byIncident, []);
  assert.deepEqual(res.byUnknownKind, []);
  assert.equal(res.resolutions.length, 1);
  assert.equal(res.resolutions[0]?.resolvedBy, 'regular');
});

/* ─────────────────── §1-2 게이트(연습값이 약속이 되지 않게) ─────────────────── */

test('§1-2: 사건 구간은 약속과 대조하고, **리허설 선언 중의 구간은 뺀다**', () => {
  const objectives = { RECOVERY_RTO_MINUTES: '240', RECOVERY_RPO_MINUTES: '30' };
  const incident = assessObjectives({ env: { ...objectives, ...windowEnv }, now: NOW });
  assert.equal(incident.attainment.rpo.attainment, 'exceeded', '사건 구간은 그대로 대조한다');
  assert.equal(incident.verdict, 'breached');
  assert.equal(incident.measurement.measurement, 'used');

  const drill = assessObjectives({
    env: { ...objectives, ...windowEnv, RECOVERY_REHEARSAL_ACTIVE: 'true' },
    now: NOW,
  });
  assert.equal(drill.attainment.rpo.attainment, 'unjudged', '연습값으로 met·exceeded 를 내지 않는다');
  assert.equal(drill.measurement.measurement, 'withheld');
  assert.notEqual(drill.verdict, 'breached', '연습이 약속 위반 기록을 만들면 안 된다');
  assert.match(drill.attainment.rpo.note, /연습 구간/);

  // 명시적으로 넘긴 실측(§1-2 명령)은 그대로 쓴다
  const explicit = assessObjectives({
    env: { ...objectives, RECOVERY_REHEARSAL_ACTIVE: 'true' },
    measured: { rpo: 10 },
    now: NOW,
  });
  assert.equal(explicit.attainment.rpo.attainment, 'met');
});

test('§1-2: 표 최신 행의 소요시간에 **출처**가 붙는다(연습은 하한이다)', () => {
  // `rehearsalAttainment` 는 실제 오늘을 기준으로 최신 행을 고른다 — 과거 일자로 적는다
  const env = { RECOVERY_RTO_MINUTES: '240', RECOVERY_RPO_MINUTES: '30' };
  const regular = rehearsalAttainment({ markdown: tableOf(row('2026-10-10', '정기', '90분', '정상')), env });
  assert.equal(regular.rto.attainment, 'met');
  assert.equal(regular.kind, 'regular');
  assert.equal(regular.basis, 'lower_bound');
  assert.equal(regular.note, REHEARSAL_HAS_NO_LOSS);

  const incident = rehearsalAttainment({ markdown: tableOf(row('2026-10-10', '사건', '300분', '정상')), env });
  assert.equal(incident.rto.attainment, 'exceeded');
  assert.equal(incident.basis, 'measurement');
  assert.equal(incident.note, INCIDENT_HAS_LOSS);

  const blank = rehearsalAttainment({ markdown: tableOf(row('2026-10-10', '', '90분', '정상')), env });
  assert.equal(blank.basis, 'unknown', '유형을 모르면 실측 자격을 지어내지 않는다');
  assert.equal(blank.note, KIND_UNREAD_NOTE);
});

/* ─────────────────────── 배선(실제 소스·문서) ─────────────────────── */

test('[실제 소스] §6-4 기록 정본이 `유형` 칸을 **읽는 판정으로** 선언한다', () => {
  assert.deepEqual(auditLedgerKindJudge(LEDGER_FIELDS), [], auditLedgerKindJudge(LEDGER_FIELDS).join(' / '));
  assert.ok(TABLE_COLUMNS.includes(KIND_COLUMN), '§6 표 열 정본에 유형 열이 없다');
  // 가드: judgedBy 가 null 로 되돌아가면(= 적히지만 아무도 읽지 않는 칸) 잡아낸다
  const reverted = LEDGER_FIELDS.map((f) => (f.key === 'kind' ? { ...f, judgedBy: null } : f));
  assert.ok(auditLedgerKindJudge(reverted).length > 0, 'judgedBy: null 로 되돌아갔는데 아무 말도 하지 않는다');
});

test('[실제 소스] §1-2 가 실측 출처 게이트를 쓴다 ⬅ 빠지면 연습값이 다시 약속이 된다', () => {
  const src = read('src', 'lib', 'recoveryObjectives.ts');
  assert.deepEqual(auditObjectivesGate(src), [], auditObjectivesGate(src).join(' / '));
  assert.ok(auditObjectivesGate('export const x = 1;').length >= 3, '가드가 동작하지 않는다');
  // 판정만 하고 버리는 꼴
  const judgedOnly = "import {measurementOrigin} from './rehearsalKind.ts';\nmeasurementOrigin({env});";
  assert.ok(auditObjectivesGate(judgedOnly).length > 0, '결과로 분기하지 않는데 통과한다');
});

test('[실제 소스] 유형을 **위치로 읽는** 자리가 그대로다(열이 끼어들면 조용히 어긋난다)', () => {
  const src = read('src', 'lib', 'recovery.ts');
  assert.deepEqual(auditKindSource(src), [], auditKindSource(src).join(' / '));
  assert.ok(auditKindSource('export function normalizeKind(){}').length > 0, '가드가 동작하지 않는다');
});

test('[실제 소스] 유형 판정이 한 곳에만 있다(범위 판정이 함께 읽으면 중복 보고)', () => {
  const src = read('src', 'lib', 'rehearsalCoverage.ts');
  assert.deepEqual(auditKindSeparation(src), [], auditKindSeparation(src).join(' / '));
  assert.ok(auditKindSeparation(`const x='${KIND_ENV}';`).length > 0, '가드가 동작하지 않는다');
});

test('[실제 소스] /api/health 배선 — 응답에 싣고 관측 판정보다 앞에 온다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), [], auditHealthWiring(route).join(' / '));
  const judgedOnly = "import {rehearsalKindCheck} from '@/lib/rehearsalKind';\nrehearsalKindCheck();";
  assert.ok(auditHealthWiring(judgedOnly).length > 0, '판정만 하고 버리는 꼴을 잡지 못한다');
});

test('가드: 되돌아갈 수 있는 길마다 문제를 말한다', () => {
  // 표 파서가 유형을 둘째 칸에서 읽지 않게 바뀌면(열이 끼어든 경우)
  const moved = read('src', 'lib', 'recovery.ts').replace('normalizeKind(cells[1])', 'normalizeKind(cells[2])');
  assert.ok(auditKindSource(moved).some((p) => p.includes('둘째 칸')), '열이 끼어든 것을 잡지 못한다');
  // env 스냅샷이 유형을 읽지 않게 되면
  const noEnv = read('src', 'lib', 'recovery.ts').replace(
    'normalizeKind(env.RECOVERY_LAST_REHEARSAL_KIND)',
    "normalizeKind('')",
  );
  assert.ok(auditKindSource(noEnv).length > 0, 'env 스냅샷에서 유형이 빠진 것을 잡지 못한다');

  // 이 판정이 관측 판정 **뒤로** 밀리면(그 관측에서 조용히 빠진다)
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  const swapped = `${route}\n  checks.rehearsalObservation = rehearsalObservationCheck({ checks });\n`.replace(
    /checks\.rehearsalKind = rehearsalKindCheck\(\);/,
    '',
  );
  assert.ok(
    auditHealthWiring(`import { rehearsalKindCheck } from '@/lib/rehearsalKind';\n${swapped}`).length > 0,
    '배선이 빠진 것을 잡지 못한다',
  );

  // §6-4 기록 정본의 집·열·키가 어긋난 경우
  const wrong = LEDGER_FIELDS.map((f) =>
    f.key === 'kind' ? { ...f, column: '구분', envKey: 'OTHER', home: 'env_only' as const } : f,
  );
  assert.equal(auditLedgerKindJudge(wrong).length, 3, '열·키·집 세 가지를 모두 말해야 한다');
  assert.ok(auditLedgerKindJudge(LEDGER_FIELDS.filter((f) => f.key !== 'kind')).length > 0, '칸 자체가 사라진 경우');
});

test('표 이력: 유형을 모르는 행이 해소한 단위도 따로 적는다(정기로 세지 않는다)', () => {
  const md = tableOf(
    row('2026-05-01', '정기', '90분', '부분 통과', 'asOf=2026-05-01;units=3-6', 'asOf=2026-05-01;units=3-6'),
    row('2026-09-01', '아마도', '95분', '정상', 'asOf=2026-09-01;units=3-6', ''),
  );
  const res = resolutionKinds(parseLedgerTable(md).rows, NOW);
  assert.deepEqual(res.byUnknownKind, ['3-6']);
  assert.deepEqual(res.byIncident, []);
  assert.match(intervalText({ rows: parseLedgerTable(md).rows, now: NOW }).join('\n'), /유형 모를 행이 해소한 단위: 3-6/);
});

test('[실제 소스] 관측 정본(§6-3)에 등록되고 어휘 정본이 실제로 읽힌다', () => {
  const obs = CHECK_OBSERVATIONS.find((o) => o.check === 'rehearsalKind');
  assert.ok(obs, '관측 정본에 rehearsalKind 가 없다 — 등록하지 않으면 관측 판정은 그대로 ok 다');
  assert.equal(obs.role, 'observe');
  assert.equal(obs.field, 'verdict');
  assert.equal(obs.cited, true);
  assert.deepEqual(obs.degradedWhen, ['rehearsal'], '리허설 중의 withheld 는 의도된 degraded 다');
  const vocab = parseVocabulary(read('src', 'lib', 'rehearsalKind.ts'), obs.vocab?.decl);
  assert.deepEqual(vocab, [...KIND_VERDICTS], '어휘 정본을 원문에서 읽을 수 없다');
  const names = read('src', 'lib', 'health.ts');
  assert.match(names, /'rehearsalKind'/, 'CheckName 에 없으면 응답에 실리지 않는다');
});

test('[실제 소스] 절차 단위 6-6 이 정본·문서에 함께 있다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '6-6');
  assert.ok(unit, '절차 단위 정본에 6-6 이 없다 — 리허설 범위에서 빠진다');
  assert.equal(unit.cited, true);
  assert.match(RUNBOOK, /^###\s*6-6\./m);
});

test('[실제 소스] 유형 키는 레지스트리에 있고 **임시 키가 아니다**(영구 기록)', () => {
  assert.ok(ENV_VARS.some((v) => v.key === KIND_ENV), `${KIND_ENV} 가 env 레지스트리에 없다`);
  assert.ok(!TRANSIENT_KEYS.includes(KIND_ENV), '유형 기록은 평상시에도 남아 있어야 하는 영구 기록이다');
  const def = ENV_VARS.find((v) => v.key === KIND_ENV);
  assert.match(String(def?.note ?? ''), /6-6/, '읽는 판정이 생겼다는 사실이 레지스트리에 없다');
});

test('[실제 문서] §6-6·표 열·env 표·체크리스트가 남아 있다', () => {
  assert.deepEqual(auditRunbookKind(RUNBOOK), [], auditRunbookKind(RUNBOOK).join(' / '));
  assert.ok(auditRunbookKind('# 빈 문서').length > 0, '가드가 동작하지 않는다');
  // env 표가 「선택」으로 되돌아가면 판정은 영구히 unknown_kind 다
  const relaxed = RUNBOOK.replace(
    new RegExp(`^\\|\\s*\`${KIND_ENV}\`.*$`, 'm'),
    `| \`${KIND_ENV}\` | \`정기\` / \`사건\` | 선택 |`,
  );
  assert.ok(auditRunbookKind(relaxed).some((p) => p.includes('선택')), '「선택」으로 되돌아간 것을 잡지 못한다');
});
