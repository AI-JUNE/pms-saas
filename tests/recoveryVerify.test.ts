// 복구 검증(행 복원 대조) 테스트.
//
// 이 파일은 순수 로직만 보는 게 아니라 **실제 저장소 파일을 매번 대조**한다.
//  - CORE_TABLES 가 실제 src/db/schema.ts 선언에 있는 테이블인지 (목록이 낡지 않도록)
//  - 조립되는 SQL 에 쓰기 동사가 없는지 (복구 경로에 쓰기를 섞지 않는다)
//  - 새 env 키가 RUNBOOK §4 와 레지스트리에 적혀 있는지는 envRegistry.test.ts 가 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CORE_TABLES, CORE_TABLE_ROLES, DATA_CAVEAT, IDENTIFIER_RE,
  ACTION_DATA_EMPTY, ACTION_DATA_INCOMPLETE, ACTION_DATA_NO_BASELINE, ACTION_DATA_SHORT, ACTION_DATA_UNVERIFIED,
  ACTION_SWITCH_READY,
  baselineFromEnv, coreCountSql, coreTableReason, countsFrom, isSafeIdentifier,
  parseCount, parseCountBaseline, recoveryVerification, recoveryVerifyLogLine, recoveryVerifyStatus,
  snapshotLine, verifyRowCounts,
} from '../src/lib/recoveryVerify.ts';
import { parseSchemaSource } from '../src/lib/schemaBaseline.ts';
import { verifySchema } from '../src/lib/schemaVerify.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ALL = [...CORE_TABLES];
const SORTED = [...CORE_TABLES].sort();   // 판정 결과는 테이블명 정렬 순으로 나온다
const presentAll = ALL;

/** 전 테이블에 같은 값을 채운 counts */
const fill = (n: number, over: Record<string, number> = {}) =>
  ({ ...Object.fromEntries(ALL.map((t) => [t, n])), ...over });

test('CORE_TABLES: 실제 schema.ts 선언에 있는 테이블만, 사유가 모두 붙어 있다', () => {
  const { model } = parseSchemaSource(read('src/db/schema.ts'));
  assert.ok(model.tables.length > 20, `schema.ts 파싱이 빗나갔다(${model.tables.length})`);
  const declared = new Set(model.tables.map((t) => t.table));
  const unknown = CORE_TABLES.filter((t) => !declared.has(t));
  assert.deepEqual(unknown, [], `schema.ts 에 없는 테이블이 핵심 목록에 있다: ${unknown.join(', ')}`);

  // §3 4단계가 이름으로 지목한 네 가지는 반드시 포함돼야 한다
  for (const must of ['organizations', 'users', 'projects', 'issues']) {
    assert.ok(CORE_TABLES.includes(must), `RUNBOOK §3 4단계가 지목한 ${must} 가 빠졌다`);
  }
  assert.equal(new Set(CORE_TABLES).size, CORE_TABLES.length, '중복이 있다');
  for (const r of CORE_TABLE_ROLES) {
    assert.ok(r.why.trim().length > 5, `${r.table}: 사유가 비었다`);
    assert.ok(isSafeIdentifier(r.table), `${r.table}: 식별자 규칙 위반`);
  }
  assert.equal(coreTableReason('USERS')?.includes('계정'), true);
  assert.equal(coreTableReason('없는테이블'), null);
  assert.equal(coreTableReason(null), null);
});

test('isSafeIdentifier: 주입 가능한 이름을 전부 거부', () => {
  assert.equal(isSafeIdentifier('audit_log'), true);
  assert.equal(isSafeIdentifier('_x1'), true);
  assert.equal(isSafeIdentifier('Users'), false, '대문자는 정규화 전이므로 거부');
  assert.equal(isSafeIdentifier('users; drop table users'), false);
  assert.equal(isSafeIdentifier('us"ers'), false);
  assert.equal(isSafeIdentifier('1users'), false);
  assert.equal(isSafeIdentifier(''), false);
  assert.equal(isSafeIdentifier('a'.repeat(64)), false);
  assert.equal(isSafeIdentifier(null), false);
  assert.equal(IDENTIFIER_RE.test('ok_1'), true);
});

test('coreCountSql: 읽기 전용 select 만 만들고, 수상한 이름이면 던진다', () => {
  const sql = coreCountSql(CORE_TABLES);
  // 쓰기 동사가 한 번도 등장하지 않아야 한다
  assert.ok(!/\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|copy)\b/i.test(sql),
    `조회 SQL 에 쓰기 동사가 있다: ${sql}`);
  assert.ok(sql.startsWith('select '), sql.slice(0, 40));
  assert.equal((sql.match(/union all/g) || []).length, CORE_TABLES.length - 1);
  for (const t of CORE_TABLES) assert.ok(sql.includes(`from "${t}"`), `${t} 조회가 없다`);
  // 결정적 순서(정렬) — 로그 비교가 가능해야 한다
  assert.equal(coreCountSql(['projects', 'users']), coreCountSql(['users', 'projects', 'users']));

  assert.throws(() => coreCountSql([]), /대상 테이블이 없다/);
  assert.throws(() => coreCountSql(['users; drop table users']), /허용되지 않는 식별자/);
  assert.throws(() => coreCountSql(['"users"']), /허용되지 않는 식별자/);
});

test('parseCount: 드라이버별 숫자 표기를 엄격히 해석하고, 모르면 null', () => {
  assert.equal(parseCount(12), 12);
  assert.equal(parseCount('12'), 12);
  assert.equal(parseCount(' 0 '), 0);
  assert.equal(parseCount(12n), 12);
  assert.equal(parseCount(1.5), null);
  assert.equal(parseCount(-1), null);
  assert.equal(parseCount('-1'), null);
  assert.equal(parseCount('열두개'), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount({}), null);
});

test('countsFrom: 판독 가능한 행만 취하고 모르는 행은 버린다', () => {
  const got = countsFrom([
    { t: 'users', n: 12 },
    { T: 'PROJECTS', N: '3' },
    { t: 'issues', n: 'NaN' },   // 행 수 판독 불가 → 버림
    { x: 'users', n: 1 },        // 테이블 이름 없음 → 버림
    { t: 'audit_log', n: 0 },
  ]);
  assert.deepEqual(got, { users: 12, projects: 3, audit_log: 0 });
  assert.deepEqual(countsFrom([]), {});
  assert.deepEqual(countsFrom(null as any), {});
});

test('parseCountBaseline: 두 형식만 인정하고 해석 못 한 토큰을 보고한다', () => {
  const j = parseCountBaseline('{"asOf":"2026-10-01","counts":{"users":12,"projects":"3"}}');
  assert.deepEqual(j, { asOf: '2026-10-01', counts: { users: 12, projects: 3 }, invalid: [] });

  const c = parseCountBaseline('asOf=2026-10-01, users=12 , projects=3');
  assert.deepEqual(c, { asOf: '2026-10-01', counts: { users: 12, projects: 3 }, invalid: [] });

  // 날짜가 비실존이면 asOf 를 지어내지 않고 invalid 로
  const bad = parseCountBaseline('asOf=2026-02-30,users=1');
  assert.equal(bad?.asOf, null);
  assert.deepEqual(bad?.invalid, ['asOf=2026-02-30']);

  // 쓸 수 있는 수치가 하나도 없으면 "기준 없음"
  assert.equal(parseCountBaseline(''), null);
  assert.equal(parseCountBaseline(null), null);
  assert.equal(parseCountBaseline('   '), null);
  assert.deepEqual(parseCountBaseline('{"nope":1}'), null);
  assert.deepEqual(parseCountBaseline('{"counts":[1,2]}'), null);
  assert.deepEqual(parseCountBaseline('{broken'), { asOf: null, counts: {}, invalid: ['json'] });

  // 수상한 키·값은 통째로 거부(조용히 버리지 않는다)
  const inv = parseCountBaseline('users=-1,"x"=1,tasks');
  assert.deepEqual(inv?.counts, {});
  assert.deepEqual(inv?.invalid, ['users=-1', '"x"=1', 'tasks']);

  assert.equal(baselineFromEnv({}), null);
  assert.equal(baselineFromEnv({ RECOVERY_DATA_BASELINE: 'users=5' })?.counts.users, 5);
});

test('snapshotLine: env 에 붙여 넣을 형식이고, 다시 파싱된다(왕복)', () => {
  const line = snapshotLine({ users: 12, projects: 3, audit_log: 0 }, '2026-10-04');
  assert.equal(line, 'asOf=2026-10-04,audit_log=0,projects=3,users=12');
  assert.deepEqual(parseCountBaseline(line), {
    asOf: '2026-10-04', counts: { users: 12, projects: 3, audit_log: 0 }, invalid: [],
  });
  // 날짜가 없거나 비실존이면 지어내지 않고 생략
  assert.equal(snapshotLine({ users: 1 }, 'oops'), 'users=1');
  assert.equal(snapshotLine({ users: 1 }), 'users=1');
  // 수상한 키·값은 내보내지 않는다
  assert.equal(snapshotLine({ 'us"ers': 1, tasks: -2, projects: 4 } as any), 'projects=4');
  assert.equal(snapshotLine({}), '');
});

test('verifyRowCounts: 조회 실패는 "0건"이 아니라 unverified', () => {
  const v = verifyRowCounts({ counts: null, present: presentAll, baseline: null });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.ok, false);
  assert.equal(v.totalRows, null);
  assert.equal(v.snapshot, null);
  assert.equal(v.action, ACTION_DATA_UNVERIFIED);
  assert.deepEqual(v.unreadable, SORTED);
  assert.equal(v.caveat, DATA_CAVEAT);

  // 조회는 됐지만 어느 행도 판독하지 못한 경우도 "모른다"
  const none = verifyRowCounts({ counts: {}, present: presentAll, baseline: null });
  assert.equal(none.verdict, 'unverified');
  assert.deepEqual(none.missingTables, []);
  assert.deepEqual(none.unreadable, SORTED);
});

test('verifyRowCounts: 핵심 테이블이 없으면 incomplete(스키마부터)', () => {
  const present = ALL.filter((t) => t !== 'issues' && t !== 'risks');
  const counts = fill(5);
  delete counts.issues; delete counts.risks;   // 없는 테이블은 세어지지 않는다
  const v = verifyRowCounts({ counts, present, baseline: null });
  assert.equal(v.verdict, 'incomplete');
  assert.deepEqual(v.missingTables, ['issues', 'risks'].sort());
  assert.equal(v.action, ACTION_DATA_INCOMPLETE);
  assert.equal(v.rows.find((r) => r.table === 'issues')?.state, 'missing');
});

test('verifyRowCounts: 전부 0건이면 empty — 기준치가 없어도 판정한다', () => {
  const v = verifyRowCounts({ counts: fill(0), present: presentAll, baseline: null });
  assert.equal(v.verdict, 'empty');
  assert.equal(v.ok, false);
  assert.equal(v.totalRows, 0);
  assert.equal(v.action, ACTION_DATA_EMPTY);
  // 기준치가 없는 테이블의 행 상태는 0건이어도 'zero'(= 판정했다)가 아니라 'unjudged' 다.
  // 전건 0 이라는 사실은 verdict 가 말하고, 행 단위로는 「대조하지 않았다」가 사실이다.
  assert.ok(v.rows.every((r) => r.state === 'unjudged'), JSON.stringify(v.rows));
  assert.deepEqual(v.uncovered, SORTED, '기준 스냅샷이 덮지 않은 테이블을 전부 알린다');
});

test('verifyRowCounts: 기준치보다 적으면 short, 0건도 부족분으로 센다', () => {
  const baseline = parseCountBaseline(`asOf=2026-10-01,${ALL.map((t) => `${t}=10`).join(',')}`);
  const v = verifyRowCounts({ counts: fill(10, { issues: 4, projects: 0 }), present: presentAll, baseline });
  assert.equal(v.verdict, 'short');
  assert.equal(v.ok, false);
  assert.equal(v.asOf, '2026-10-01');
  assert.deepEqual(v.shortfalls, [
    { table: 'issues', baseline: 10, actual: 4, missing: 6 },
    { table: 'projects', baseline: 10, actual: 0, missing: 10 },
  ]);
  assert.equal(v.action, ACTION_DATA_SHORT);
  assert.equal(v.rows.find((r) => r.table === 'issues')?.delta, -6);
});

test('verifyRowCounts: 기준 스냅샷이 없으면 ok 로 올리지 않는다(no_baseline)', () => {
  const v = verifyRowCounts({ counts: fill(7), present: presentAll, baseline: null, now: new Date('2026-10-04T05:00:00Z') });
  assert.equal(v.verdict, 'no_baseline');
  assert.equal(v.ok, false);
  assert.equal(v.action, ACTION_DATA_NO_BASELINE);
  assert.ok(v.rows.every((r) => r.state === 'unjudged'));
  // 그대로 env 에 붙여 넣을 수 있는 스냅샷을 돌려준다
  assert.ok(v.snapshot?.startsWith('asOf=2026-10-04,'), v.snapshot ?? 'null');
  assert.equal(parseCountBaseline(v.snapshot)?.counts.users, 7);

  // 일부 테이블만 기준치가 있어도 전면 ok 는 아니다
  const partial = verifyRowCounts({
    counts: fill(7), present: presentAll, baseline: parseCountBaseline('users=1'),
  });
  assert.equal(partial.verdict, 'no_baseline');
});

test('verifyRowCounts: 전 테이블이 기준치 이상이면 ok — 한계를 함께 돌려준다', () => {
  const baseline = parseCountBaseline(`asOf=2026-10-01,${ALL.map((t) => `${t}=5`).join(',')}`);
  const v = verifyRowCounts({ counts: fill(5, { users: 9 }), present: presentAll, baseline });
  assert.equal(v.verdict, 'ok');
  assert.equal(v.ok, true);
  assert.equal(v.action, null);
  assert.deepEqual(v.shortfalls, []);
  assert.match(v.caveat, /RPO/);
  assert.match(v.caveat, /유실 확정이 아니라/);
  assert.equal(v.rows.find((r) => r.table === 'users')?.delta, 4);

  // 기준 스냅샷에만 있는 이름은 무시하되 알린다
  const extra = verifyRowCounts({
    counts: fill(5), present: presentAll,
    baseline: parseCountBaseline(`asOf=2026-10-01,${ALL.map((t) => `${t}=5`).join(',')},legacy_table=1`),
  });
  assert.deepEqual(extra.unknownInBaseline, ['legacy_table']);
  assert.equal(extra.verdict, 'ok');

  // 같은 스냅샷에서 asOf 만 빼면 ok 가 아니다 — 시점을 모르는 수치는 「손상 전 기대치」가 아니다
  const undated = verifyRowCounts({
    counts: fill(5), present: presentAll,
    baseline: parseCountBaseline(ALL.map((t) => `${t}=5`).join(',')),
  });
  assert.equal(undated.verdict, 'undated');
  assert.equal(undated.ok, false);
});

test('verifyRowCounts: 실존 목록을 모르면 없는 테이블을 missing 으로 단정하지 않는다', () => {
  const v = verifyRowCounts({ counts: fill(3, { issues: undefined as any }), present: null, baseline: null });
  assert.deepEqual(v.missingTables, []);
  assert.deepEqual(v.unreadable, ['issues']);
  assert.equal(v.verdict, 'no_baseline');
});

test('recoveryVerification: 스키마와 행 수가 모두 통과해야 전환 가능', () => {
  const schemaOk = verifySchema({ expected: ['users'], present: ['users'] });
  const schemaEmpty = verifySchema({ expected: ['users'], present: [] });
  const baseline = parseCountBaseline(`asOf=2026-10-01,${ALL.map((t) => `${t}=1`).join(',')}`);
  const dataOk = verifyRowCounts({ counts: fill(2), present: presentAll, baseline });
  const dataEmpty = verifyRowCounts({ counts: fill(0), present: presentAll, baseline });

  const good = recoveryVerification(schemaOk, dataOk);
  assert.equal(good.switchReady, true);
  assert.equal(good.action, ACTION_SWITCH_READY);

  // 스키마는 ok 인데 데이터가 비어 있는 바로 그 구멍 — 전환 불가
  const hole = recoveryVerification(schemaOk, dataEmpty);
  assert.equal(hole.switchReady, false);
  assert.equal(hole.action, ACTION_DATA_EMPTY);

  // 스키마가 깨져 있으면 스키마 조치가 먼저다
  const broken = recoveryVerification(schemaEmpty, dataOk);
  assert.equal(broken.switchReady, false);
  assert.equal(broken.action, schemaEmpty.action);
});

test('recoveryVerifyLogLine: 수치·테이블명만 남기고 행 내용은 담지 않는다', () => {
  const baseline = parseCountBaseline(`asOf=2026-10-01,${ALL.map((t) => `${t}=10`).join(',')}`);
  const v = recoveryVerification(
    verifySchema({ expected: ['users'], present: ['users'] }),
    verifyRowCounts({ counts: fill(10, { issues: 1 }), present: presentAll, baseline }),
  );
  const line = recoveryVerifyLogLine(v);
  assert.match(line, /schema=ok/);
  assert.match(line, /data=short/);
  assert.match(line, /short=issues/);
  assert.match(line, /switch_ready=false/);
  assert.match(line, /baseline_as_of=2026-10-01/);
  assert.ok(!/select|password|postgres:/i.test(line), line);

  const un = recoveryVerifyLogLine(recoveryVerification(
    verifySchema({ expected: ['users'], present: null }),
    verifyRowCounts({ counts: null, present: null, baseline: null }),
  ));
  assert.match(un, /rows=\?/);
  assert.match(un, /unreadable=/);
});

test('recoveryVerifyStatus: 기준 스냅샷 설정 여부를 사실대로 말한다', () => {
  const none = recoveryVerifyStatus(null);
  assert.equal(none.baselineConfigured, false);
  assert.equal(none.baselineAsOf, null);
  assert.equal(none.coreTables, CORE_TABLES.length);
  assert.match(none.note, /기준 스냅샷이 없다/);

  const set = recoveryVerifyStatus(parseCountBaseline('asOf=2026-10-01,users=5,projects=2'));
  assert.equal(set.baselineConfigured, true);
  assert.equal(set.baselineTables, 2);
  assert.equal(set.baselineAsOf, '2026-10-01');
});

test('라우트: 복구 검증 엔드포인트는 슈퍼관리자 전용 + 읽기 전용이다', () => {
  const src = read('src/app/api/admin/recovery-verify/route.ts');
  assert.match(src, /isSuperadmin/, '권한 검사가 없다');
  assert.match(src, /auditSecurity\(/, '열람 감사로그가 없다');
  // DDL·쓰기를 섞지 않았는지 — db 접근은 두 건의 읽기 조회뿐
  assert.equal((src.match(/db\.execute\(/g) || []).length, 2, 'db 접근 건수가 바뀌었다');
  assert.ok(!/db\.(insert|update|delete)\b/.test(src), '쓰기 호출이 들어왔다');
  assert.ok(!/CREATE |ALTER |DROP |TRUNCATE /i.test(src), 'DDL 이 들어왔다');
  // route.ts 는 HTTP 메서드·설정 외 export 금지(Vercel 빌드 실패 사례)
  const exports = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+))/gm)]
    .map((m) => m[1] || m[2]).sort();
  assert.deepEqual(exports, ['GET', 'dynamic']);
});

test('RUNBOOK: §3 4단계가 이 점검을 지시하고, 기준 스냅샷 키가 §4 에 적혀 있다', () => {
  const runbook = read('RUNBOOK.md');
  assert.match(runbook, /\/api\/admin\/recovery-verify/, '§3 4단계가 검증 경로를 안내하지 않는다');
  assert.match(runbook, /RECOVERY_DATA_BASELINE/, '기준 스냅샷 env 키가 문서에 없다');
  assert.match(runbook, /switchReady/, '전환 가능 판정이 문서에 없다');
  // 자동화가 리허설 표를 채우지 않는다는 약속은 그대로 유지돼야 한다
  assert.match(runbook, /자동화 에이전트는 이 표를 임의로 채우지 않는다/);
});
