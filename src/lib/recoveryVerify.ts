/**
 * recoveryVerify.ts — 복구된 DB 에 **행이 실제로 돌아왔는지** 대조한다. 2026-10-04
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * RUNBOOK §3 4단계는 전환 전에 「핵심 데이터(조직·사용자·프로젝트·이슈 건수)를 **손상 전 기대치와
 * 대조**한다」고 지시하고, 그 검증을 통과했을 때만 5단계(운영 `DATABASE_URL` 교체)로 넘어가라고 한다.
 * 그런데 지금 코드에는
 *   (1) 행 수를 **세어 주는 경로가 없고**(어디에도 count 조회가 없다),
 *   (2) 비교 대상인 「손상 전 기대치」가 **어디에도 기록되지 않는다**(§2 월 점검도 수치를 남기지 않는다).
 * 즉 4단계는 담당자가 눈대중으로 "있어 보인다"를 판단한 뒤 운영 DB 를 갈아타는 절차였다.
 *
 * 앞선 `lib/schemaVerify.ts` 는 **테이블이 있는지**까지만 본다(`verdict: ok` 가 행 복원을 보장하지
 * 않는다고 RUNBOOK 에 명시해 둔 그 한계다). 빈 테이블만 있는 DB 도 `schema.verdict: ok` 를 받는다 —
 * 스키마는 복원됐지만 데이터는 비어 있는 상태가 "성공"으로 보이는 마지막 구멍이다.
 *
 * 이 모듈은 그 구멍을 메운다:
 *   - 핵심 테이블 행 수를 세는 **읽기 전용 SQL 을 조립**하고(`coreCountSql`),
 *   - 운영자가 §2 월 점검에서 남긴 **스냅샷(기준치)과 대조**해(`verifyRowCounts`)
 *   - `ok`/`short`/`empty`/`incomplete`/`no_baseline`/`unverified` 로 판정하고,
 *   - 다음 점검에 쓸 스냅샷 문자열을 **그대로 붙여 넣을 수 있게** 돌려준다(`snapshotLine`).
 *
 * 원칙
 * - DB·`process.env`·파일시스템 미접근. 조회는 호출부(라우트)가 하고 여기서는 조립·해석만 한다.
 * - **임의 기준치 금지**: 기준 스냅샷이 없으면 `ok` 로 올리지 않고 `no_baseline` 로 남긴다.
 *   "대충 이 정도면 됐다"는 숫자를 만들지 않는다.
 * - 조회 실패를 "0건"으로 단정하지 않는다(`unverified`).
 * - 식별자는 화이트리스트 정규식을 통과한 것만 SQL 에 넣는다(문자열 보간 지점이므로).
 */

import { parseRehearsalDate, recoveryCheck } from './recovery.ts';
import {
  assessBaselineAge, baselineAgeLine, baselineMaxAgeDays, snapshotAdoption,
  type BaselineAge, type BaselineStamp, type SnapshotAdoption,
} from './recoveryBaseline.ts';
import { normalizeTableNames, type SchemaVerification } from './schemaVerify.ts';

/* ───────────────────────────── 핵심 테이블 ───────────────────────────── */

/**
 * 복구 검증 대상. "전부"가 아니라 **유실되면 서비스가 성립하지 않는 것**만 고른다.
 * 테스트가 각 이름이 실제 `src/db/schema.ts` 선언에 있는지 매번 대조한다(목록이 낡지 않도록).
 */
export const CORE_TABLE_ROLES: readonly { table: string; why: string }[] = [
  { table: 'users', why: '계정 — 유실되면 아무도 로그인할 수 없다' },
  { table: 'organizations', why: '테넌트 루트 — 유실되면 모든 데이터가 고아가 된다' },
  { table: 'memberships', why: '소속 — 유실되면 계정이 남아도 조직에 들어갈 수 없다' },
  { table: 'projects', why: '프로젝트 — 하위 업무 데이터의 부모' },
  { table: 'phases', why: '단계 — 일정·기성고의 기준' },
  { table: 'members', why: '프로젝트 인력 — 담당자 배정의 참조 대상' },
  { table: 'requirements', why: '요구사항 — 추적성(요구-업무-테스트)의 출발점' },
  { table: 'tasks', why: '업무(WBS) — 일정·진척의 본체' },
  { table: 'issues', why: '이슈 — 고객 접점 이력이라 유실이 바로 드러난다' },
  { table: 'risks', why: '리스크 — 대응 이력이 사라지면 재작성이 불가능하다' },
  { table: 'documents', why: '산출물 — 승인 이력이 붙어 있어 재생성할 수 없다' },
  { table: 'audit_log', why: '감사 이력 — 사후 조사·법적 보존 대상이라 재생성이 불가능하다' },
];

export const CORE_TABLES: readonly string[] = CORE_TABLE_ROLES.map((r) => r.table);

/** 왜 이 테이블을 보는지(화면·문서에 그대로 쓸 수 있는 설명). 모르는 이름은 null */
export function coreTableReason(table: unknown): string | null {
  const t = String(table ?? '').trim().toLowerCase();
  return CORE_TABLE_ROLES.find((r) => r.table === t)?.why ?? null;
}

/* ───────────────────────────── 조회 SQL 조립 ───────────────────────────── */

/** SQL 에 넣어도 되는 식별자(소문자·숫자·밑줄). 따옴표·공백·마이너스 전부 거부 */
export const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;

export function isSafeIdentifier(name: unknown): boolean {
  return typeof name === 'string' && name.length <= 63 && IDENTIFIER_RE.test(name);
}

/**
 * 핵심 테이블 행 수 조회 SQL — **읽기 전용**(`select` + `count(*)` 뿐이다).
 * 테이블 이름은 `isSafeIdentifier` 를 통과한 것만 넣고, 하나라도 어긋나면 던진다
 * (조립 실패를 조용히 빈 SQL 로 바꾸면 "0건"처럼 보이게 되므로 반드시 드러낸다).
 * 존재하지 않는 테이블을 넣으면 조회 전체가 실패하므로, 호출부가 실존 목록으로 걸러서 넘긴다.
 */
export function coreCountSql(tables: readonly string[]): string {
  const list = [...new Set((tables ?? []).map((t) => String(t ?? '').trim().toLowerCase()))].filter(Boolean).sort();
  if (list.length === 0) throw new Error('coreCountSql: 대상 테이블이 없다');
  const bad = list.filter((t) => !isSafeIdentifier(t));
  if (bad.length) throw new Error(`coreCountSql: 허용되지 않는 식별자 — ${bad.join(', ')}`);
  return list.map((t) => `select '${t}' as t, count(*)::int as n from "${t}"`).join(' union all ');
}

/** 결과 행에서 테이블 이름이 담겨 오는 컬럼 */
const T_KEYS = ['t', 'T'];
/** 결과 행에서 행 수가 담겨 오는 컬럼 */
const N_KEYS = ['n', 'N'];

function pick(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return row[k];
  return undefined;
}

/** 드라이버마다 숫자/문자열로 오는 count 값을 **엄격히** 정수로. 판독 불가면 null(추측하지 않는다) */
export function parseCount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 ? raw : null;
  if (typeof raw === 'bigint') return raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    return /^\d{1,15}$/.test(s) ? Number(s) : null;
  }
  return null;
}

/**
 * `coreCountSql` 결과 행 → `{ 테이블: 행수 }`.
 * 테이블 이름이나 행 수를 판독하지 못한 행은 **버린다** — 그 테이블은 호출부에서 `unreadable` 로 드러난다.
 */
export function countsFrom(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows ?? []) {
    if (!row || typeof row !== 'object') continue;
    const t = pick(row, T_KEYS);
    if (typeof t !== 'string') continue;
    const name = normalizeTableNames([t])[0];
    if (!name) continue;
    const n = parseCount(pick(row, N_KEYS));
    if (n === null) continue;
    out[name] = n;
  }
  return out;
}

/* ───────────────────────────── 기준 스냅샷 ───────────────────────────── */

export interface CountBaseline {
  /** 스냅샷을 뜬 날짜(YYYY-MM-DD). 판독 불가면 null — 비교는 하되 「언제 기준인지 모름」을 드러낸다 */
  asOf: string | null;
  counts: Record<string, number>;
  /** 해석하지 못한 토큰(형식 오류·음수·비정수). 조용히 버리지 않고 보고한다 */
  invalid: string[];
}

/**
 * 기준 스냅샷 파싱. 두 형식만 인정한다.
 *   1) JSON — `{"asOf":"2026-10-01","counts":{"users":12,"projects":3}}`
 *   2) 간단 표기 — `asOf=2026-10-01,users=12,projects=3`
 * 값은 0 이상 정수만. 테이블 이름은 식별자 규칙을 통과해야 한다.
 * 쓸 수 있는 항목이 하나도 없으면 null(= 기준 없음)로 돌린다 — 빈 기준치로 `ok` 를 만들지 않는다.
 */
export function parseCountBaseline(raw: unknown): CountBaseline | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const counts: Record<string, number> = {};
  const invalid: string[] = [];
  let asOf: string | null = null;

  const put = (key: unknown, value: unknown, token: string) => {
    const name = String(key ?? '').trim().toLowerCase();
    const n = parseCount(value);
    if (!isSafeIdentifier(name) || n === null) { invalid.push(token); return; }
    counts[name] = n;
  };

  if (text.startsWith('{')) {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { asOf: null, counts: {}, invalid: ['json'] }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { asOf: null, counts: {}, invalid: ['json'] };
    const obj = parsed as Record<string, unknown>;
    asOf = parseRehearsalDate(obj.asOf);
    if (obj.asOf !== undefined && asOf === null) invalid.push('asOf');
    const src = obj.counts && typeof obj.counts === 'object' && !Array.isArray(obj.counts)
      ? (obj.counts as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(src)) put(k, v, k);
  } else {
    for (const part of text.split(/[,\n;]/)) {
      const token = part.trim();
      if (!token) continue;
      const eq = token.indexOf('=');
      if (eq < 0) { invalid.push(token); continue; }
      const key = token.slice(0, eq).trim();
      const value = token.slice(eq + 1).trim();
      if (key.toLowerCase() === 'asof') {
        asOf = parseRehearsalDate(value);
        if (asOf === null) invalid.push(token);
        continue;
      }
      put(key, value, token);
    }
  }

  if (Object.keys(counts).length === 0) return invalid.length ? { asOf, counts, invalid } : null;
  return { asOf, counts, invalid };
}

/** env 스냅샷. `RECOVERY_DATA_BASELINE` 만 인정한다(미설정이면 기준 없음 → 판정 보류) */
export function baselineFromEnv(env: Record<string, string | undefined> = process.env): CountBaseline | null {
  return parseCountBaseline(env.RECOVERY_DATA_BASELINE);
}

/**
 * 신선도 판정에 넘길 요약 — **기준일과 테이블 수만** 담는다(행 수는 넘기지 않는다).
 * 공개 `/api/health` 로도 나가는 값이라 수치 노출면을 좁혀 둔다.
 */
export function baselineStamp(baseline: CountBaseline | null): BaselineStamp | null {
  if (!baseline) return null;
  return { asOf: baseline.asOf, tables: Object.keys(baseline.counts).length };
}

/**
 * 다음 점검에 쓸 스냅샷 한 줄 — `RECOVERY_DATA_BASELINE` 에 **그대로 붙여 넣을 수 있는** 형식.
 * 이것은 「사람이 채우는 RUNBOOK 표」를 자동으로 채우는 게 아니라, 사람이 복사할 문자열을 주는 것이다.
 * `asOf` 가 실존 날짜가 아니면 **날짜를 지어내지 않고 생략**한다.
 */
export function snapshotLine(counts: Record<string, number>, asOf?: unknown): string {
  const day = parseRehearsalDate(asOf);
  const parts = day ? [`asOf=${day}`] : [];
  for (const table of Object.keys(counts ?? {}).sort()) {
    const n = parseCount(counts[table]);
    if (isSafeIdentifier(table) && n !== null) parts.push(`${table}=${n}`);
  }
  return parts.join(',');
}

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * `stale`·`undated` 는 **DB 가 아니라 기준치가 자격을 잃은** 상태다.
 * 수치는 기준치 이상이지만 그 기준치가 「손상 전」인지 알 수 없어 `ok` 로 올리지 않는다.
 */
export type DataVerdict = 'ok' | 'short' | 'empty' | 'incomplete' | 'no_baseline' | 'stale' | 'undated' | 'unverified';
export type CountState = 'ok' | 'short' | 'zero' | 'missing' | 'unreadable' | 'unjudged';

export interface CountRow {
  table: string;
  baseline: number | null;
  actual: number | null;
  /** actual - baseline. 둘 중 하나라도 없으면 null */
  delta: number | null;
  state: CountState;
}

export const ACTION_DATA_UNVERIFIED =
  '행 수를 조회하지 못해 검증하지 못했다 — "데이터 없음"이 아니라 "확인 못 함"이다. DB 연결·권한을 확인하고 다시 실행할 것';
export const ACTION_DATA_INCOMPLETE =
  '핵심 테이블이 DB 에 없다 — 스키마부터 복원해야 한다. RUNBOOK §3-1 의 베이스라인 DDL 적용 후 다시 실행할 것';
export const ACTION_DATA_EMPTY =
  '테이블은 있으나 핵심 테이블이 전부 0건이다 — 스키마만 만들어졌고 데이터는 복원되지 않았다. 전환하지 말 것(RUNBOOK §3 4단계)';
export const ACTION_DATA_SHORT =
  '기준 스냅샷보다 적은 테이블이 있다 — 정상 삭제분인지 유실인지 확인한 뒤에만 전환할 것(RUNBOOK §3 4단계)';
export const ACTION_DATA_NO_BASELINE =
  '기준 스냅샷(RECOVERY_DATA_BASELINE)이 없거나 핵심 테이블을 덜 덮어 대조하지 못했다 — 전환하지 말 것(uncovered 참고). ' +
  'snapshot 값은 **정상 운영 중**(RUNBOOK §2 월 점검)에만 기준치로 넣는다 — 복구 검증 중에 넣으면 복구 대상 DB 를 자기 자신과 비교하게 된다';

/** `ok` 가 무엇을 보장하지 **않는지**. 응답·로그에 함께 내보내 과신을 막는다 */
export const DATA_CAVEAT =
  'ok 는 「기준 스냅샷(asOf) 시점 이상의 행 수」까지만 뜻한다. 스냅샷 이후에 생긴 행의 유실은 이 점검으로 알 수 없다(RPO 구간). short 는 유실 확정이 아니라 확인 필요다 — 정상 삭제로도 줄어든다.';

export interface DataVerification {
  verdict: DataVerdict;
  /** 검증을 통과했을 때만 true. `no_baseline`·`unverified` 는 "모른다"이므로 false */
  ok: boolean;
  /** 기준 스냅샷 기준일(없으면 null) */
  asOf: string | null;
  rows: CountRow[];
  /** 기준치보다 적은 테이블 */
  shortfalls: { table: string; baseline: number; actual: number; missing: number }[];
  /** DB 에 아예 없는 핵심 테이블 */
  missingTables: string[];
  /** 있는데 행 수를 판독하지 못한 테이블 */
  unreadable: string[];
  /** 기준 스냅샷에만 있고 핵심 목록에 없는 이름(무시하되 알린다) */
  unknownInBaseline: string[];
  /** 기준 스냅샷이 **덮지 않은** 핵심 테이블 — 이 테이블들은 대조 자체가 되지 않았다 */
  uncovered: string[];
  /** 스냅샷에서 해석하지 못한 토큰 */
  invalidBaseline: string[];
  /** 판독된 행 수 합계(조회 실패 시 null) */
  totalRows: number | null;
  /** 기준 스냅샷의 신선도 — 낡거나 날짜 없는 기준치는 `ok` 를 만들지 못한다 */
  age: BaselineAge;
  action: string | null;
  caveat: string;
  /** `RECOVERY_DATA_BASELINE` 에 붙여 넣을 현재 스냅샷(조회 실패 시 null) */
  snapshot: string | null;
  /** 위 `snapshot` 을 기준치로 채택해도 되는 조건 — 복구일에 덮어쓰는 사고를 막는다 */
  snapshotUse: { adopt: SnapshotAdoption; note: string };
}

/**
 * 핵심 테이블 행 수 ↔ 기준 스냅샷 대조.
 * - `counts: null` = 조회 실패 → `unverified`("없다"로 단정하지 않는다)
 * - `present: null` = 실존 테이블 목록을 모름 → 없는 테이블을 `missing` 으로 단정하지 않고 `unreadable` 로 남긴다
 */
export function verifyRowCounts(input: {
  counts: Record<string, number> | null;
  present?: readonly string[] | null;
  baseline?: CountBaseline | null;
  tables?: readonly string[];
  /** snapshot 문자열의 기준일 + 스냅샷 신선도 판정의 기준 시각 */
  now?: Date;
  /**
   * 스냅샷 갱신 기한(일). 호출부가 `baselineMaxAgeDays(env)` 로 읽어 넘긴다.
   * 넘기지 않으면 낡음 판정을 **보류**한다(임의 주기를 만들지 않는다).
   */
  maxAgeDays?: number | null;
}): DataVerification {
  const tables = normalizeTableNames(input.tables ?? CORE_TABLES);
  const baseline = input.baseline ?? null;
  const present = input.present == null ? null : new Set(normalizeTableNames(input.present));
  const age = assessBaselineAge({
    stamp: baselineStamp(baseline),
    now: input.now,
    maxAgeDays: input.maxAgeDays ?? null,
  });
  const base = {
    asOf: baseline?.asOf ?? null,
    invalidBaseline: baseline?.invalid ?? [],
    unknownInBaseline: baseline
      ? Object.keys(baseline.counts).filter((t) => !tables.includes(t)).sort()
      : [],
    uncovered: baseline
      ? tables.filter((t) => !Object.prototype.hasOwnProperty.call(baseline.counts, t))
      : [...tables],
    age,
    caveat: DATA_CAVEAT,
  };

  if (input.counts === null) {
    return {
      ...base, verdict: 'unverified', ok: false, rows: [], shortfalls: [],
      missingTables: [], unreadable: [...tables], totalRows: null,
      action: ACTION_DATA_UNVERIFIED, snapshot: null,
      snapshotUse: snapshotAdoption('unverified'),
    };
  }

  const counts = input.counts ?? {};
  const rows: CountRow[] = [];
  const shortfalls: DataVerification['shortfalls'] = [];
  const missingTables: string[] = [];
  const unreadable: string[] = [];
  let totalRows = 0;
  let counted = 0;
  let zeros = 0;
  let unjudged = 0;

  for (const table of tables) {
    const b = baseline && Object.prototype.hasOwnProperty.call(baseline.counts, table) ? baseline.counts[table] : null;
    const actual = Object.prototype.hasOwnProperty.call(counts, table) ? parseCount(counts[table]) : null;

    if (actual === null) {
      const gone = present !== null && !present.has(table);
      if (gone) missingTables.push(table); else unreadable.push(table);
      rows.push({ table, baseline: b, actual: null, delta: null, state: gone ? 'missing' : 'unreadable' });
      continue;
    }

    counted++;
    totalRows += actual;
    if (actual === 0) zeros++;
    let state: CountState;
    // 기준치가 없는 테이블은 **행 수가 0이어도** 판정되지 않은 것이다.
    // 예전에는 0건을 'zero' 로만 적고 미판정에서 빼서, 기준 스냅샷이 일부 테이블만 덮으면
    // 「11개 테이블이 전부 비었는데 ok」가 나왔다(empty 는 전건 0일 때만 걸리므로).
    if (b === null) { state = 'unjudged'; unjudged++; }
    else if (actual < b) { state = 'short'; shortfalls.push({ table, baseline: b, actual, missing: b - actual }); }
    else state = actual === 0 ? 'zero' : 'ok';
    rows.push({ table, baseline: b, actual, delta: b === null ? null : actual - b, state });
  }
  shortfalls.sort((a, b) => a.table.localeCompare(b.table));

  const snapshot = snapshotLine(
    Object.fromEntries(rows.filter((r) => r.actual !== null).map((r) => [r.table, r.actual as number])),
    isoDay(input.now ?? new Date()),
  );
  const common = {
    ...base, rows, shortfalls, missingTables, unreadable,
    totalRows, snapshot: snapshot || null,
  };

  const out = (verdict: DataVerdict, action: string | null): DataVerification =>
    ({ ...common, verdict, ok: verdict === 'ok', action, snapshotUse: snapshotAdoption(verdict) });

  // 순서가 뜻을 만든다 — 더 심각한 판정을 기준치 문제로 덮지 않는다.
  if (missingTables.length) return out('incomplete', ACTION_DATA_INCOMPLETE);
  if (counted === 0) return out('unverified', ACTION_DATA_UNVERIFIED);
  if (zeros === counted) return out('empty', ACTION_DATA_EMPTY);
  if (shortfalls.length) return out('short', ACTION_DATA_SHORT);
  if (!baseline || unjudged > 0) return out('no_baseline', ACTION_DATA_NO_BASELINE);
  // 수치는 기준치 이상이다. 그 기준치를 「손상 전」으로 믿을 수 있는지가 마지막 관문이다.
  if (age.status === 'stale') return out('stale', age.action);
  if (age.status === 'undated' || age.status === 'future') return out('undated', age.action);
  return out('ok', null);
}

function isoDay(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/* ───────────────────────────── 스키마 + 데이터 합산 ───────────────────────────── */

export const ACTION_SWITCH_READY =
  '스키마·행 수 모두 기준을 넘었다 — RUNBOOK §3 5단계(운영 DATABASE_URL 전환)로 진행할 수 있다';

export interface RecoveryVerification {
  schema: SchemaVerification;
  data: DataVerification;
  /** 전환(§3 5단계)해도 되는가 — **둘 다** ok 일 때만 true */
  switchReady: boolean;
  /** 다음에 할 일 한 줄. 스키마가 먼저다(스키마가 깨져 있으면 행 수는 의미가 없다) */
  action: string;
  caveat: string;
}

export function recoveryVerification(schema: SchemaVerification, data: DataVerification): RecoveryVerification {
  const switchReady = schema.ok && data.ok;
  return {
    schema,
    data,
    switchReady,
    action: switchReady
      ? ACTION_SWITCH_READY
      : (schema.action || data.action || ACTION_DATA_UNVERIFIED),
    caveat: DATA_CAVEAT,
  };
}

/** 로그 한 줄. 테이블 이름과 개수만 — 행 내용·연결문자열은 담지 않는다 */
export function recoveryVerifyLogLine(v: RecoveryVerification): string {
  const parts = [
    `schema=${v.schema.verdict}`,
    `tables=${v.schema.present}/${v.schema.expected}`,
    `data=${v.data.verdict}`,
    `rows=${v.data.totalRows ?? '?'}`,
    `switch_ready=${v.switchReady}`,
  ];
  parts.push(baselineAgeLine(v.data.age));
  if (v.data.uncovered.length) parts.push(`uncovered=${v.data.uncovered.join('|')}`);
  if (v.data.shortfalls.length) parts.push(`short=${v.data.shortfalls.map((s) => s.table).join('|')}`);
  if (v.data.missingTables.length) parts.push(`missing=${v.data.missingTables.join('|')}`);
  if (v.data.unreadable.length) parts.push(`unreadable=${v.data.unreadable.length}`);
  return parts.join(' ');
}

/**
 * `/api/health` 용 복구 준비도 체크 — 리허설 신선도(`lib/recovery.ts`)에 **기준 스냅샷
 * 신선도**를 더한다. RUNBOOK §2 는 스냅샷을 월 1회 갱신하라고 지시하지만 그 갱신이 빠진 것을
 * 알려 주는 장치가 없었고, 낡은 스냅샷은 복구일에 조용히 `ok` 를 만든다.
 *
 * **required: false** — 리허설·스냅샷 문제로 서비스를 down(503) 처리하지 않는다(degraded 200).
 * 공개 엔드포인트라 **행 수는 담지 않는다** — 기준일·경과일수·덮은 테이블 수뿐이다.
 */
export function recoveryReadinessCheck(args?: {
  env?: Record<string, string | undefined>;
  now?: Date;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const rehearsal = recoveryCheck({ env, now: args?.now });
  const age = assessBaselineAge({
    stamp: baselineStamp(baselineFromEnv(env)),
    now: args?.now,
    maxAgeDays: baselineMaxAgeDays(env),
  });
  return {
    ok: rehearsal.ok && age.trusted,
    required: false,
    detail: { ...rehearsal.detail, baseline: age },
  };
}

/** 설정 상태 요약(화면·문서용) */
export function recoveryVerifyStatus(baseline: CountBaseline | null): {
  coreTables: number;
  baselineConfigured: boolean;
  baselineAsOf: string | null;
  baselineTables: number;
  note: string;
} {
  return {
    coreTables: CORE_TABLES.length,
    baselineConfigured: !!baseline && Object.keys(baseline.counts).length > 0,
    baselineAsOf: baseline?.asOf ?? null,
    baselineTables: baseline ? Object.keys(baseline.counts).length : 0,
    note: baseline && Object.keys(baseline.counts).length > 0
      ? '기준 스냅샷이 설정되어 있다 — 복구 후 행 수를 기계적으로 대조한다'
      : '기준 스냅샷이 없다 — 복구 후 행 수를 대조할 수 없다(RUNBOOK §2 에서 설정한다)',
  };
}
