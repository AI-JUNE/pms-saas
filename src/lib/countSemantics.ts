/**
 * countSemantics.ts — 행 수 대조가 **테이블마다 다른 뜻**이라는 사실(RUNBOOK §3 4단계·§3-11). 2026-10-22
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 4단계는 핵심 테이블의 행 수를 기준 스냅샷과 대조하고, 그 판정이 §3 5단계 전환의 게이트
 * (`switchReady`)다. 그런데 그 대조는 테이블 **전체를 한 규칙으로** 본다 — 「기준치 이상이면 ok,
 * 적으면 `short`(= 유실 확정이 아니라 확인 필요다. **정상 삭제로도 줄어든다**)」. 그 한 문장이
 * 응답·로그·RUNBOOK 에 그대로 적혀 있었는데, 핵심 테이블 가운데 그 말이 맞는 것은 일부뿐이다.
 *
 *  (1) **`audit_log` 에서 그 설명은 거짓이다.** 이 앱은 감사 행을 **지우지 않는다** —
 *      `lib/audit.ts` 는 insert 만 하고, 조회는 `/api/audit`·`/api/admin/security-events` 뿐이며,
 *      `AUDIT_RETENTION_DAYS` 는 레지스트리에 「**자동 삭제는 없다**」로 적혀 있다. 그러니 이
 *      테이블이 기준치보다 적다는 것은 「정상 삭제」로 설명될 수 없는 사실이고, 하필 §3-5 가
 *      「복구가 되돌리기 전에 DB 밖으로 내보내라」고 지시한 **조사 근거 자신**이다. 가장 단단한
 *      증거가 가장 약한 문장으로 설명되고 있었다 — 담당자는 그 `short` 를 보고 「감소분을 설명할
 *      수 있으면 전환」(4단계 지시)으로 넘어간다.
 *
 *  (2) **앱이 지우지 않는 테이블과 사용자가 지우는 테이블이 섞여 있었다.** `users`·`organizations`·
 *      `memberships` 에는 소스 어디에도 삭제 구문이 없다(관리 화면은 역할·활성 상태만 바꾼다).
 *      줄었다면 **앱 밖에서 일어난 일**(DB 직접 접속·수동 정리 — §3-3 `FREEZE_LIMITS` 가 막지
 *      못한다고 적어 둔 그 경로)이다. 「정상 삭제로도 줄어든다」는 설명은 설정기반 CRUD 로
 *      사용자가 지울 수 있는 여덟 개와 첨부에만 맞는다.
 *
 *  (3) **`attachments` 는 아예 세지 않았다.** §1-1 이 2026-10-16 에 그 사실을 스스로 적어 두었다 —
 *      핵심 테이블에 `attachments` 가 없어서 첨부 메타 행이 통째로 비어도 대조는 `ok` 이고, 6단계는
 *      테이블 존재만 본다. 첨부는 `documents`·`issues` 에 달리는데 **부모만** 세고 있었고,
 *      `attachments` 는 부모를 FK 로 참조하지 않으므로(`entity`·`entity_id` 소프트 참조) 부모 행 수는
 *      첨부에 대해 **아무 말도 하지 않는다**. 본문은 처음부터 보관되지 않으니(§1-1) 그 목록이
 *      첨부에 관해 남아 있는 전부다.
 *
 *  (4) **그래서 「세기 시작하면」 새 거짓이 생긴다.** 첨부를 핵심 테이블에 넣으면 응답에
 *      `attachments: ok` 가 나오는데, §1 표·§1-1 은 「첨부가 복구된다」를 고지에 넣지 말라고
 *      지시한다 — 돌아오는 것은 **목록**이다. 행 수만 보는 판정에 그 사실을 함께 달지 않으면
 *      사각지대를 메우면서 더 조용한 오해를 만든다.
 *
 * 그래서 이 모듈은
 *   · 핵심 테이블의 **삭제 가능성을 정본 목록**으로 두고(`TABLE_SEMANTICS` — 삭제 경로 ·
 *     그 선언의 근거 · 줄었을 때의 뜻 · 행이 돌아와도 복구되지 않는 것),
 *   · `short` 를 **테이블마다 다르게 판정하고**(`shrinkMeaning` → `confirmed_loss`/`out_of_band`/
 *     `needs_check`/`unknown`. 모르는 이름은 추측하지 않는다),
 *   · 정상 운영으로 **설명되지 않는** 감소분을 따로 모으고(`classifyShortfalls().unexplained`),
 *   · 그 선언이 거짓이 되는 변경을 **CI 에서 실패시킨다**(`auditAppendOnlyClaim` — 감사로그 삭제
 *     구문이 생기면, `auditCrudDeletePaths` — CRUD 등록이 사라지면),
 *   · 이 판정이 보장하지 **못하는** 것을 `SEMANTICS_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근, **신규 조회·쓰기·DDL 0 · 신규 env 0**.
 *   핵심 테이블 목록은 **인자로 받는다**(`lib/recoveryVerify.ts` 가 이 모듈을 쓰므로 반대 방향
 *   import 를 만들지 않는다 — 양방향 대조는 정적 점검이 한다).
 * - **임의 분류 금지**: 소스에서 확인한 사실만 적고, 모르는 테이블은 `unknown` 으로 남긴다
 *   (`needs_check` 로 올리지 않는다 — 「확인 필요」도 하나의 판정이다).
 * - **새 거짓 ok 를 만들지 않는다**: 첨부를 세기 시작했다는 것이 「첨부가 복구된다」는 뜻이 아니다.
 */

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const COUNT_RUNBOOK_REF = 'RUNBOOK §3 4단계·§3-11';

/* ──────────────────────── 삭제 가능성(정본) ──────────────────────── */

/**
 * - `append_only` — 앱이 지우지 않고, **지우면 안 되는** 보존 대상이다
 * - `operator_only` — 앱에 삭제 경로가 없다(줄었다면 앱 밖에서 일어난 일이다)
 * - `user_deletable` — 사용자가 화면·API 로 지울 수 있다
 * - `unknown` — 정본에 없는 이름. **추측하지 않는다**
 */
export type Mutability = 'append_only' | 'operator_only' | 'user_deletable' | 'unknown';

/** 기준치보다 적을 때 그것이 뜻하는 것 */
export type ShrinkMeaning = 'confirmed_loss' | 'out_of_band' | 'needs_check' | 'unknown';

/** 앱 안에서 행이 지워지는 경로의 모양 — 정적 점검이 이 값으로 대조 대상을 고른다 */
export type DeleteVia = 'none' | 'crud' | 'route';

export interface TableSemantics {
  table: string;
  /** drizzle 선언 이름(`configs.ts`·소스 원문 대조에 쓴다) */
  model: string;
  mutability: Mutability;
  deleteVia: DeleteVia;
  /** 앱 안에서 행이 지워지는 경로 — 없으면 null(지어내지 않는다) */
  deletePath: string | null;
  /** 이 선언의 근거(소스에서 확인한 사실) */
  evidence: string;
  /** 행이 돌아와도 복구되지 **않는** 것 — 없으면 null */
  bodyOutside: string | null;
}

const CRUD = (table: string, model: string, what: string): TableSemantics => ({
  table,
  model,
  mutability: 'user_deletable',
  deleteVia: 'crud',
  deletePath: `설정기반 CRUD 의 DELETE(\`lib/configs.ts\` 의 \`${model}\` 자원)`,
  evidence: `${what} — 사용자가 화면에서 지울 수 있으므로 감소가 정상 운영의 결과일 수 있다`,
  bodyOutside: null,
});

export const TABLE_SEMANTICS: readonly TableSemantics[] = [
  {
    table: 'audit_log',
    model: 'auditLog',
    mutability: 'append_only',
    deleteVia: 'none',
    deletePath: null,
    evidence:
      '`lib/audit.ts` 는 insert 만 하고 조회는 `/api/audit`·`/api/admin/security-events` 뿐이다. ' +
      '`AUDIT_RETENTION_DAYS` 는 보존 일수를 적어 두기만 하고 **자동 삭제는 없다**(레지스트리 주석). ' +
      '게다가 §3-5 가 전환 전 보존을 지시하는 **조사 근거 자신**이고 §1 표의 법적 보존 대상이다',
    bodyOutside: null,
  },
  {
    table: 'users',
    model: 'users',
    mutability: 'operator_only',
    deleteVia: 'none',
    deletePath: null,
    evidence:
      '소스에 이 테이블의 삭제 구문이 없다 — `/api/admin/users` 는 PATCH 로 역할·활성 상태만 바꾼다. ' +
      '줄었다면 DB 직접 접속·수동 정리처럼 **앱 밖에서 일어난 일**이다(§3-3 `FREEZE_LIMITS`)',
    bodyOutside: null,
  },
  {
    table: 'organizations',
    model: 'organizations',
    mutability: 'operator_only',
    deleteVia: 'none',
    deletePath: null,
    evidence: '소스에 이 테이블의 삭제 구문이 없다 — 테넌트 루트는 화면에서 지워지지 않는다(해지는 플랜 변경이다)',
    bodyOutside: null,
  },
  {
    table: 'memberships',
    model: 'memberships',
    mutability: 'operator_only',
    deleteVia: 'none',
    deletePath: null,
    evidence: '소스에 이 테이블의 삭제 구문이 없다 — 소속은 추가·역할 변경만 있다',
    bodyOutside: null,
  },
  CRUD('projects', 'projects', '프로젝트'),
  CRUD('phases', 'phases', '단계'),
  CRUD('members', 'members', '프로젝트 인력'),
  CRUD('requirements', 'requirements', '요구사항'),
  CRUD('tasks', 'tasks', '업무(WBS)'),
  CRUD('issues', 'issues', '이슈'),
  CRUD('risks', 'risks', '리스크'),
  CRUD('documents', 'documents', '산출물'),
  {
    table: 'attachments',
    model: 'attachments',
    mutability: 'user_deletable',
    deleteVia: 'route',
    deletePath: '`DELETE /api/attachments/[id]`',
    evidence: '첨부 메타 행은 업로더·관리자가 화면에서 지울 수 있다 — 감소가 정상 운영의 결과일 수 있다',
    bodyOutside:
      '행이 돌아와도 **파일 본문은 돌아오지 않는다** — 처음부터 어디에도 보관되지 않았다(`status=metadata_only`, §1-1). ' +
      '이 테이블의 `ok` 를 「첨부가 복구됐다」로 읽지 않는다. 돌아오는 것은 목록이다',
  },
];

/** 모르는 이름은 null — 지어내지 않는다 */
export function semanticsFor(table: unknown): TableSemantics | null {
  const t = String(table ?? '').trim().toLowerCase();
  return TABLE_SEMANTICS.find((s) => s.table === t) ?? null;
}

export function mutabilityOf(table: unknown): Mutability {
  return semanticsFor(table)?.mutability ?? 'unknown';
}

/* ──────────────────────────── 판정 ──────────────────────────── */

const MEANING_BY_MUTABILITY: Record<Mutability, ShrinkMeaning> = {
  append_only: 'confirmed_loss',
  operator_only: 'out_of_band',
  user_deletable: 'needs_check',
  unknown: 'unknown',
};

export const SHRINK_NOTES: Record<ShrinkMeaning, { meaning: string; action: string }> = {
  confirmed_loss: {
    meaning: '앱이 지우지 않고 지워서도 안 되는 테이블이 줄었다 — 「정상 삭제」로 설명되지 않는다',
    action: '유실로 다룬다. §3-5 로 보존한 사본과 대조해 구간을 확정하고, 설명되기 전에는 전환하지 않는다',
  },
  out_of_band: {
    meaning: '앱에 삭제 경로가 없는 테이블이 줄었다 — 줄인 주체가 **앱 밖**에 있다',
    action: '앱 밖 작업(DB 직접 접속·수동 정리)의 기록을 찾는다. 찾지 못하면 유실로 다룬다',
  },
  needs_check: {
    meaning: '사용자가 지울 수 있는 테이블이 줄었다 — 유실 확정이 아니라 확인 필요다',
    action: '감사로그에서 그 구간의 삭제 이력을 찾아 감소분을 설명한다(설명되면 전환해도 된다)',
  },
  unknown: {
    meaning: '정본에 없는 테이블이라 감소의 뜻을 판정하지 않았다 — **통과가 아니다**',
    action: `\`TABLE_SEMANTICS\` 에 삭제 경로와 근거를 적고 다시 판정한다(${COUNT_RUNBOOK_REF})`,
  },
};

export function shrinkMeaning(table: unknown): ShrinkMeaning {
  return MEANING_BY_MUTABILITY[mutabilityOf(table)];
}

/** 한 테이블의 감소를 사람이 읽는 한 줄로. 모르는 이름도 「모른다」고 적는다 */
export function shrinkNote(table: unknown): string {
  const name = String(table ?? '').trim().toLowerCase() || '(이름 없음)';
  const m = shrinkMeaning(table);
  return `${name}: ${SHRINK_NOTES[m].meaning} → ${SHRINK_NOTES[m].action}`;
}

export interface ShrinkRow {
  table: string;
  mutability: Mutability;
  severity: ShrinkMeaning;
  meaning: string;
  action: string;
}

/** 감소한 테이블마다 뜻을 붙인다(행 수·기준치는 호출부가 들고 있다 — 여기서는 이름만 본다) */
export function shrinkRows(tables: readonly (string | { table: string })[]): ShrinkRow[] {
  const names = (tables ?? []).map((t) => (typeof t === 'string' ? t : t?.table));
  const out: ShrinkRow[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const table = String(raw ?? '').trim().toLowerCase();
    if (!table || seen.has(table)) continue;
    seen.add(table);
    const severity = shrinkMeaning(table);
    out.push({
      table,
      mutability: mutabilityOf(table),
      severity,
      meaning: SHRINK_NOTES[severity].meaning,
      action: SHRINK_NOTES[severity].action,
    });
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

export interface ShrinkClassification {
  rows: ShrinkRow[];
  confirmedLoss: string[];
  outOfBand: string[];
  needsCheck: string[];
  unknown: string[];
  /**
   * **정상 운영으로 설명되지 않는** 감소분(`confirmed_loss` ∪ `out_of_band` ∪ `unknown`).
   * 합집합으로 두는 이유: 하나만 보면 나머지가 「확인 필요」에 섞여 같은 문장으로 읽힌다.
   */
  unexplained: string[];
}

export function classifyShortfalls(tables: readonly (string | { table: string })[]): ShrinkClassification {
  const rows = shrinkRows(tables);
  const of = (s: ShrinkMeaning) => rows.filter((r) => r.severity === s).map((r) => r.table);
  const confirmedLoss = of('confirmed_loss');
  const outOfBand = of('out_of_band');
  const unknown = of('unknown');
  return {
    rows,
    confirmedLoss,
    outOfBand,
    needsCheck: of('needs_check'),
    unknown,
    unexplained: [...confirmedLoss, ...outOfBand, ...unknown].sort(),
  };
}

/** 대조에 들어온 테이블 가운데 **행이 돌아와도 복구되지 않는 것**이 있으면 그 사실을 함께 낸다 */
export function bodyOutsideCaveats(tables: readonly string[]): string[] {
  const set = new Set((tables ?? []).map((t) => String(t ?? '').trim().toLowerCase()));
  return TABLE_SEMANTICS.filter((s) => s.bodyOutside && set.has(s.table)).map((s) => `${s.table}: ${s.bodyOutside}`);
}

/* ─────────────────── 거짓이 되는 판정 ─────────────────── */

export interface CountMisread {
  key: string;
  verdict: string;
  /** 그 판정이 하는 말 */
  says: string;
  /** 왜 거짓인가 */
  why: string;
}

export const COUNT_MISREADS: readonly CountMisread[] = [
  {
    key: 'audit_shrink_as_normal',
    verdict: 'short (audit_log)',
    says: '「유실 확정이 아니다 — 정상 삭제로도 줄어든다」',
    why: '이 앱은 감사 행을 지우지 않는다(자동 삭제 없음). 줄었다면 §3-5 가 보존하라고 한 **조사 근거가 사라진 것**이다',
  },
  {
    key: 'operator_shrink_as_normal',
    verdict: 'short (users·organizations·memberships)',
    says: '같은 문장 — 「정상 삭제로도 줄어든다」',
    why: '소스에 삭제 경로가 없다. 줄인 주체는 앱 밖에 있고, 그 작업은 감사로그에도 남지 않는다',
  },
  {
    key: 'attachments_uncounted',
    verdict: 'ok (첨부 미포함)',
    says: '「핵심 테이블이 전부 기준치 이상이다」',
    why: '2026-10-22 전까지 `attachments` 는 세지 않았다 — 첨부 목록이 통째로 비어도 이 판정은 `ok` 였다(§1-1)',
  },
  {
    key: 'attachments_ok_as_restored',
    verdict: 'ok (attachments)',
    says: '「첨부가 복구됐다」',
    why: '행 수는 **목록**에 대한 말이다. 본문은 처음부터 보관되지 않아 복구 대상이 아니다(§1-1 — 고지에 넣지 않는다)',
  },
];

/* ──────────────────────── 보장하지 못하는 것 ──────────────────────── */

export const SEMANTICS_LIMITS: readonly string[] = [
  '이 판정은 **감소의 뜻**까지만 말한다 — 줄어든 행이 무엇이었는지, 누가 지웠는지는 말하지 않는다(그것은 §3-5 감사로그가 본다)',
  '`needs_check` 는 「정상일 수 있다」는 뜻이지 **「정상이다」가 아니다** — 감소분을 설명하지 못하면 유실로 다룬다',
  '`confirmed_loss`·`out_of_band` 도 **행 수가 줄었을 때만** 나온다 — 같은 수의 행이 **변조**됐으면 어느 판정도 걸리지 않는다(§3 3단계 ε 가 작을 때의 그 구멍이다)',
  '삭제 경로 선언은 **소스에서 확인한 사실**이지만, 같은 DB 를 쓰는 다른 배포·마이그레이션·수동 작업은 코드에 없다',
  '`attachments` 를 세기 시작했다는 것이 「첨부가 복구된다」는 뜻이 아니다 — 돌아오는 것은 목록이고 본문은 보관되지 않는다(§1-1)',
  '기준 스냅샷이 덮지 않은 테이블은 이 판정에 **들어오지도 않는다**(`uncovered`) — 첨부를 더한 날의 기존 스냅샷이 그렇다(§2 월 점검에서 갱신한다)',
  '분류는 **테이블 단위**다 — 한 테이블 안에서 조직별·프로젝트별로 어디가 비었는지는 말하지 않는다(응답이 전 테넌트 합계다)',
];

/* ───────────────────────── 출력(사람·로그) ───────────────────────── */

export interface SemanticsPlan {
  tables: readonly TableSemantics[];
  misreads: readonly CountMisread[];
  limits: readonly string[];
  runbook: string;
}

export function semanticsPlan(): SemanticsPlan {
  return { tables: TABLE_SEMANTICS, misreads: COUNT_MISREADS, limits: SEMANTICS_LIMITS, runbook: COUNT_RUNBOOK_REF };
}

/** 사람이 읽는 요약(§3-11 의 1줄 명령이 출력하는 것) */
export function semanticsText(plan: SemanticsPlan = semanticsPlan()): string {
  const lines = [`[countSemantics] 핵심 테이블 ${plan.tables.length}개 — 감소의 뜻 (${plan.runbook})`];
  for (const s of plan.tables) {
    lines.push(`· ${s.table} [${s.mutability} → ${MEANING_BY_MUTABILITY[s.mutability]}] ${s.deletePath ?? '앱 내 삭제 경로 없음'}`);
  }
  for (const m of plan.misreads) lines.push(`× ${m.verdict} 가 하는 말: ${m.says} — ${m.why}`);
  for (const l of plan.limits) lines.push(`※ ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 테이블 이름과 개수만 — 행 수는 담지 않는다(그것은 호출부의 것이다) */
export function semanticsLogLine(c: ShrinkClassification): string {
  const parts = ['[countSemantics]', `shrunk=${c.rows.length}`];
  if (c.confirmedLoss.length) parts.push(`confirmed_loss=${c.confirmedLoss.join('|')}`);
  if (c.outOfBand.length) parts.push(`out_of_band=${c.outOfBand.join('|')}`);
  if (c.needsCheck.length) parts.push(`needs_check=${c.needsCheck.join('|')}`);
  if (c.unknown.length) parts.push(`unknown=${c.unknown.join('|')}`);
  return parts.join(' ');
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * 핵심 테이블 정본(`CORE_TABLES`)과 이 모듈의 정본이 **양방향으로** 맞는지.
 * 한쪽만 자라면 세는 테이블의 감소가 `unknown` 으로 떨어지거나(판정 보류), 세지 않는 테이블에
 * 뜻만 선언돼 있게 된다 — 어느 쪽도 응답을 바꾸지 않는다.
 */
export function auditSemanticsCoverage(coreTables: readonly string[]): string[] {
  const core = new Set((coreTables ?? []).map((t) => String(t ?? '').trim().toLowerCase()));
  const declared = new Set(TABLE_SEMANTICS.map((s) => s.table));
  const problems: string[] = [];
  if (core.size === 0) return ['핵심 테이블 목록이 비어 있다 — 대조할 대상이 없다'];
  for (const t of core) {
    if (!declared.has(t)) problems.push(`핵심 테이블 ${t} 의 삭제 가능성이 정본에 없다 — 감소가 unknown 으로 떨어진다`);
  }
  for (const s of TABLE_SEMANTICS) {
    if (!core.has(s.table)) problems.push(`정본에만 있는 테이블 ${s.table} — 4단계가 세지 않으므로 이 선언은 쓰이지 않는다`);
  }
  if (!core.has('attachments')) {
    problems.push('핵심 테이블에 attachments 가 없다 — 첨부 메타 행이 통째로 비어도 행 수 대조가 ok 를 낸다(§1-1)');
  }
  return problems;
}

/**
 * `append_only` 선언이 **소스와 맞는지**. 보존 정리·배치 삭제가 들어오는 순간
 * `confirmed_loss` 는 거짓이 되고(정상 삭제가 생긴다) 그 테이블의 `short` 를 다시 「확인 필요」로
 * 읽어야 하는데, 응답은 그대로 돈다. 그래서 소스 원문에서 삭제 구문을 찾는다.
 */
export function auditAppendOnlyClaim(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  for (const def of TABLE_SEMANTICS) {
    if (def.mutability !== 'append_only') continue;
    const drizzle = new RegExp(`\\bdelete\\(\\s*${def.model}\\s*[),]`);
    const raw = new RegExp(`\\bdelete\\s+from\\s+"?${def.table}"?`, 'i');
    if (drizzle.test(s) || raw.test(s)) {
      problems.push(
        `${def.table} 에 삭제 구문이 생겼다 — append_only 선언이 거짓이 됐다. ` +
          `감소의 뜻(confirmed_loss)과 ${COUNT_RUNBOOK_REF} 를 함께 고칠 것`,
      );
    }
  }
  return problems;
}

/**
 * `user_deletable`(CRUD 경유) 선언이 **설정과 맞는지**. 자원이 설정에서 빠지면 그 테이블은
 * 더 이상 화면에서 지워지지 않는데 선언은 「정상 삭제로도 줄어든다」를 유지한다 —
 * 그러면 실제 유실이 「확인 필요」로 약하게 설명된다.
 */
export function auditCrudDeletePaths(configsSrc: unknown): string[] {
  const s = String(configsSrc ?? '');
  const problems: string[] = [];
  if (!/table:\s*\w+/.test(s)) return ['configs.ts 에서 자원 선언을 찾지 못했다 — 이 가드가 가리킬 곳이 사라졌다'];
  for (const def of TABLE_SEMANTICS) {
    if (def.deleteVia !== 'crud') continue;
    if (!new RegExp(`table:\\s*${def.model}\\b`).test(s)) {
      problems.push(`${def.table} 가 설정기반 CRUD 자원에서 빠졌다 — 삭제 경로 선언이 낡았다`);
    }
  }
  return problems;
}

/**
 * `lib/recoveryVerify.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 빠지면 4단계 응답은 다시 한 문장으로 돌아가는데(그 문장은 `audit_log` 에서 거짓이다)
 * 상태 코드도 `verdict` 도 바뀌지 않는다.
 */
export function auditVerifyWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]\.\/countSemantics\.ts['"]/.test(s)) problems.push('countSemantics 를 import 하지 않는다');
  if (!/classifyShortfalls\(/.test(s)) problems.push('classifyShortfalls() 를 호출하지 않는다');
  if (!/unexplained/.test(s)) problems.push('설명되지 않는 감소분을 응답에 싣지 않는다(판정만 하고 버리는 꼴)');
  if (!/attachments/.test(s)) problems.push('핵심 테이블 정본에 attachments 가 없다 — §1-1 의 사각지대가 돌아왔다');
  // 한 문장으로 되돌아간 모습 — 테이블별 판정을 가리키지 않는 caveat 는 audit_log 에서 거짓이다.
  if (!/3-11/.test(s)) problems.push('caveat·action 이 테이블별 판정(§3-11)을 가리키지 않는다');
  return problems;
}

/** RUNBOOK 원문 점검 — §3-11 이 살아 있고 4단계가 그 판정을 가리키는지 */
export function auditRunbookSemantics(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/^###\s*3-11\.\s/m.test(s)) problems.push('§3-11 절이 사라졌다 — 감소의 뜻을 적어 둔 유일한 자리다');
  if (!/data\.unexplained/.test(s)) problems.push('RUNBOOK 어디에도 data.unexplained 확인 지시가 없다');
  // §1-1 이 「세지 않는다」로 되돌아갔는지(사각지대가 메워진 사실을 문서가 모르면 담당자도 모른다)
  if (/핵심 테이블 12개에 `attachments` 가 없/.test(s)) {
    problems.push('§1-1 이 「핵심 테이블에 attachments 가 없다」로 되돌아갔다 — 지금은 센다');
  }
  for (const m of COUNT_MISREADS) {
    if (!s.includes(m.key)) problems.push(`§3-11 에 거짓이 되는 판정 ${m.key} 가 없다`);
  }
  return problems;
}

/** 배선 상태 요약(문서·보고용) */
export function countSemanticsStatus(): {
  tables: number;
  appendOnly: string[];
  operatorOnly: string[];
  userDeletable: number;
  misreads: number;
  limits: number;
} {
  const by = (m: Mutability) => TABLE_SEMANTICS.filter((s) => s.mutability === m).map((s) => s.table);
  return {
    tables: TABLE_SEMANTICS.length,
    appendOnly: by('append_only'),
    operatorOnly: by('operator_only'),
    userDeletable: by('user_deletable').length,
    misreads: COUNT_MISREADS.length,
    limits: SEMANTICS_LIMITS.length,
  };
}
