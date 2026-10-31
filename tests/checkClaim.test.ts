// **§2 점검 일자는 주장이다**(RUNBOOK §2-4 · §2 · §2-1 · §6-8). 2026-10-31
//
// 이 파일이 지키는 것은 둘이다.
//  (1) **주장을 근거로 올리지 않는다** — 점검 일자 한 줄에서 파생된 `trusted`·빈 `untrusted` 를
//      「최근 확인」으로 읽는 길을 막는다. 뒷받침할 축이 없으면 `uncorroborated`(보류)이고,
//      한 주기 이상 앞선 기준일이 있으면 `contradicted` 다 — 통과로 올리지 않는다.
//  (2) **거짓 차단을 만들지 않는다** — 이 판정은 게이트가 아니다. `ok`·`trusted`·상태 코드를
//      바꾸지 않고, 임의 허용 오차를 만들지 않으며(주기 설정값만 인정), 날짜 없는 두 값이
//      영구히 대조되지 않는다는 한계를 숨기지 않는다.
// 더해서 실제 §2 단계 정본·날짜 없는 설정값 정본·헬스 라우트·절차 단위 정본·이 모듈과
// RUNBOOK 원문을 대조해 문서와 코드가 함께 낡지 않게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_CLAIM_NO_CLAIM, ACTION_CLAIM_UNCORROBORATED, CAVEAT_ALIGNED_IS_NOT_CORRECT,
  CAVEAT_CLAIM_NOT_A_GATE, CAVEAT_UNDATED_STAY_CLAIMS, CLAIM_BLIND_SPOTS, CLAIM_LIMITS,
  CLAIM_MISREADS, CLAIM_RUNBOOK_REF, CLAIM_SOURCES, CLAIM_VERDICTS, ROW_VERDICTS,
  SOURCE_VERDICTS,
  assessCheckClaim, auditNoNewEnv, auditNoNewHealthCheck, auditPeriodicWiring, auditRunbookClaim,
  auditSelfSource, auditSourceCanon, auditUndatedCanon, claimLine, claimMisreadFor,
  claimSourceFor, claimStatus, claimText, datedEnvSources, publicClaim, reconcileCheckRow,
  sourceStamp,
} from '../src/lib/checkClaim.ts';
import {
  CHECK_INTERVAL_ENV, LAST_CHECK_ENV, MONTHLY_STEPS, UNDATED_SETTINGS, periodicCheckHealth,
} from '../src/lib/periodicCheck.ts';
import { ENV_VARS } from '../src/lib/envRegistry.ts';
import { PROCEDURE_UNITS } from '../src/lib/rehearsalCoverage.ts';
import { parseLedgerTable, type LedgerRow } from '../src/lib/rehearsalLedger.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...rel: string[]) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const RUNBOOK = read('RUNBOOK.md');
const SELF_SRC = read('src', 'lib', 'checkClaim.ts');
const PERIODIC_SRC = read('src', 'lib', 'periodicCheck.ts');
const HEALTH_SRC = read('src', 'app', 'api', 'health', 'route.ts');

const NOW = new Date('2026-10-31T09:00:00Z');
const INTERVAL = 35;
const TODAY = '2026-10-31';

/** 그 점검에서 3번을 실제로 돌린 스냅샷 — **행 수는 응답에 나가지 않아야 한다** */
const data = (asOf: string) => `asOf=${asOf},users=4242,projects=37`;
/** 그 점검에서 4번을 실제로 돌린 키 목록 스냅샷 */
const envSnap = (asOf: string) => `asOf=${asOf};keys=DATABASE_URL,SESSION_COOKIE`;

const base = (over: Record<string, string | undefined> = {}) => ({
  RECOVERY_DATA_BASELINE: data(TODAY),
  RECOVERY_ENV_BASELINE: envSnap(TODAY),
  RECOVERY_PITR_RETENTION_HOURS: '720',
  RECOVERY_EXPECTED_DB: 'a1b2c3d4e5f6',
  ...over,
});

const assess = (lastCheck: unknown, env: Record<string, string | undefined>, intervalDays: number | null = INTERVAL) =>
  assessCheckClaim({ lastCheck, intervalDays, env, now: NOW });

const row = (date: string, kindRaw: string): LedgerRow => ({
  row: 1,
  date,
  kind: kindRaw.includes('정기') ? 'periodic' : kindRaw.includes('사건') ? 'incident' : 'unknown',
  kindRaw,
  target: '',
  durationMin: null,
  result: 'pass',
  owner: '담당',
  note: '',
  scope: '',
  unpassed: '',
});

/* ─────────────────────────── 대조 축 정본 ─────────────────────────── */

test('정본: §2 가 공급하는 값 전건이 있고 **대조할 수 있는 것은 둘뿐**이라고 적는다', () => {
  assert.ok(CLAIM_SOURCES.length >= 5);
  const dated = datedEnvSources();
  assert.deepEqual(dated.map((s) => s.key), ['RECOVERY_DATA_BASELINE', 'RECOVERY_ENV_BASELINE']);

  // 날짜 없는 두 값은 **영구히 대조되지 않는다** — 그 사실을 정본에 적어 둔다.
  const undatable = CLAIM_SOURCES.filter((s) => s.home === 'env' && !s.dated);
  assert.deepEqual(undatable.map((s) => s.key), ['RECOVERY_PITR_RETENTION_HOURS', 'RECOVERY_EXPECTED_DB']);
  for (const s of undatable) assert.match(s.corroborates, /없다/);

  // 표 쪽은 설정 키가 없고(런타임이 읽지 못한다), 전건이 §2 단계 번호와 설명을 갖는다.
  const table = CLAIM_SOURCES.filter((s) => s.home === 'table');
  assert.equal(table.length, 1);
  assert.equal(table[0].key, null);
  for (const s of CLAIM_SOURCES) {
    assert.ok(s.step >= 1 && s.reader.trim() && s.ifMissing.trim(), `${s.key} 정본이 비었다`);
  }
  assert.equal(claimSourceFor('RECOVERY_DATA_BASELINE')?.step, 3);
  assert.equal(claimSourceFor('없는키'), null);
});

test('정본: 대조 축의 설정 키는 전건 레지스트리에 등록된 **기존** 키다(신규 env 0)', () => {
  const known = new Set(ENV_VARS.map((v) => v.key));
  for (const s of CLAIM_SOURCES) {
    if (s.key === null) continue;
    assert.ok(known.has(s.key), `${s.key} 가 env 레지스트리에 없다 — 새 키를 만든 셈이다`);
  }
});

test('정본: 이 대조가 없으면 거짓이 되는 판정 다섯을 적어 둔다', () => {
  const keys = CLAIM_MISREADS.map((m) => m.key);
  assert.deepEqual(keys, [
    'date_is_performance',
    'empty_untrusted_is_fresh',
    'stale_snapshot_is_separate',
    'overdue_is_skipped',
    'table_row_is_checked',
  ]);
  for (const m of CLAIM_MISREADS) assert.ok(m.says.trim() && m.why.trim());
  assert.match(claimMisreadFor('date_is_performance')!.why, /주장/);
  assert.equal(claimMisreadFor('x'), null);
});

/* ─────────────────────────── 값 한 칸 판독 ─────────────────────────── */

test('판독: 미설정·판독 불가·날짜 없음·기준일을 **섞지 않는다**', () => {
  const dataSrc = claimSourceFor('RECOVERY_DATA_BASELINE')!;
  const envSrc = claimSourceFor('RECOVERY_ENV_BASELINE')!;

  assert.deepEqual(sourceStamp(dataSrc, {}), { state: 'absent', asOf: null });
  assert.deepEqual(sourceStamp(dataSrc, { RECOVERY_DATA_BASELINE: '   ' }), { state: 'absent', asOf: null });
  assert.deepEqual(sourceStamp(dataSrc, { RECOVERY_DATA_BASELINE: data('2026-09-01') }), {
    state: 'dated',
    asOf: '2026-09-01',
  });
  // 날짜 없는 스냅샷은 「언제 기준인지 모른다」 — 0건이나 오늘로 메우지 않는다.
  assert.deepEqual(sourceStamp(dataSrc, { RECOVERY_DATA_BASELINE: 'users=12' }), { state: 'undated', asOf: null });
  assert.deepEqual(sourceStamp(dataSrc, { RECOVERY_DATA_BASELINE: '???' }), { state: 'unreadable', asOf: null });

  assert.deepEqual(sourceStamp(envSrc, { RECOVERY_ENV_BASELINE: envSnap('2026-10-02') }), {
    state: 'dated',
    asOf: '2026-10-02',
  });
  assert.equal(sourceStamp(envSrc, { RECOVERY_ENV_BASELINE: 'keys=DATABASE_URL' }).state, 'undated');

  // 날짜를 품을 수 없는 축은 값이 있어도 기준일을 지어내지 않는다.
  assert.deepEqual(sourceStamp(claimSourceFor('RECOVERY_EXPECTED_DB')!, { RECOVERY_EXPECTED_DB: 'a1b2c3' }), {
    state: 'undated',
    asOf: null,
  });
  // 표 축은 런타임에서 읽을 값이 없고, 판독기를 배선하지 않은 축은 **추측하지 않고** 보고한다.
  assert.equal(sourceStamp(CLAIM_SOURCES.find((s) => s.home === 'table')!, {}).state, 'absent');
  assert.equal(
    sourceStamp({ ...dataSrc, key: 'RECOVERY_UNWIRED_SNAPSHOT' }, { RECOVERY_UNWIRED_SNAPSHOT: data(TODAY) }).state,
    'unreadable',
  );
});

/* ─────────────────────────── 주장 대조 ─────────────────────────── */

test('corroborated: 기준일이 점검 일자와 같으면 그 단계는 그 점검에서 돌았다', () => {
  const a = assess(TODAY, base());
  assert.equal(a.verdict, 'corroborated');
  assert.equal(a.claimDate, TODAY);
  assert.deepEqual(a.corroborating, ['RECOVERY_DATA_BASELINE', 'RECOVERY_ENV_BASELINE']);
  assert.deepEqual(a.contradicting, []);
  assert.equal(a.trustQualified, true);
  // 「대조됐다」가 날짜 없는 두 값까지 보증하지는 않는다 — 그 사실을 한 줄로 함께 말한다.
  assert.deepEqual(a.unverifiable, [
    'RECOVERY_PITR_RETENTION_HOURS',
    'RECOVERY_EXPECTED_DB',
    '§6 표 점검 행',
  ]);
  assert.match(a.qualifies, /날짜 없는 두 값/);
  assert.match(a.action ?? '', /맞다/);
});

test('contradicted: 한 **주기 이상** 앞선 기준일은 「그 단계를 수행하지 않았다」다', () => {
  const a = assess(TODAY, base({ RECOVERY_DATA_BASELINE: data('2026-05-01') }));
  assert.equal(a.verdict, 'contradicted');
  assert.deepEqual(a.contradicting, ['RECOVERY_DATA_BASELINE']);
  assert.deepEqual(a.corroborating, ['RECOVERY_ENV_BASELINE']);
  assert.equal(a.trustQualified, false, '거짓인 날짜로 보존 창·지문을 confirmed 로 올렸다');
  assert.match(a.qualifies, /거짓/);
  assert.match(a.action ?? '', /183일 전/);

  const lag = a.rows.find((r) => r.label === 'RECOVERY_DATA_BASELINE')!;
  assert.equal(lag.verdict, 'skipped');
  assert.equal(lag.lagDays, 183);
});

test('partly: 하루라도 앞선 값은 그 점검에서 갱신되지 않았다(임의 허용 오차 없음)', () => {
  const a = assess(TODAY, base({ RECOVERY_ENV_BASELINE: envSnap('2026-10-30') }));
  assert.equal(a.verdict, 'partly');
  assert.deepEqual(a.contradicting, ['RECOVERY_ENV_BASELINE']);
  assert.equal(a.rows.find((r) => r.label === 'RECOVERY_ENV_BASELINE')!.lagDays, 1);
  assert.equal(a.trustQualified, false);
});

test('주기 미설정이면 skipped 를 판정하지 않는다 — 코드가 주기를 지어내지 않는다', () => {
  const env = base({ RECOVERY_DATA_BASELINE: data('2026-01-01') });
  assert.equal(assess(TODAY, env, null).verdict, 'partly');
  assert.equal(assess(TODAY, env, INTERVAL).verdict, 'contradicted');
  // 모듈 안에 기본 주기 리터럴을 두지 않았다.
  assert.equal(/intervalDays\s*=\s*\d/.test(SELF_SRC), false, '기본 주기를 코드가 들고 있다');
});

test('date_behind: 값이 점검 일자보다 새것이면 7번(날짜 적기)이 밀린 것이다', () => {
  const a = assess('2026-10-01', base({ RECOVERY_DATA_BASELINE: data('2026-10-20'), RECOVERY_ENV_BASELINE: envSnap('2026-10-20') }));
  assert.equal(a.verdict, 'date_behind');
  assert.deepEqual(a.corroborating, []);
  assert.equal(a.trustQualified, false);
  assert.match(a.action ?? '', /RECOVERY_LAST_CHECK/);
  assert.equal(a.rows.find((r) => r.label === 'RECOVERY_DATA_BASELINE')!.verdict, 'ahead');

  // 맞는 축이 하나라도 있으면 그쪽이 근거다(ahead 는 위험 쪽으로 기울지 않는다).
  const mixed = assess('2026-10-20', base({ RECOVERY_DATA_BASELINE: data('2026-10-20'), RECOVERY_ENV_BASELINE: envSnap('2026-10-25') }));
  assert.equal(mixed.verdict, 'corroborated');
});

test('uncorroborated: 뒷받침할 축이 없으면 날짜는 **주장 그대로**다(통과가 아니다)', () => {
  const none = assess(TODAY, { RECOVERY_PITR_RETENTION_HOURS: '720' });
  assert.equal(none.verdict, 'uncorroborated');
  assert.equal(none.trustQualified, false);
  assert.equal(none.action, ACTION_CLAIM_UNCORROBORATED);
  assert.deepEqual(
    none.rows.filter((r) => r.verdict === 'absent').map((r) => r.label),
    ['RECOVERY_DATA_BASELINE', 'RECOVERY_ENV_BASELINE'],
  );

  // 날짜 없는 스냅샷·판독 불가도 「맞다」로 올리지 않는다.
  assert.equal(assess(TODAY, base({ RECOVERY_DATA_BASELINE: 'users=12', RECOVERY_ENV_BASELINE: 'keys=A_B' })).verdict, 'uncorroborated');
  const broken = assess(TODAY, base({ RECOVERY_DATA_BASELINE: '???', RECOVERY_ENV_BASELINE: '???' }));
  assert.equal(broken.verdict, 'uncorroborated');
  assert.deepEqual(broken.rows.filter((r) => r.verdict === 'unreadable').length, 2);
});

test('no_claim: 축으로 쓸 수 없는 점검 일자는 대조하지 않는다(§2-1 이 이미 말한다)', () => {
  for (const bad of [undefined, '', '   ', '2026-13-01', '2026-02-30', 'yesterday']) {
    const a = assess(bad, base());
    assert.equal(a.verdict, 'no_claim', `${String(bad)} 를 축으로 썼다`);
    assert.equal(a.claimDate, null);
    assert.equal(a.action, ACTION_CLAIM_NO_CLAIM);
    assert.deepEqual(a.corroborating, []);
    assert.equal(a.trustQualified, false);
  }
  // 미래 일자도 「최근 확인」의 축이 아니다 — 값은 판독해 두고 판정만 보류한다.
  const future = assess('2026-12-01', base());
  assert.equal(future.verdict, 'no_claim');
  assert.equal(future.rows.find((r) => r.label === 'RECOVERY_DATA_BASELINE')!.verdict, 'unjudged');
  assert.equal(future.rows.find((r) => r.label === 'RECOVERY_DATA_BASELINE')!.asOf, TODAY);
});

test('판정 순서: skipped 가 lagging 에 덮이지 않는다', () => {
  const a = assess(TODAY, base({
    RECOVERY_DATA_BASELINE: data('2026-01-01'),
    RECOVERY_ENV_BASELINE: envSnap('2026-10-29'),
  }));
  assert.equal(a.verdict, 'contradicted');
  assert.deepEqual(a.contradicting, ['RECOVERY_DATA_BASELINE', 'RECOVERY_ENV_BASELINE']);
});

/* ─────────────────────────── 표 쪽 대조(§2 6번) ─────────────────────────── */

test('표 대조: 표를 넘기지 않은 것을 「행이 없다」로 단정하지 않는다', () => {
  const r = reconcileCheckRow({ lastCheck: TODAY, now: NOW });
  assert.equal(r.verdict, 'no_table');
  assert.equal(r.basis, 'env');
  assert.match(r.action ?? '', /2-4 명령/);
});

test('표 대조: 점검 행과 env 날짜의 어긋남을 양방향으로 가른다', () => {
  const rows = [row('2026-10-31', '점검'), row('2026-09-01', '정기'), row('2026-08-01', '사건')];
  const aligned = reconcileCheckRow({ rows, lastCheck: TODAY, now: NOW });
  assert.equal(aligned.verdict, 'aligned');
  assert.equal(aligned.basis, 'table');
  assert.equal(aligned.checkRows, 1);
  assert.equal(aligned.action, null);

  assert.equal(reconcileCheckRow({ rows, lastCheck: '2026-10-01', now: NOW }).verdict, 'row_newer');
  assert.equal(reconcileCheckRow({ rows: [row('2026-09-15', '점검')], lastCheck: TODAY, now: NOW }).verdict, 'env_newer');

  // 리허설·사건 행만 있으면 점검 이력이 env 한 줄에만 있다.
  const noCheck = reconcileCheckRow({ rows: [row('2026-09-01', '정기')], lastCheck: TODAY, now: NOW });
  assert.equal(noCheck.verdict, 'no_check_row');
  assert.match(noCheck.action ?? '', /점검/);

  // 「정기 점검」처럼 겹치는 말은 점검 행으로 **단정하지 않는다**(§6-8 ambiguous).
  assert.equal(reconcileCheckRow({ rows: [row('2026-10-31', '정기 점검')], lastCheck: TODAY, now: NOW }).verdict, 'unreadable_row');
  // 축이 없으면 보류다.
  assert.equal(reconcileCheckRow({ rows, lastCheck: '', now: NOW }).verdict, 'unjudged');
  // 미래 행은 기록으로 세지 않는다.
  assert.equal(reconcileCheckRow({ rows: [row('2026-12-01', '점검')], lastCheck: TODAY, now: NOW }).verdict, 'no_check_row');
});

test('[실제 문서] §6 표에는 아직 점검 행이 없다 — 표를 자동으로 채우지 않는다', () => {
  const rows = parseLedgerTable(RUNBOOK).rows;
  const r = reconcileCheckRow({ rows, lastCheck: TODAY, now: NOW });
  assert.equal(r.verdict, 'no_check_row');
  assert.equal(r.checkRows, 0);
});

/* ─────────────────────────── 출력 ─────────────────────────── */

test('공개 응답: 판정·키 이름·일자·일수만 담고 **설정값을 담지 않는다**', () => {
  const a = assess(TODAY, base());
  const body = JSON.stringify(publicClaim(a));
  for (const leak of ['4242', 'projects=37', 'DATABASE_URL', 'SESSION_COOKIE', '720', 'a1b2c3d4e5f6']) {
    assert.equal(body.includes(leak), false, `공개 응답에 ${leak} 가 새어 나갔다`);
  }
  assert.ok(body.includes(CLAIM_RUNBOOK_REF) && body.includes('RECOVERY_DATA_BASELINE'));
  assert.deepEqual(publicClaim(a).limits, CLAIM_LIMITS);
  assert.equal((publicClaim(a).rows as unknown[]).length, CLAIM_SOURCES.length);
});

test('출력: 사람용 요약·로그 한 줄에 판정과 키 이름만 담는다', () => {
  const a = assess(TODAY, base({ RECOVERY_DATA_BASELINE: data('2026-05-01') }));
  const r = reconcileCheckRow({ rows: [row('2026-09-15', '점검')], lastCheck: TODAY, now: NOW });

  const text = claimText(a, r);
  assert.ok(text.includes('contradicted') && text.includes(TODAY) && text.includes('env_newer'));
  assert.equal(text.includes('4242'), false, '요약에 행 수가 섞였다');

  const line = claimLine(a, r);
  assert.ok(line.startsWith('[check-claim] '));
  assert.ok(line.includes('verdict=contradicted') && line.includes('trust_qualified=false') && line.includes('row=env_newer'));
  assert.equal(line.includes('4242'), false, '로그에 행 수가 섞였다');

  const status = claimStatus(base());
  assert.deepEqual(status.configured, ['RECOVERY_DATA_BASELINE', 'RECOVERY_ENV_BASELINE']);
  assert.equal(status.datedAxes, 2);
  assert.match(claimStatus({}).note, /주장 그대로/);
});

test('한계를 숨기지 않는다 — 날짜 없는 두 값은 영구히 대조되지 않고, 이 판정은 게이트가 아니다', () => {
  const joined = CLAIM_LIMITS.join('\n');
  assert.ok(CLAIM_LIMITS.includes(CAVEAT_ALIGNED_IS_NOT_CORRECT));
  assert.ok(CLAIM_LIMITS.includes(CAVEAT_UNDATED_STAY_CLAIMS));
  assert.ok(CLAIM_LIMITS.includes(CAVEAT_CLAIM_NOT_A_GATE));
  assert.match(joined, /undatable/);
  assert.match(joined, /이 배포 스코프/);
  assert.ok(CLAIM_BLIND_SPOTS.length >= 5);
  // 전환 게이트를 건드리지 않는다(판정 순서 규율).
  assert.equal(/switchReady\s*=|gateSwitchReady/.test(SELF_SRC), false, '점검 근거로 전환 게이트를 내렸다');
});

test('판정 어휘는 응답·문서가 함께 쓰는 정본이다', () => {
  assert.equal(new Set(CLAIM_VERDICTS).size, CLAIM_VERDICTS.length);
  assert.equal(new Set(SOURCE_VERDICTS).size, SOURCE_VERDICTS.length);
  assert.equal(new Set(ROW_VERDICTS).size, ROW_VERDICTS.length);
  for (const v of CLAIM_VERDICTS) assert.ok(RUNBOOK.includes(`\`${v}\``), `§2-4 에 ${v} 가 없다`);
});

/* ─────────────────────────── 정본끼리의 대조(CI) ─────────────────────────── */

test('[실제 정본] §2 가 값을 공급하는 단계는 전건 대조 축에 있다 — 늘면 CI 가 막는다', () => {
  assert.deepEqual(auditSourceCanon(MONTHLY_STEPS, LAST_CHECK_ENV), []);

  // 새 공급 단계가 생겼는데 축에 적지 않으면 잡는다.
  const grown = [...MONTHLY_STEPS, { step: 8, supplies: 'RECOVERY_NEW_BASELINE', dated: true }];
  assert.equal(auditSourceCanon(grown, LAST_CHECK_ENV).length, 1);
  // 단계 정본이 사라져도 잡는다(소절만 남고 절차가 바뀐 경우).
  assert.ok(auditSourceCanon([{ step: 1, supplies: null }], LAST_CHECK_ENV).length >= 4);

  // 축의 모양이 깨지는 세 경우 — 대조할 수 있는 축이 하나도 남지 않는 것까지 잡는다.
  const table = CLAIM_SOURCES.find((s) => s.home === 'table')!;
  const broken = auditSourceCanon(MONTHLY_STEPS, LAST_CHECK_ENV, [
    { ...table, home: 'env' as const, dated: false },
    { ...claimSourceFor('RECOVERY_EXPECTED_DB')!, home: 'table' as const },
  ]);
  assert.ok(broken.some((p) => /대조할 수 있는 축이 하나도 없다/.test(p)));
  assert.ok(broken.some((p) => /env 축에 키 이름이 없다/.test(p)));
  assert.ok(broken.some((p) => /설정 키가 붙어 있다/.test(p)));
});

test('[실제 정본] 날짜 없는 설정값 정본과 `dated` 선언이 어긋나면 CI 가 막는다', () => {
  assert.deepEqual(auditUndatedCanon(UNDATED_SETTINGS), []);
  assert.equal(auditUndatedCanon([...UNDATED_SETTINGS, { key: 'RECOVERY_DATA_BASELINE' }]).length, 1);
  assert.equal(auditUndatedCanon([]).length, 2, '대조되지 않는 축이 §2-1 정본에서 빠진 것을 놓쳤다');
  // §2-1 이 새 「날짜 없는 값」을 추적하기 시작했는데 대조 축에 없으면 잡는다.
  assert.equal(auditUndatedCanon([{ key: 'RECOVERY_SOMETHING_NEW' }]).length, 3);
});

test('[실제 소스] lib/periodicCheck.ts 가 이 판정을 응답에 실어 보낸다', () => {
  assert.deepEqual(auditPeriodicWiring(PERIODIC_SRC), []);
  assert.equal(auditPeriodicWiring('').length, 4);
  // 판정만 하고 버리는 꼴·주기 미전달을 각각 잡는다.
  assert.ok(auditPeriodicWiring("import {assessCheckClaim} from './checkClaim.ts'; assessCheckClaim({});").length >= 2);
});

test('[실제 소스] 새 런타임 체크·새 환경변수를 만들지 않았다', () => {
  assert.deepEqual(auditNoNewHealthCheck(HEALTH_SRC), []);
  assert.equal(auditNoNewHealthCheck('checks.checkClaim = claimCheck();').length, 1);
  assert.deepEqual(auditNoNewEnv(SELF_SRC), []);
  assert.equal(auditNoNewEnv('const k = process.env.RECOVERY_CLAIM_TOLERANCE_DAYS;').length, 2);
});

test('[실제 소스] 순수 모듈이고 **판독을 복제하지 않는다**', () => {
  assert.deepEqual(auditSelfSource(SELF_SRC), []);
  assert.ok(auditSelfSource('').length >= 4, '판독 재사용이 빠진 것을 놓쳤다');
  assert.ok(auditSelfSource(`${SELF_SRC}\nimport fs from 'node:fs';`).length >= 1);
  // 날짜·스냅샷 형식 정규식을 이 모듈이 다시 들고 있지 않다(갈라지면 영구히 남는다).
  assert.equal(/asOf\s*=/.test(SELF_SRC.replace(/`asOf`/g, '')), false, '스냅샷 형식을 다시 파싱한다');
});

test('[실제 문서] RUNBOOK §2-4 가 절차로 남아 있고 §2 본문이 그곳으로 유도한다', () => {
  assert.deepEqual(auditRunbookClaim(RUNBOOK), []);
  assert.ok(auditRunbookClaim('').length >= CLAIM_VERDICTS.length);
  // §2 본문(1~7번)에서 유도가 사라지면 잡는다(소절은 그대로 남아 있어도).
  const cut = RUNBOOK.replace(/ {3}- ⚠️ \*\*이 한 줄은 주장이다[\s\S]*?판정을 본다\.\n/, '');
  assert.ok(auditRunbookClaim(cut).length >= 1, '§2 본문의 유도가 사라진 것을 놓쳤다');
});

test('[실제 정본] 절차 단위 2-4 가 등록돼 있다 — 리허설 범위가 이 소절을 세게 된다', () => {
  const unit = PROCEDURE_UNITS.find((u) => u.key === '2-4');
  assert.ok(unit, '단위 2-4 가 정본에 없다 — 절차는 자라는데 범위 판정은 ok 로 남는다');
  assert.equal(unit!.cited, true);
  assert.equal(unit!.since, '2026-10-31');
  assert.match(unit!.skipped, /점검 일자/);
});

/* ─────────────────────────── 게이트가 아니다 ─────────────────────────── */

test('[실제 체크] §2-1 응답에 claim 이 실리고, 그것으로 ok·trusted 를 바꾸지 않는다', () => {
  const env = {
    RECOVERY_LAST_CHECK: TODAY,
    RECOVERY_CHECK_INTERVAL_DAYS: String(INTERVAL),
    ...base({ RECOVERY_DATA_BASELINE: data('2026-05-01') }),
  };
  const c = periodicCheckHealth({ env, now: NOW });
  const claim = c.detail.claim as Record<string, unknown>;

  assert.equal(c.detail.verdict, 'ok');
  assert.equal(c.ok, true, '점검 근거 미달로 degraded 를 만들었다 — 거짓 차단이 된다');
  assert.equal(c.detail.trusted, true, 'trusted 를 뒤집었다 — 이 판정은 게이트가 아니다');
  assert.deepEqual(c.detail.untrusted, [], '§2-1 의 목록을 이 판정이 고쳤다');

  // 달라지는 것은 **다음에 할 일**이다.
  assert.equal(claim.verdict, 'contradicted');
  assert.equal(claim.trustQualified, false);
  assert.match(String(claim.qualifies), /거짓/);

  // 공개 엔드포인트 — 설정값은 여전히 섞이지 않는다.
  const body = JSON.stringify(c);
  for (const leak of ['4242', 'DATABASE_URL', '720', 'a1b2c3d4e5f6']) {
    assert.equal(body.includes(leak), false, `${leak} 가 헬스 응답에 새어 나갔다`);
  }
  assert.ok(body.includes(LAST_CHECK_ENV) && body.includes(CHECK_INTERVAL_ENV));

  // 평상시(전건 미설정)에도 조용하다 — 미설정은 §2-1 이 이미 말한다.
  const quiet = periodicCheckHealth({ env: {}, now: NOW }).detail.claim as Record<string, unknown>;
  assert.equal(quiet.verdict, 'no_claim');
});
