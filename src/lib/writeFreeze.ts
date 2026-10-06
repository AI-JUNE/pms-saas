/**
 * writeFreeze.ts — RUNBOOK §3 **2단계(쓰기 차단)** 를 실제로 수행·확인 가능하게 만든다. 2026-10-06
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * RUNBOOK §3 의 복구 절차는 2단계에서 「쓰기 차단 — 배포를 유지보수 상태로 전환하거나
 * Vercel에서 트래픽을 차단한다」고 지시한다. 그런데
 *   (1) **「유지보수 상태」가 코드에 없었다.** 그런 모드가 구현된 적이 없으므로 이 지시는
 *       수행할 수 없는 문장이었다.
 *   (2) 남은 선택지인 「Vercel 트래픽 차단」은 **복구 자신을 막는다** — 4단계의
 *       `GET /api/admin/recovery-verify`·6단계의 `POST /api/admin/migrate`·`/api/health`
 *       가 전부 같은 배포 뒤에 있다. 그래서 담당자는 실제로는 차단을 걸지 않고 넘어가게 된다.
 *   (3) 차단이 걸렸는지 **기계적으로 확인할 방법이 없었다.** 2단계는 리허설 체크리스트에도
 *       없어서 리허설로도 검증되지 않았다.
 *
 * 차단이 빠지면 어떻게 조용히 실패하는가:
 *   · 3단계에서 시점 T-ε 복구 브랜치를 뜬다. 그 브랜치는 **그 시점의 사본**이다.
 *   · 그 뒤로도 사용자 쓰기가 운영 DB 에 계속 들어온다. 4단계 검증은 **복구 브랜치**를
 *     세므로 운영 DB 로 들어오는 그 쓰기를 전혀 보지 못한다.
 *   · 5단계에서 운영 `DATABASE_URL` 을 복구 브랜치로 바꾸는 순간 그 쓰기가 전부 사라진다.
 *   · 검증은 `switchReady: true` 였고 전환도 성공했으므로 **복구는 「성공」으로 보인다.**
 *     유실량은 어디에도 기록되지 않는다 — `lib/recoveryVerify.ts` 의 기준 스냅샷 대조는
 *     운영 DB 가 그 사이 커지는 것을 볼 수 없기 때문이다(대조 대상이 브랜치다).
 *
 * 이 모듈은 그 구멍을 메운다:
 *   · 쓰기 메서드만 막고 **조회는 열어 두는** 읽기전용 모드를 판정하고(`freezeDecision`),
 *   · 복구 자신이 쓰는 경로는 사유와 함께 예외로 둔다(`FREEZE_EXEMPT`),
 *   · 차단 상태를 `/api/health` 에 드러내 2단계를 **확인 가능한 단계**로 만든다
 *     (`writeFreezeCheck`),
 *   · 게이트가 조용히 빠지는 것을 막는 정적 점검을 둔다(`auditFreezeWiring`·`auditMatcherCoverage`).
 *
 * 원칙
 * - 순수 모듈: DB·파일시스템 미접근. 값 비교는 호출부가 넘긴 것만 쓴다.
 * - 기본 OFF. 스위치는 `'true'` 문자열일 때만 ON(`1`·`yes`·공백은 OFF 유지).
 * - fail-closed: 모르는 메서드는 「읽기」로 가정하지 않고 차단한다. 경로가 수상하면
 *   (`..` 포함 등) 예외로 통과시키지 않는다.
 * - **새 거짓 ok 를 만들지 않는다**: 이 게이트가 막지 **못하는** 경로를 `FREEZE_LIMITS`
 *   로 함께 내보낸다(아래).
 */

/** 활성화 스위치 키. 기본 OFF — 복구 작업 중에만 사람이 ON 한다 */
export const WRITE_FREEZE_ENV = 'RECOVERY_WRITE_FREEZE';

/** 차단 응답 코드. `lib/http.ts` 의 ERROR 목록에 없는 이유는 라우트가 아니라 **미들웨어**가 낸다 */
export const FREEZE_CODE = 'WRITE_FROZEN';

/** 차단 응답 상태. 503 = 일시적 불가(재시도 가능) — 400대(영구 거절)와 뜻이 다르다 */
export const FREEZE_STATUS = 503;

/**
 * 클라이언트 백오프 힌트(초). **RTO 약속이 아니다** — 복구 소요시간을 뜻하지 않는다.
 * RUNBOOK §1 의 RTO/RPO 는 여전히 `[확인 필요]` 이고 이 숫자로 대신하지 않는다.
 */
export const FREEZE_RETRY_AFTER_SEC = 120;

export const FREEZE_MESSAGE =
  '복구 작업 중입니다. 데이터 보호를 위해 저장·수정이 일시적으로 차단되었습니다. 조회는 그대로 가능합니다.';

/** 응답에 함께 실어 담당자가 근거 문서를 찾을 수 있게 한다 */
export const FREEZE_RUNBOOK_REF = 'RUNBOOK §3 2단계(쓰기 차단)';

/* ───────────────────────────── 메서드 분류 ───────────────────────────── */

const READ_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];
const WRITE_METHODS: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

export type MethodKind = 'read' | 'write' | 'unknown';

/**
 * HTTP 메서드 분류. 목록 밖(TRACE·CONNECT·빈 값·비문자열)은 `unknown` 이다 —
 * **「읽기」로 가정하지 않는다.** 차단의 목적이 유실 방지이므로 모르는 쪽은 막는다.
 */
export function methodKind(method: unknown): MethodKind {
  const m = String(method ?? '').trim().toUpperCase();
  if (READ_METHODS.includes(m)) return 'read';
  if (WRITE_METHODS.includes(m)) return 'write';
  return 'unknown';
}

/* ───────────────────────────── 예외 경로 ───────────────────────────── */

export interface FreezeExempt {
  /** 경로 접두사(정확 일치 또는 `/` 경계) */
  path: string;
  /** 왜 막지 않는가 — 사유 없는 예외를 두지 않는다 */
  why: string;
  /** 이 예외가 **그래도 쓰기라는** 사실(없으면 쓰기가 아니다). 숨기지 않고 적는다 */
  writes?: string;
}

/**
 * 차단 중에도 통과시키는 쓰기 경로. **복구 자신이 쓰는 경로만** 둔다.
 * 「Vercel 트래픽 차단」이 쓸 수 없는 수단인 이유가 바로 이 목록이다.
 */
export const FREEZE_EXEMPT: readonly FreezeExempt[] = [
  {
    path: '/api/admin/migrate',
    why: 'RUNBOOK §3 6단계 스키마 정합(멱등 DDL). 막으면 복구 절차 자체가 진행되지 않는다',
    writes: 'DDL 을 실행한다 — 전환 후 복구 대상 DB 에 거는 것이 의도된 동작이다',
  },
  {
    path: '/api/auth/login',
    why: '세션 발급. 막으면 §3 4·6단계의 관리 엔드포인트(슈퍼관리자 전용)에 닿을 수 없다',
    writes: 'sessions 행을 만든다 — 복구 시 버려도 되는 일회성 데이터다',
  },
  {
    path: '/api/auth/logout',
    why: '세션 종료. 담당자가 계정을 바꿔 붙어야 할 수 있고, 막을 이유가 없다',
    writes: 'sessions 행을 지운다',
  },
  {
    path: '/api/client-errors',
    why: '장애 중 클라이언트 오류 수집. 끊기면 복구 중 발생한 오류의 원인을 못 찾는다',
  },
];

/** `..`·백슬래시가 섞인 경로는 예외 판정에 쓰지 않는다(경로 우회 차단) */
function normalizePath(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s.startsWith('/')) return null;
  if (s.includes('..') || s.includes('\\') || s.includes('%2e') || s.includes('%2E')) return null;
  const collapsed = s.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') || '/' : '/';
}

/** 경로가 예외 목록에 걸리는가. 판독 불가 경로는 **예외로 보지 않는다**(fail-closed) */
export function exemptFor(path: unknown): FreezeExempt | null {
  const p = normalizePath(path);
  if (!p) return null;
  return FREEZE_EXEMPT.find((e) => p === e.path || p.startsWith(`${e.path}/`)) ?? null;
}

/* ───────────────────────────── 스위치 ───────────────────────────── */

/**
 * 차단 ON 여부. `'true'` 문자열만 인정한다.
 * ※ **미들웨어(Edge)는 이 함수를 쓰지 않는다** — Edge 런타임은 `process.env.KEY` 를
 *   빌드 시 리터럴로 치환하므로 env 객체를 통째로 넘기면 키가 비어 올 수 있다.
 *   그래서 미들웨어는 키를 직접 읽어 boolean 만 `freezeDecision` 에 넘긴다.
 */
export function writeFreezeEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RECOVERY_WRITE_FREEZE === 'true';
}

/* ───────────────────────────── 판정 ───────────────────────────── */

export type FreezeOutcome = 'off' | 'read' | 'exempt' | 'blocked' | 'blocked_unknown_method';

export interface FreezeDecision {
  outcome: FreezeOutcome;
  blocked: boolean;
  /** 판정에 쓴 메서드 분류 */
  kind: MethodKind;
  method: string;
  /** 정규화된 경로. 판독 불가면 원문을 그대로 둔다(로그용) */
  path: string;
  status: number | null;
  code: string | null;
  message: string | null;
  retryAfterSec: number | null;
  /** 통과시킨 사유(`exempt` 일 때만) */
  exemptWhy: string | null;
}

/**
 * 요청 하나에 대한 차단 판정.
 * - `enabled: false` → `off`(아무것도 바꾸지 않는다. 기본값이다)
 * - 읽기 → `read`(조회는 막지 않는다. 운영 화면이 읽기전용으로 계속 뜬다)
 * - 예외 경로의 쓰기 → `exempt`
 * - 그 밖의 쓰기 → `blocked`, 모르는 메서드 → `blocked_unknown_method`
 */
export function freezeDecision(input: {
  method: unknown;
  path: unknown;
  enabled: boolean;
}): FreezeDecision {
  const kind = methodKind(input.method);
  const method = String(input.method ?? '').trim().toUpperCase() || '?';
  const path = normalizePath(input.path) ?? String(input.path ?? '');
  const pass = (outcome: FreezeOutcome, exemptWhy: string | null = null): FreezeDecision => ({
    outcome, blocked: false, kind, method, path,
    status: null, code: null, message: null, retryAfterSec: null, exemptWhy,
  });

  if (input.enabled !== true) return pass('off');
  if (kind === 'read') return pass('read');

  const ex = exemptFor(path);
  if (ex) return pass('exempt', ex.why);

  return {
    outcome: kind === 'unknown' ? 'blocked_unknown_method' : 'blocked',
    blocked: true,
    kind, method, path,
    status: FREEZE_STATUS,
    code: FREEZE_CODE,
    message: FREEZE_MESSAGE,
    retryAfterSec: FREEZE_RETRY_AFTER_SEC,
    exemptWhy: null,
  };
}

/** 차단 응답 본문 — `lib/http.ts` 의 표준 에러 모양(`{ok:false, code, message}`)을 따른다 */
export function freezeResponseBody(decision: FreezeDecision): {
  ok: false; code: string; message: string; runbook: string;
} {
  return {
    ok: false,
    code: decision.code ?? FREEZE_CODE,
    message: decision.message ?? FREEZE_MESSAGE,
    runbook: FREEZE_RUNBOOK_REF,
  };
}

/** 로그 한 줄. 메서드·경로·판정만 — 본문·쿠키·쿼리스트링은 담지 않는다(PII 유입 차단) */
export function freezeLogLine(decision: FreezeDecision): string {
  const parts = [`freeze=${decision.outcome}`, `method=${decision.method}`, `path=${decision.path}`];
  if (decision.exemptWhy) parts.push('exempt=1');
  return parts.join(' ');
}

/* ───────────────────────────── 막지 못하는 것 ───────────────────────────── */

/**
 * 이 게이트의 **사각지대**. 차단을 걸었다는 사실이 「유실 없음」을 뜻하지 않는다 —
 * 그 착각이 바로 이 모듈이 메우려는 종류의 구멍이므로 응답·문서에 함께 실어 보낸다.
 */
export const FREEZE_LIMITS: readonly string[] = [
  'DATABASE_URL 로 직접 붙는 쓰기(psql·Neon 콘솔·DB 도구)는 앱을 거치지 않아 막히지 않는다',
  '같은 DATABASE_URL 을 쓰는 다른 배포(프리뷰·스테이징·로컬)는 각자의 스위치를 따른다 — 배포별로 켜야 한다',
  `예외 경로(${FREEZE_EXEMPT.map((e) => e.path).join(', ')})는 통과한다 — 복구 절차가 쓰는 경로다`,
  '차단을 켠 순간 이미 처리 중이던 요청은 끝까지 진행된다(요청 단위 판정이다)',
  '외부 웹훅(결제 등)도 차단되어 503 을 받는다 — 제공자 재시도에 의존하며, 재시도 만료분은 수동 대조가 필요하다',
];

/* ───────────────────────────── /api/health 체크 ───────────────────────────── */

/**
 * 차단 상태를 공개 헬스체크에 드러낸다 — RUNBOOK §3 2단계를 **확인 가능한 단계**로 만든다.
 *
 * `ok` 의 뜻: 평상시(차단 OFF)가 `true`. 차단 중에는 쓰기가 실제로 거절되는 상태이므로
 * `false`(= degraded)로 둔다. **required: false** 이므로 503 이 되지는 않는다.
 *
 * ※ 이 값은 **이 배포 자신의** 차단 상태만 말한다. 복구 검증(§3 4단계)은 스테이징에서
 *   복구 브랜치를 보고, 차단은 운영 배포에 걸린다 — 서로 다른 배포의 상태를 한 응답에
 *   합치면 거짓 보증이 되므로 `recoveryVerification` 에 섞지 않았다.
 */
export function writeFreezeCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const frozen = writeFreezeEnabled(args?.env ?? process.env);
  return {
    ok: !frozen,
    required: false,
    detail: {
      frozen,
      switchKey: WRITE_FREEZE_ENV,
      blocks: frozen ? WRITE_METHODS.join(',') : null,
      exempt: frozen ? FREEZE_EXEMPT.map((e) => e.path) : [],
      limits: frozen ? FREEZE_LIMITS : [],
      note: frozen
        ? `쓰기 차단 중(${FREEZE_RUNBOOK_REF}) — 조회는 가능하다. 차단이 「유실 없음」을 뜻하지는 않는다(limits 참고)`
        : '쓰기 차단 OFF — 평상시 상태다',
    },
  };
}

/* ───────────────────────────── 배선 정적 점검 ───────────────────────────── */

/**
 * `src/middleware.ts` 가 게이트를 **실제로** 물고 있는지 원문으로 점검한다.
 * 미들웨어는 유일한 적용 지점이라, 한 줄이 빠지면 차단이 조용히 사라진다
 * (라우트 38곳 중 `handle(fn, req)` 로 req 를 넘기는 곳이 13곳뿐이어서
 *  `lib/http.ts` 는 메서드·경로를 모르는 호출이 많고 적용 지점이 될 수 없다).
 */
export function auditFreezeWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];

  if (!/from\s+['"][^'"]*writeFreeze['"]/.test(s)) {
    problems.push('writeFreeze 모듈을 import 하지 않는다');
  }

  const call = s.match(/freezeDecision\(\s*\{([\s\S]*?)\}\s*\)/);
  if (!call) {
    problems.push('freezeDecision(...) 호출이 없다 — 쓰기 차단이 걸리지 않는다');
  } else {
    if (!/req\.method/.test(call[1])) problems.push('freezeDecision 에 req.method 를 넘기지 않는다');
    if (!/pathname/.test(call[1])) problems.push('freezeDecision 에 pathname 을 넘기지 않는다');
    if (!/RECOVERY_WRITE_FREEZE\s*===\s*['"]true['"]/.test(call[1])) {
      problems.push(`${WRITE_FREEZE_ENV} === 'true' 비교로 스위치를 읽지 않는다`);
    }
  }

  if (!/\.blocked/.test(s)) problems.push('판정 결과(blocked)를 분기하지 않는다 — 판정만 하고 통과시킨다');

  const iDecide = s.indexOf('freezeDecision(');
  const iNext = s.indexOf('NextResponse.next()');
  if (iDecide >= 0 && iNext >= 0 && iDecide > iNext) {
    problems.push('freezeDecision 이 NextResponse.next() 뒤에 있다 — 요청이 이미 통과한 뒤다');
  }

  if (!new RegExp(String(FREEZE_STATUS)).test(s) && !/FREEZE_STATUS/.test(s)) {
    problems.push(`차단 응답 상태(${FREEZE_STATUS})를 쓰지 않는다`);
  }

  return problems;
}

/**
 * 미들웨어 matcher 가 `/api` 를 **제외하지 않는지** 점검한다.
 * 제외 목록에 api 가 끼면 쓰기 차단이 전 API 에서 사라진다 — 화면은 그대로 도므로
 * 사람 눈에는 아무 변화가 없다. 가장 조용한 회귀 경로이므로 파일 수준에서 고정한다.
 */
export function auditMatcherCoverage(src: unknown): string[] {
  const s = String(src ?? '');
  const m = s.match(/matcher:\s*\[([\s\S]*?)\]/);
  if (!m) return ['middleware config.matcher 를 찾지 못했다 — 형식이 바뀌었으면 이 가드를 함께 볼 것'];
  const problems: string[] = [];
  const neg = m[1].match(/\(\?!([^)]*)\)/g) ?? [];
  for (const group of neg) {
    if (/\bapi\b/.test(group)) problems.push(`matcher 가 api 를 제외한다 — ${group}`);
  }
  if (!/\(\?!/.test(m[1]) && !/\/\(/.test(m[1]) && !m[1].includes("'/'")) {
    problems.push('matcher 가 전 경로를 덮지 않는 것으로 보인다 — 쓰기 차단 적용 범위를 확인할 것');
  }
  return problems;
}

/** 배선 상태 요약(문서·보고용) */
export function writeFreezeStatus(env: Record<string, string | undefined> = process.env): {
  frozen: boolean;
  switchKey: string;
  exemptPaths: string[];
  limits: number;
  note: string;
} {
  const frozen = writeFreezeEnabled(env);
  return {
    frozen,
    switchKey: WRITE_FREEZE_ENV,
    exemptPaths: FREEZE_EXEMPT.map((e) => e.path),
    limits: FREEZE_LIMITS.length,
    note: frozen
      ? '쓰기 차단 ON — 조회만 가능하다'
      : '쓰기 차단 OFF(기본값) — 복구 작업 중에만 사람이 켠다',
  };
}
