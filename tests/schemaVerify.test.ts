/**
 * schemaVerify.test.ts — 복구 현장에서 사람이 보는 "성공"을 검증된 판정으로 바꾼다. 2026-10-03
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * `schemaBaseline.test.ts` 는 같은 문제를 CI 시점에 잡는다. 그러나 복구 담당자가 실제로 보는 것은
 * `POST /api/admin/migrate` 의 응답이고, 그 응답의 `applied` 는 **예외를 던지지 않은 문장 수**다.
 * 빈 DB 에서는 `ALTER TABLE IF EXISTS … ADD COLUMN` 들이 대상 테이블이 없어 조용히 건너뛰면서도
 * applied 로 세어지므로, 테이블이 하나도 없는 DB 에서도 `failed: 0` 짜리 "성공"이 나온다.
 *
 * 이 테스트는 `lib/schemaVerify.ts` 의 판정을 고정하고, **실제 `src/lib/migrate.ts`·`src/db/schema.ts`
 * 원문**으로 빈 DB 시나리오를 재현해 그 조용한 실패가 `silentSuccess=true` 로 드러나는지 검사한다.
 * 파일만 읽는다 — DB·네트워크·process.env 를 건드리지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import {
  PRESENT_TABLES_SQL,
  TABLE_NAME_KEYS,
  ACTION_EMPTY,
  ACTION_INCOMPLETE,
  ACTION_UNVERIFIED,
  ACTION_NO_EXPECTATION,
  rowsOf,
  tableNamesFrom,
  normalizeTableNames,
  createdTables,
  alterTargets,
  skippedForMissingTable,
  verifySchema,
  migrationReport,
  migrationLogLine,
} from '../src/lib/schemaVerify.ts';
import { extractMigrationStatements } from '../src/lib/schemaBaseline.ts';
import * as schema from '../src/db/schema.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIGRATE_SRC = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'migrate.ts'), 'utf8');
const STATEMENTS = extractMigrationStatements(MIGRATE_SRC);

/** drizzle 에 선언된 테이블(= 앱 화면이 읽는 것) */
const DECLARED = Object.values(schema as Record<string, unknown>)
  .filter((v): v is PgTable => is(v, PgTable))
  .map((t) => getTableName(t));

/** 앱이 실제로 쓰는 테이블 — migrate.ts 의 expectedTables() 와 같은 규칙 */
const EXPECTED = normalizeTableNames([...DECLARED, ...createdTables(STATEMENTS)]);

/* ─────────────────────────── 조회 SQL·결과 해석 ─────────────────────────── */

test('실존 테이블 조회 SQL 은 읽기 전용이다 — 복구 경로에 쓰기를 섞지 않는다', () => {
  assert.match(PRESENT_TABLES_SQL, /^select\b/i);
  assert.match(PRESENT_TABLES_SQL, /information_schema\.tables/i);
  for (const verb of ['insert', 'update', 'delete', 'drop', 'create', 'alter', 'truncate', 'grant']) {
    assert.ok(!new RegExp(`\\b${verb}\\b`, 'i').test(PRESENT_TABLES_SQL), `${verb} 가 검증 조회에 섞였다`);
  }
  // 다른 테넌트·스키마를 긁지 않는다
  assert.match(PRESENT_TABLES_SQL, /current_schema\(\)/i);
});

test('rowsOf 는 드라이버 결과 모양(배열 / rows 래핑)을 모두 처리하고 쓰레기는 버린다', () => {
  assert.deepEqual(rowsOf([{ table_name: 'users' }]), [{ table_name: 'users' }]);
  assert.deepEqual(rowsOf({ rows: [{ table_name: 'users' }] }), [{ table_name: 'users' }]);
  assert.deepEqual(rowsOf([null, 'x', 3, [1]]), []);
  assert.deepEqual(rowsOf(undefined), []);
  assert.deepEqual(rowsOf({ rowCount: 1 }), []);
});

test('tableNamesFrom 은 컬럼명이 달라도 읽고, 모호하면 추측하지 않는다', () => {
  assert.deepEqual(tableNamesFrom([{ table_name: 'users' }, { tablename: 'issues' }, { TABLE_NAME: 'tasks' }]), ['users', 'issues', 'tasks']);
  // 알려진 키가 없고 값이 하나뿐 → 그 값을 쓴다
  assert.deepEqual(tableNamesFrom([{ anything: 'boards' }]), ['boards']);
  // 알려진 키가 없고 값이 여럿 → 아무거나 고르지 않는다(틀린 이름을 "존재"로 읽으면 검증이 무의미)
  assert.deepEqual(tableNamesFrom([{ a: 'x', b: 'y' }]), []);
  assert.deepEqual(tableNamesFrom([{ table_name: '  ' }, { table_name: 42 }]), []);
  assert.ok(TABLE_NAME_KEYS.includes('table_name'));
});

test('normalizeTableNames 는 소문자·따옴표·중복을 정리한다', () => {
  assert.deepEqual(normalizeTableNames(['Users', '"issues"', 'users', ' tasks ']), ['issues', 'tasks', 'users']);
  assert.deepEqual(normalizeTableNames(['', '   ']), []);
});

/* ─────────────────────────── DDL 추출 ─────────────────────────── */

test('createdTables 는 실제 MIGRATION_DDL 이 만드는 테이블을 뽑는다', () => {
  const created = createdTables(STATEMENTS);
  for (const t of ['billing_customers', 'subscriptions', 'invoices', 'tests', 'test_cycles', 'todos']) {
    assert.ok(created.includes(t), `${t} 가 createdTables 에서 빠졌다`);
  }
  // CREATE INDEX 를 테이블로 오인하지 않는다
  assert.ok(!created.some((t) => t.endsWith('_idx')));
});

test('alterTargets 는 IF EXISTS 유무를 구분한다 — 조용한 실패와 시끄러운 실패는 다르다', () => {
  const t = alterTargets([
    'ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS epic text',
    'ALTER TABLE tasks ADD COLUMN note text',
    'CREATE INDEX IF NOT EXISTS x_idx ON issues (org_id)',
  ]);
  assert.deepEqual(t, [
    { table: 'issues', column: 'epic', ifExists: true },
    { table: 'tasks', column: 'note', ifExists: false },
  ]);
});

test('skippedForMissingTable 은 IF EXISTS 문장만 센다', () => {
  const stmts = [
    'ALTER TABLE IF EXISTS issues ADD COLUMN IF NOT EXISTS epic text',
    'ALTER TABLE IF EXISTS tasks ADD COLUMN IF NOT EXISTS note text',
    'ALTER TABLE risks ADD COLUMN owner text', // 대상이 없으면 오류로 드러난다 → 세지 않는다
  ];
  assert.deepEqual(skippedForMissingTable(stmts, []), [
    { table: 'issues', column: 'epic' },
    { table: 'tasks', column: 'note' },
  ]);
  assert.deepEqual(skippedForMissingTable(stmts, ['issues', 'tasks']), []);
});

/* ─────────────────────────── 판정 ─────────────────────────── */

test('빈 DB: 실제 코드 기준으로 verdict=empty + 조용히 건너뛴 ALTER 가 숫자로 드러난다', () => {
  const v = verifySchema({ expected: EXPECTED, present: [], statements: STATEMENTS });
  assert.equal(v.verdict, 'empty');
  assert.equal(v.ok, false);
  assert.equal(v.present, 0);
  assert.equal(v.expected, EXPECTED.length);
  assert.equal(v.missingTables.length, EXPECTED.length);
  assert.ok(v.missingTables.includes('users') && v.missingTables.includes('projects'));
  // 이 ALTER 들이 바로 "오류 없이 건너뛰는" 문장들이다 — MIGRATION_DDL 의 ALTER IF EXISTS 전건
  assert.equal(
    v.skippedAlters.length,
    alterTargets(STATEMENTS).filter((a) => a.ifExists).length,
    '빈 DB 에서는 IF EXISTS ALTER 가 전부 조용히 건너뛰어야 한다',
  );
  assert.ok(v.skippedAlters.length >= 59, `조용한 no-op ALTER 수(${v.skippedAlters.length})가 2026-10-03 실측 59건보다 줄었다 — 확인할 것`);
  assert.equal(v.action, ACTION_EMPTY);
  assert.match(String(v.action), /§3-1/);
});

test('일부 누락: verdict=incomplete, 있는 것은 있는 대로 센다', () => {
  const v = verifySchema({ expected: ['users', 'projects', 'issues'], present: ['users', 'projects'], statements: [] });
  assert.equal(v.verdict, 'incomplete');
  assert.equal(v.ok, false);
  assert.equal(v.present, 2);
  assert.deepEqual(v.missingTables, ['issues']);
  assert.equal(v.action, ACTION_INCOMPLETE);
});

test('정합: 기대 테이블이 다 있으면 ok — 모르는 테이블이 더 있어도 문제 삼지 않는다', () => {
  const v = verifySchema({ expected: EXPECTED, present: [...EXPECTED, 'legacy_scratch'], statements: STATEMENTS });
  assert.equal(v.verdict, 'ok');
  assert.equal(v.ok, true);
  assert.deepEqual(v.missingTables, []);
  assert.deepEqual(v.skippedAlters, [], '정합 상태에서는 건너뛰는 ALTER 가 없어야 한다 — 있으면 ALTER 대상이 기대 목록 밖이라는 뜻');
  assert.equal(v.action, null);
  assert.equal(v.present, EXPECTED.length);
});

test('조회 실패(present=null)는 "없다"로 단정하지 않고 unverified 로 남는다', () => {
  const v = verifySchema({ expected: EXPECTED, present: null, statements: STATEMENTS });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.ok, false);
  assert.deepEqual(v.missingTables, [], '조회하지 못한 것을 누락으로 보고하면 거짓 경보가 된다');
  assert.equal(v.action, ACTION_UNVERIFIED);
});

test('기대 목록이 비면 "정합"이 아니라 unverified', () => {
  const v = verifySchema({ expected: [], present: ['users'], statements: STATEMENTS });
  assert.equal(v.verdict, 'unverified');
  assert.equal(v.ok, false);
  assert.equal(v.action, ACTION_NO_EXPECTATION);
});

test('silentSuccess — failed 0 인데 스키마가 비어 있는 조합만 true', () => {
  const empty = verifySchema({ expected: EXPECTED, present: [], statements: STATEMENTS });
  const good = verifySchema({ expected: ['users'], present: ['users'], statements: [] });
  const unknown = verifySchema({ expected: EXPECTED, present: null, statements: [] });

  assert.equal(migrationReport({ applied: 112, failed: [] }, empty).silentSuccess, true);
  assert.equal(migrationReport({ applied: 112, failed: [] }, good).silentSuccess, false);
  // 이미 시끄럽게 실패한 경우는 "조용한" 성공이 아니다
  assert.equal(migrationReport({ applied: 1, failed: [{ stmt: 'x', error: 'boom' }] }, empty).silentSuccess, false);
  // 모르는 상태를 실패로 승격하지 않는다
  assert.equal(migrationReport({ applied: 112, failed: [] }, unknown).silentSuccess, false);
  assert.equal(migrationReport({ applied: 112, failed: [] }, empty).applied, 112);
});

test('로그 한 줄에 수치·테이블 이름만 담고 비밀값은 담지 않는다', () => {
  const r = migrationReport({ applied: 112, failed: [] }, verifySchema({ expected: EXPECTED, present: [], statements: STATEMENTS }));
  const line = migrationLogLine(r);
  assert.match(line, /applied=112/);
  assert.match(line, /failed=0/);
  assert.match(line, /schema=empty/);
  assert.match(line, /silent_success=true/);
  assert.ok(!/postgres:\/\/|password|secret|DATABASE_URL/i.test(line));
});

/* ─────────────────────────── 실제 배선 ─────────────────────────── */

test('runMigrations 는 적용만 하고 끝내지 않고 실제 스키마와 대조한다', () => {
  assert.match(MIGRATE_SRC, /from\s+'@\/lib\/schemaVerify'/, 'migrate.ts 가 검증을 거치지 않는다');
  assert.match(MIGRATE_SRC, /verifySchema\(/);
  assert.match(MIGRATE_SRC, /return migrationReport\(/, 'runMigrations 가 검증 결과를 응답에 담지 않는다');
  // 검증 조회는 상수 경유 — 여기에 임의 SQL 을 적어 넣지 못하게 한다
  assert.match(MIGRATE_SRC, /PRESENT_TABLES_SQL/);
  // 조회 실패가 migrate 전체를 막아서는 안 된다
  assert.match(MIGRATE_SRC, /return null/);
});

test('검증을 붙이면서 부팅 자동 DDL 이 늘어나지 않았다', () => {
  // schemaBaseline(베이스라인 DDL 도출)은 승인 전까지 부팅 경로에 들어가지 않는다
  assert.ok(!/schemaBaseline|baselineDdl/.test(MIGRATE_SRC));
  for (const t of DECLARED) {
    if (createdTables(STATEMENTS).includes(t)) continue;
    assert.ok(!new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`).test(MIGRATE_SRC), `${t} CREATE 가 MIGRATION_DDL 에 들어갔다`);
  }
});
