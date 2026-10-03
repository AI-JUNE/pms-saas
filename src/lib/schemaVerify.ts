/**
 * schemaVerify.ts — 마이그레이션의 "성공" 보고를 실제 스키마와 대조한다. 2026-10-03
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * `lib/schemaBaseline.ts` 는 같은 문제를 **CI 시점**에 잡는다(소스끼리 대조). 그러나
 * 복구 현장에서 사람이 보는 것은 CI 가 아니라 `POST /api/admin/migrate` 의 응답이다.
 * 그 응답은 지금 `{applied: N, failed: []}` 뿐이고, `applied` 는 **예외를 던지지 않은 문장 수**다 —
 * 빈 DB 에서는 `ALTER TABLE IF EXISTS … ADD COLUMN` 41건이 대상 테이블이 없어 오류 없이
 * 건너뛰면서도 전부 applied 로 세어진다. 그래서 테이블이 하나도 없는 DB 에서도
 * `failed: 0` 짜리 "성공"이 나오고, 담당자는 RUNBOOK §3 6단계를 끝냈다고 믿은 뒤
 * 빈 화면을 보고서야 복구가 안 됐음을 알게 된다.
 *
 * 이 모듈은 그 응답을 **검증된 판정으로 바꾼다**: 앱이 실제로 쓰는 테이블 목록과
 * DB 에 실제로 있는 테이블 목록을 대조해
 *   (1) 없는 테이블(`missingTables`),
 *   (2) 그 때문에 조용히 건너뛴 ALTER 수(`skippedAlters`) — 조용한 실패의 규모,
 *   (3) 사람이 다음에 할 일(`action`, RUNBOOK §3-1 로 유도),
 *   (4) `failed: 0` 인데 스키마가 정합되지 않은 상태(`silentSuccess`) 를 돌려준다.
 *
 * DB·`process.env`·파일시스템에 접근하지 않는 **순수 함수 모음**이다. 조회 자체는 호출부
 * (`lib/migrate.ts`)가 하고, 여기서는 그 결과만 해석한다. 조회에 쓸 SQL 도 상수로 노출해
 * 테스트가 **읽기 전용인지** 매번 검사할 수 있게 한다(복구 경로에 쓰기를 섞지 않는다).
 */

/** 실존 테이블 목록 조회용 — 읽기 전용. 현재 search_path 의 기본 스키마만 본다 */
export const PRESENT_TABLES_SQL =
  "select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'";

/** 드라이버가 테이블 이름을 담아 오는 컬럼 이름들(neon-http/pg/postgres.js 가 서로 다르다) */
export const TABLE_NAME_KEYS: readonly string[] = ['table_name', 'tablename', 'tableName', 'TABLE_NAME'];

function isRow(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 드라이버마다 다른 결과 모양(`rows` 래핑 / 배열 그 자체)에서 행 배열만 꺼낸다 */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.filter(isRow);
  if (isRow(result) && Array.isArray(result.rows)) return result.rows.filter(isRow);
  return [];
}

/**
 * 행에서 테이블 이름만 뽑는다. 알려진 컬럼명이 없으면 **값이 하나뿐일 때만** 그 값을 쓴다 —
 * 여러 컬럼 중 아무거나 고르지 않는다(틀린 이름을 "존재한다"로 읽으면 검증이 무의미해진다).
 */
export function tableNamesFrom(rows: readonly Record<string, unknown>[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    let hit: unknown;
    for (const k of TABLE_NAME_KEYS) if (typeof row[k] === 'string') { hit = row[k]; break; }
    if (hit === undefined) {
      const vals = Object.values(row);
      if (vals.length === 1 && typeof vals[0] === 'string') hit = vals[0];
    }
    if (typeof hit === 'string' && hit.trim()) out.push(hit);
  }
  return out;
}

/** 소문자·따옴표 제거·중복 제거·정렬. Postgres 의 따옴표 없는 식별자는 소문자로 저장된다 */
export function normalizeTableNames(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const t = String(raw ?? '').trim().replace(/^"(.*)"$/, '$1').toLowerCase();
    if (t) out.add(t);
  }
  return [...out].sort();
}

/** MIGRATION_DDL 이 `CREATE TABLE IF NOT EXISTS` 로 만드는 테이블 이름 */
export function createdTables(statements: readonly string[]): string[] {
  const out: string[] = [];
  for (const stmt of statements) {
    const m = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s*\(/i.exec(stmt);
    if (m) out.push(m[1]);
  }
  return normalizeTableNames(out);
}

export interface AlterTarget {
  table: string;
  column: string;
  /** `IF EXISTS` 가 붙어 있으면 대상이 없어도 **조용히** 넘어간다. 없으면 오류로 드러난다 */
  ifExists: boolean;
}

/** `ALTER TABLE [IF EXISTS] <t> ADD COLUMN [IF NOT EXISTS] <c>` 대상 */
export function alterTargets(statements: readonly string[]): AlterTarget[] {
  const out: AlterTarget[] = [];
  for (const stmt of statements) {
    const m = /^\s*ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?("?\w+"?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)/i.exec(stmt);
    if (m) out.push({ table: normalizeTableNames([m[2]])[0], column: normalizeTableNames([m[3]])[0], ifExists: !!m[1] });
  }
  return out;
}

/**
 * 대상 테이블이 DB 에 없어서 **오류 없이 건너뛴** ALTER — 조용한 실패의 규모.
 * `IF EXISTS` 가 없는 문장은 실제로 오류를 내므로(= `failed` 에 잡힌다) 여기서 세지 않는다.
 */
export function skippedForMissingTable(
  statements: readonly string[],
  present: readonly string[],
): { table: string; column: string }[] {
  const have = new Set(normalizeTableNames(present));
  return alterTargets(statements)
    .filter((a) => a.ifExists && !have.has(a.table))
    .map(({ table, column }) => ({ table, column }));
}

export type SchemaVerdict = 'ok' | 'empty' | 'incomplete' | 'unverified';

export const ACTION_EMPTY =
  '테이블이 하나도 없다 — migrate 만으로는 복원되지 않는다. RUNBOOK §3-1 의 베이스라인 DDL 을 먼저 적용한 뒤 다시 실행할 것';
export const ACTION_INCOMPLETE =
  '일부 테이블이 없다 — RUNBOOK §3-1 의 베이스라인 DDL 로 누락분을 만든 뒤 다시 실행할 것';
export const ACTION_UNVERIFIED =
  '실제 테이블 목록을 조회하지 못해 검증하지 못했다 — DB 연결·권한을 확인하고 RUNBOOK §3-1 로 직접 대조할 것';
export const ACTION_NO_EXPECTATION =
  '기대 테이블 목록이 비어 있어 대조하지 못했다 — 스키마 모듈을 읽지 못한 것이므로 배포본을 확인할 것';

export interface SchemaVerification {
  verdict: SchemaVerdict;
  /** 검증을 통과했을 때만 true. `unverified` 는 "모른다"이므로 false */
  ok: boolean;
  /** 앱이 쓰는 테이블 수 */
  expected: number;
  /** 그중 실제로 있는 테이블 수 */
  present: number;
  missingTables: string[];
  skippedAlters: { table: string; column: string }[];
  /** 사람이 다음에 할 일. 정합이면 null */
  action: string | null;
}

/**
 * 기대 테이블(앱이 쓰는 것) ↔ 실존 테이블 대조.
 * `present: null` = 조회 실패. 이때 **"없다"로 단정하지 않고** `unverified` 로 남긴다.
 */
export function verifySchema(input: {
  expected: readonly string[];
  present: readonly string[] | null;
  statements?: readonly string[];
}): SchemaVerification {
  const expected = normalizeTableNames(input.expected);
  const base = { expected: expected.length, present: 0, missingTables: [] as string[], skippedAlters: [] as { table: string; column: string }[] };

  if (input.present === null) return { ...base, verdict: 'unverified', ok: false, action: ACTION_UNVERIFIED };
  if (expected.length === 0) return { ...base, verdict: 'unverified', ok: false, action: ACTION_NO_EXPECTATION };

  const present = normalizeTableNames(input.present);
  const have = new Set(present);
  const missingTables = expected.filter((t) => !have.has(t));
  const skippedAlters = input.statements ? skippedForMissingTable(input.statements, present) : [];
  const found = expected.length - missingTables.length;

  if (missingTables.length === 0) {
    return { expected: expected.length, present: found, missingTables, skippedAlters, verdict: 'ok', ok: true, action: null };
  }
  const verdict: SchemaVerdict = found === 0 ? 'empty' : 'incomplete';
  return {
    expected: expected.length,
    present: found,
    missingTables,
    skippedAlters,
    verdict,
    ok: false,
    action: verdict === 'empty' ? ACTION_EMPTY : ACTION_INCOMPLETE,
  };
}

export interface MigrationOutcome {
  applied: number;
  failed: { stmt: string; error: string }[];
}

export interface MigrationReport extends MigrationOutcome {
  schema: SchemaVerification;
  /**
   * `failed` 가 비었는데도 스키마가 정합되지 않은 상태 — 지금까지 사람을 속여 온 바로 그 조합.
   * 이 값이 true 면 응답은 "성공"처럼 보여도 복구는 끝나지 않았다.
   */
  silentSuccess: boolean;
}

export function migrationReport(outcome: MigrationOutcome, schema: SchemaVerification): MigrationReport {
  return {
    applied: outcome.applied,
    failed: outcome.failed,
    schema,
    silentSuccess: outcome.failed.length === 0 && (schema.verdict === 'empty' || schema.verdict === 'incomplete'),
  };
}

/** 로그 한 줄. 값·연결문자열을 담지 않는다(테이블 이름과 개수만) */
export function migrationLogLine(r: MigrationReport): string {
  const parts = [
    `applied=${r.applied}`,
    `failed=${r.failed.length}`,
    `schema=${r.schema.verdict}`,
    `tables=${r.schema.present}/${r.schema.expected}`,
  ];
  if (r.schema.missingTables.length) parts.push(`missing=${r.schema.missingTables.length}`);
  if (r.schema.skippedAlters.length) parts.push(`skipped_alters=${r.schema.skippedAlters.length}`);
  if (r.silentSuccess) parts.push('silent_success=true');
  if (r.schema.action) parts.push(`action=${r.schema.action}`);
  return parts.join(' ');
}
