/**
 * ledgerPurpose.test.ts — §6 표의 행이 **무엇의 기록인가**(RUNBOOK §2·§6·§6-8). 2026-10-23
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6-6 은 「연습」과 「사건」을 갈라 놓았는데, 같은 표에 행을 적으라고 지시하는 절이 하나 더
 * 있다 — §2 월 점검 6번이다. 월 점검은 §3 절차를 **하나도 수행하지 않는데**, `유형` 어휘에
 * 그것을 적을 값이 없었고 `normalizeKind` 는 부분 문자열 `정기` 로 판정하므로 §2 의 절 이름
 * 그대로 「정기 점검」이라고 적어도 정기 리허설 행이 됐다 — 기한이 매월 리셋되고(리허설을 한
 * 번도 하지 않아도 `ok` 가 유지된다), §1-2 가 몇 분짜리 점검 소요시간을 RTO 실측으로 읽었다.
 *
 * 그래서 (a) 판독의 경계(「정기 점검」은 `ambiguous`), (b) 판정 순서와 「추정해서 빼지 않는다」
 * 규율, (c) §1-2 게이트가 실제로 점검 행을 뺀다는 사실, (d) 배선(파서 원문 보존·health 응답·
 * 관측 정본·절차 단위·§6-4 기록 정본·§2 지시·표 어휘·§6-8 문서·체크리스트)을 파일 수준에서
 * 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHECK_ROW_EMPTY_CELLS,
  CHECK_VALUE,
  PURPOSE_COLUMN,
  PURPOSE_DRIFTS,
  PURPOSE_ENV,
  PURPOSE_LIMITS,
  PURPOSE_MISREADS,
  PURPOSE_ROLES,
  PURPOSE_RUNBOOK_REF,
  PURPOSE_VALUES,
  PURPOSE_VERDICTS,
  assessPurpose,
  auditAttainmentPurposeGate,
  auditHealthWiring,
  auditKindRawKept,
  auditRoleAlignment,
  auditRunbookPurpose,
  auditSectionTwoRow,
  auditTableVocabulary,
  checkRowShape,
  displacedLatest,
  latestRehearsalRow,
  ledgerPurposeCheck,
  ledgerPurposeStatus,
  promotedIntoEnv,
  publicPurpose,
  purposeLogLine,
  purposeOfRow,
  purposeState,
  purposeText,
  rehearsalRows,
  roleForPurpose,
} from '../src/lib/ledgerPurpose.ts';
import { KIND_ROLES } from '../src/lib/rehearsalKind.ts';
import { LEDGER_FIELDS, parseLedgerTable, type LedgerRow } from '../src/lib/rehearsalLedger.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { CHECK_OBSERVATIONS } from '../src/lib/rehearsalObservation.ts';
import { rehearsalAttainment } from '../src/lib/recoveryObjectives.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');

const NOW = new Date('2026-10-23T12:00:00Z');

function rowOf(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    row: 1,
    date: '2026-09-20',
    kind: 'periodic',
    kindRaw: '정기',
    target: '',
    durationMin: 95,
    result: 'pass',
    owner: '운영담당',
    note: '',
    scope: '',
    unpassed: '',
    ...over,
  };
}

/** §2 월 점검이 남기는 행 — §3 수치는 비어 있다 */
function checkRow(over: Partial<LedgerRow> = {}): LedgerRow {
  return rowOf({
    row: 2,
    date: '2026-10-20',
    kind: 'unknown',
    kindRaw: CHECK_VALUE,
    durationMin: null,
    ...over,
  });
}

/* ───────────────────────────── 판독의 경계 ───────────────────────────── */

test('purposeState: 「정기 점검」을 연습으로 올리지 않는다 ⬅ §2 의 절 이름이 그 말이다', () => {
  assert.equal(purposeState('정기'), 'rehearsal');
  assert.equal(purposeState('사건'), 'incident');
  assert.equal(purposeState(CHECK_VALUE), 'check');
  assert.equal(purposeState('월 점검'), 'check');
  // 두 토큰이 겹치면 **어느 쪽도 고르지 않는다**
  assert.equal(purposeState('정기 점검'), 'ambiguous');
  assert.equal(purposeState('정기 환경 점검'), 'ambiguous');
  assert.equal(purposeState(''), 'absent');
  assert.equal(purposeState('   '), 'absent');
  assert.equal(purposeState('기타'), 'unreadable');
  assert.equal(purposeState(null), 'absent');
});

test('purposeOfRow: 원문이 없으면 점검으로 추정하지 않는다(판정 보류)', () => {
  assert.equal(purposeOfRow(rowOf()), 'rehearsal');
  assert.equal(purposeOfRow(checkRow()), 'check');
  // 파서를 거치지 않은(원문 없는) 행: 접힌 값만으로는 점검을 되살릴 수 없다
  assert.equal(purposeOfRow({ kind: 'unknown' }), 'unreadable');
  assert.equal(purposeOfRow({ kind: 'periodic' }), 'rehearsal');
  assert.equal(purposeOfRow({ kind: 'incident' }), 'incident');
});

test('세 목적의 자격이 §6-6 정본과 양방향으로 맞는다 ⬅ 어긋나면 두 절이 다른 말을 한다', () => {
  assert.deepEqual(auditRoleAlignment(KIND_ROLES), []);
  const check = roleForPurpose('check');
  assert.ok(check);
  // 점검은 어떤 리허설 자격도 갖지 않는다
  assert.equal(check.resetsInterval, false);
  assert.equal(check.rtoEvidence, 'none');
  assert.equal(check.resolvesUnpassed, false);
  assert.equal(check.countsAsCoverage, false);
  assert.equal(PURPOSE_ROLES.length, 3);
  // 자격이 같아지면 잡는다
  const loosened = KIND_ROLES.map((r) => (r.kind === 'incident' ? { ...r, resetsInterval: true } : r));
  assert.ok(auditRoleAlignment(loosened).length > 0);
});

/* ───────────────────────────── 판정 ───────────────────────────── */

test('assessPurpose: 평상시(기록 없음)는 판정 보류이고 degraded 를 늘리지 않는다', () => {
  const a = assessPurpose({ env: {}, now: NOW });
  assert.equal(a.verdict, 'no_record');
  assert.equal(a.basis, 'env');
  assert.equal(ledgerPurposeCheck({ env: {}, now: NOW }).ok, true);
});

test('assessPurpose: 겹친 말이 먼저다 ⬅ 「정기 점검」은 통과가 아니다', () => {
  const a = assessPurpose({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: '정기 점검' }, now: NOW });
  assert.equal(a.verdict, 'ambiguous_purpose');
  assert.equal(a.envPurpose, 'ambiguous');
  assert.equal(ledgerPurposeCheck({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: '정기 점검' }, now: NOW }).ok, false);
});

test('assessPurpose: 점검이 리허설 env 로 승격된 두 경로를 모두 잡는다', () => {
  // (가) env 에 점검이라고 적혀 있다
  const byValue = assessPurpose({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: CHECK_VALUE }, now: NOW });
  assert.equal(byValue.verdict, 'check_in_env');
  // (나) env 일자가 표의 **점검 행** 일자와 같다(§6-4 가 「맞추라」고 지시해 생기는 경로)
  const byDate = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: '정기' },
    rows: [rowOf(), checkRow()],
    now: NOW,
  });
  assert.equal(byDate.verdict, 'check_in_env');
  assert.equal(byDate.basis, 'table+env');
});

test('assessPurpose: 점검 행이 리허설 행을 가리면 그 사실을 말한다', () => {
  const a = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' },
    rows: [rowOf(), checkRow()],
    now: NOW,
  });
  assert.equal(a.verdict, 'check_latest');
  assert.deepEqual(a.displacedBy, ['2026-10-20']);
  assert.equal(a.counts.check, 1);
  assert.equal(a.counts.rehearsal, 1);
  assert.equal(a.latestPurpose, 'check');
});

test('assessPurpose: 목적을 읽을 수 없는 행은 통과가 아니다 / 제자리면 ok', () => {
  const unknown = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' },
    rows: [rowOf(), rowOf({ row: 2, date: '2026-09-25', kind: 'unknown', kindRaw: '기타' })],
    now: NOW,
  });
  assert.equal(unknown.verdict, 'unknown_purpose');
  assert.deepEqual(unknown.unreadableRows, [2]);

  const ok = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' },
    rows: [checkRow({ row: 1, date: '2026-08-20' }), rowOf({ row: 2 })],
    now: NOW,
  });
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual(ok.displacedBy, []);
});

test('미래 일자 행은 기록으로 세지 않는다', () => {
  const a = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' },
    rows: [rowOf(), checkRow({ date: '2026-12-01' })],
    now: NOW,
  });
  assert.equal(a.verdict, 'ok');
  assert.equal(a.counts.check, 0);
});

test('판정 어휘는 정본 밖으로 나가지 않는다', () => {
  const cases = [
    { env: {} },
    { env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: '정기 점검' } },
    { env: { RECOVERY_LAST_REHEARSAL: '2026-10-20', [PURPOSE_ENV]: CHECK_VALUE } },
    { env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' }, rows: [rowOf(), checkRow()] },
    { env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '사건' }, rows: [rowOf()] },
  ];
  for (const c of cases) {
    const a = assessPurpose({ ...c, now: NOW });
    assert.ok(PURPOSE_VERDICTS.includes(a.verdict), `모르는 판정: ${a.verdict}`);
    assert.ok(a.action.trim().length > 0);
  }
});

/* ─────────────────── 추정해서 빼지 않는다 ─────────────────── */

test('rehearsalRows: 점검만 뺀다 ⬅ 겹친 말·판독 불가를 빼면 실제 리허설이 사라진다', () => {
  const rows = [
    rowOf(),
    checkRow(),
    rowOf({ row: 3, date: '2026-10-01', kindRaw: '정기 점검' }),
    rowOf({ row: 4, date: '2026-10-05', kind: 'unknown', kindRaw: '기타' }),
  ];
  assert.deepEqual(rehearsalRows(rows).map((r) => r.row), [1, 3, 4]);
  assert.equal(latestRehearsalRow(rows, NOW)?.row, 4);
  // 그 뒤에 들어온 점검 행은 가림으로 보고하되, 겹친 말·판독 불가 행은 그대로 남겨 둔다
  assert.deepEqual(displacedLatest(rows, NOW).displacedBy, ['2026-10-20']);
  assert.equal(displacedLatest(rows, NOW).rehearsal?.row, 4);
});

test('promotedIntoEnv: 판독 불가 일자는 승격으로 세지 않는다', () => {
  assert.equal(promotedIntoEnv({ rows: [checkRow()], env: { RECOVERY_LAST_REHEARSAL: '어제' } }).promoted, false);
  assert.equal(promotedIntoEnv({ rows: [checkRow()], env: {} }).envDate, null);
  const hit = promotedIntoEnv({ rows: [rowOf(), checkRow()], env: { RECOVERY_LAST_REHEARSAL: '2026-10-20' } });
  assert.equal(hit.promoted, true);
  assert.deepEqual(hit.matchedRows, [2]);
});

test('checkRowShape: 점검 행이 들고 있는 리허설 수치를 짚는다(권고 규율)', () => {
  assert.deepEqual(checkRowShape(checkRow()).unexpected, []);
  const dirty = checkRowShape(checkRow({ durationMin: 12, scope: 'units=2-1' }));
  assert.deepEqual(dirty.unexpected.sort(), ['범위', '소요시간']);
  // 리허설 행에는 적용하지 않는다
  assert.equal(checkRowShape(rowOf()).isCheck, false);
  assert.deepEqual(checkRowShape(rowOf()).unexpected, []);
  assert.equal(CHECK_ROW_EMPTY_CELLS.every((c) => c.why.trim().length > 0), true);
});

/* ─────────────────── §1-2 게이트가 실제로 작동한다 ─────────────────── */

test('[실제 문서] §1-2 가 점검 행의 소요시간을 RTO 실측으로 쓰지 않는다', () => {
  const md = [
    '| 일자 | 유형(정기/사건/점검) | 복구 대상 시점 | 소요시간 | 검증 결과 | 담당 | 비고 | 범위 | 미통과 단위 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| 2026-09-20 | 정기 | | 180분 | 정상 | 운영담당 | | | |',
    `| 2026-10-20 | ${CHECK_VALUE} | | 12분 | 정상 | 운영담당 | | | |`,
  ].join('\n');
  const rows = parseLedgerTable(md).rows;
  // 파서가 원문을 버리지 않는다
  assert.equal(rows[1].kindRaw, CHECK_VALUE);
  assert.equal(latestRehearsalRow(rows, NOW)?.durationMin, 180);

  const got = rehearsalAttainment({ markdown: md, env: { RECOVERY_RTO_MINUTES: '240' } });
  assert.equal(got.row?.date, '2026-09-20', '점검 행이 §1-2 의 실측 근거가 되면 안 된다');
  assert.notEqual(got.row?.durationMin, 12);
  assert.deepEqual(auditAttainmentPurposeGate(read('src', 'lib', 'recoveryObjectives.ts')), []);
});

test('[실제 소스] 표 파서가 `유형` 원문을 버리지 않는다', () => {
  assert.deepEqual(auditKindRawKept(read('src', 'lib', 'rehearsalLedger.ts')), []);
  assert.ok(auditKindRawKept('const rows = []').length > 0);
});

/* ───────────────────────────── 공개 응답·로그 ───────────────────────────── */

test('공개 응답·로그에 소요시간·담당·비고를 담지 않는다 ⬅ 무인증 응답이다', () => {
  const a = assessPurpose({
    env: { RECOVERY_LAST_REHEARSAL: '2026-09-20', [PURPOSE_ENV]: '정기' },
    rows: [rowOf({ owner: '홍길동', note: '내부 메모', durationMin: 95 }), checkRow()],
    now: NOW,
  });
  const dump = `${JSON.stringify(publicPurpose(a))} ${purposeLogLine(a)} ${purposeText(a)}`;
  for (const leak of ['홍길동', '내부 메모', '95']) {
    assert.ok(!dump.includes(leak), `공개 응답에 ${leak} 이 들어 있다`);
  }
  assert.ok(purposeLogLine(a).startsWith('recovery_ledger_purpose '));
  assert.equal(ledgerPurposeStatus({}, undefined, NOW).basis, 'env');
  assert.equal(ledgerPurposeStatus({}, [], NOW).basis, 'table+env');
});

test('런타임은 표를 보지 않았다는 사실을 적는다', () => {
  const detail = ledgerPurposeCheck({ env: {}, now: NOW }).detail;
  assert.equal(detail.basis, 'env');
  assert.equal(detail.latestPurpose, null);
  assert.equal(detail.runbook, PURPOSE_RUNBOOK_REF);
  assert.equal(ledgerPurposeCheck({ env: {}, now: NOW }).required, false);
  assert.deepEqual(detail.values, PURPOSE_VALUES);
  assert.ok(PURPOSE_LIMITS.length >= 5);
});

/* ───────────────────────────── 배선(실제 파일) ───────────────────────────── */

test('[실제 소스] /api/health 가 이 판정을 싣고, 관측보다 앞에 있다', () => {
  assert.deepEqual(auditHealthWiring(read('src', 'app', 'api', 'health', 'route.ts')), []);
  const swapped = 'checks.rehearsalObservation = x();\nchecks.ledgerPurpose = ledgerPurposeCheck();';
  assert.ok(auditHealthWiring(swapped).some((p) => p.includes('뒤에 실린다')));
});

test('[실제 정본] 관측 정본·절차 단위·§6-4 기록 정본에 등록돼 있다', () => {
  const obs = CHECK_OBSERVATIONS.find((o) => o.check === 'ledgerPurpose');
  assert.ok(obs, '관측 정본에 ledgerPurpose 가 없다');
  assert.equal(obs.cited, true);
  // 평상시 degraded 를 늘리지 않는다 — 이 체크의 ok:false 는 고쳐야 할 상태다
  assert.deepEqual([...obs.degradedWhen], []);

  const unit = PROCEDURE_UNITS.find((u) => u.key === '6-8');
  assert.ok(unit, '절차 단위 6-8 이 없다');
  assert.equal(unit.cited, true);

  const kind = LEDGER_FIELDS.find((f) => f.key === 'kind');
  assert.ok(kind?.judgedBy?.includes('ledgerPurpose'), '§6-4 기록 정본이 §6-8 을 읽는 판정으로 적지 않는다');
  assert.equal(kind?.column, PURPOSE_COLUMN);
});

test('[실제 문서] §2 6번이 점검 행의 값과 env 금지를 지시한다', () => {
  assert.deepEqual(auditSectionTwoRow(RUNBOOK), []);
  assert.ok(auditSectionTwoRow('## 2. 정기 점검\n6절 표에 적는다').length > 0);
});

test('[실제 문서] §6 표 어휘가 세 값을 적고 있다 ⬅ 둘로 돌아가면 적을 값이 사라진다', () => {
  assert.deepEqual(auditTableVocabulary(RUNBOOK), []);
  const old = '| 일자 | 유형(정기/사건) | 검증 결과 |';
  assert.ok(auditTableVocabulary(old).some((p) => p.includes(CHECK_VALUE)));
});

test('[실제 문서] §6-8 이 판정·어긋남·거짓이 되는 판정·확인 수단을 적고 체크리스트가 인용한다', () => {
  assert.deepEqual(auditRunbookPurpose(RUNBOOK), []);
  assert.ok(auditRunbookPurpose('# 빈 문서').length > 0);
  assert.ok(PURPOSE_MISREADS.length >= 4);
  assert.ok(PURPOSE_DRIFTS.length === 3);
  for (const m of PURPOSE_MISREADS) assert.ok(m.reader.trim() && m.says.trim() && m.why.trim());
});

test('정적 점검의 반대 방향 ⬅ 되돌아간 배선·정본·문서를 실제로 잡는다', () => {
  // 자격 정본이 한쪽에서 사라지거나 점검이 리허설 자격을 갖는 경우
  assert.ok(auditRoleAlignment([]).length >= 2);
  const greedy = PURPOSE_ROLES.map((r) => (r.purpose === 'check' ? { ...r, resetsInterval: true } : r));
  assert.ok(auditRoleAlignment(KIND_ROLES, greedy).some((p) => p.includes('리허설 자격')));
  const blank = PURPOSE_ROLES.map((r) => (r.purpose === 'check' ? { ...r, writtenBy: ' ' } : r));
  assert.ok(auditRoleAlignment(KIND_ROLES, blank).some((p) => p.includes('비었다')));

  // §1-2 가 목적을 보지 않는 읽기로 되돌아가는 두 꼴
  assert.ok(auditAttainmentPurposeGate('const row = null').some((p) => p.includes('latestRehearsalRow')));
  assert.ok(
    auditAttainmentPurposeGate('latestRehearsalRow(x); latestLedgerRow(parseLedgerTable(md).rows)').some((p) =>
      p.includes('되돌아갔다'),
    ),
  );

  // 배선 누락 세 꼴
  assert.equal(auditHealthWiring('').length, 3);
  assert.ok(
    auditHealthWiring("import { ledgerPurposeCheck } from '@/lib/ledgerPurpose';\nconst x = ledgerPurposeCheck();").some(
      (p) => p.includes('판정만 하고 버리는 꼴'),
    ),
  );

  // §6-8 소절·체크리스트 인용 소실
  const noSection = RUNBOOK.replace(/^### 6-8\./m, '### 6-9.');
  assert.deepEqual(auditRunbookPurpose(noSection), ['RUNBOOK 에 6-8 절이 없다']);
  const noCite = RUNBOOK.replace(/checks\.ledgerPurpose/g, 'checks.ledgerRole');
  assert.ok(auditRunbookPurpose(noCite).some((p) => p.includes('체크리스트가')));
  assert.equal(auditSectionTwoRow('## 3. 다른 문서').length, 1);
  assert.equal(auditTableVocabulary('표가 없다').length, 1);
});

test('이 모듈은 DB·next·process.env 를 건드리지 않는다', () => {
  const src = read('src', 'lib', 'ledgerPurpose.ts');
  // 설명문의 「`process.env` 미접근」은 접근이 아니다 — **읽는 꼴**만 금지한다
  assert.ok(!/process\.env\s*[.[]/.test(src), '순수 모듈이 process.env 를 읽는다');
  for (const banned of ["from 'next", '@/db', 'node:fs', 'drizzle']) {
    assert.ok(!src.includes(banned), `순수 모듈에 ${banned} 가 있다`);
  }
});
