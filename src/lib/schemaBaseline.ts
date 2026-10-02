/**
 * schemaBaseline.ts — drizzle 스키마 ↔ 부팅 MIGRATION_DDL 대조 + 복구용 베이스라인 DDL 도출. 2026-10-03
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * RUNBOOK §3 6단계는 복구 후 「`POST /api/admin/migrate` 1회 실행(멱등 DDL)」으로 스키마가
 * 정합된다고 약속한다. 그런데 `lib/migrate.ts` 의 MIGRATION_DDL 에는 `users`·`organizations`·
 * `projects`·`issues` 같은 **기반 테이블의 CREATE TABLE 이 아예 없다**(최초 1회 drizzle-kit push
 * 로 만들어진 뒤 코드에 남지 않았다). 더 나쁜 것은 뒤따르는 ALTER 가 전부 `IF EXISTS` 라서
 * 대상 테이블이 없으면 **오류 없이 통째로 건너뛴다** — `runMigrations()` 는 failed 0 으로
 * "성공"을 보고하고 사람은 스키마가 복원됐다고 믿는다. 500 이 아니라 빈 화면으로 드러난다.
 *
 * 이 모듈은 DB 에 접근하지 않는 **순수 정적 점검기**다. schema.ts 원문을 파싱해
 *   (1) MIGRATION_DDL 이 만들지 못하는 테이블(`tablesWithoutCreate`),
 *   (2) 그래서 조용히 no-op 되는 ALTER(`silentNoopAlters`),
 *   (3) 만들어지는 테이블의 컬럼 누락·유령 컬럼,
 *   (4) 복구 시 사람이 먼저 실행할 **베이스라인 DDL 을 schema.ts 에서 도출**한다
 *       (손으로 적지 않는다 — 손으로 적으면 envRegistry 때처럼 또 낡는다).
 *
 * 도출된 DDL 은 MIGRATION_DDL 에 넣지 않는다 — 부팅 자동 실행되는 신규 테이블 생성은 승인 사항이다.
 * 이 모듈은 `process.env` 도 읽지 않는다(환경변수 레지스트리 대조 대상 아님).
 */

export type ColumnKind = 'serial' | 'integer' | 'bigint' | 'text' | 'boolean' | 'timestamp';

const KINDS: readonly ColumnKind[] = ['serial', 'integer', 'bigint', 'text', 'boolean', 'timestamp'];

export interface SchemaColumn {
  /** TS 속성명 (orgId) */
  prop: string;
  /** DB 컬럼명 (org_id) */
  name: string;
  kind: ColumnKind;
  notNull: boolean;
  primaryKey: boolean;
  /** bigint ... generatedAlwaysAsIdentity() */
  identity: boolean;
  withTimezone: boolean;
  /** SQL 리터럴 그대로 ('free' · true · 0 · now()). 없으면 null */
  defaultSql: string | null;
  /** 참조 대상 drizzle 변수명 (users) */
  refVar: string | null;
  refProp: string | null;
  /** 'cascade' 등. 지정 없으면 null */
  refOnDelete: string | null;
}

export interface SchemaIndex {
  name: string;
  unique: boolean;
  /** TS 속성명 목록 */
  props: string[];
}

export interface SchemaTable {
  /** drizzle export 변수명 (issueWatchers) */
  varName: string;
  /** DB 테이블명 (issue_watchers) */
  table: string;
  columns: SchemaColumn[];
  /** primaryKey({ columns: [...] }) 의 TS 속성명 목록 */
  compositePk: string[];
  indexes: SchemaIndex[];
}

export interface SchemaModel {
  tables: SchemaTable[];
  byVar: Record<string, SchemaTable>;
  byTable: Record<string, SchemaTable>;
}

/* ─────────────────────────── 원문 파싱 보조 ─────────────────────────── */

/** `open` 위치의 괄호/중괄호/대괄호와 짝이 맞는 닫는 위치. 문자열 리터럴은 건너뛴다. 못 찾으면 -1 */
export function matchDelimiter(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const close = pairs[src[open]];
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (ch === src[open]) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** 괄호·문자열 중첩을 지키며 최상위 쉼표로 나눈다 */
export function splitTopLevel(src: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      let lit = ch;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') { lit += src[i]; i++; } lit += src[i]; i++; }
      buf += lit + q;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/* ─────────────────────────── 컬럼 표현식 파싱 ─────────────────────────── */

/** `text('email').notNull()` 같은 drizzle 컬럼 표현식 1건. 해석 불가면 null(추측하지 않는다) */
export function parseColumnExpr(prop: string, expr: string): SchemaColumn | null {
  const head = /^([A-Za-z_]\w*)\s*\(/.exec(expr);
  if (!head) return null;
  const kind = head[1] as ColumnKind;
  if (!KINDS.includes(kind)) return null;

  const openArgs = expr.indexOf('(', head.index);
  const closeArgs = matchDelimiter(expr, openArgs);
  if (closeArgs < 0) return null;
  const args = expr.slice(openArgs + 1, closeArgs);
  const nameLit = /'([^'\\]*)'/.exec(args);
  if (!nameLit) return null;

  const chain = expr.slice(closeArgs + 1);
  let defaultSql: string | null = null;
  if (/\.defaultNow\(\)/.test(chain)) defaultSql = 'now()';
  else {
    const d = /\.default\(\s*([^()]*?)\s*\)/.exec(chain);
    if (d) defaultSql = d[1];
  }
  const ref = /\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)\s*(?:,\s*\{[^}]*onDelete:\s*'(\w+)'[^}]*\})?/.exec(chain);

  return {
    prop,
    name: nameLit[1],
    kind,
    notNull: /\.notNull\(\)/.test(chain),
    primaryKey: /\.primaryKey\(\)/.test(chain),
    identity: /\.generatedAlwaysAsIdentity\(\)/.test(chain),
    withTimezone: /withTimezone\s*:\s*true/.test(args),
    defaultSql,
    refVar: ref ? ref[1] : null,
    refProp: ref ? ref[2] : null,
    refOnDelete: ref && ref[3] ? ref[3] : null,
  };
}

/** schema.ts 원문 → 테이블 모델. 파싱 실패한 컬럼은 `unparsed` 로 보고하고 버리지 않는다 */
export function parseSchemaSource(src: string): { model: SchemaModel; unparsed: { table: string; prop: string }[] } {
  const tables: SchemaTable[] = [];
  const unparsed: { table: string; prop: string }[] = [];
  const re = /export\s+const\s+(\w+)\s*=\s*pgTable\(\s*'([^']+)'\s*,\s*\{/g;

  // 각 pgTable 선언의 시작 위치를 먼저 모아 두면 tail 범위를 정확히 자를 수 있다
  const heads: { varName: string; table: string; braceAt: number; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    heads.push({ varName: m[1], table: m[2], braceAt: m.index + m[0].length - 1, start: m.index });
  }

  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const end = matchDelimiter(src, h.braceAt);
    if (end < 0) continue;
    const body = src.slice(h.braceAt + 1, end);
    const tailEnd = i + 1 < heads.length ? heads[i + 1].start : src.length;
    const tail = src.slice(end + 1, tailEnd);

    const columns: SchemaColumn[] = [];
    for (const entry of splitTopLevel(body)) {
      const kv = /^(\w+)\s*:\s*([\s\S]+)$/.exec(entry);
      if (!kv) continue;
      const col = parseColumnExpr(kv[1], kv[2]);
      if (col) columns.push(col);
      else unparsed.push({ table: h.table, prop: kv[1] });
    }

    const pk = /primaryKey\(\s*\{\s*columns:\s*\[([^\]]*)\]/.exec(tail);
    const compositePk = pk ? Array.from(pk[1].matchAll(/t\.(\w+)/g), (x) => x[1]) : [];

    const indexes: SchemaIndex[] = [];
    for (const ix of tail.matchAll(/\b(uniqueIndex|index)\(\s*'([^']+)'\s*\)\s*\.on\(([^)]*)\)/g)) {
      indexes.push({
        name: ix[2],
        unique: ix[1] === 'uniqueIndex',
        props: Array.from(ix[3].matchAll(/t\.(\w+)/g), (x) => x[1]),
      });
    }

    tables.push({ varName: h.varName, table: h.table, columns, compositePk, indexes });
  }

  const byVar: Record<string, SchemaTable> = {};
  const byTable: Record<string, SchemaTable> = {};
  for (const t of tables) { byVar[t.varName] = t; byTable[t.table] = t; }
  return { model: { tables, byVar, byTable }, unparsed };
}

/* ─────────────────────────── DDL 도출 ─────────────────────────── */

export function sqlType(col: SchemaColumn): string {
  if (col.kind === 'timestamp') return col.withTimezone ? 'timestamptz' : 'timestamp';
  return col.kind;
}

/** 컬럼 1건의 DDL 조각. 기존 MIGRATION_DDL 과 같은 어순(DEFAULT → NOT NULL → REFERENCES) */
export function columnDdl(col: SchemaColumn, model: SchemaModel): string {
  const parts = [col.name, sqlType(col)];
  if (col.identity) parts.push('GENERATED ALWAYS AS IDENTITY');
  if (col.primaryKey) parts.push('PRIMARY KEY');
  if (col.defaultSql) parts.push(`DEFAULT ${col.defaultSql}`);
  if (col.notNull) parts.push('NOT NULL');
  if (col.refVar) {
    const target = model.byVar[col.refVar];
    const targetCol = target?.columns.find((c) => c.prop === col.refProp);
    if (target && targetCol) {
      parts.push(`REFERENCES ${target.table}(${targetCol.name})`);
      if (col.refOnDelete) parts.push(`ON DELETE ${col.refOnDelete.toUpperCase()}`);
    }
  }
  return parts.join(' ');
}

export function createTableDdl(t: SchemaTable, model: SchemaModel): string {
  const cols = t.columns.map((c) => columnDdl(c, model));
  if (t.compositePk.length) {
    const names = t.compositePk.map((p) => t.columns.find((c) => c.prop === p)?.name ?? p);
    cols.push(`PRIMARY KEY (${names.join(', ')})`);
  }
  return `CREATE TABLE IF NOT EXISTS ${t.table} (${cols.join(', ')})`;
}

export function indexDdl(t: SchemaTable, ix: SchemaIndex): string {
  const names = ix.props.map((p) => t.columns.find((c) => c.prop === p)?.name ?? p);
  return `CREATE ${ix.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${ix.name} ON ${t.table} (${names.join(', ')})`;
}

/** 참조 관계를 지키는 생성 순서(FK 대상이 먼저). 순환은 입력 순서로 떨어뜨린다 */
export function dependencyOrder(tables: SchemaTable[], model: SchemaModel): SchemaTable[] {
  const want = new Set(tables.map((t) => t.table));
  const out: SchemaTable[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (t: SchemaTable) => {
    if (state.get(t.table)) return;
    state.set(t.table, 'visiting');
    for (const c of t.columns) {
      if (!c.refVar) continue;
      const dep = model.byVar[c.refVar];
      if (dep && dep.table !== t.table && want.has(dep.table) && state.get(dep.table) !== 'visiting') visit(dep);
    }
    state.set(t.table, 'done');
    out.push(t);
  };
  for (const t of tables) visit(t);
  return out;
}

/* ─────────────────────────── MIGRATION_DDL 파싱 ─────────────────────────── */

export interface MigrationDdl {
  statements: string[];
  /** CREATE TABLE 되는 테이블 → 그 CREATE 안의 컬럼명 */
  created: Record<string, string[]>;
  /** ALTER TABLE ... ADD COLUMN 으로 더해지는 컬럼 */
  altered: Record<string, string[]>;
  indexes: { name: string; table: string }[];
}

/** `migrate.ts` 원문에서 MIGRATION_DDL 배열의 문장만 뽑는다(모듈을 import 하면 DB 클라이언트가 함께 뜬다) */
export function extractMigrationStatements(migrateSrc: string): string[] {
  // `MIGRATION_DDL: string[] = [` — 타입 표기의 `[]` 가 아니라 대입되는 배열의 `[` 를 잡는다
  const decl = /MIGRATION_DDL\b[\s\S]*?=\s*\[/.exec(migrateSrc);
  if (!decl) return [];
  const open = decl.index + decl[0].length - 1;
  const close = matchDelimiter(migrateSrc, open);
  if (close < 0) return [];
  const body = migrateSrc.slice(open + 1, close);
  return Array.from(body.matchAll(/`([^`]*)`/g), (x) => x[1].trim()).filter((s) => s.length > 0);
}

export function parseMigrationDdl(statements: string[]): MigrationDdl {
  const created: Record<string, string[]> = {};
  const altered: Record<string, string[]> = {};
  const indexes: { name: string; table: string }[] = [];

  for (const stmt of statements) {
    const ct = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s*\(/i.exec(stmt);
    if (ct) {
      const open = stmt.indexOf('(', ct.index);
      const close = matchDelimiter(stmt, open);
      const cols: string[] = [];
      if (close > 0) {
        for (const seg of splitTopLevel(stmt.slice(open + 1, close))) {
          const name = /^(\w+)\s/.exec(seg);
          if (name && !/^(primary|unique|constraint|foreign|check)$/i.test(name[1])) cols.push(name[1]);
        }
      }
      created[ct[1]] = cols;
      continue;
    }
    const ac = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(stmt);
    if (ac) { (altered[ac[1]] ??= []).push(ac[2]); continue; }
    const ci = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)/i.exec(stmt);
    if (ci) indexes.push({ name: ci[1], table: ci[2] });
  }
  return { statements, created, altered, indexes };
}

/* ─────────────────────────── 대조 ─────────────────────────── */

export interface BaselineAudit {
  schemaTables: number;
  /** MIGRATION_DDL 이 CREATE 하는, schema.ts 에도 있는 테이블 */
  createdByMigration: string[];
  /** schema.ts 에 있으나 MIGRATION_DDL 이 만들지 못하는 테이블 = 빈 DB 복구의 사각지대 */
  tablesWithoutCreate: string[];
  /** 대상 테이블이 없어 `IF EXISTS` 때문에 오류 없이 건너뛰는 ALTER */
  silentNoopAlters: { table: string; column: string }[];
  /** CREATE 되지 않은 테이블 위의 CREATE INDEX — 이쪽은 조용하지 않고 실패한다 */
  indexesOnUncreatedTable: { index: string; table: string }[];
  /** MIGRATION_DDL 이 만드는 테이블인데 schema.ts 컬럼이 CREATE·ALTER 어디에도 없는 경우 */
  columnsMissingInDdl: { table: string; column: string }[];
  /** MIGRATION_DDL 에만 있고 schema.ts 에 없는 테이블(drizzle 밖 원시 SQL 영역) */
  ddlOnlyTables: string[];
  /** schema.ts 에 있는 테이블인데 DDL 쪽에만 있는 컬럼 */
  ghostColumns: { table: string; column: string }[];
}

export function auditBaselineCoverage(model: SchemaModel, ddl: MigrationDdl): BaselineAudit {
  const createdByMigration: string[] = [];
  const tablesWithoutCreate: string[] = [];
  for (const t of model.tables) {
    if (ddl.created[t.table]) createdByMigration.push(t.table);
    else tablesWithoutCreate.push(t.table);
  }
  const uncreated = new Set(tablesWithoutCreate);

  const silentNoopAlters: { table: string; column: string }[] = [];
  for (const [table, cols] of Object.entries(ddl.altered)) {
    if (!uncreated.has(table)) continue;
    for (const column of cols) silentNoopAlters.push({ table, column });
  }

  const indexesOnUncreatedTable = ddl.indexes
    .filter((ix) => uncreated.has(ix.table))
    .map((ix) => ({ index: ix.name, table: ix.table }));

  const columnsMissingInDdl: { table: string; column: string }[] = [];
  const ghostColumns: { table: string; column: string }[] = [];
  for (const table of createdByMigration) {
    const t = model.byTable[table];
    const known = new Set([...(ddl.created[table] ?? []), ...(ddl.altered[table] ?? [])]);
    for (const c of t.columns) if (!known.has(c.name)) columnsMissingInDdl.push({ table, column: c.name });
    const schemaCols = new Set(t.columns.map((c) => c.name));
    for (const c of known) if (!schemaCols.has(c)) ghostColumns.push({ table, column: c });
  }

  const ddlOnlyTables = Object.keys(ddl.created).filter((t) => !model.byTable[t]).sort();

  return {
    schemaTables: model.tables.length,
    createdByMigration,
    tablesWithoutCreate,
    silentNoopAlters,
    indexesOnUncreatedTable,
    columnsMissingInDdl,
    ddlOnlyTables,
    ghostColumns,
  };
}

/**
 * MIGRATION_DDL 이 못 만드는 테이블을 schema.ts 에서 도출한 **베이스라인 DDL**.
 * 복구 담당자가 MIGRATION_DDL 보다 **먼저** 실행한다. 전부 멱등(IF NOT EXISTS).
 */
export function baselineDdl(model: SchemaModel, ddl: MigrationDdl): string[] {
  const missing = model.tables.filter((t) => !ddl.created[t.table]);
  const ordered = dependencyOrder(missing, model);
  const out: string[] = [];
  for (const t of ordered) out.push(createTableDdl(t, model));
  for (const t of ordered) for (const ix of t.indexes) out.push(indexDdl(t, ix));
  return out;
}

/** 멱등성·파괴적 구문 점검. 복구 절차가 `migrate` 를 반복 호출해도 안전해야 한다 */
export function auditIdempotency(statements: string[]): { notIdempotent: string[]; destructive: string[] } {
  const notIdempotent: string[] = [];
  const destructive: string[] = [];
  for (const s of statements) {
    if (!/\bIF\s+(NOT\s+)?EXISTS\b/i.test(s)) notIdempotent.push(s);
    if (/\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN\s+\w+\s+TYPE)\b/i.test(s)) destructive.push(s);
  }
  return { notIdempotent, destructive };
}

export interface BaselineStatus {
  schemaTables: number;
  createdByMigration: number;
  tablesWithoutCreate: number;
  silentNoopAlters: number;
  baselineStatements: number;
  /** 빈 DB 에 migrate 만 돌렸을 때 스키마가 복원되는가 */
  migrateAloneRestoresSchema: boolean;
  /** 치명 불일치(만들어지는 테이블의 컬럼 누락·유령 컬럼·파괴적 구문) */
  drift: number;
}

export function schemaBaselineStatus(model: SchemaModel, ddl: MigrationDdl): BaselineStatus {
  const audit = auditBaselineCoverage(model, ddl);
  const idem = auditIdempotency(ddl.statements);
  return {
    schemaTables: audit.schemaTables,
    createdByMigration: audit.createdByMigration.length,
    tablesWithoutCreate: audit.tablesWithoutCreate.length,
    silentNoopAlters: audit.silentNoopAlters.length,
    baselineStatements: baselineDdl(model, ddl).length,
    migrateAloneRestoresSchema: audit.tablesWithoutCreate.length === 0,
    drift: audit.columnsMissingInDdl.length + audit.ghostColumns.length + idem.destructive.length + idem.notIdempotent.length,
  };
}
