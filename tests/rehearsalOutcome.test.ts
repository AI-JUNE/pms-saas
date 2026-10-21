/**
 * rehearsalOutcome.test.ts — 리허설이 **무엇을 통과했는가**(RUNBOOK §6·§6-5). 2026-10-21
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6-2(범위)·§6-4(기록의 집)의 전제는 「수행했다 = 검증됐다」인데, §6 표의 `검증 결과` 어휘에는
 * `부분 통과` 가 있고 `rehearsalFreshness` 는 그것을 `failing` 으로 판정하면서 「**실패 항목을
 * 조치하라**」고 지시한다 — 그 「실패 항목」을 적는 칸이 표에도 env 에도 없었다. 그래서
 * (가) 범위 판정은 `ok`(「단위 N/N 검증」)인데 신선도는 `failing` 이고 **어느 단위인지는 어디에도
 * 없었고**, (나) 통과하지 못한 단위는 범위에 들어 있으니 `uncovered` 도 아니어서 **다음 리허설
 * 안내에서 빠졌고**, (다) 결과를 `정상` 으로 덮으면 사실 자체가 사라졌고, (라) §1-2 는 그 행의
 * `소요시간` 을 결과와 무관하게 RTO 실측으로 써서 **`부분 통과` 가 `met`** 을 냈다.
 *
 * 그래서 (a) 「통과」의 경계와 판정 순서, (b) 값을 지어내지 않는 규율(임의 귀속 금지·중복 보고
 * 금지), (c) 표 이력의 해소 규칙, (d) 배선(health 응답·레지스트리·§6-4 기록 정본·§1-2 게이트·
 * §6-5 문서·체크리스트)을 파일 수준에서 고정한다.
 * 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  OUTCOME_COLUMN,
  OUTCOME_DRIFTS,
  OUTCOME_ENV,
  OUTCOME_LIMITS,
  OUTCOME_MISREADS,
  OUTCOME_RUNBOOK_REF,
  OUTCOME_VERDICTS,
  assessOutcome,
  attainmentEligibility,
  auditAttainmentGate,
  auditCoverageSeparation,
  auditHealthWiring,
  auditLedgerHome,
  auditOutcomeShape,
  auditRegistrySources,
  auditRunbookOutcome,
  outcomeLogLine,
  outcomeState,
  outcomeText,
  outstandingText,
  outstandingUnits,
  parseUnpassedRecord,
  rehearsalOutcomeCheck,
  rehearsalOutcomeStatus,
  remediationUnits,
  unpassedLine,
} from '../src/lib/rehearsalOutcome.ts';
import { LEDGER_FIELDS, TABLE_COLUMNS, parseLedgerTable } from '../src/lib/rehearsalLedger.ts';
import { PROCEDURE_UNITS, procedureRevision } from '../src/lib/rehearsalCoverage.ts';
import { CHECK_OBSERVATIONS } from '../src/lib/rehearsalObservation.ts';
import { rehearsalAttainment } from '../src/lib/recoveryObjectives.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const NOW = new Date('2026-11-05T12:00:00Z');

/** 지금 정본의 전 단위 */
const ALL_UNITS = PROCEDURE_UNITS.map((u) => u.key);
const REV = procedureRevision().rev;

/** 리허설을 마친 env 한 벌 — 범위는 전 단위, 결과·미통과는 인자로 */
const envOf = (result: string, unpassed?: string, scope?: string): Record<string, string | undefined> => ({
  RECOVERY_LAST_REHEARSAL: '2026-11-01',
  RECOVERY_LAST_REHEARSAL_RESULT: result,
  RECOVERY_LAST_REHEARSAL_SCOPE: scope ?? `asOf=2026-11-01;rev=${REV};units=${ALL_UNITS.join(',')}`,
  ...(unpassed === undefined ? {} : { [OUTCOME_ENV]: unpassed }),
});

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

/* ─────────────────────────── 정본 ─────────────────────────── */

test('정본: 귀속하지 않으면 거짓이 되는 판정이 전건 적혀 있다 ⬅ 이 모듈의 존재 이유다', () => {
  assert.deepEqual(auditOutcomeShape(), [], `정본 위반: ${auditOutcomeShape().join(' / ')}`);
  assert.ok(OUTCOME_MISREADS.length >= 4, '잘못 읽히는 판정이 줄었다');
  const keys = OUTCOME_MISREADS.map((m) => m.key);
  assert.ok(keys.includes('coverage_counts_unpassed'), '범위 판정이 ok 를 내는 사실을 적어 둔다');
  assert.ok(keys.includes('rto_from_unpassed'), '부분 통과의 소요시간이 RTO met 이 되는 사실을 적어 둔다');
  assert.ok(keys.includes('freshness_points_nowhere'), '「실패 항목을 조치하라」가 가리킬 곳이 없던 사실을 적어 둔다');
  assert.equal(OUTCOME_DRIFTS.length, 3, '어긋남은 세 방향이다');
  assert.ok(OUTCOME_LIMITS.length >= 6, '보장하지 못하는 것이 줄었다');
  assert.match(OUTCOME_RUNBOOK_REF, /6-5/);
});

test('정본: 미통과 기록은 §6-4 의 기록 정본에 **집이 둘로** 등록돼 있다', () => {
  assert.deepEqual(auditLedgerHome(LEDGER_FIELDS), [], auditLedgerHome(LEDGER_FIELDS).join(' / '));
  assert.ok(TABLE_COLUMNS.includes(OUTCOME_COLUMN), '§6 표 열 정본에 미통과 열이 없다');
  assert.equal(TABLE_COLUMNS[TABLE_COLUMNS.length - 1], OUTCOME_COLUMN, '새 열은 맨 뒤에 붙인다(위치 기반 파서)');
  const f = LEDGER_FIELDS.find((x) => x.envKey === OUTCOME_ENV);
  assert.equal(f?.home, 'both', 'env 에만 있으면 Promote 롤백으로 재수행 대상이 사라진다');
  assert.match(f?.judgedBy ?? '', /rehearsalOutcome/);
});

test('정본: 기록 키는 레지스트리에 있고 **임시 키가 아니다** ⬅ 영구 기록이다', () => {
  assert.deepEqual(auditRegistrySources(ENV_VARS, TRANSIENT_KEYS), []);
  assert.ok(!TRANSIENT_KEYS.includes(OUTCOME_ENV));
  const v = ENV_VARS.find((x) => x.key === OUTCOME_ENV);
  assert.equal(v?.group, '복구 리허설');
  assert.equal(v?.indirectIn, 'src/lib/rehearsalOutcome.ts');
});

test('정본: 절차 단위(6-5)와 관측 대상으로 등록돼 있다 ⬅ 등록하지 않으면 판정이 자라지 않는다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '6-5');
  assert.ok(unit, '§6-5 가 절차 단위 정본에 없다');
  assert.equal(unit?.cited, true);
  const obs = CHECK_OBSERVATIONS.find((o) => o.check === 'rehearsalOutcome');
  assert.ok(obs, '관측 정본에 rehearsalOutcome 이 없다');
  assert.equal(obs?.field, 'verdict');
  assert.equal(obs?.vocab?.decl, 'OUTCOME_VERDICTS', '값 어휘는 복사하지 않고 정본 위치만 가리킨다');
  assert.deepEqual(obs?.degradedWhen, [], '평상시·리허설에 의도적 degraded 를 만들지 않는다');
});

/* ─────────────────────── 「통과」의 경계 ─────────────────────── */

test('outcomeState: `정상` 만 통과다 ⬅ 「부분」을 통과로 올리지 않는다', () => {
  assert.equal(outcomeState('정상'), 'passed');
  assert.equal(outcomeState('부분 통과'), 'not_passed', '「통과」가 들어 있어도 부분은 통과가 아니다');
  assert.equal(outcomeState('실패'), 'not_passed');
  assert.equal(outcomeState(''), 'no_record');
  assert.equal(outcomeState(undefined), 'no_record');
  assert.equal(outcomeState('대체로 잘 됐음'), 'unreadable', '판독 불가는 통과도 미통과도 아니다');
});

/* ─────────────────────── 기록 판독 ─────────────────────── */

test('parseUnpassedRecord: 두 형식만 받고 판독 못 한 토큰을 단위로 채택하지 않는다', () => {
  const line = parseUnpassedRecord('asOf=2026-11-01;units=3-6,3-7');
  assert.deepEqual(line?.units, ['3-6', '3-7']);
  assert.equal(line?.asOf, '2026-11-01');
  assert.deepEqual(line?.invalid, []);

  const json = parseUnpassedRecord('{"asOf":"2026-11-01","units":["3-7","3-6"]}');
  assert.deepEqual(json?.units, ['3-6', '3-7'], '두 형식이 같은 값을 돌려준다');

  const bare = parseUnpassedRecord('3-6, 3-7');
  assert.deepEqual(bare?.units, ['3-6', '3-7'], '표 칸에 단위만 적는 꼴도 받는다');

  const dirty = parseUnpassedRecord('asOf=2026-11-01;units=3-6,차단단계;owner=운영담당');
  assert.deepEqual(dirty?.units, ['3-6'], '판독 못 한 토큰을 단위로 올리지 않는다');
  assert.ok(dirty!.invalid.length >= 2, '해석하지 못한 토큰과 받지 않는 칸을 숨기지 않는다');
  assert.ok(!dirty!.invalid.join('|').includes('운영담당'), '받지 않는 칸의 **값**은 되돌려 주지 않는다(공개 응답 PII)');

  assert.equal(parseUnpassedRecord('')?.units, undefined, '미설정은 null 이다(「미통과 없음」이 아니다)');
  assert.equal(parseUnpassedRecord(null), null);
  assert.equal(parseUnpassedRecord('none')?.explicitNone, true);
  assert.equal(parseUnpassedRecord('units=없음')?.explicitNone, true);
  assert.deepEqual(parseUnpassedRecord('{{')?.invalid, ['json']);
});

test('parseUnpassedRecord: 판독 못 한 기준일·배열 꼴·단위만 적은 꼴을 각각 제대로 다룬다', () => {
  const badDate = parseUnpassedRecord('asOf=어제;units=3-6');
  assert.deepEqual(badDate?.units, ['3-6']);
  assert.equal(badDate?.asOf, null, '못 읽은 날짜를 지어내지 않는다');
  assert.ok(badDate!.invalid.some((t) => t.startsWith('asOf=')));

  assert.deepEqual(parseUnpassedRecord('["3-6"]')?.invalid, ['json'], '배열 JSON 은 기록 모양이 아니다');
  assert.deepEqual(parseUnpassedRecord('{"units":"none"}')?.explicitNone, true);
  assert.deepEqual(parseUnpassedRecord('3-6')?.units, ['3-6'], '단위 하나만 적은 꼴');
  assert.deepEqual(parseUnpassedRecord('그냥 메모')?.invalid, ['그냥 메모'], '`=` 가 없는 자유 메모는 채택하지 않는다');
});

test('attainmentEligibility: 결과 칸이 비어 있으면 자격이 없다(판정 보류다)', () => {
  const blank = attainmentEligibility({ result: '' });
  assert.equal(blank.state, 'no_record');
  assert.equal(blank.eligible, false);
  assert.match(blank.why, /비어 있다/);
});

test('정적 점검: 어긋난 선언·빠진 배선을 **각 방향으로** 잡는다', () => {
  assert.ok(
    auditOutcomeShape([{ key: 'x', reader: '', says: 'a', why: 'b' }], [{ key: 'y', when: '', effect: 'e' }]).length >= 2,
    '설명이 빈 정본을 잡는다',
  );
  assert.ok(
    auditOutcomeShape(
      [
        { key: 'x', reader: 'r', says: 's', why: 'w' },
        { key: 'x', reader: 'r', says: 's', why: 'w' },
      ],
      [
        { key: 'y', when: 'w', effect: 'e' },
        { key: 'y', when: 'w', effect: 'e' },
      ],
    ).length >= 2,
    '중복 키를 잡는다',
  );

  assert.ok(auditRegistrySources([], []).some((p) => p.includes('레지스트리에 없다')));
  assert.ok(
    auditRegistrySources([{ key: OUTCOME_ENV }], [OUTCOME_ENV]).some((p) => p.includes('임시 키 목록에 있다')),
    '임시 키로 넣으면 복구 때 유실이 드러나지 않는다',
  );

  assert.ok(auditLedgerHome([]).some((p) => p.includes('기록 정본에')));
  const envOnlyField = { ...LEDGER_FIELDS.find((f) => f.envKey === OUTCOME_ENV)!, column: null, home: 'env_only' as const, judgedBy: null };
  assert.ok(auditLedgerHome([envOnlyField]).length >= 3, '열 없음·집 하나·읽는 판정 없음을 모두 잡는다');

  assert.ok(
    auditCoverageSeparation('// 비어 있다').some((p) => p.includes('assessCoverage 가 없다')),
    '재수행 대상을 산출할 상대가 사라지면 잡는다',
  );

  const noChecklist = RUNBOOK.replace(/^### 리허설 체크리스트$/m, '### 다른 절');
  assert.ok(auditRunbookOutcome(noChecklist).some((p) => p.includes('체크리스트가 없다')));
  const noDrift = RUNBOOK.split(OUTCOME_DRIFTS[0].key).join('x');
  assert.ok(auditRunbookOutcome(noDrift).some((p) => p.includes(OUTCOME_DRIFTS[0].key)));
  const noChecks = RUNBOOK.split('checks.rehearsalOutcome').join('checks.x');
  assert.ok(auditRunbookOutcome(noChecks).some((p) => p.includes('확인 지시가 없다')));
  const noCommand = RUNBOOK.split('outstandingText').join('x');
  assert.ok(auditRunbookOutcome(noCommand).some((p) => p.includes('미해소 미통과를 뽑는 명령이 없다')));
  const noEnv = RUNBOOK.split(OUTCOME_ENV).join('X_KEY');
  assert.ok(auditRunbookOutcome(noEnv).some((p) => p.includes('§4-7')));
});

test('unpassedLine: 왕복 가능하고 **비실존 날짜는 지어내지 않는다**', () => {
  const line = unpassedLine(['3-7', '3-6', '3-6'], '2026-11-01');
  assert.equal(line, 'asOf=2026-11-01;units=3-6,3-7');
  assert.deepEqual(parseUnpassedRecord(line)?.units, ['3-6', '3-7']);
  assert.equal(unpassedLine([], null), 'units=none', '미통과 없음은 명시할 수 있다');
  assert.equal(unpassedLine(['3-6'], '2026-02-30'), 'units=3-6', '비실존 날짜는 생략한다(지어내지 않는다)');
  assert.equal(unpassedLine(['차단'], '2026-11-01'), 'asOf=2026-11-01;units=none', '단위 모양이 아니면 담지 않는다');
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('assessOutcome: 리허설이 없으면 **판정을 보류한다** ⬅ 미실시는 checks.recovery 가 말한다', () => {
  const a = assessOutcome({ env: {}, now: NOW });
  assert.equal(a.verdict, 'no_rehearsal');
  assert.equal(rehearsalOutcomeCheck({ env: {}, now: NOW }).ok, true, '평상시에 degraded 를 늘리지 않는다');
});

test('assessOutcome: 결과가 미통과인데 단위가 없으면 `unattributed` ⬅ 이것이 이 모듈이 생긴 구멍이다', () => {
  const a = assessOutcome({ env: envOf('부분 통과'), now: NOW });
  assert.equal(a.verdict, 'unattributed');
  assert.equal(a.state, 'not_passed');
  assert.deepEqual(a.unpassed, []);
  assert.match(a.action, /재수행 대상을 산출할 수 없다/);
  assert.equal(rehearsalOutcomeCheck({ env: envOf('부분 통과'), now: NOW }).ok, false, '판정 불가는 통과가 아니다');

  // 「없음」으로 적는 것은 귀속이 아니다 — 결과가 미통과면 단위가 있어야 한다.
  assert.equal(assessOutcome({ env: envOf('실패', 'units=none'), now: NOW }).verdict, 'unattributed');
});

test('assessOutcome: 귀속되면 `attributed` 이고 **재수행 대상이 산출된다**', () => {
  const a = assessOutcome({ env: envOf('부분 통과', 'asOf=2026-11-01;units=3-6,3-7'), now: NOW });
  assert.equal(a.verdict, 'attributed');
  assert.deepEqual(a.unpassed, ['3-6', '3-7']);
  assert.deepEqual(a.remediation, ['3-6', '3-7'], '범위가 전 단위면 재수행 대상은 미통과뿐이다');
  assert.equal(a.durationTrusted, false, '끝까지 가지 않은 소요시간은 RTO 실측 자격이 없다');
  const check = rehearsalOutcomeCheck({ env: envOf('부분 통과', 'units=3-6'), now: NOW });
  assert.equal(check.ok, true, '실패 자체는 checks.recovery 가 failing 으로 말한다(중복 보고 금지)');
  assert.equal(check.detail.verdict, 'attributed');
});

test('assessOutcome: 전부 통과면 `ok`, 통과인데 미통과가 적혀 있으면 모순으로 잡는다', () => {
  const ok = assessOutcome({ env: envOf('정상'), now: NOW });
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.durationTrusted, true);
  assert.deepEqual(ok.remediation, [], '전 단위를 통과했으면 재수행 대상이 없다');

  const bad = assessOutcome({ env: envOf('정상', 'units=3-6'), now: NOW });
  assert.equal(bad.verdict, 'contradicts_result');
  assert.match(bad.action, /둘 중 하나가 틀렸다/);
});

test('assessOutcome: 판정 보류·기록 자격이 **거짓 ok 보다 앞에 오지 않는다**', () => {
  // 결과를 판독할 수 없으면 통과 여부를 가릴 수 없다 — checks.recovery 가 unknown_result 로 말한다.
  assert.equal(assessOutcome({ env: envOf('대체로 잘 됐음'), now: NOW }).verdict, 'unreadable_result');
  assert.equal(assessOutcome({ env: envOf(''), now: NOW }).verdict, 'unreadable_result');
  // 해석 못 한 토큰·미래 기준일은 채택하지 않는다(「미통과 없음」으로 올리지 않는다).
  assert.equal(assessOutcome({ env: envOf('부분 통과', 'units=3-6,차단'), now: NOW }).verdict, 'invalid_record');
  assert.equal(assessOutcome({ env: envOf('부분 통과', 'asOf=2026-12-25;units=3-6'), now: NOW }).verdict, 'invalid_record');
  // 정본에 없는 단위는 가리킬 소절이 없다.
  const unknown = assessOutcome({ env: envOf('부분 통과', 'units=9-9'), now: NOW });
  assert.equal(unknown.verdict, 'unknown_units');
  assert.deepEqual(unknown.unknownUnits, ['9-9']);
});

test('assessOutcome: 범위 밖 단위를 미통과로 적으면 `outside_scope` ⬅ 범위 기록이 거짓이 된다', () => {
  const env = envOf('부분 통과', 'units=3-6,3-7', 'asOf=2026-11-01;units=3-6');
  const a = assessOutcome({ env, now: NOW });
  assert.equal(a.verdict, 'outside_scope');
  assert.deepEqual(a.outsideScope, ['3-7']);

  // 범위 기록이 아예 없으면 **없는 대조를 어긋남으로 만들지 않는다**.
  const noScope = assessOutcome({
    env: { RECOVERY_LAST_REHEARSAL: '2026-11-01', RECOVERY_LAST_REHEARSAL_RESULT: '실패', [OUTCOME_ENV]: 'units=3-6' },
    now: NOW,
  });
  assert.deepEqual(noScope.outsideScope, []);
  assert.equal(noScope.verdict, 'attributed');
});

test('remediationUnits: 세 목록의 **합집합**이다 ⬅ 하나만 보면 나머지가 조용히 빠진다', () => {
  assert.deepEqual(
    remediationUnits({ unpassed: ['3-6'], uncovered: ['6-4'], addedSinceRehearsal: ['6-5', '3-6'] }),
    ['3-6', '6-4', '6-5'],
  );
  assert.deepEqual(remediationUnits({ unpassed: ['차단'], uncovered: [], addedSinceRehearsal: [] }), []);

  // 범위가 일부뿐이면 미통과와 **범위에 없는 단위**가 함께 재수행 대상이 된다.
  const a = assessOutcome({ env: envOf('부분 통과', 'units=1-1', 'asOf=2026-11-01;units=1-1'), now: NOW });
  assert.ok(a.remediation.includes('1-1'));
  assert.ok(a.remediation.length > 1, '범위에 없는 단위가 함께 들어간다');
});

/* ─────────────────── RTO 실측 자격(§1-2 게이트) ─────────────────── */

test('attainmentEligibility: `정상` 만 RTO 실측 자격이 있다', () => {
  assert.equal(attainmentEligibility({ result: 'pass' }).eligible, true);
  assert.equal(attainmentEligibility({ result: 'partial' }).eligible, false);
  assert.equal(attainmentEligibility({ result: 'fail' }).eligible, false);
  assert.equal(attainmentEligibility({ result: 'unknown' }).state, 'unreadable');
  assert.equal(attainmentEligibility(null).state, 'no_record');
  assert.match(attainmentEligibility({ result: 'partial' }).why, /약속을 지킨 것으로 기록된다/);
});

test('§1-2 가 이 게이트를 쓴다 ⬅ 부분 통과의 소요시간이 다시 `met` 이 되면 CI 가 막는다', () => {
  const objectives = { RECOVERY_RTO_MINUTES: '240', RECOVERY_RPO_MINUTES: '60' };
  // `rehearsalAttainment` 는 지금 시각으로 최신 행을 고른다 — 미래 일자는 기록으로 세지 않는다.
  const passed = tableOf('| 2026-10-10 | 정기 | 2026-10-09 22:00 KST | 1시간 20분 | 정상 | 운영담당 | 메모 | units=1-1 | |');
  assert.equal(rehearsalAttainment({ markdown: passed, env: objectives }).rto.attainment, 'met');

  const partial = tableOf('| 2026-10-10 | 정기 | 2026-10-09 22:00 KST | 1시간 20분 | 부분 통과 | 운영담당 | 메모 | units=1-1 | 3-6 |');
  const r = rehearsalAttainment({ markdown: partial, env: objectives });
  assert.equal(r.row?.durationMin, 80, '수치는 그대로 읽는다(깎지 않는다)');
  assert.equal(r.eligibility.eligible, false);
  assert.equal(r.rto.attainment, 'unjudged', '끝까지 가지 않은 소요시간으로 `met` 을 내지 않는다');

  assert.deepEqual(auditAttainmentGate(read('src', 'lib', 'recoveryObjectives.ts')), []);
  assert.ok(
    auditAttainmentGate('export function rehearsalAttainment(){return 1}').some((p) => p.includes('import')),
    '게이트가 빠진 모듈을 잡는다',
  );
  assert.ok(
    auditAttainmentGate("from './rehearsalOutcome.ts'; attainmentEligibility(row);").some((p) => p.includes('분기하지 않는다')),
    '판정만 하고 버리는 꼴도 잡는다',
  );
});

/* ─────────────────────── 표의 이력 ─────────────────────── */

test('outstandingUnits: 뒤 리허설이 **수행하고 미통과로 적지 않을 때만** 해소된다', () => {
  const rows = parseLedgerTable(
    tableOf(
      '| 2026-09-01 | 정기 | - | 90분 | 부분 통과 | 담당A | - | units=3-6,3-7 | 3-6,3-7 |',
      '| 2026-10-01 | 정기 | - | 80분 | 부분 통과 | 담당A | - | units=3-6 | 3-6 |',
      '| 2026-11-01 | 정기 | - | 70분 | 정상 | 담당A | - | units=3-7 | |',
    ),
  ).rows;
  const s = outstandingUnits(rows, NOW);
  assert.deepEqual(s.outstanding.map((o) => o.unit), ['3-6'], '3-7 은 마지막 행이 수행하고 미통과로 적지 않아 해소됐다');
  assert.deepEqual(s.resolved, ['3-7']);
  assert.equal(s.outstanding[0].since, '2026-09-01', '처음 적힌 일자를 유지한다');
  assert.equal(s.outstanding[0].times, 2, '다시 적힌 횟수를 센다');

  // 범위에 없으면 수행하지 않은 것이므로 **해소로 세지 않는다**(적지 않아서 사라지는 길을 막는다).
  const notPerformed = parseLedgerTable(
    tableOf(
      '| 2026-09-01 | 정기 | - | 90분 | 부분 통과 | 담당A | - | units=3-6 | 3-6 |',
      '| 2026-11-01 | 정기 | - | 70분 | 정상 | 담당A | - | units=1-1 | |',
    ),
  ).rows;
  assert.deepEqual(outstandingUnits(notPerformed, NOW).outstanding.map((o) => o.unit), ['3-6']);
});

test('outstandingUnits: 판독 불가 행은 **해소도 미통과도 만들지 않는다**', () => {
  const rows = parseLedgerTable(
    tableOf(
      '| 2026-09-01 | 정기 | - | 90분 | 실패 | 담당A | - | units=3-6 | 3-6 |',
      '| 2026-11-01 | 정기 | - | 70분 | 대체로 잘 됐음 | 담당A | - | units=3-6 | |',
    ),
  ).rows;
  const s = outstandingUnits(rows, NOW);
  assert.deepEqual(s.outstanding.map((o) => o.unit), ['3-6'], '판독 불가 행으로 해소되지 않는다');
  assert.deepEqual(s.unreadableRows, ['2026-11-01']);

  const future = parseLedgerTable(tableOf('| 2027-01-01 | 정기 | - | 10분 | 부분 통과 | 담당A | - | units=3-6 | 3-6 |')).rows;
  assert.deepEqual(outstandingUnits(future, NOW).outstanding, [], '미래 일자는 기록으로 세지 않는다');

  const text = outstandingText(rows, NOW);
  assert.ok(text.join('\n').includes('3-6'));
  assert.ok(text.join('\n').includes('RTO 실측 자격'));
});

/* ─────────────────────── 출력(값을 담지 않는다) ─────────────────────── */

test('응답·로그에 담당·비고·소요시간 **값**을 담지 않는다 ⬅ 무인증 공개 엔드포인트다', () => {
  const env = {
    ...envOf('부분 통과', 'units=3-6'),
    RECOVERY_LAST_REHEARSAL_KIND: '정기',
  };
  const dump = JSON.stringify(rehearsalOutcomeCheck({ env, now: NOW }));
  assert.ok(!dump.includes('운영담당'), '담당은 담지 않는다');
  assert.ok(!/"durationMin"|분\\"/.test(dump), '소요시간 수치를 담지 않는다');
  assert.ok(dump.includes('3-6'), '단위 키(소절 번호)는 담는다 — 문서에서 찾을 수 있어야 한다');
  assert.ok(dump.includes(OUTCOME_ENV), '키 이름은 담는다(값이 아니다)');

  const a = assessOutcome({ env, now: NOW });
  const log = outcomeLogLine(a);
  assert.match(log, /^\[rehearsalOutcome\] verdict=attributed/);
  assert.ok(!log.includes('운영담당'));
  const text = outcomeText(a).join('\n');
  assert.ok(text.includes('재수행 대상'));
  const st = rehearsalOutcomeStatus(env);
  assert.equal(st.verdict, 'attributed');
  assert.equal(st.unpassed, 1);
});

test('모듈이 process.env·DB·파일시스템을 들고 있지 않다 ⬅ env 는 인자로 받는다', () => {
  const src = read('src', 'lib', 'rehearsalOutcome.ts');
  assert.ok(!/from\s+['"]node:fs['"]/.test(src), 'fs 를 import 하지 않는다');
  assert.ok(!/@\/db|drizzle|next\/server/.test(src), 'DB·next 를 import 하지 않는다');
  assert.ok(
    !/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+table|alter\s+table|drop\s+table)\b/i.test(src),
    '쓰기·DDL 이 없다',
  );
  // `process.env` 는 체크 함수의 기본 인자에서만 쓴다(라우트에서 넘기지 않는 경우).
  assert.equal((src.match(/process\.env/g) ?? []).length, 2, 'process.env 접근이 늘었다');
});

/* ─────────────────── 실제 소스·문서 대조 ─────────────────── */

test('[실제 소스] /api/health 가 이 판정을 싣고 **관측 판정보다 앞에** 둔다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), [], auditHealthWiring(route).join(' / '));
  assert.ok(
    auditHealthWiring("import { rehearsalOutcomeCheck } from '@/lib/rehearsalOutcome';\nrehearsalOutcomeCheck();").some((p) =>
      p.includes('판정만 하고 버리면'),
    ),
    '호출만 하고 담지 않는 꼴을 잡는다',
  );
  const reordered =
    "import { rehearsalOutcomeCheck } from '@/lib/rehearsalOutcome';\n" +
    'checks.rehearsalObservation = rehearsalObservationCheck({ checks });\n' +
    'checks.rehearsalOutcome = rehearsalOutcomeCheck();';
  assert.ok(auditHealthWiring(reordered).some((p) => p.includes('뒤에 실린다')), '관측 판정 뒤로 밀린 경우를 잡는다');
});

test('[실제 소스] 귀속 판정이 **두 곳에 생기지 않았다** ⬅ 중복 보고 금지', () => {
  const coverage = read('src', 'lib', 'rehearsalCoverage.ts');
  assert.deepEqual(auditCoverageSeparation(coverage), []);
  assert.ok(
    auditCoverageSeparation(`const x = env['${OUTCOME_ENV}']; export function assessCoverage(){}`).some((p) =>
      p.includes('두 곳에 생겼다'),
    ),
  );
  // 「실패 항목을 조치하라」가 가리킬 자리를 문서로 지시하게 됐는지(신선도 쪽 action).
  assert.match(read('src', 'lib', 'recovery.ts'), /6-5/, 'failing 의 action 이 가리킬 절을 적고 있다');
});

test('[실제 문서] RUNBOOK §6-5·표 열·env 표·체크리스트가 살아 있다', () => {
  assert.deepEqual(auditRunbookOutcome(RUNBOOK), [], auditRunbookOutcome(RUNBOOK).join(' / '));
  for (const v of OUTCOME_VERDICTS) {
    assert.ok(RUNBOOK.includes(`\`${v}\``), `§6-5 판정 표에 ${v} 가 없다`);
  }
  assert.ok(
    auditRunbookOutcome(RUNBOOK.replace(/^### 6-5\..*$/m, '### 9-9. 다른 절')).some((p) => p.includes('§6-5 절이 사라졌다')),
  );
  assert.ok(
    auditRunbookOutcome(RUNBOOK.split(OUTCOME_COLUMN).join('범위2')).some((p) => p.includes('열이 없다')),
    '표 열이 사라지면 기록의 집이 env 하나로 줄어든다',
  );
  assert.ok(auditRunbookOutcome('# 다른 문서').length > 0);
});
