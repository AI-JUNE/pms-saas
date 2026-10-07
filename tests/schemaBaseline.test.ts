/**
 * schemaBaseline.test.ts — drizzle 스키마 ↔ 부팅 MIGRATION_DDL 대조. 2026-10-03
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * RUNBOOK §3 6단계는 복구 후 `POST /api/admin/migrate` 1회로 스키마가 정합된다고 약속한다.
 * 그런데 MIGRATION_DDL 에는 기반 테이블 25개의 CREATE TABLE 이 없고, 뒤따르는 ALTER 는
 * 전부 `IF EXISTS` 라서 테이블이 없으면 **오류 없이 건너뛴다**. runMigrations() 는 failed 0 을
 * 보고하고 사람은 복원됐다고 믿는다 — 조용한 실패다.
 *
 * 이 테스트는 **실제 `src/db/schema.ts` 와 실제 `src/lib/migrate.ts` 원문을 매번 파싱**해
 * 그 사각지대를 숫자로 고정한다. 테이블을 새로 추가하면서 CREATE DDL 을 안 적으면 CI 가 실패한다.
 * 파일만 읽는다 — DB·네트워크·process.env 를 건드리지 않는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  matchDelimiter,
  splitTopLevel,
  parseColumnExpr,
  parseSchemaSource,
  sqlType,
  columnDdl,
  createTableDdl,
  indexDdl,
  dependencyOrder,
  extractMigrationStatements,
  parseMigrationDdl,
  auditBaselineCoverage,
  baselineDdl,
  auditIdempotency,
  schemaBaselineStatus,
} from '../src/lib/schemaBaseline.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCHEMA_SRC = fs.readFileSync(path.join(ROOT, 'src', 'db', 'schema.ts'), 'utf8');
const MIGRATE_SRC = fs.readFileSync(path.join(ROOT, 'src', 'lib', 'migrate.ts'), 'utf8');

const { model, unparsed } = parseSchemaSource(SCHEMA_SRC);
const statements = extractMigrationStatements(MIGRATE_SRC);
const ddl = parseMigrationDdl(statements);

/**
 * 빈 DB 복구 시 `migrate` 가 만들지 못하는 테이블 — 2026-10-03 실측 고정값.
 * 이 목록이 **늘어나면** 새 테이블을 CREATE DDL 없이 추가한 것이고,
 * **줄어들면** 베이스라인을 MIGRATION_DDL 로 승격한 것이다. 둘 다 사람이 알아야 한다.
 */
const KNOWN_WITHOUT_CREATE = [
  'users', 'sessions', 'organizations', 'memberships', 'permissions', 'role_permissions',
  'counters', 'audit_log', 'projects', 'phases', 'members', 'requirements', 'issues',
  'risks', 'tasks', 'documents', 'meetings', 'notifications', 'comments', 'sprints',
  'interfaces', 'infra_assets', 'firewall_requests', 'procurement_items', 'boards',
];

/* ─────────────────────────── 파서 단위 ─────────────────────────── */

test('matchDelimiter / splitTopLevel 는 문자열·중첩 괄호를 건너뛴다', () => {
  assert.equal(matchDelimiter("(a, '(')", 0), 7);
  assert.equal(matchDelimiter('{a:{b:1}}', 0), 8);
  assert.equal(matchDelimiter('[1,2]', 0), 4);
  assert.equal(matchDelimiter('abc', 0), -1, '괄호가 아니면 -1');
  assert.equal(matchDelimiter('(a', 0), -1, '짝이 없으면 -1');

  assert.deepEqual(splitTopLevel("a, f(b, c), 'x,y'"), ['a', 'f(b, c)', "'x,y'"]);
  assert.deepEqual(splitTopLevel('a, , b'), ['a', 'b'], '빈 조각은 버린다');
  assert.deepEqual(splitTopLevel("'a\\'b', c"), ["'a\\'b'", 'c'], '이스케이프된 인용부호');
});

test('parseColumnExpr 는 drizzle 컬럼 표현식을 읽고, 모르는 꼴은 null 을 낸다', () => {
  const id = parseColumnExpr('id', "serial('id').primaryKey()")!;
  assert.equal(id.name, 'id');
  assert.equal(id.kind, 'serial');
  assert.ok(id.primaryKey && !id.notNull);

  const big = parseColumnExpr('id', "bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity()")!;
  assert.equal(big.name, 'id', "두 번째 인자의 'number' 를 컬럼명으로 오인하지 않는다");
  assert.ok(big.identity);

  const ts = parseColumnExpr('createdAt', "timestamp('created_at', { withTimezone: true }).defaultNow().notNull()")!;
  assert.equal(sqlType(ts), 'timestamptz');
  assert.equal(ts.defaultSql, 'now()');

  const plain = parseColumnExpr('executedAt', "timestamp('executed_at')")!;
  assert.equal(sqlType(plain), 'timestamp');
  assert.equal(plain.defaultSql, null);

  const ko = parseColumnExpr('type', "text('type').default('단위').notNull()")!;
  assert.equal(ko.defaultSql, "'단위'", '한글 기본값도 리터럴 그대로');

  const fk = parseColumnExpr('userId', "integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' })")!;
  assert.deepEqual([fk.refVar, fk.refProp, fk.refOnDelete], ['users', 'id', 'cascade']);

  const noDel = parseColumnExpr('x', "integer('x').references(() => users.id)")!;
  assert.equal(noDel.refOnDelete, null);

  assert.equal(parseColumnExpr('x', "jsonb('x')"), null, '모르는 타입은 추측하지 않는다');
  assert.equal(parseColumnExpr('x', 'someFlag'), null);
  assert.equal(parseColumnExpr('x', 'text(SOME_CONST)'), null, '컬럼명이 리터럴이 아니면 포기한다');
  assert.equal(parseColumnExpr('x', "text('x'"), null, '괄호가 안 닫히면 포기한다');
});

test('실제 schema.ts 가 빠짐없이 파싱된다', () => {
  assert.deepEqual(unparsed, [], `해석 못한 컬럼이 있으면 대조가 무의미하다: ${JSON.stringify(unparsed)}`);
  assert.equal(model.tables.length, 37); // 배치181: +password_reset_tokens·attachments·issue_links·form_entries
  // 복합 PK·유니크 인덱스 같은 무결성 장치가 실제로 읽혔는지
  assert.deepEqual(model.byTable['role_permissions'].compositePk, ['orgId', 'role', 'permissionId']);
  assert.deepEqual(model.byTable['counters'].compositePk, ['orgId', 'scope']);
  assert.ok(model.byTable['users'].indexes.some((i) => i.name === 'users_email_idx' && i.unique));
  assert.ok(model.byTable['issue_watchers'].indexes.some((i) => i.name === 'issue_watchers_uniq' && i.unique));
  // 테이블마다 최소 1개 컬럼은 읽혀야 한다
  for (const t of model.tables) assert.ok(t.columns.length > 0, `${t.table} 컬럼 0개`);
});

/* ─────────────────────────── DDL 도출 ─────────────────────────── */

test('도출한 CREATE TABLE 이 기존 MIGRATION_DDL 과 같은 어순·문법을 쓴다', () => {
  const users = createTableDdl(model.byTable['users'], model);
  assert.equal(
    users,
    'CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text NOT NULL, name text NOT NULL, '
      + 'password_hash text NOT NULL, is_active boolean DEFAULT true NOT NULL, '
      + 'is_superadmin boolean DEFAULT false NOT NULL, created_at timestamptz DEFAULT now() NOT NULL)',
  );
  const rp = createTableDdl(model.byTable['role_permissions'], model);
  assert.match(rp, /PRIMARY KEY \(org_id, role, permission_id\)\)$/, '복합 PK 는 테이블 제약으로');
  assert.match(rp, /permission_id integer NOT NULL REFERENCES permissions\(id\) ON DELETE CASCADE/);
  assert.match(
    createTableDdl(model.byTable['audit_log'], model),
    /id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY/,
  );
  assert.equal(
    indexDdl(model.byTable['memberships'], model.byTable['memberships'].indexes[0]),
    'CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user_idx ON memberships (org_id, user_id)',
  );
  // 참조 대상이 모델에 없으면 REFERENCES 를 지어내지 않는다
  const orphan = { ...model.byTable['sessions'].columns[1], refVar: 'nope' };
  assert.equal(columnDdl(orphan, model), 'user_id integer NOT NULL');
});

test('dependencyOrder 는 FK 대상을 먼저 놓고 순환에도 멈추지 않는다', () => {
  const picked = ['issue_watchers', 'issues', 'projects', 'organizations'].map((t) => model.byTable[t]);
  const order = dependencyOrder(picked, model).map((t) => t.table);
  assert.ok(order.indexOf('organizations') < order.indexOf('projects'));
  assert.ok(order.indexOf('projects') < order.indexOf('issues'));
  assert.ok(order.indexOf('issues') < order.indexOf('issue_watchers'));

  const a: any = { varName: 'a', table: 'a', compositePk: [], indexes: [], columns: [{ prop: 'b', name: 'b', kind: 'integer', notNull: false, primaryKey: false, identity: false, withTimezone: false, defaultSql: null, refVar: 'b', refProp: 'id', refOnDelete: null }] };
  const b: any = { varName: 'b', table: 'b', compositePk: [], indexes: [], columns: [{ prop: 'a', name: 'a', kind: 'integer', notNull: false, primaryKey: false, identity: false, withTimezone: false, defaultSql: null, refVar: 'a', refProp: 'id', refOnDelete: null }] };
  const cyc = dependencyOrder([a, b], { tables: [a, b], byVar: { a, b }, byTable: { a, b } });
  assert.equal(cyc.length, 2, '순환이어도 전건을 낸다');

  // 자기참조는 자기 자신을 기다리지 않는다
  const self: any = { varName: 's', table: 's', compositePk: [], indexes: [], columns: [{ prop: 'p', name: 'p', kind: 'integer', notNull: false, primaryKey: false, identity: false, withTimezone: false, defaultSql: null, refVar: 's', refProp: 'id', refOnDelete: null }] };
  assert.equal(dependencyOrder([self], { tables: [self], byVar: { s: self }, byTable: { s: self } }).length, 1);
});

/* ─────────────────────────── MIGRATION_DDL 파싱 ─────────────────────────── */

test('실제 migrate.ts 에서 MIGRATION_DDL 문장을 원문 그대로 뽑는다', () => {
  assert.ok(statements.length > 80, `뽑힌 문장 ${statements.length}건 — 파서가 배열을 놓쳤다`);
  assert.ok(statements.every((s) => /^(CREATE|ALTER)\b/i.test(s)), 'DDL 아닌 문장이 섞였다');
  assert.deepEqual(extractMigrationStatements('export const OTHER = [`x`]'), [], '다른 배열을 긁어오지 않는다');
  assert.deepEqual(extractMigrationStatements('MIGRATION_DDL: string[] = ['), [], '배열이 안 닫히면 포기한다');
  assert.deepEqual(extractMigrationStatements('MIGRATION_DDL: string[] = [`a`, ``, `  b  `]'), ['a', 'b']);
});

test('MIGRATION_DDL 은 전건 멱등이고 파괴적 구문이 없다', () => {
  const idem = auditIdempotency(statements);
  assert.deepEqual(idem.notIdempotent, [], '반복 실행 안전하지 않은 문장');
  assert.deepEqual(idem.destructive, [], 'DROP/TRUNCATE/DELETE 는 부팅 DDL 에 있을 수 없다');
  // 점검기가 실제로 잡는지
  const probe = auditIdempotency(['CREATE TABLE x (id serial)', 'DROP TABLE IF EXISTS x', 'ALTER TABLE IF EXISTS x ADD COLUMN IF NOT EXISTS y text']);
  assert.equal(probe.notIdempotent.length, 1);
  assert.equal(probe.destructive.length, 1);
  // ON DELETE CASCADE 를 파괴적 구문으로 오인하지 않는다
  assert.deepEqual(auditIdempotency(['CREATE TABLE IF NOT EXISTS x (a integer REFERENCES y(id) ON DELETE CASCADE)']).destructive, []);
});

/* ─────────────────────────── 핵심: 복구 사각지대 고정 ─────────────────────────── */

test('빈 DB 에 migrate 만 돌리면 기반 테이블 25개가 만들어지지 않는다 (RUNBOOK §3 한계)', () => {
  const audit = auditBaselineCoverage(model, ddl);
  assert.deepEqual(
    audit.tablesWithoutCreate.slice().sort(),
    KNOWN_WITHOUT_CREATE.slice().sort(),
    '목록이 바뀌었다 — 새 테이블에 CREATE DDL 을 빠뜨렸거나 베이스라인을 승격했다. RUNBOOK §3 도 함께 고쳐라',
  );
  assert.equal(audit.createdByMigration.length, 12, 'migrate 가 만드는 schema.ts 테이블(배치181 +4)');
  assert.equal(audit.createdByMigration.length + audit.tablesWithoutCreate.length, model.tables.length);

  // 조용한 실패의 증거: 대상 테이블이 없는데 IF EXISTS 때문에 오류조차 안 나는 ALTER
  assert.ok(audit.silentNoopAlters.length > 30, `조용히 건너뛰는 ALTER ${audit.silentNoopAlters.length}건`);
  assert.ok(audit.silentNoopAlters.some((a) => a.table === 'organizations' && a.column === 'invite_code'));
  assert.ok(audit.silentNoopAlters.some((a) => a.table === 'issues' && a.column === 'story_points'));

  // 반대로 인덱스 생성은 조용하지 않다(없는 테이블이면 실패로 드러난다)
  assert.ok(audit.indexesOnUncreatedTable.some((i) => i.index === 'sessions_token_idx'));
});

test('migrate 가 만드는 테이블에는 컬럼 드리프트가 없다', () => {
  const audit = auditBaselineCoverage(model, ddl);
  assert.deepEqual(audit.columnsMissingInDdl, [], 'CREATE·ALTER 어디에도 없는 schema.ts 컬럼');
  assert.deepEqual(audit.ghostColumns, [], 'schema.ts 에 없는 유령 컬럼');

  /**
   * 이 점검으로 실제로 잡힌 결함(2026-10-03): MIGRATION_DDL 은 `tests.cycle` 을 만드는데
   * drizzle `tests` 테이블에는 선언이 없었다. configs.ts 는 `cycle` 을 필드로 받고 테스트 화면은
   * 「차수」 입력을 내주지만, drizzle insert/update 는 테이블에 없는 키를 **조용히 버린다** —
   * 사용자가 입력한 차수가 200 OK 와 함께 사라지고 `/test-cycles` 그룹화가 늘 빈 상태였다.
   */
  assert.ok(model.byTable['tests'].columns.some((c) => c.name === 'cycle'), 'tests.cycle 선언이 사라지면 차수 입력이 다시 조용히 버려진다');
  assert.ok((ddl.altered['tests'] ?? []).includes('cycle'), 'DB 쪽 컬럼은 ALTER 로 이미 존재한다(신규 DDL 불필요)');
  // drizzle 밖(원시 SQL) 테이블은 오류가 아니라 사실로 보고한다
  assert.deepEqual(audit.ddlOnlyTables, ['billing_customers', 'billing_events', 'billing_methods', 'invoices', 'subscriptions']);
});

test('베이스라인 DDL 이 schema.ts 에서 도출되고, 복구 담당자가 그대로 실행할 수 있다', () => {
  const base = baselineDdl(model, ddl);
  const creates = base.filter((s) => s.startsWith('CREATE TABLE'));
  assert.equal(creates.length, KNOWN_WITHOUT_CREATE.length);
  assert.ok(base.every((s) => /IF NOT EXISTS/.test(s)), '전건 멱등이어야 반복 실행이 안전하다');
  assert.deepEqual(auditIdempotency(base).destructive, []);

  // 누락 테이블의 모든 컬럼이 빠짐없이 들어간다
  for (const name of KNOWN_WITHOUT_CREATE) {
    const t = model.byTable[name];
    const stmt = creates.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`))!;
    assert.ok(stmt, `${name} CREATE 누락`);
    for (const c of t.columns) assert.match(stmt, new RegExp(`[(, ]${c.name} `), `${name}.${c.name} 누락`);
  }

  // FK 대상이 먼저 만들어진다 — 아니면 복구 중 실행이 실패한다
  const at = (table: string) => creates.findIndex((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`));
  for (const t of KNOWN_WITHOUT_CREATE.map((n) => model.byTable[n])) {
    for (const c of t.columns) {
      if (!c.refVar) continue;
      const dep = model.byVar[c.refVar];
      if (!dep || dep.table === t.table) continue;
      assert.ok(at(dep.table) >= 0, `${t.table} 가 참조하는 ${dep.table} 가 베이스라인에 없다 — migrate 보다 먼저 못 만든다`);
      assert.ok(at(dep.table) < at(t.table), `${dep.table} 가 ${t.table} 보다 먼저 와야 한다`);
    }
  }

  // 인덱스는 해당 테이블 CREATE 이후에만
  for (const ix of base.filter((s) => s.includes('INDEX'))) {
    const on = /\sON\s+(\w+)\s/.exec(ix)!;
    assert.ok(base.indexOf(ix) > at(on[1]), `${ix} 가 테이블보다 먼저다`);
  }
});

test('베이스라인 DDL 은 부팅 자동 실행 경로(MIGRATION_DDL)에 섞이지 않는다', () => {
  // 신규 테이블 생성은 승인 사항이다. 도출만 하고 배선하지 않는다.
  assert.ok(!/schemaBaseline|baselineDdl/.test(MIGRATE_SRC), 'migrate.ts 가 베이스라인을 import 하면 부팅 시 테이블이 생긴다');
  for (const name of KNOWN_WITHOUT_CREATE) {
    assert.ok(
      !new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`).test(MIGRATE_SRC),
      `${name} CREATE 가 MIGRATION_DDL 에 들어갔다 — 승인 없이 부팅 때 테이블이 생성된다`,
    );
  }
});

test('RUNBOOK §3 이 migrate 단독 복구를 더 이상 약속하지 않는다', () => {
  const runbook = fs.readFileSync(path.join(ROOT, 'RUNBOOK.md'), 'utf8');
  const sec3 = runbook.slice(runbook.indexOf('## 3.'), runbook.indexOf('## 4.'));
  assert.ok(sec3.includes('lib/schemaBaseline.ts'), '§3 이 베이스라인 도출 위치를 가리켜야 한다');
  assert.match(sec3, /IF EXISTS/, '§3 이 ALTER 가 조용히 건너뛰는 한계를 적어야 한다');
  assert.match(sec3, /빈 (DB|스키마)|새 (프로젝트|DB)/, '§3 이 빈 DB 복구 경로를 구분해야 한다');
});

test('schemaBaselineStatus 가 현재 상태를 숫자로 요약한다', () => {
  const s = schemaBaselineStatus(model, ddl);
  assert.equal(s.schemaTables, 37);
  assert.equal(s.createdByMigration, 12);
  assert.equal(s.tablesWithoutCreate, 25);
  assert.equal(s.migrateAloneRestoresSchema, false, '지금은 migrate 단독으로 복원되지 않는다');
  assert.equal(s.drift, 0, '만들어지는 테이블 범위에는 드리프트가 없다');
  assert.ok(s.baselineStatements >= 25 && s.silentNoopAlters > 30);
});
