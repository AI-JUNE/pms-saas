/**
 * recoveryObjectives.test.ts — 절차의 **약속**(RTO/RPO)과 실측의 대조(RUNBOOK §1·§1-2). 2026-10-20
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 소절 20개의 판정이 전부 「그 단계를 했는가」만 말하는 동안, 이 절차가 지키기로 한 두 수치는
 * §1 에서 `[확인 필요]` 로 비어 있었고 **읽는 코드가 하나도 없었다** — 비어 있다는 사실조차
 * 응답에 나오지 않는다. 그래서 §3-7 이 분으로 확정하고 §3-10 이 되돌릴 수 없는 고지로 내보내는
 * 구간이 **약속을 넘겼는지** 아무도 판정하지 않았고, 소요시간은 §6 표에만 쌓였다.
 *
 * 그래서 (a) 임의 목표치·단위 해석을 하지 않는 규율, (b) 판정 순서(판독 불가 → 약속 없음 →
 * 한쪽만 → 실측 초과 → 설정 모순), (c) 「대조하지 못했다」를 「문제 없다」로 올리지 않는 규율,
 * (d) 공개 응답의 **수치 부재**, (e) 배선(health 응답·레지스트리·§1·§1-2·체크리스트·기록 정본)을
 * 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ATTAINMENTS,
  CONFLICT_KINDS,
  OBJECTIVES,
  OBJECTIVES_RUNBOOK_REF,
  OBJECTIVE_DRIFTS,
  OBJECTIVE_LIMITS,
  OBJECTIVE_VERDICTS,
  RPO_ENV,
  RTO_ENV,
  assessFeasibility,
  assessObjectives,
  auditHealthWiring,
  auditMeasureHome,
  auditObjectiveShape,
  auditRegistrySources,
  auditRunbookObjectives,
  compareToObjective,
  conflictText,
  documentedObjectives,
  measuredFromEnv,
  objectiveFor,
  objectivesFromEnv,
  objectivesLogLine,
  objectivesStatus,
  objectivesText,
  parseObjectiveMinutes,
  recoveryObjectivesCheck,
  reconcileDocumented,
  rehearsalAttainment,
} from '../src/lib/recoveryObjectives.ts';
import { LEDGER_FIELDS, TABLE_COLUMNS } from '../src/lib/rehearsalLedger.ts';
import { CHECK_OBSERVATIONS } from '../src/lib/rehearsalObservation.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const NOW = new Date('2026-10-20T12:00:00Z');

/** 목표 2건을 분으로 넣은 env */
const withObjectives = (rto: string, rpo: string): Record<string, string | undefined> => ({
  [RTO_ENV]: rto,
  [RPO_ENV]: rpo,
});

/* ─────────────────────────── 정본 ─────────────────────────── */

test('정본: 목표마다 약속·실측 출처·공백 시 생기는 일이 있고 키에 단위가 붙어 있다', () => {
  assert.equal(OBJECTIVES.length, 2, '목표는 RTO·RPO 두 건이다');
  assert.deepEqual(auditObjectiveShape(), [], `정본 위반: ${auditObjectiveShape().join(' / ')}`);
  assert.equal(objectiveFor('rto')?.envKey, RTO_ENV);
  assert.equal(objectiveFor('rpo')?.envKey, RPO_ENV);
  assert.equal(objectiveFor('없는키'), null, '모르는 목표를 지어내지 않는다');
  // RTO 실측은 표에만 산다 — 런타임이 볼 수 없다는 사실이 정본에 적혀 있어야 한다
  assert.equal(objectiveFor('rto')?.measureHome, 'table');
  assert.equal(objectiveFor('rpo')?.measureHome, 'env');
  assert.ok(OBJECTIVE_LIMITS.length >= 6, '한계 설명이 줄었다');
  assert.equal(OBJECTIVE_DRIFTS.length, 3, '어긋남 방향 3건');
  assert.ok(OBJECTIVES_RUNBOOK_REF.includes('1-2'));
});

test('auditObjectiveShape: 단위 없는 키 이름·빈 설명을 잡는다', () => {
  const noUnit = auditObjectiveShape([{ ...OBJECTIVES[0], envKey: 'RECOVERY_RTO' }]);
  assert.ok(noUnit.some((p) => p.includes('단위가 없다')), '「4」가 분인지 시간인지 모르는 키를 통과시켰다');
  const empty = auditObjectiveShape([{ ...OBJECTIVES[0], blank: '  ' }]);
  assert.ok(empty.some((p) => p.includes('설명이 비었다')));
  const dup = auditObjectiveShape([OBJECTIVES[0], OBJECTIVES[0]]);
  assert.ok(dup.some((p) => p.includes('두 번 있다')));
});

/* ─────────────────────── 값 읽기(임의 수치 금지) ─────────────────────── */

test('parseObjectiveMinutes: 분 정수만 — 단위 표기·0·소수·음수는 받지 않는다', () => {
  assert.equal(parseObjectiveMinutes('240'), 240);
  assert.equal(parseObjectiveMinutes(' 60 '), 60);
  assert.equal(parseObjectiveMinutes('4h'), null);
  assert.equal(parseObjectiveMinutes('4시간'), null, '「4」가 분인지 시간인지 모르는 값을 해석해 주지 않는다');
  assert.equal(parseObjectiveMinutes('240m'), null);
  assert.equal(parseObjectiveMinutes('0'), null, '0분 복구는 약속이 아니라 오기다');
  assert.equal(parseObjectiveMinutes('-30'), null);
  assert.equal(parseObjectiveMinutes('1.5'), null);
  assert.equal(parseObjectiveMinutes(''), null);
  assert.equal(parseObjectiveMinutes(undefined), null);
  assert.equal(parseObjectiveMinutes('9999999'), null, '상한 밖(1년 초과)은 오타로 본다');
});

test('objectivesFromEnv: 미설정·공백·판독 불가를 구분한다', () => {
  const none = objectivesFromEnv({});
  assert.equal(none.rto.state, 'unset');
  assert.equal(none.rpo.state, 'unset');
  assert.equal(none.rto.minutes, null, '미설정에 기본 목표치를 넣지 않는다');

  const blank = objectivesFromEnv(withObjectives(' ', '60'));
  assert.equal(blank.rto.state, 'blank', '대시보드에는 「있다」로 보이는 공백을 설정으로 세지 않는다');
  assert.equal(blank.rpo.state, 'set');

  const bad = objectivesFromEnv(withObjectives('4시간', '60'));
  assert.equal(bad.rto.state, 'invalid');
  assert.equal(bad.rto.minutes, null);
});

/* ─────────────────────── 설정끼리의 모순 ─────────────────────── */

test('assessFeasibility: 보존 창보다 긴 RTO·스냅샷 기한보다 촘촘한 RPO 를 잡는다', () => {
  const conflictBoth = assessFeasibility({
    rtoMinutes: 3000, // 50시간
    rpoMinutes: 60,
    retentionHours: 24,
    baselineMaxAgeDays: 35,
  });
  assert.deepEqual(conflictBoth.conflicts, ['rto_exceeds_retention', 'rpo_below_baseline_resolution']);
  assert.deepEqual(conflictBoth.unjudged, []);

  const clean = assessFeasibility({ rtoMinutes: 240, rpoMinutes: 60, retentionHours: 168, baselineMaxAgeDays: null });
  assert.deepEqual(clean.conflicts, [], 'RTO 는 창 안이다');
  assert.equal(clean.unjudged.length, 1, '기한을 모르는 RPO 쪽은 미판정으로 남는다');
});

test('상대 설정값을 모르면 **모순 없음으로 올리지 않는다**', () => {
  const unknown = assessFeasibility({ rtoMinutes: 240, rpoMinutes: 60, retentionHours: null, baselineMaxAgeDays: null });
  assert.deepEqual(unknown.conflicts, []);
  assert.equal(unknown.unjudged.length, 2, '「대조했는데 문제 없었다」와 「대조하지 못했다」는 다르다');
  assert.ok(unknown.unjudged.some((u) => u.includes('RECOVERY_PITR_RETENTION_HOURS')));
  assert.ok(unknown.unjudged.some((u) => u.includes('RECOVERY_BASELINE_MAX_AGE_DAYS')));

  const noTarget = assessFeasibility({ rtoMinutes: null, rpoMinutes: null, retentionHours: 24, baselineMaxAgeDays: 35 });
  assert.deepEqual(noTarget.conflicts, [], '목표가 없으면 모순도 판정하지 않는다');
  assert.equal(noTarget.unjudged.length, 2);

  for (const kind of CONFLICT_KINDS) {
    const t = conflictText(kind);
    assert.ok(t && t.how.length > 0 && t.fix.length > 0, `${kind} 설명·조치가 없다`);
  }
  assert.equal(conflictText('없는모순'), null);
});

/* ─────────────────────── 실측과의 대조 ─────────────────────── */

test('compareToObjective: 같으면 met, 넘기면 초과분을 적고, 판독 불가는 통과가 아니다', () => {
  assert.equal(compareToObjective('rto', 240, 240).attainment, 'met', '같은 값은 목표 안이다');
  const over = compareToObjective('rto', 240, 300);
  assert.equal(over.attainment, 'exceeded');
  assert.equal(over.overBy, 60);
  assert.equal(compareToObjective('rpo', 60, null).attainment, 'unjudged', '실측이 없으면 판정 보류다');
  assert.equal(compareToObjective('rpo', null, 30).attainment, 'unjudged', '목표가 없으면 견줄 대상이 없다');
  const unreadable = compareToObjective('rpo', 60, '한 시간');
  assert.equal(unreadable.attainment, 'unreadable');
  assert.equal(unreadable.overBy, null, '판독 불가를 met 으로 올리지 않는다');
  assert.ok(ATTAINMENTS.includes(unreadable.attainment));
});

test('measuredFromEnv: RPO 는 §3-7 구간, RTO 는 **런타임에서 항상 없다**', () => {
  const incident = measuredFromEnv(
    {
      RECOVERY_RESTORE_POINT: '2026-10-20T09:00:00+09:00',
      RECOVERY_WRITE_FREEZE_AT: '2026-10-20T11:30:00+09:00',
    },
    NOW,
  );
  assert.equal(incident.rpoMinutes, 150, '구간은 §3-7 이 확정한 값을 그대로 쓴다(여기서 다시 만들지 않는다)');
  assert.equal(incident.rtoMinutes, null);
  assert.ok(incident.rtoNote.includes('§6 표'), 'RTO 실측이 없는 이유를 숨기지 않는다');

  const normal = measuredFromEnv({}, NOW);
  assert.equal(normal.rpoMinutes, null, '평상시에는 구간이 없다');

  const halfRecorded = measuredFromEnv({ RECOVERY_RESTORE_POINT: '2026-10-20T09:00:00+09:00' }, NOW);
  assert.equal(halfRecorded.rpoMinutes, null, '끝이 없으면 구간을 추정하지 않는다(§3-7 basis_missing)');
});

/* ─────────────────────── 종합 판정과 순서 ─────────────────────── */

test('평상시(미설정)는 unset — degraded 로 드러내고 임의 목표치를 만들지 않는다', () => {
  const a = assessObjectives({ env: {}, now: NOW });
  assert.equal(a.verdict, 'unset');
  assert.deepEqual(a.missing, ['rto', 'rpo']);
  assert.deepEqual(a.configured, []);
  assert.equal(a.attainment.rto.attainment, 'unjudged');
  assert.ok(a.action.includes(RTO_ENV), '해야 할 일에 키 이름이 있다');

  const check = recoveryObjectivesCheck({ env: {}, now: NOW });
  assert.equal(check.ok, false, '§1 의 공백이 평상시에 드러나야 한다 — 이 체크가 생긴 이유다');
  assert.equal(check.required, false, '약속이 비었다고 503 을 내면 복구가 자기 자신을 막는다');
  assert.equal(check.detail.verdict, 'unset');
});

test('판정 순서: 판독 불가 → 약속 없음 → 한쪽만 → 실측 초과 → 설정 모순', () => {
  const invalid = assessObjectives({ env: withObjectives('4시간', '60'), now: NOW });
  assert.equal(invalid.verdict, 'invalid');
  assert.deepEqual(invalid.unreadable, ['rto']);

  const partial = assessObjectives({ env: { [RTO_ENV]: '240' }, now: NOW });
  assert.equal(partial.verdict, 'partial');
  assert.deepEqual(partial.missing, ['rpo']);

  // 실측 초과(이미 일어난 사실)가 설정 모순(아직 일어나지 않은 일)보다 앞이다
  const breached = assessObjectives({
    env: withObjectives('3000', '60'),
    now: NOW,
    measured: { rpo: 300 },
    retentionHours: 24,
    baselineMaxAgeDays: 35,
  });
  assert.equal(breached.verdict, 'breached');
  assert.deepEqual(breached.breached, ['rpo']);
  assert.equal(breached.attainment.rpo.overBy, 240);
  assert.ok(breached.conflicts.length > 0, '모순은 사라지지 않고 목록으로 함께 나간다');

  const infeasible = assessObjectives({
    env: withObjectives('3000', '60'),
    now: NOW,
    retentionHours: 24,
    baselineMaxAgeDays: 35,
  });
  assert.equal(infeasible.verdict, 'infeasible');

  const ok = assessObjectives({
    env: withObjectives('240', '60'),
    now: NOW,
    retentionHours: 168,
    baselineMaxAgeDays: null,
  });
  assert.equal(ok.verdict, 'ok');
  assert.ok(ok.unjudgedConflicts.length > 0, '한쪽 대조를 못 했다는 사실은 ok 여도 함께 적는다');
  for (const v of [invalid, partial, breached, infeasible, ok]) {
    assert.ok(OBJECTIVE_VERDICTS.includes(v.verdict));
  }
});

test('인자로 넘긴 null 은 「모른다」다 — env 로 되돌아가 추측하지 않는다', () => {
  const a = assessObjectives({
    env: { ...withObjectives('3000', '60'), RECOVERY_PITR_RETENTION_HOURS: '24' },
    now: NOW,
    retentionHours: null,
    baselineMaxAgeDays: null,
  });
  assert.deepEqual(a.conflicts, [], 'null 을 받고 env 를 몰래 읽으면 모순을 내게 된다');
  assert.equal(a.verdict, 'ok');
});

test('상대 설정값은 env 의 정본 로더로 읽는다(같은 판독 규칙을 두 번 쓰지 않는다)', () => {
  const a = assessObjectives({
    env: { ...withObjectives('3000', '60'), RECOVERY_PITR_RETENTION_HOURS: '24' },
    now: NOW,
  });
  assert.deepEqual(a.conflicts, ['rto_exceeds_retention']);
});

/* ─────────────────────── 공개 응답에는 수치가 없다 ─────────────────────── */

test('응답·로그에 목표 분·실측 분·초과 분을 담지 않는다', () => {
  const env = withObjectives('4321', '1234');
  const check = recoveryObjectivesCheck({ env, now: NOW, measured: { rpo: 9999 } });
  const dump = JSON.stringify(check.detail);
  for (const n of ['4321', '1234', '9999', '8765']) {
    assert.ok(!dump.includes(n), `응답에 수치(${n})가 들어 있다 — 무인증 응답이다`);
  }
  assert.equal(check.detail.rto, 'set', '상태 어휘만 담는다');
  assert.deepEqual(check.detail.attainment, { rto: 'unjudged', rpo: 'exceeded' });
  assert.deepEqual(check.detail.keys, [RTO_ENV, RPO_ENV]);
  assert.equal(typeof check.detail.unjudgedConflicts, 'number', '미판정은 개수만 담는다');
  assert.ok(Array.isArray(check.detail.limits));

  const line = objectivesLogLine({ env, now: NOW, measured: { rpo: 9999 } });
  for (const n of ['4321', '1234', '9999']) assert.ok(!line.includes(n), '로그에 수치가 들어 있다');
  assert.ok(line.includes('verdict=breached'));

  const status = objectivesStatus({ env, now: NOW });
  assert.equal(status.configured, 2);
  assert.equal(status.limits, OBJECTIVE_LIMITS.length);

  // 사람이 읽는 요약에는 수치가 있어도 된다(저장소·콘솔에서만 쓴다)
  const text = objectivesText({ env, now: NOW });
  assert.ok(text.join('\n').includes('4321'));
});

/* ─────────────────────── §6 표 소요시간과의 대조 ─────────────────────── */

const tableOf = (...rows: string[]): string =>
  [
    '## 6. 복구 리허설 기록',
    '',
    `| ${TABLE_COLUMNS.join(' | ')} |`,
    `| ${TABLE_COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
  ].join('\n');

test('rehearsalAttainment: 표의 최신 행 소요시간을 RTO 와 견준다', () => {
  const md = tableOf(
    '| 2026-10-10 | 정기 | 2026-10-09 22:00 KST | 1시간 20분 | 정상 | 운영담당 | 메모 | asOf=2026-10-10;units=1-1 |',
  );
  const met = rehearsalAttainment({ markdown: md, env: withObjectives('240', '60') });
  assert.equal(met.row?.durationMin, 80);
  assert.equal(met.rto.attainment, 'met');

  const exceeded = rehearsalAttainment({ markdown: md, env: withObjectives('60', '60') });
  assert.equal(exceeded.rto.attainment, 'exceeded');
  assert.equal(exceeded.rto.overBy, 20);

  const noObjective = rehearsalAttainment({ markdown: md, env: {} });
  assert.equal(noObjective.rto.attainment, 'unjudged', '목표가 없으면 견줄 대상이 없다');

  const emptyTable = rehearsalAttainment({ markdown: tableOf(), env: withObjectives('240', '60') });
  assert.equal(emptyTable.row, null);
  assert.equal(emptyTable.rto.attainment, 'unjudged', '표가 비어 있으면 판정 보류다(통과가 아니다)');
  assert.ok(emptyTable.note.includes('RPO'), '리허설에는 고지 대상 유실이 없다는 사실을 함께 적는다');
});

/* ─────────────────────── §1 표기와의 대조 ─────────────────────── */

test('documentedObjectives: `[확인 필요]` 는 placeholder, 자유 문장의 숫자는 주워 오지 않는다', () => {
  const doc = documentedObjectives(RUNBOOK);
  assert.equal(doc.state, 'placeholder', '지금 §1 은 비어 있다 — 그것이 이 체크가 드러내는 상태다');
  assert.equal(doc.rtoMinutes, null);

  const filled = documentedObjectives('- 목표 복구시간(RTO)·목표 복구시점(RPO): `RTO 240분`·`RPO 60분`');
  assert.equal(filled.state, 'documented');
  assert.equal(filled.rtoMinutes, 240);
  assert.equal(filled.rpoMinutes, 60);

  const prose = documentedObjectives('- 목표 복구시간(RTO)·목표 복구시점(RPO): 네 시간 정도, 유실은 한 시간');
  assert.equal(prose.state, 'unreadable', '문장에서 숫자를 지어내지 않는다');
  assert.equal(documentedObjectives('# 다른 문서').state, 'missing');
});

test('reconcileDocumented: 문서에만·env 에만 있는 약속을 가른다', () => {
  const md = '- 목표 복구시간(RTO)·목표 복구시점(RPO): `RTO 240분`·`RPO 60분`';
  const same = reconcileDocumented({ markdown: md, env: withObjectives('240', '60') });
  assert.deepEqual(same.differs, []);
  assert.deepEqual(same.undocumented, []);
  assert.deepEqual(same.unwired, []);

  const drift = reconcileDocumented({ markdown: md, env: withObjectives('480', '60') });
  assert.deepEqual(drift.differs, ['rto'], '두 기록이 다른 약속을 말한다');

  const envOnly = reconcileDocumented({ markdown: RUNBOOK, env: withObjectives('240', '60') });
  assert.deepEqual(envOnly.undocumented, ['rto', 'rpo'], '문서가 `[확인 필요]` 인데 코드에만 수치가 있다');

  const docOnly = reconcileDocumented({ markdown: md, env: {} });
  assert.deepEqual(docOnly.unwired, ['rto', 'rpo'], '문서에만 적으면 판정은 영구히 unset 이다');
});

/* ─────────────────────── 배선(실제 소스·문서) ─────────────────────── */

test('[실제 소스] /api/health 가 이 판정을 싣고, rehearsalObservation **앞에** 온다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), [], `배선 문제: ${auditHealthWiring(route).join(' / ')}`);
  const mine = route.indexOf('checks.recoveryObjectives =');
  const observation = route.indexOf('checks.rehearsalObservation =');
  assert.ok(mine > 0 && observation > mine, 'rehearsalObservation 뒤에 실리면 이 체크가 관측에서 조용히 빠진다');

  const health = read('src', 'lib', 'health.ts');
  assert.ok(/'recoveryObjectives'/.test(health), 'CheckName 에 없으면 응답에 영원히 나오지 않는다');

  assert.ok(auditHealthWiring('').length >= 3, '빈 라우트를 통과시키지 않는다');
  assert.ok(
    auditHealthWiring("import { recoveryObjectivesCheck } from '@/lib/recoveryObjectives';\nrecoveryObjectivesCheck();").some(
      (p) => p.includes('판정만 하고 버리는 꼴'),
    ),
  );
});

test('[실제 소스] 관측 정본·절차 단위·레지스트리에 등록돼 있다', () => {
  const obs = CHECK_OBSERVATIONS.find((o) => o.check === 'recoveryObjectives');
  assert.ok(obs, '관측 정본에 없으면 리허설이 이 장치를 한 번도 읽지 않는다');
  assert.equal(obs?.field, 'verdict');
  assert.equal(obs?.cited, true);
  assert.ok(obs?.degradedWhen.includes('normal'), '평상시 degraded 가 **의도된 것**임을 정본에 적어야 한다');

  const unit = PROCEDURE_UNITS.find((u) => u.key === '1-2');
  assert.ok(unit, '§1-2 가 절차 단위 정본에 없다 — 범위 판정이 소절 추가를 보지 못한다');
  assert.equal(unit?.cited, true);

  assert.deepEqual(
    auditRegistrySources(ENV_VARS, TRANSIENT_KEYS),
    [],
    `레지스트리 문제: ${auditRegistrySources(ENV_VARS, TRANSIENT_KEYS).join(' / ')}`,
  );
  assert.ok(
    auditRegistrySources(ENV_VARS, [...TRANSIENT_KEYS, RTO_ENV]).some((p) => p.includes('임시 키 목록')),
    '목표치는 복구 중에만 넣는 표지가 아니라 영구 설정이다',
  );
  assert.ok(auditRegistrySources([], TRANSIENT_KEYS).length >= 2);
});

test('[실제 정본] §6 표 `소요시간` 칸이 이 판정에 연결돼 있다', () => {
  assert.deepEqual(auditMeasureHome(LEDGER_FIELDS), [], `실측의 집 문제: ${auditMeasureHome(LEDGER_FIELDS).join(' / ')}`);
  const unlinked = LEDGER_FIELDS.map((f) => (f.key === 'duration' ? { ...f, judgedBy: null } : f));
  assert.ok(
    auditMeasureHome(unlinked).some((p) => p.includes('만나는 자리')),
    '읽는 판정이 사라지면 목표와 실측이 다시 만나지 않는다',
  );
  const noColumn = LEDGER_FIELDS.map((f) => (f.key === 'duration' ? { ...f, column: null } : f));
  assert.ok(auditMeasureHome(noColumn).some((p) => p.includes('저장소에 남지 않는다')));
  assert.ok(auditMeasureHome([]).some((p) => p.includes('소요시간 칸이 없다')));
});

test('[실제 문서] RUNBOOK §1·§1-2·체크리스트가 목표치를 적는 절차로 남아 있다', () => {
  assert.deepEqual(auditRunbookObjectives(RUNBOOK), [], `문서 문제: ${auditRunbookObjectives(RUNBOOK).join(' / ')}`);

  const noSection = RUNBOOK.replace(/^###\s*1-2\./m, '### 1-9.');
  assert.ok(auditRunbookObjectives(noSection).some((p) => p.includes('§1-2 절이 사라졌다')));

  const noKey = RUNBOOK.split(RTO_ENV).join('RECOVERY_SOMETHING_ELSE');
  assert.ok(auditRunbookObjectives(noKey).some((p) => p.includes(RTO_ENV)));

  assert.ok(auditRunbookObjectives('# 빈 문서').length >= 5, '빈 문서를 통과시키지 않는다');
});
