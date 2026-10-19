/**
 * rehearsalCoverage.test.ts — 리허설이 **어느 절차를 검증했는가**(RUNBOOK §6·§6-2). 2026-10-19
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * 전 절의 기계적 판정이 전제로 깔고 있는 문장은 「이 절차는 실제로 작동한다」이고, 그 근거는 §6
 * 리허설 하나다. 그런데 그것을 말하는 `checks.recovery` 는 **일자와 결과 두 칸**만 본다 —
 * 「언제 했는가」는 말하고 **「무엇을 검증했는가」는 말하지 않는다.** 절차는 소절 19개·체크리스트
 * 36항목으로 자랐고 그 변경을 만드는 쪽이 야간 자동 개발 자신인데, 기한 판정은 시간만 보므로
 * **장치가 좋아질수록 근거가 낡는 방향으로는 아무 신호도 생기지 않았다.**
 *
 * 그래서 (a) 판정 자체(보류 → 기록 없음 → 판독 불가 → **미검증 단위** → 날짜 자격),
 * (b) 값을 담지 않는 규율, (c) 배선(health 응답·레지스트리·§6-2·체크리스트)과 **소절 ↔ 정본
 * 양방향 대조**를 파일 수준에서 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지
 * 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_PROCEDURE_CHANGED,
  COVERAGE_DRIFTS,
  COVERAGE_ENV,
  COVERAGE_LIMITS,
  COVERAGE_RUNBOOK_REF,
  COVERAGE_VERDICTS,
  LAST_REHEARSAL_ENV,
  NON_PROCEDURE_SECTIONS,
  PROCEDURE_UNITS,
  REVISION_LEN,
  addedSince,
  assessCoverage,
  auditChecklistCitations,
  auditFreshnessSource,
  auditHealthWiring,
  auditRegistrySources,
  auditRunbookCoverage,
  auditSectionCoverage,
  auditUnitSections,
  coverageLine,
  coverageLogLine,
  coveragePlanFor,
  coverageText,
  parseCoverageRecord,
  procedureRevision,
  recordPresence,
  rehearsalCoverageCheck,
  rehearsalCoverageStatus,
  runbookSectionKeys,
  uncitedUnits,
  unitFor,
} from '../src/lib/rehearsalCoverage.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const UNITS = PROCEDURE_UNITS;
const ALL_KEYS = UNITS.map((u) => u.key);
const FULL = `asOf=2026-10-19;rev=${procedureRevision().rev};units=${[...ALL_KEYS].sort().join(',')}`;
const NOW = new Date('2026-10-19T12:00:00Z');

/* ─────────────────────────── 정본 목록 ─────────────────────────── */

test('절차 단위 정본: 키가 중복 없이 있고 since·제목·거른 결과가 비어 있지 않다', () => {
  assert.ok(UNITS.length >= 19, `단위가 ${UNITS.length}개다 — 소절이 늘면 정본도 자라야 한다`);
  assert.equal(new Set(ALL_KEYS).size, UNITS.length, '단위 키가 중복됐다');
  for (const u of UNITS) {
    assert.match(u.key, /^\d{1,2}-\d{1,2}$/, `${u.key} 가 소절 번호 꼴이 아니다`);
    assert.match(u.since, /^\d{4}-\d{2}-\d{2}$/, `${u.key} 의 since 가 날짜가 아니다`);
    assert.ok(u.title.trim(), `${u.key} 의 제목이 비었다`);
    assert.ok(u.skipped.trim(), `${u.key} 의 「거르면 생기는 일」이 비었다`);
  }
  assert.equal(unitFor('3-10')!.title.includes('유실 고지'), true);
  assert.equal(unitFor('없는단위'), null);
});

test('체크리스트가 번호로 인용하지 않는 단위를 **숨기지 않는다**', () => {
  const uncited = uncitedUnits();
  assert.ok(uncited.length > 0, '현재 문서에는 인용되지 않는 단위가 있다 — 0 이면 탐지가 깨진 것이다');
  for (const k of uncited) assert.equal(unitFor(k)!.cited, false);
  // 그 사실이 한계로 함께 나간다.
  assert.ok(COVERAGE_LIMITS.some((l) => l.includes('이름으로 찾을 수 없다')));
});

test('예외 소절(환경변수 묶음)은 이유와 함께 적혀 있고 단위와 겹치지 않는다', () => {
  assert.ok(NON_PROCEDURE_SECTIONS.length >= 10);
  const declared = new Set(ALL_KEYS);
  for (const e of NON_PROCEDURE_SECTIONS) {
    assert.ok(e.why.trim(), `${e.key} 에 이유가 없다`);
    assert.equal(declared.has(e.key), false, `${e.key} 가 단위와 예외에 둘 다 있다`);
  }
});

test('어긋남은 세 방향이고, 절차가 앞서 나간 것은 **아무도 알아채지 못한다**', () => {
  assert.deepEqual(
    COVERAGE_DRIFTS.map((d) => d.key),
    ['procedure_outruns_rehearsal', 'scope_stamped_later', 'unit_removed'],
  );
  const outrun = COVERAGE_DRIFTS.find((d) => d.key === 'procedure_outruns_rehearsal')!;
  assert.match(outrun.noticedBy, /아무도/);
  for (const d of COVERAGE_DRIFTS) assert.ok(d.when.trim() && d.effect.trim() && d.fix.trim(), `${d.key} 칸이 비었다`);
  // 사라진 단위는 유실로 단정하지 않는다.
  assert.match(COVERAGE_DRIFTS.find((d) => d.key === 'unit_removed')!.noticedBy, /단정하지 않는다/);
});

/* ─────────────────────────── 절차 개정 ─────────────────────────── */

test('개정 지문: 같은 입력에 같은 값, 단위가 늘면 바뀌고, 제목만 고치면 바뀌지 않는다', () => {
  const a = procedureRevision();
  assert.match(a.rev, new RegExp(`^[0-9a-f]{${REVISION_LEN}}$`));
  assert.equal(a.unitCount, UNITS.length);
  assert.equal(a.rev, procedureRevision().rev);

  const renamed = UNITS.map((u) => ({ ...u, title: `${u.title} (수정)`, skipped: 'x' }));
  assert.equal(procedureRevision(renamed).rev, a.rev, '제목·설명 수정으로 개정이 바뀌면 거짓 경보가 된다');

  const grown = [...UNITS, { key: '9-9', title: '새 소절', since: '2026-12-01', cited: false, skipped: 'x' }];
  assert.notEqual(procedureRevision(grown).rev, a.rev, '단위가 늘었는데 개정이 그대로다');
  assert.equal(procedureRevision(grown).latestSince, '2026-12-01');
});

test('리허설 뒤에 들어온 단위는 **범위 기록이 없어도** 산출된다', () => {
  assert.deepEqual(addedSince(null), []);
  const added = addedSince('2026-10-14');
  assert.ok(added.includes('3-10'), '2026-10-19 에 들어온 단위가 빠졌다');
  assert.ok(added.includes('1-1'));
  assert.equal(added.includes('3-2'), false, '리허설보다 먼저 있던 단위가 섞였다');
});

/* ─────────────────────────── 범위 기록 판독 ─────────────────────────── */

test('범위 기록: 두 형식을 받고 왕복하며, 모르는 토큰은 **채택하지 않고 보고한다**', () => {
  assert.equal(parseCoverageRecord(''), null);
  assert.equal(parseCoverageRecord('   '), null);

  const line = parseCoverageRecord('asOf=2026-10-19;rev=0123456789ab;units=3-2, 1-1 3-2')!;
  assert.equal(line.asOf, '2026-10-19');
  assert.equal(line.rev, '0123456789ab');
  assert.deepEqual(line.units, ['1-1', '3-2']);
  assert.deepEqual(line.invalid, []);

  const json = parseCoverageRecord('{"asOf":"2026-10-19","units":["1-1","3-2"]}')!;
  assert.deepEqual(json.units, ['1-1', '3-2']);
  assert.equal(json.rev, null);

  // 왕복: 산출한 줄을 그대로 되읽을 수 있어야 한다.
  const round = parseCoverageRecord(coverageLine(NOW))!;
  assert.deepEqual(round.units, [...ALL_KEYS].sort());
  assert.equal(round.rev, procedureRevision().rev);
  assert.equal(round.asOf, '2026-10-19');

  // 사람 이름·비고·연결 문자열 같은 다른 칸은 받지 않는다.
  const extra = parseCoverageRecord('asOf=2026-10-19;units=1-1;owner=홍길동')!;
  assert.ok(extra.invalid.length > 0, '모르는 칸을 조용히 버렸다');
  assert.equal(extra.invalid.join(' ').includes('홍길동'), false, '판독 실패 토큰에 값을 담았다');

  assert.deepEqual(parseCoverageRecord('{"units":')!.invalid, ['json']);
  assert.deepEqual(parseCoverageRecord('["1-1"]')!.invalid, ['json'], '배열은 범위 기록이 아니다');
  // 칸 이름 없이 적은 줄·단위 꼴이 아닌 토큰은 채택하지 않는다.
  assert.deepEqual(parseCoverageRecord('1-1,2-1')!.units, []);
  assert.deepEqual(parseCoverageRecord('1-1,2-1')!.invalid, ['1-1,2-1']);
  assert.deepEqual(parseCoverageRecord('units=1-1,삼-일')!.invalid, ['삼-일']);
  assert.ok(parseCoverageRecord('asOf=2026-02-30;units=1-1')!.invalid.some((i) => i.startsWith('asOf=')));
  assert.ok(parseCoverageRecord('rev=xyz;units=1-1')!.invalid.some((i) => i.startsWith('rev=')));
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('리허설 기록이 없으면 **판정을 보류한다**(미실시는 checks.recovery 가 말한다)', () => {
  const c = assessCoverage({ env: {}, now: NOW });
  assert.equal(c.verdict, 'no_rehearsal');
  assert.equal(c.lastRehearsal, null);
  assert.deepEqual(c.uncovered, [], '기록이 없으면 미검증 단위를 단정하지 않는다');
  assert.equal(rehearsalCoverageCheck({ env: {}, now: NOW }).ok, true, '중복 보고 금지 — degraded 로 내리지 않는다');
});

test('일자만 있고 범위가 없으면 `unrecorded` — **통과가 아니라 판정 불가**다', () => {
  const env = { [LAST_REHEARSAL_ENV]: '2026-10-01' };
  const c = assessCoverage({ env, now: NOW });
  assert.equal(c.verdict, 'unrecorded');
  assert.match(c.action, /판정을 못 한 것/);
  // 기록이 없어도 날짜 축으로는 말할 수 있다.
  assert.ok(c.addedSinceRehearsal.length > 0);
  assert.ok(c.behindDays !== null && c.behindDays > 0);
  assert.equal(rehearsalCoverageCheck({ env, now: NOW }).ok, false);
});

test('판독 불가·미래 일자는 채택하지 않는다(일부만 읽으면 어느 단위를 덮었는지 모른다)', () => {
  const base = { [LAST_REHEARSAL_ENV]: '2026-10-19' };
  assert.equal(
    assessCoverage({ env: { ...base, [COVERAGE_ENV]: 'units=1-1;owner=x' }, now: NOW }).verdict,
    'invalid_record',
  );
  assert.equal(assessCoverage({ env: { ...base, [COVERAGE_ENV]: 'units=' }, now: NOW }).verdict, 'invalid_record');
  assert.equal(
    assessCoverage({ env: { ...base, [COVERAGE_ENV]: `asOf=2027-01-01;units=${ALL_KEYS.join(',')}` }, now: NOW }).verdict,
    'invalid_record',
    '미래 일자는 수행 기록이 아니다',
  );
});

test('범위에 없는 단위가 있으면 `procedure_changed` — **날짜 자격 문제가 이것을 덮지 않는다**', () => {
  const partial = ALL_KEYS.filter((k) => k !== '3-10' && k !== '6-2');
  const env = { [LAST_REHEARSAL_ENV]: '2026-10-19', [COVERAGE_ENV]: `units=${partial.join(',')}` };
  const c = assessCoverage({ env, now: NOW });
  assert.equal(c.verdict, 'procedure_changed', 'asOf 가 없는데도 미검증 단위가 먼저 드러나야 한다');
  assert.deepEqual(c.uncovered, ['3-10', '6-2']);
  assert.equal(c.coveredCount, partial.length);
  assert.equal(c.action, ACTION_PROCEDURE_CHANGED);
  assert.equal(rehearsalCoverageCheck({ env, now: NOW }).ok, false);
});

test('전 단위를 덮었어도 날짜가 없거나 리허설보다 뒤면 통과시키지 않는다', () => {
  const units = `units=${ALL_KEYS.join(',')}`;
  assert.equal(
    assessCoverage({ env: { [LAST_REHEARSAL_ENV]: '2026-10-19', [COVERAGE_ENV]: units }, now: NOW }).verdict,
    'undated',
  );
  assert.equal(
    assessCoverage({
      env: { [LAST_REHEARSAL_ENV]: '2026-10-01', [COVERAGE_ENV]: `asOf=2026-10-19;${units}` },
      now: NOW,
    }).verdict,
    'scope_after_rehearsal',
    '리허설 뒤에 떠서 넣은 범위는 그 사이 단위까지 덮는다',
  );
});

test('당일 산출한 전 단위 범위는 `ok` — 정본에 없는 키는 **유실로 단정하지 않는다**', () => {
  const env = { [LAST_REHEARSAL_ENV]: '2026-10-19', [COVERAGE_ENV]: FULL };
  const c = assessCoverage({ env, now: NOW });
  assert.equal(c.verdict, 'ok');
  assert.equal(c.revMatches, true);
  assert.deepEqual(c.uncovered, []);
  assert.equal(rehearsalCoverageCheck({ env, now: NOW }).ok, true);

  const ghost = assessCoverage({
    env: { [LAST_REHEARSAL_ENV]: '2026-10-19', [COVERAGE_ENV]: `${FULL},9-9` },
    now: NOW,
  });
  assert.deepEqual(ghost.unknownUnits, ['9-9']);
  assert.equal(ghost.verdict, 'ok', '사라진 단위 키가 판정을 끌어내리지 않는다');
});

test('판정 키 목록과 공백 기록 취급', () => {
  assert.deepEqual(
    [...COVERAGE_VERDICTS],
    ['no_rehearsal', 'unrecorded', 'invalid_record', 'procedure_changed', 'undated', 'scope_after_rehearsal', 'ok'],
  );
  assert.equal(recordPresence({}), 'absent');
  assert.equal(recordPresence({ [COVERAGE_ENV]: '   ' }), 'blank', '공백을 「있다」로 보면 안 된다');
  assert.equal(recordPresence({ [COVERAGE_ENV]: FULL }), 'set');
});

/* ─────────────────────── 값을 담지 않는 규율 ─────────────────────── */

test('응답·로그에 담당자·비고·설정값이 섞이지 않는다 — 단위 키·판정·날짜·개수뿐', () => {
  const env = {
    [LAST_REHEARSAL_ENV]: '2026-10-19',
    [COVERAGE_ENV]: FULL,
    DATABASE_URL: 'postgres://u:p@ep-secret-123.ap-southeast-1.aws.neon.tech/db',
    HEALTH_DETAIL_TOKEN: 'super-secret-token-value-0123456789',
  };
  const dump = JSON.stringify(rehearsalCoverageCheck({ env, now: NOW }));
  for (const needle of ['postgres://', 'ep-secret', 'super-secret', 'u:p@']) {
    assert.equal(dump.includes(needle), false, `응답에 ${needle} 가 들어갔다`);
  }
  const check = rehearsalCoverageCheck({ env, now: NOW });
  assert.equal(check.required, false, 'required: true 면 리허설 범위로 서비스가 내려간다');
  assert.equal((check.detail as Record<string, unknown>).runbook, COVERAGE_RUNBOOK_REF);
  assert.deepEqual((check.detail as Record<string, unknown>).limits, COVERAGE_LIMITS);

  const plan = coveragePlanFor({ env, now: NOW });
  const log = coverageLogLine(plan);
  assert.match(log, /^\[rehearsalCoverage\] verdict=ok/);
  assert.equal(log.includes('postgres://'), false);
  assert.match(coverageText(plan), /범위에 없는 단위 없음/);
  const status = rehearsalCoverageStatus(env);
  assert.equal(status.verdict, 'ok');
  assert.equal(status.units, UNITS.length);
});

/* ─────────────────────────── 정적 점검(실제 파일) ─────────────────────────── */

test('정본 단위가 **실제 RUNBOOK 소절**로 존재한다', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditUnitSections(runbook), []);
  assert.ok(runbookSectionKeys(runbook).includes('6-2'), '§6-2 소절이 없다');
  // 소절이 사라진 경우를 실제로 잡는지.
  assert.ok(auditUnitSections('### 1-1. 제목\n').length > 0);
  assert.ok(auditUnitSections('').length > 0, '소절을 하나도 못 찾으면 조용히 통과하면 안 된다');
});

test('**반대 방향** — RUNBOOK 의 번호 소절이 전부 정본·예외에 등록돼 있다(이 장치의 핵심)', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditSectionCoverage(runbook), []);
  // 새 소절을 등록하지 않으면 CI 가 실패해야 한다 — 등록하지 않으면 절차만 자라고 판정은 ok 가 된다.
  const problems = auditSectionCoverage(`${runbook}\n### 7-1. 새 소절\n본문\n`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /7-1/);
});

test('각 단위의 `cited` 선언이 실제 체크리스트와 맞는다(「§3 6-1단계」는 소절 인용이 아니다)', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditChecklistCitations(runbook), []);
  assert.ok(auditChecklistCitations('체크리스트가 없는 문서').length > 0);
  // 단계 표기를 소절 인용으로 세면 §6-1 이 늘 인용된 것으로 보인다.
  const onlyStep = '### 리허설 체크리스트\n- [ ] 보안 상태를 재적용했다(§3 6-1단계)\n';
  const judged = auditChecklistCitations(onlyStep, [
    { key: '6-1', title: 't', since: '2026-10-16', cited: false, skipped: 's' },
  ]);
  assert.deepEqual(judged, []);

  // 선언이 거짓인 두 방향을 모두 잡는다 — 정본이 체크리스트와 어긋나면 알려 준다.
  const cited = '### 리허설 체크리스트\n- [ ] 범위를 적었다(§6-2)\n';
  assert.match(
    auditChecklistCitations(cited, [{ key: '6-2', title: 't', since: '2026-10-19', cited: false, skipped: 's' }])[0],
    /인용하는데/,
  );
  assert.match(
    auditChecklistCitations(cited, [{ key: '3-3', title: 't', since: '2026-10-06', cited: true, skipped: 's' }])[0],
    /이름으로 찾을 수 없다/,
  );
});

test('§6 가 **범위를 기록하는 절차**로 남아 있다(§6-2·키·체크리스트 항목)', () => {
  const runbook = read('RUNBOOK.md');
  assert.deepEqual(auditRunbookCoverage(runbook), []);
  const problems = auditRunbookCoverage(runbook.replace(/^###\s*6-2\..*$/m, '### 6-2 범위'));
  assert.ok(problems.some((p) => p.includes('6-2')));
  assert.ok(auditRunbookCoverage(runbook.replace(new RegExp(COVERAGE_ENV, 'g'), 'X')).length > 0);
  assert.ok(
    auditRunbookCoverage(runbook.replace(/^###\s*리허설 체크리스트$/m, '### 항목')).some((p) =>
      p.includes('체크리스트가 없다'),
    ),
  );
});

test('리허설 일자의 정본 위치(`lib/recovery.ts`)가 그대로다 — 범위 판정이 조용해지는 회귀를 막는다', () => {
  assert.deepEqual(auditFreshnessSource(read('src', 'lib', 'recovery.ts')), []);
  assert.ok(auditFreshnessSource('export const x = 1').length > 0);
  // 신선도가 범위까지 보기 시작하면 중복 보고가 된다.
  assert.ok(auditFreshnessSource(`${LAST_REHEARSAL_ENV} rehearsalFreshness ${COVERAGE_ENV}`).length > 0);
});

test('`/api/health` 가 판정을 **응답에 싣는다** + `CheckName` 에 등록돼 있다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), []);
  assert.ok(auditHealthWiring(route.replace(/checks\.rehearsalCoverage\s*=/, 'const unused =')).length > 0);
  assert.match(read('src', 'lib', 'health.ts'), /'rehearsalCoverage'/);
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 원인).
  const exports = [...route.matchAll(/^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/gm)].map(
    (m) => m[1] || m[2],
  );
  assert.deepEqual(exports.sort(), ['GET', 'dynamic']);
});

test('기록 키가 레지스트리에 있고 **임시 키가 아니다**(영구 기록이다)', () => {
  assert.deepEqual(auditRegistrySources(ENV_VARS, TRANSIENT_KEYS), []);
  assert.ok(auditRegistrySources([{ key: LAST_REHEARSAL_ENV }], TRANSIENT_KEYS).length > 0);
  assert.ok(auditRegistrySources(ENV_VARS, [...TRANSIENT_KEYS, COVERAGE_ENV]).length > 0);
});

test('모듈이 DB·next·fs 를 건드리지 않고 임의 기본 범위를 두지 않는다', () => {
  const src = read('src', 'lib', 'rehearsalCoverage.ts');
  for (const forbidden of ['@/db', "from 'next", 'node:fs', 'drizzle-orm', 'CREATE TABLE', 'insert into', 'db.execute']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} 가 들어갔다 — 순수 모듈이어야 한다`);
  }
  // 기본 범위·기본 주기 리터럴을 두지 않는다(두면 수행하지 않은 단위가 조용히 덮인다).
  assert.equal(/units\s*=\s*\[['"]\d/.test(src), false);
});
