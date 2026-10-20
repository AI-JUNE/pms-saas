/**
 * rehearsalLedger.test.ts — 리허설 근거의 **두 기록**(§6 표 ↔ env) 대조(RUNBOOK §6·§6-4). 2026-10-20
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §6-2·§6-3 의 전제는 「리허설 기록이 있다」이고, 그 기록은 **두 군데**에 있다 — 저장소에 남는
 * §6 표와 판정이 읽는 env 스냅샷. 그 둘이 한 번도 대조되지 않았다: 판정은 **사라지는 쪽**만
 * 보고(§4 유실·§5-1 Promote 롤백), 범위는 표에 칸이 없어 **집이 하나**였고, 겹치는 칸이 다른
 * 말을 해도 응답은 `ok` 였으며, **결과를 판독하지 못하면 `ok`** 가 나왔다.
 *
 * 그래서 (a) 판정 순서(판독 불가 → 내구성 → 한쪽만 → 칸 어긋남), (b) 값을 지어내지 않는 규율,
 * (c) 배선(health 응답·레지스트리·§6-4·체크리스트)과 **표 ↔ 정본 양방향 대조**를 파일 수준에서
 * 고정한다. 이 테스트는 **파일만 읽는다** — 네트워크·DB 를 쓰지 않고 `process.env` 도 바꾸지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  LEDGER_DRIFTS,
  LEDGER_FIELDS,
  LEDGER_LIMITS,
  LEDGER_RUNBOOK_REF,
  LEDGER_VERDICTS,
  POSITIONAL_COLUMNS,
  TABLE_COLUMNS,
  auditColumnOrder,
  auditFieldHomes,
  auditHealthWiring,
  auditRecordSources,
  auditRunbookLedger,
  envLedger,
  latestLedgerRow,
  ledgerLogLine,
  ledgerRestoreLines,
  ledgerStatus,
  ledgerText,
  parseLedgerTable,
  reconcileLedger,
  rehearsalLedgerCheck,
  singleHomedFields,
  unjudgedFields,
  type LedgerField,
} from '../src/lib/rehearsalLedger.ts';
import { rehearsalFreshness, rehearsalFromEnv, recoveryCheck } from '../src/lib/recovery.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { TRANSIENT_KEYS } from '../src/lib/envPresence.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const NOW = new Date('2026-10-20T12:00:00Z');

/** 표 한 장을 만든다(열 순서는 정본과 같다) */
function tableOf(...rows: string[]): string {
  return [
    '## 6. 복구 리허설 기록',
    '',
    `| ${TABLE_COLUMNS.join(' | ')} |`,
    `| ${TABLE_COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows,
    '',
  ].join('\n');
}

const ROW_PASS = '| 2026-10-10 | 정기 | 2026-10-09 22:00 KST | 1시간 20분 | 정상 | 운영담당 | 메모 | asOf=2026-10-10;units=1-1 |';

/* ─────────────────────────── 기록의 집(정본) ─────────────────────────── */

test('정본: 칸마다 집·유실 설명이 있고 담당은 env 에 담지 않는다', () => {
  assert.ok(LEDGER_FIELDS.length >= 8, '기록 칸이 줄었다');
  const keys = LEDGER_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length, '칸이 중복됐다');
  for (const f of LEDGER_FIELDS) {
    assert.ok(f.column || f.envKey, `${f.key} 에 집이 없다`);
    assert.ok(f.lost.trim().length > 0, `${f.key} 에 유실 시 생기는 일이 없다`);
  }
  const owner = LEDGER_FIELDS.find((f) => f.key === 'owner');
  assert.equal(owner?.envKey, null, '담당(PII)은 공개 응답에 나가는 env 에 담지 않는다');
  const scope = LEDGER_FIELDS.find((f) => f.key === 'scope');
  assert.equal(scope?.home, 'both', '범위는 2026-10-20 에 표 열을 만들어 집을 둘로 늘렸다');
});

test('집이 하나인 칸·읽는 판정이 없는 칸을 숨기지 않는다', () => {
  const single = singleHomedFields();
  assert.ok(single.includes('duration'), '소요시간은 표에만 있다');
  assert.ok(single.includes('owner'), '담당은 표에만 있다');
  const unjudged = unjudgedFields();
  assert.ok(unjudged.includes('target'), '복구 대상 시점은 적히지만 읽는 판정이 없다');
  assert.ok(unjudged.includes('note'), '비고는 적히지만 읽는 판정이 없다');
  // 소요시간은 2026-10-20(§1-2)에 읽는 판정이 생겼다 — 목표(RTO)와 견주는 자리다.
  assert.ok(!unjudged.includes('duration'), '소요시간은 §1-2 가 읽는다');
  const duration = LEDGER_FIELDS.find((f) => f.key === 'duration');
  assert.match(duration?.judgedBy ?? '', /recoveryObjectives/);
});

test('auditFieldHomes: 선언이 실제 집과 다르거나 env 전용이면 잡는다', () => {
  assert.deepEqual(auditFieldHomes(), [], `정본 위반: ${auditFieldHomes().join(' / ')}`);

  const envOnly: LedgerField[] = [
    {
      key: 'scope',
      column: null,
      envKey: 'RECOVERY_LAST_REHEARSAL_SCOPE',
      home: 'env_only',
      judgedBy: 'x',
      lost: '사라진다',
    },
  ];
  const problems = auditFieldHomes(envOnly);
  assert.ok(
    problems.some((p) => p.includes('env 에만 산다')),
    'env 에만 사는 기록을 통과시켰다 — 그것이 이 배치가 고친 상태다',
  );

  const wrongHome: LedgerField[] = [{ ...envOnly[0], column: '범위', home: 'table_only' }];
  assert.ok(auditFieldHomes(wrongHome).some((p) => p.includes('home 선언')));

  const unknownKey: LedgerField[] = [{ ...envOnly[0], column: '범위', home: 'both', envKey: 'RECOVERY_MADE_UP' }];
  assert.ok(auditFieldHomes(unknownKey).some((p) => p.includes('레지스트리에 없다')));

  const asTransient: LedgerField[] = [{ ...envOnly[0], column: '범위', home: 'both' }];
  assert.ok(
    auditFieldHomes(asTransient, ENV_VARS, [...TRANSIENT_KEYS, 'RECOVERY_LAST_REHEARSAL_SCOPE']).some((p) =>
      p.includes('임시 키 목록'),
    ),
    '리허설 근거가 임시 키로 분류되면 복구 때 유실이 드러나지 않는다',
  );
});

/* ─────────────────────────── 표 읽기 ─────────────────────────── */

test('parseLedgerTable: 열 이름으로 읽고 placeholder 행은 기록이 아니다', () => {
  const t = parseLedgerTable(tableOf('| (미실시) | | | | | | 예정 `[확인 필요]` | |', ROW_PASS));
  assert.equal(t.found, true);
  assert.equal(t.rows.length, 1, 'placeholder 행은 기록이 아니다');
  const r = t.rows[0];
  assert.equal(r.date, '2026-10-10');
  assert.equal(r.kind, 'periodic');
  assert.equal(r.durationMin, 80);
  assert.equal(r.result, 'pass');
  assert.equal(r.owner, '운영담당');
  assert.equal(r.scope, 'asOf=2026-10-10;units=1-1');
});

test('parseLedgerTable: 다른 판정 표를 리허설 기록으로 오인하지 않는다', () => {
  const other = ['| 일자 | 뜻 |', '| --- | --- |', '| 2026-10-10 | 무언가 |'].join('\n');
  assert.equal(parseLedgerTable(other).found, false, '`검증 결과` 열이 없는 표는 리허설 표가 아니다');
  assert.equal(parseLedgerTable('').found, false);
  assert.equal(parseLedgerTable(undefined).found, false);
});

test('latestLedgerRow: 미래 일자는 기록으로 세지 않는다', () => {
  const t = parseLedgerTable(
    tableOf(ROW_PASS, '| 2027-01-01 | 정기 | - | 10분 | 정상 | 운영담당 | | |'),
  );
  assert.equal(latestLedgerRow(t.rows, NOW)?.date, '2026-10-10');
  assert.equal(latestLedgerRow([], NOW), null);
});

test('auditColumnOrder: 열이 중간에 끼어들면 잡는다 ⬅ 위치 기반 파서가 다른 칸을 읽는다', () => {
  assert.deepEqual(auditColumnOrder(tableOf(ROW_PASS)), []);
  const inserted = tableOf(ROW_PASS).replace('| 일자 | 유형', '| 일자 | 새열 | 유형');
  const problems = auditColumnOrder(inserted);
  assert.ok(problems.length > 0, '열 삽입을 통과시켰다');
  assert.ok(problems.some((p) => p.includes('위치로 읽으므로')));
  assert.ok(auditColumnOrder('표 없음')[0].includes('찾지 못했다'));

  // 선언된 열이 표에서 사라지면(범위 열을 떼면) 기록의 집이 선언과 달라진다.
  const noScope = tableOf(ROW_PASS)
    .replace(' | 범위 |', ' |')
    .replace(' | asOf=2026-10-10;units=1-1 |', ' |');
  assert.ok(
    auditColumnOrder(noScope).some((p) => p.includes('기록의 집이 선언과 다르다')),
    '범위 열을 떼어내면 그 값은 env 에만 남는다',
  );
});

/* ─────────────────────────── env 읽기 ─────────────────────────── */

test('envLedger: 미설정과 판독 실패를 구분한다', () => {
  const none = envLedger({});
  assert.equal(none.date, null);
  assert.equal(none.dateFilled, false);
  const bad = envLedger({ RECOVERY_LAST_REHEARSAL: 'yesterday' });
  assert.equal(bad.date, null);
  assert.equal(bad.dateFilled, true, '값이 있는데 못 읽은 것은 미설정과 다르다');
  const ok = envLedger({
    RECOVERY_LAST_REHEARSAL: ' 2026-10-10 ',
    RECOVERY_LAST_REHEARSAL_RESULT: '정상',
    RECOVERY_LAST_REHEARSAL_KIND: '정기',
    RECOVERY_LAST_REHEARSAL_SCOPE: 'asOf=2026-10-10;units=1-1',
  });
  assert.equal(ok.date, '2026-10-10');
  assert.equal(ok.result, 'pass');
  assert.equal(ok.kind, 'periodic');
  assert.equal(ok.scopeFilled, true);
});

/* ─────────────────────────── 대조 판정 ─────────────────────────── */

const ENV_PASS = {
  RECOVERY_LAST_REHEARSAL: '2026-10-10',
  RECOVERY_LAST_REHEARSAL_RESULT: '정상',
  RECOVERY_LAST_REHEARSAL_KIND: '정기',
  RECOVERY_LAST_REHEARSAL_SCOPE: 'asOf=2026-10-10;units=1-1',
};

test('reconcileLedger: 양쪽이 비어 있으면 판정 보류다(평상시 — 중복 보고 금지)', () => {
  const a = reconcileLedger({ env: {}, markdown: tableOf('| (미실시) | | | | | | | |'), now: NOW });
  assert.equal(a.verdict, 'no_record');
  assert.equal(a.basis, 'table+env');
  assert.match(a.action, /판정 보류/);
});

test('reconcileLedger: 두 기록이 일치하면 ok', () => {
  const a = reconcileLedger({ env: ENV_PASS, markdown: tableOf(ROW_PASS), now: NOW });
  assert.equal(a.verdict, 'ok');
  assert.equal(a.tableDate, '2026-10-10');
  assert.equal(a.envDate, '2026-10-10');
  assert.deepEqual(a.differs, []);
});

test('reconcileLedger: 판독 불가를 ok 로 올리지 않는다(결과·일자)', () => {
  const noResult = reconcileLedger({
    env: { RECOVERY_LAST_REHEARSAL: '2026-10-10' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(noResult.verdict, 'unreadable_result', '결과를 못 읽는 상태는 통과가 아니다');

  const weird = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL_RESULT: '완료함' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(weird.verdict, 'unreadable_result', '어휘 밖 문구를 통과로 읽지 않는다');

  const badDate = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL: '2026-10-32' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(badDate.verdict, 'unreadable_date', '대시보드에는 넣어 둔 것으로 보이는 상태다');
});

test('reconcileLedger: 한쪽만 있는 상태를 양방향으로 가른다', () => {
  const tableOnly = reconcileLedger({ env: {}, markdown: tableOf(ROW_PASS), now: NOW });
  assert.equal(tableOnly.verdict, 'table_only');
  assert.match(tableOnly.action, /복원/);

  const envOnly = reconcileLedger({ env: ENV_PASS, markdown: tableOf('| (미실시) | | | | | | | |'), now: NOW });
  assert.equal(envOnly.verdict, 'env_only');
  assert.match(envOnly.action, /저장소에 근거가 없으므로/);
});

test('reconcileLedger: 겹치는 칸이 다른 말을 하면 드러낸다(우선순위 일자>결과>유형>범위)', () => {
  const date = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL: '2026-10-09' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(date.verdict, 'date_mismatch');
  assert.ok(date.differs.includes('date'));

  const result = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL_RESULT: '부분 통과' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(result.verdict, 'result_mismatch', '표가 부분 통과인데 env 가 정상이면 판정이 거짓 ok 가 된다');

  const kind = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL_KIND: '사건' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(kind.verdict, 'kind_mismatch');

  const scope = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL_SCOPE: 'asOf=2026-10-10;units=1-1,2-1' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(scope.verdict, 'scope_mismatch');

  const spaced = reconcileLedger({
    env: { ...ENV_PASS, RECOVERY_LAST_REHEARSAL_SCOPE: ' asOf=2026-10-10;units=1-1 ' },
    markdown: tableOf(ROW_PASS),
    now: NOW,
  });
  assert.equal(spaced.verdict, 'ok', '공백 차이를 어긋남으로 세지 않는다');
});

test('reconcileLedger: 표를 못 찾으면 「일치한다」로 올리지 않는다', () => {
  const a = reconcileLedger({ env: ENV_PASS, markdown: '표가 없는 문서', now: NOW });
  assert.equal(a.verdict, 'unreadable_table');
  assert.equal(a.basis, 'table+env');
});

test('reconcileLedger: 표를 넘기지 않으면 **표를 보지 않았다**고 적는다', () => {
  const a = reconcileLedger({ env: ENV_PASS, now: NOW });
  assert.equal(a.basis, 'env', '런타임은 저장소 파일을 읽지 않는다');
  assert.equal(a.verdict, 'ok');
  assert.equal(a.tableDate, null, '보지 않은 표의 일자를 지어내지 않는다');
  assert.ok(
    LEDGER_LIMITS.some((l) => l.includes('표를 보지 않았다')),
    '그 한계를 응답에 함께 내보낸다',
  );
});

test('reconcileLedger: 판정이 읽는 값이 env 에만 있으면 undurable 로 드러낸다', () => {
  const fields: LedgerField[] = [
    {
      key: 'scope',
      column: null,
      envKey: 'RECOVERY_LAST_REHEARSAL_SCOPE',
      home: 'env_only',
      judgedBy: 'assessCoverage',
      lost: '판정 보류로 내려앉는다',
    },
  ];
  const a = reconcileLedger({ env: ENV_PASS, markdown: tableOf(ROW_PASS), now: NOW, fields });
  assert.equal(a.verdict, 'undurable');
  assert.deepEqual(a.undurable, ['scope']);
  const empty = reconcileLedger({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-10', RECOVERY_LAST_REHEARSAL_RESULT: '정상' }, markdown: tableOf(ROW_PASS), now: NOW, fields });
  assert.notEqual(empty.verdict, 'undurable', '채워져 있지 않은 칸을 유실 위험으로 세지 않는다');

  // env 쪽 값이 없는 칸(소요시간 등)은 env 키가 붙어 있어도 유실 위험으로 세지 않는다.
  const noEnvValue = reconcileLedger({
    env: ENV_PASS,
    markdown: tableOf(ROW_PASS),
    now: NOW,
    fields: [{ ...fields[0], key: 'duration' }],
  });
  assert.deepEqual(noEnvValue.undurable, []);
});

/* ─────────────────────────── 복원 ─────────────────────────── */

test('ledgerRestoreLines: 표에서 env 를 만들고 **없는 값은 지어내지 않는다**', () => {
  const row = latestLedgerRow(parseLedgerTable(tableOf(ROW_PASS)).rows, NOW);
  const lines = ledgerRestoreLines(row);
  assert.deepEqual(lines, [
    'RECOVERY_LAST_REHEARSAL=2026-10-10',
    'RECOVERY_LAST_REHEARSAL_RESULT=정상',
    'RECOVERY_LAST_REHEARSAL_KIND=정기',
    'RECOVERY_LAST_REHEARSAL_SCOPE=asOf=2026-10-10;units=1-1',
  ]);
  const joined = lines.join('\n');
  assert.ok(!joined.includes('운영담당'), '담당(PII)은 env 로 옮기지 않는다');
  assert.ok(!joined.includes('메모'), '비고(자유 메모)는 env 로 옮기지 않는다');

  const thin = latestLedgerRow(
    parseLedgerTable(tableOf('| 2026-10-10 | | - | | | 운영담당 | | |')).rows,
    NOW,
  );
  const blanks = ledgerRestoreLines(thin).join('\n');
  assert.ok(blanks.includes('RECOVERY_LAST_REHEARSAL_RESULT=[확인 필요]'), '빈 칸을 값으로 메우지 않는다');
  assert.ok(blanks.includes('RECOVERY_LAST_REHEARSAL_SCOPE=[확인 필요]'));
  assert.match(ledgerRestoreLines(null)[0], /복원할 기록이 없다/);
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('rehearsalLedgerCheck: required:false 이고 평상시에는 조용하다', () => {
  const normal = rehearsalLedgerCheck({ env: {}, now: NOW });
  assert.equal(normal.required, false, '기록 어긋남으로 서비스를 내리면 복구가 자기 자신을 막는다');
  assert.equal(normal.ok, true, '평상시(기록 없음)는 degraded 를 늘리지 않는다 — 미실시는 checks.recovery 가 말한다');
  assert.equal(normal.detail.verdict, 'no_record');
  assert.equal(normal.detail.basis, 'env');

  const broken = rehearsalLedgerCheck({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-10' }, now: NOW });
  assert.equal(broken.ok, false, '결과 판독 불가는 degraded 로 드러낸다');
  assert.equal(broken.detail.verdict, 'unreadable_result');
});

test('응답에는 담당·비고·범위 값·설정값을 담지 않는다', () => {
  const dump = JSON.stringify(
    rehearsalLedgerCheck({
      env: { ...ENV_PASS, DATABASE_URL: 'postgresql://u:p@host/db' },
      now: NOW,
    }),
  );
  assert.ok(!dump.includes('운영담당'));
  assert.ok(!dump.includes('postgresql://'));
  assert.ok(!dump.includes('units=1-1'), '범위 값을 공개 응답에 담지 않는다');
  assert.ok(dump.includes(LEDGER_RUNBOOK_REF), '근거 절을 함께 내보낸다');
  for (const d of LEDGER_DRIFTS) assert.ok(dump.includes(d.key));
});

test('ledgerText·ledgerLogLine·ledgerStatus: 수치를 지어내지 않는다', () => {
  const a = reconcileLedger({ env: {}, markdown: tableOf(ROW_PASS), now: NOW });
  const text = ledgerText(a).join('\n');
  assert.match(text, /table_only/);
  assert.match(text, /2026-10-10/);
  const line = ledgerLogLine(a);
  assert.match(line, /^\[rehearsalLedger\] verdict=table_only basis=table\+env table=2026-10-10 env=-/);
  assert.ok(!line.includes('운영담당'), '로그에 담당을 남기지 않는다');
  const st = ledgerStatus({});
  assert.equal(st.verdict, 'no_record');
  assert.equal(st.envRecorded, false);
  assert.equal(st.limits, LEDGER_LIMITS.length);
});

test('판정 어휘는 LEDGER_VERDICTS 안에서만 나온다', () => {
  const cases = [
    reconcileLedger({ env: {}, now: NOW }),
    reconcileLedger({ env: ENV_PASS, now: NOW }),
    reconcileLedger({ env: ENV_PASS, markdown: tableOf(ROW_PASS), now: NOW }),
    reconcileLedger({ env: ENV_PASS, markdown: '표 없음', now: NOW }),
    reconcileLedger({ env: { RECOVERY_LAST_REHEARSAL: 'x' }, now: NOW }),
  ];
  for (const c of cases) assert.ok(LEDGER_VERDICTS.includes(c.verdict), `${c.verdict} 가 어휘 밖이다`);
});

/* ─────────────── 고친 거짓 ok: 판독 불가 결과(lib/recovery.ts) ─────────────── */

test('[실제 판정] 결과를 판독하지 못한 기록이 「리허설 통과」로 나가지 않는다', () => {
  const f = rehearsalFreshness({
    rows: rehearsalFromEnv({ RECOVERY_LAST_REHEARSAL: '2026-10-10' }),
    now: NOW,
    intervalDays: 180,
  });
  assert.equal(f.status, 'unknown_result', '판독 불가는 통과도 실패도 아니다');
  assert.equal(f.lastDate, '2026-10-10', '일자는 그대로 말한다');

  const c = recoveryCheck({ env: { RECOVERY_LAST_REHEARSAL: '2026-10-10' }, now: NOW });
  assert.equal(c.ok, false, '그 상태로 ok 가 나가면 §2 점검·마켓플레이스 설명이 「검증됐다」로 읽는다');
  assert.equal(c.required, false);
});

test('auditRecordSources: 판정의 입력 자리와 unknown_result 분기를 고정한다', () => {
  const src = read('src', 'lib', 'recovery.ts');
  assert.deepEqual(auditRecordSources(src), [], `recovery.ts 점검 위반: ${auditRecordSources(src).join(' / ')}`);
  assert.ok(auditRecordSources(src.replace(/unknown_result/g, 'x')).some((p) => p.includes('unknown_result')));
  assert.ok(
    auditRecordSources(src.replace(/RECOVERY_LAST_REHEARSAL_RESULT/g, 'OTHER_KEY')).some((p) => p.includes('더 이상 읽지 않는다')),
  );
});

/* ─────────────────────────── 실제 문서·배선 ─────────────────────────── */

test('[실제 문서] §6 표의 열 순서가 위치 기반 파서와 맞고 범위 열이 있다', () => {
  assert.deepEqual(auditColumnOrder(RUNBOOK), [], `RUNBOOK §6 표 점검 위반: ${auditColumnOrder(RUNBOOK).join(' / ')}`);
  const t = parseLedgerTable(RUNBOOK);
  assert.equal(t.found, true);
  assert.ok(t.index['범위'] >= POSITIONAL_COLUMNS.length, '새 열은 위치 기반 파서 뒤에 붙인다');
  assert.ok(
    /자동화 에이전트는 이 표를 임의로 채우지 않는다/.test(RUNBOOK),
    '열을 늘려도 표를 채우지 않는다는 규칙은 그대로다',
  );
});

test('[실제 문서] §6-4 와 체크리스트 항목이 있다', () => {
  assert.deepEqual(auditRunbookLedger(RUNBOOK), [], `RUNBOOK §6-4 점검 위반: ${auditRunbookLedger(RUNBOOK).join(' / ')}`);
  assert.ok(auditRunbookLedger(RUNBOOK.replace(/^### 6-4\./m, '### 6-9.')).some((p) => p.includes('§6-4 절이 사라졌다')));
  assert.ok(
    auditRunbookLedger(RUNBOOK.replace(/ledgerRestoreLines/g, 'x')).some((p) => p.includes('복원하는 명령이 없다')),
  );
  assert.ok(
    auditRunbookLedger(RUNBOOK.replace(/^### 리허설 체크리스트/m, '### 딴 제목')).some((p) =>
      p.includes('리허설 체크리스트가 없다'),
    ),
    '체크리스트가 사라지면 이 절차의 실행 표면이 사라진다',
  );
});

test('[실제 문서] 6절이 결과 판독 불가를 ok 라고 적지 않는다', () => {
  const at = RUNBOOK.indexOf('| `RECOVERY_LAST_REHEARSAL_RESULT`');
  assert.ok(at > 0, '환경변수 표에 결과 키 행이 있어야 한다');
  const row = RUNBOOK.slice(at, RUNBOOK.indexOf('\n', at));
  assert.match(row, /unknown_result/, '판독 불가 판정을 문서가 함께 말한다');
});

test('[실제 소스] /api/health 가 두 기록 대조를 응답에 싣는다', () => {
  const route = read('src', 'app', 'api', 'health', 'route.ts');
  assert.deepEqual(auditHealthWiring(route), [], `배선 위반: ${auditHealthWiring(route).join(' / ')}`);
  assert.ok(auditHealthWiring(route.replace(/checks\.rehearsalLedger\s*=\s*/, '')).some((p) => p.includes('판정만 하고 버리는 꼴')));
  // §6-3 이 요구하는 순서: 관측 판정(rehearsalObservation)보다 **앞에** 실려야 보인다.
  assert.ok(
    route.indexOf('checks.rehearsalLedger =') < route.indexOf('checks.rehearsalObservation ='),
    'rehearsalObservation 뒤에 실리면 그 판정에서 조용히 빠진다',
  );
  assert.ok(/'rehearsalLedger'/.test(read('src', 'lib', 'health.ts')), 'CheckName 에 등록돼 있어야 응답에 실린다');
});

test('[실제 소스] 이 모듈은 DB·next·fs 를 건드리지 않고 신규 env 를 만들지 않는다', () => {
  const src = read('src', 'lib', 'rehearsalLedger.ts');
  for (const bad of ['next/server', 'drizzle-orm', '@/db', 'node:fs', 'db.execute', 'CREATE TABLE']) {
    assert.ok(!src.includes(bad), `순수 모듈에 ${bad} 가 들어왔다`);
  }
  const keys = [...src.matchAll(/RECOVERY_[A-Z_]+/g)].map((m) => m[0]);
  const known = new Set(ENV_VARS.map((v) => v.key));
  for (const k of new Set(keys)) {
    if (k === 'RECOVERY_MADE_UP') continue;
    assert.ok(known.has(k), `${k} 가 env 레지스트리에 없다 — 신규 env 를 만들지 않는다`);
  }
});
