/**
 * healthSignal.ts — 복구 장치의 판정이 **누구에게 도달하는가** (RUNBOOK §2-2)
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────────
 * §1·§2·§3 1~8단계·§4·§5·§6 을 전부 기계화한 뒤, 그 판정이 **도착하는 곳은 하나**다 —
 * `GET /api/health` 응답 본문의 `checks.*`. 복구 관련 체크는 전부 `required: false` 이고
 * 그것은 의도적이다(설정 유실·리허설 미실시로 서비스를 내리면 **복구 자신이 막힌다**).
 * 그 결과 `summarize()` 는 `degraded` 를 내고 `buildHealthBody` 는 **`ok: true` + HTTP 200**
 * 으로 돌려준다.
 *
 * 문제는 그 다음이다. 지금 이 응답을 읽는 쪽은 셋인데 **어느 쪽도 degraded 를 보지 못한다**:
 *
 *   1) 업타임 모니터·로드밸런서·마켓플레이스 상태 점검 — `app/api/health/route.ts` 주석이
 *      스스로 적어 둔 대상이다. 이들은 **상태 코드**를 본다 → 전 항목 degraded 인 배포와
 *      완전 정상인 배포가 똑같이 `200` 이다.
 *   2) 본문을 파싱하는 감시자 — 관례적으로 `ok` 불리언을 본다. `ok: status !== 'down'` 이라
 *      degraded 에서도 `true` 다.
 *   3) 예외 알림(`lib/logger.ts` `notifyAlert`) — API 500(`lib/http.ts`)·클라이언트 오류
 *      (`api/client-errors`)·프로세스 크래시에만 걸려 있다. 이 판정들은 **예외가 아니라
 *      정상 응답**이라 한 번도 발신되지 않는다.
 *
 * 남은 통로는 사람이 열어 보는 것뿐인데 **그 시점이 순환이다** — 사람이 `/api/health` 를 여는
 * 공식 계기는 §2 월 점검(7단계 중 5단계가 이 호출이다)이고, 「§2 가 밀렸다」를 알려 주는
 * `checks.periodicCheck` 가 **바로 그 응답 안에** 있다. 점검을 거르면 거른 사실도 함께 안 보인다.
 * `periodicCheck.overdue`·`recovery.missing`·`recoveryBaseline.stale` 은 전부 **거른 사람에게만**
 * 필요한 신호인데, 그 사람에게 도달하는 경로가 없다.
 *
 * 시한부 신호는 더 나쁘다 — `writeFreeze`·`incidentClosure`·`postRestoreSecurity`·`externalState`
 * 는 설계상 **차단이 걸려 있는 동안에만** 쓸모가 있다(그 뒤엔 기록할 대상이 사라지거나
 * `stale_record` 가 된다). 그 창은 복구 중 수십 분이고, 그동안 응답을 폴링하는 주체가 없다.
 *
 * ── 무엇을 하는가 ────────────────────────────────────────────────────────────
 * 상태 코드는 **바꾸지 않는다**(각 체크가 `required: false` 를 고른 결정과 충돌한다 —
 * degraded 로 503 을 내면 복구가 자기 자신을 막는다). 대신 **상태 코드를 바꾸지 않고도
 * 감시자가 걸 수 있는 표면**을 만든다:
 *   - 응답 헤더 `x-health-status` / `x-health-degraded` — JSON 을 파싱하지 못하는 감시자도
 *     헤더 조건 하나로 degraded 에 경보를 걸 수 있다.
 *   - 응답 본문 `signal` — degraded 체크 **이름** 목록, 창이 닫히면 사라지는 체크,
 *     지금 이 신호를 보지 못하는 관측자 목록.
 *
 * **알림은 코드가 발신하지 않는다.** 헬스체크는 폴링되는 엔드포인트라 요청마다 발신하면
 * 중복이 되고, 서버리스에서는 인스턴스가 여러 개·수명이 짧아 모듈 상태로 디듀프할 방법이
 * 없다(디듀프한 척하면 인스턴스 수만큼 발신된다). 그 한계를 숨기지 않고 `SIGNAL_LIMITS` 에
 * 적고, 감시자 쪽 설정 방법을 RUNBOOK §2-2 에 둔다.
 *
 * 순수 모듈 — DB·next·fs·`process.env` 를 건드리지 않고 **신규 조회·쓰기·DDL·신규 env 가 0** 이다.
 * 판정은 이미 만들어진 응답 본문만 본다.
 */
import type { CheckName, HealthBody, HealthStatus } from './health.ts';
import { WRITE_FREEZE_ENV } from './writeFreeze.ts';

export const SIGNAL_RUNBOOK_REF = 'RUNBOOK.md §2-2 (판정의 도달 — degraded 는 상태 코드에 나타나지 않는다)';

/* ─────────────────────────── 응답 헤더 ─────────────────────────── */

/** 항상 붙는다. 값은 `ok`/`degraded`/`down` 셋뿐이다. */
export const HEALTH_STATUS_HEADER = 'x-health-status';
/** degraded 인 체크 **이름**을 쉼표로 잇는다. 비면 헤더 자체를 붙이지 않는다. */
export const HEALTH_DEGRADED_HEADER = 'x-health-degraded';

/* ─────────────────────────── 관측자 정본 ─────────────────────────── */

export type ObserverId = 'status_code' | 'ok_flag' | 'error_alert' | 'status_header' | 'human_check';

export interface Observer {
  id: ObserverId;
  /** 누가 보는가 */
  who: string;
  /** 무엇을 읽는가 */
  reads: string;
  /** degraded 를 **보는가** */
  seesDegraded: boolean;
  /** 상시 감시인가(사람이 계기를 만들어야 하는 것은 상시가 아니다) */
  standing: boolean;
  /** 왜 보(지 못하)는가 */
  why: string;
  /** 근거 */
  source: string;
}

/**
 * 지금 이 응답을 읽는 쪽 전부. **추가하려면 근거가 있어야 한다** — 「어딘가에서 보고 있을
 * 것이다」는 관측자가 아니다.
 */
export const OBSERVERS: readonly Observer[] = [
  {
    id: 'status_code',
    who: '업타임 모니터·로드밸런서·마켓플레이스 상태 점검',
    reads: 'HTTP 상태 코드',
    seesDegraded: false,
    standing: true,
    why: 'degraded 는 200 이다 — 전 항목 degraded 인 배포와 완전 정상인 배포가 구분되지 않는다',
    source: 'lib/health.ts statusCode() · api/health/route.ts 주석이 적어 둔 대상',
  },
  {
    id: 'ok_flag',
    who: '응답 본문의 `ok` 만 보는 감시자',
    reads: '`ok` 불리언',
    seesDegraded: false,
    standing: true,
    why: '`ok: status !== \'down\'` 이라 degraded 에서도 true 다',
    source: 'lib/health.ts buildHealthBody()',
  },
  {
    id: 'error_alert',
    who: '오류 알림 웹훅(`notifyAlert`)',
    reads: '던져진 예외·API 500·클라이언트 오류',
    seesDegraded: false,
    standing: true,
    why: '판정은 예외가 아니라 **정상 응답**이다 — 이 경로를 한 번도 지나지 않는다',
    source: 'lib/logger.ts · lib/http.ts · api/client-errors/route.ts',
  },
  {
    id: 'status_header',
    who: '응답 헤더에 조건을 거는 감시자',
    reads: `\`${HEALTH_STATUS_HEADER}\` / \`${HEALTH_DEGRADED_HEADER}\``,
    seesDegraded: true,
    standing: true,
    why: '상태 코드를 바꾸지 않고 degraded 를 드러내는 **유일한 상시 표면**이다(설정은 감시자 쪽)',
    source: 'lib/healthSignal.ts signalHeaders() · api/health/route.ts',
  },
  {
    id: 'human_check',
    who: '§2 월 점검을 수행하는 사람',
    reads: '응답 본문 전체',
    seesDegraded: true,
    standing: false,
    why: '본다. 그러나 **계기가 월 1회 점검 자신**이라, 점검이 밀리면 밀렸다는 신호도 함께 멈춘다(순환)',
    source: 'RUNBOOK §2 1~7번 · lib/periodicCheck.ts',
  },
] as const;

export function observerFor(id: string): Observer | null {
  return OBSERVERS.find((o) => o.id === id) ?? null;
}

/** 상시로 degraded 를 보는 관측자. 비어 있으면 **판정이 아무에게도 도달하지 않는다**. */
export function standingObservers(): ObserverId[] {
  return OBSERVERS.filter((o) => o.standing && o.seesDegraded).map((o) => o.id);
}

/** 상시 감시자인데 degraded 를 보지 못하는 쪽 */
export function blindObservers(): ObserverId[] {
  return OBSERVERS.filter((o) => o.standing && !o.seesDegraded).map((o) => o.id);
}

/* ─────────────────────────── 시한부 체크 정본 ─────────────────────────── */

export interface TimeBoundCheck {
  name: CheckName;
  /** 언제까지 쓸모가 있는가 */
  window: string;
  /** 창이 닫히면 어떻게 되는가 */
  afterWindow: string;
  source: string;
}

/**
 * **창이 닫히면 신호 자체가 사라지는** 체크. 월 1회 사람 점검으로는 원리상 닿지 못한다 —
 * 이 넷은 전부 쓰기 차단(`RECOVERY_WRITE_FREEZE`)이 걸려 있는 **복구 중 수십 분**에만 뜻이 있다.
 */
export const TIME_BOUND_CHECKS: readonly TimeBoundCheck[] = [
  {
    name: 'writeFreeze',
    window: `차단(\`${WRITE_FREEZE_ENV}\`)이 걸려 있는 동안`,
    afterWindow: '해제를 잊으면 서비스가 읽기전용으로 남는데 상태 코드는 계속 200 이다',
    source: 'lib/writeFreeze.ts · RUNBOOK §3 2·7단계',
  },
  {
    name: 'incidentClosure',
    window: '차단이 걸려 있는 동안(= 유실 구간의 끝을 **아직 기록할 수 있는** 동안)',
    afterWindow: '7단계가 스위치를 지우면 끝을 확정할 근거가 사라진다 — 되돌릴 수 없는 고지를 사람 기억으로 적게 된다',
    source: 'lib/incidentClosure.ts · RUNBOOK §3 8단계·§3-7',
  },
  {
    name: 'postRestoreSecurity',
    window: '차단이 걸려 있는 동안(= 아직 아무도 들어오지 못하는 동안)',
    afterWindow: '해제하면 되살아난 세션·옛 비밀번호로 문이 열린 채 서비스가 돈다',
    source: 'lib/postRestoreSecurity.ts · RUNBOOK §3 6-1단계·§3-8',
  },
  {
    name: 'externalState',
    window: '차단을 풀기 전까지(대조 구간의 끝이 확정되기 전)',
    afterWindow: '제공자 재시도가 만료되면 반영되지 않은 결제는 **다시 오지 않는다**',
    source: 'lib/externalReconcile.ts · RUNBOOK §3 6-2단계·§3-9',
  },
] as const;

export function timeBoundFor(name: string): TimeBoundCheck | null {
  return TIME_BOUND_CHECKS.find((t) => t.name === name) ?? null;
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export type SignalVerdict = 'ok' | 'degraded' | 'down' | 'unreadable';

export const ACTION_OK = '정상 — degraded 인 체크가 없다';
export const ACTION_DEGRADED =
  'degraded 는 **상태 코드로 드러나지 않는다**. 감시자에 헤더 조건을 걸어 두었는지 확인하고(§2-2), 아래 이름의 체크를 본문에서 읽는다';
export const ACTION_TIME_BOUND =
  '**창이 닫히면 사라지는 신호가 포함돼 있다** — 복구·리허설 중이라면 차단을 풀기 전에 처리한다(§3-7·§3-8·§3-9)';
export const ACTION_DOWN = '필수 체크가 실패했다 — 상태 코드 503 으로 드러난다. 여기서는 더 할 일이 없다';
export const ACTION_UNREADABLE = '응답 모양을 읽을 수 없다 — 「degraded 가 없다」로 올리지 않는다';

const STATUSES: readonly HealthStatus[] = ['ok', 'degraded', 'down'];

export interface SignalReach {
  verdict: SignalVerdict;
  /** 본문이 말하는 상태(읽을 수 없으면 null — 추측하지 않는다) */
  status: HealthStatus | null;
  /** `required: false` 인데 실패한 체크 **이름** */
  degraded: string[];
  /** `required: true` 인데 실패한 체크 이름(= 503 사유) */
  failing: string[];
  /** 지금 degraded 인 것 중 **창이 닫히면 사라지는** 체크 */
  timeBound: string[];
  /** 상태 코드만 보는 감시자에게 보이는가 */
  visibleToStatusCode: boolean;
  /** `ok` 불리언만 보는 감시자에게 보이는가 */
  visibleToOkFlag: boolean;
  /** 지금 이 신호를 보지 못하는 상시 관측자 */
  blind: ObserverId[];
  action: string;
  caveats: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 응답 본문에서 체크별 실패를 추려 **어디까지 보이는지**를 판정한다.
 *
 * 읽을 수 없는 모양은 `unreadable` 이다 — 빈 목록으로 돌려주면 「degraded 가 없다」와
 * 구분되지 않는다(§3 전반에서 지켜 온 규율: **모르는 것과 없는 것은 다르다**).
 */
export function assessSignalReach(body: unknown): SignalReach {
  const base = {
    status: null as HealthStatus | null,
    degraded: [] as string[],
    failing: [] as string[],
    timeBound: [] as string[],
    visibleToStatusCode: false,
    visibleToOkFlag: false,
    blind: [] as ObserverId[],
  };

  if (!isRecord(body) || !isRecord(body.checks)) {
    return { ...base, verdict: 'unreadable', blind: blindObservers(), action: ACTION_UNREADABLE, caveats: caveatsFor([]) };
  }
  const status = STATUSES.includes(body.status as HealthStatus) ? (body.status as HealthStatus) : null;
  if (status === null) {
    return { ...base, verdict: 'unreadable', blind: blindObservers(), action: ACTION_UNREADABLE, caveats: caveatsFor([]) };
  }

  const degraded: string[] = [];
  const failing: string[] = [];
  for (const [name, raw] of Object.entries(body.checks)) {
    if (!isRecord(raw) || typeof raw.ok !== 'boolean') continue; // 모양을 모르는 항목은 세지 않는다
    if (raw.ok) continue;
    if (raw.required === true) failing.push(name);
    else degraded.push(name);
  }
  degraded.sort();
  failing.sort();

  const timeBound = degraded.filter((n) => timeBoundFor(n) !== null);

  if (status === 'down') {
    return {
      status,
      verdict: 'down',
      degraded,
      failing,
      timeBound,
      visibleToStatusCode: true,
      visibleToOkFlag: true,
      blind: [],
      action: ACTION_DOWN,
      caveats: caveatsFor(timeBound),
    };
  }

  if (degraded.length === 0) {
    return {
      status,
      verdict: 'ok',
      degraded,
      failing,
      timeBound,
      visibleToStatusCode: false,
      visibleToOkFlag: false,
      blind: [],
      action: ACTION_OK,
      caveats: caveatsFor(timeBound),
    };
  }

  return {
    status,
    verdict: 'degraded',
    degraded,
    failing,
    timeBound,
    // 바로 이 두 줄이 이 모듈이 존재하는 이유다 — degraded 는 둘 중 어디에도 나타나지 않는다.
    visibleToStatusCode: false,
    visibleToOkFlag: false,
    blind: blindObservers(),
    action: timeBound.length > 0 ? `${ACTION_DEGRADED}. ${ACTION_TIME_BOUND}` : ACTION_DEGRADED,
    caveats: caveatsFor(timeBound),
  };
}

function caveatsFor(timeBound: string[]): string[] {
  const out = [
    '헤더가 붙는다 ≠ 누군가 보고 있다 — 감시자 설정은 이 저장소 밖이다(§2-2)',
    '이 판정은 **이 배포·이 응답**만 말한다. 다른 인스턴스·다른 배포·조금 전 상태는 모른다',
  ];
  if (timeBound.length > 0) {
    out.push(`창이 닫히면 사라지는 신호: ${timeBound.join(', ')} — 지금 보지 못하면 **나중에 볼 수 없다**`);
  }
  return out;
}

/* ─────────────────────────── 사각지대 ─────────────────────────── */

export const SIGNAL_LIMITS: readonly string[] = [
  '**알림은 이 코드가 보내지 않는다** — 헬스체크는 폴링되는 엔드포인트라 요청마다 발신하면 중복이 되고, 서버리스는 인스턴스가 여러 개·수명이 짧아 모듈 상태로 디듀프할 수 없다(디듀프한 척하면 인스턴스 수만큼 나간다)',
  '헤더·`signal` 은 **표면**일 뿐이다 — 감시자에 조건을 걸지 않으면 degraded 는 여전히 아무에게도 도달하지 않는다',
  '`ok`(degraded 없음)는 **이 응답 시점**만 뜻한다 — 폴링 사이에 떴다 사라진 degraded 는 어디에도 남지 않는다',
  '판정 함수가 예외를 던지면 그 체크만 빠지는 것이 아니라 **응답 전체가 실패**한다(그쪽은 상태 코드로 드러난다)',
  '모양을 읽을 수 없는 체크 항목은 **세지 않는다** — 목록에 없다고 정상이라는 뜻이 아니다',
  '체크 이름만 말한다 — 무엇이 왜 degraded 인지는 각 체크의 `detail` 과 해당 절이 말한다',
];

/* ─────────────────────────── 출력 ─────────────────────────── */

/**
 * 상태 코드를 바꾸지 않고 degraded 를 드러내는 응답 헤더.
 * 값에는 체크 **이름**만 들어간다(이미 공개 본문에 있는 이름이고, 설정값·호스트는 담지 않는다).
 */
export function signalHeaders(body: unknown): Record<string, string> {
  const r = assessSignalReach(body);
  const headers: Record<string, string> = {
    [HEALTH_STATUS_HEADER]: r.verdict === 'unreadable' ? 'unreadable' : String(r.status),
  };
  const names = [...r.failing, ...r.degraded];
  if (names.length > 0) headers[HEALTH_DEGRADED_HEADER] = names.join(',');
  return headers;
}

export interface SignalStatus {
  verdict: SignalVerdict;
  degraded: string[];
  failing: string[];
  timeBound: string[];
  visibleToStatusCode: boolean;
  visibleToOkFlag: boolean;
  /** 상시로 이 신호를 보는 관측자 */
  seenBy: ObserverId[];
  /** 상시 관측자 중 지금 이 신호를 보지 못하는 쪽 */
  blind: ObserverId[];
  headers: { status: string; degraded: string };
  action: string;
  caveats: string[];
  limits: readonly string[];
  runbook: string;
}

/** 공개 응답에 싣는 요약. 이름·판정·개수만 담고 설정값은 담지 않는다. */
export function signalStatus(body: unknown): SignalStatus {
  const r = assessSignalReach(body);
  return {
    verdict: r.verdict,
    degraded: r.degraded,
    failing: r.failing,
    timeBound: r.timeBound,
    visibleToStatusCode: r.visibleToStatusCode,
    visibleToOkFlag: r.visibleToOkFlag,
    seenBy: standingObservers(),
    blind: r.blind,
    headers: { status: HEALTH_STATUS_HEADER, degraded: HEALTH_DEGRADED_HEADER },
    action: r.action,
    caveats: r.caveats,
    limits: SIGNAL_LIMITS,
    runbook: SIGNAL_RUNBOOK_REF,
  };
}

/** 헬스 본문에 `signal` 을 붙인다. `lib/health.ts` 를 건드리지 않아 순환 import 가 없다. */
export function withSignal(body: HealthBody): HealthBody & { signal: SignalStatus } {
  return { ...body, signal: signalStatus(body) };
}

/** 사람이 읽는 요약(보고·문서용). 수치를 지어내지 않는다. */
export function signalText(body: unknown): string[] {
  const r = assessSignalReach(body);
  const lines = [`판정: ${r.verdict}${r.status ? ` (status=${r.status})` : ''}`];
  if (r.failing.length > 0) lines.push(`필수 실패(503): ${r.failing.join(', ')}`);
  if (r.degraded.length > 0) lines.push(`degraded(200): ${r.degraded.join(', ')}`);
  if (r.timeBound.length > 0) lines.push(`창이 닫히면 사라짐: ${r.timeBound.join(', ')}`);
  if (r.blind.length > 0) lines.push(`보지 못하는 상시 관측자: ${r.blind.join(', ')}`);
  lines.push(`할 일: ${r.action}`);
  return lines;
}

/** 로그 한 줄. 체크 이름·개수·판정만 — 설정값·호스트·행 수를 담지 않는다. */
export function signalLogLine(body: unknown): string {
  const r = assessSignalReach(body);
  const parts = [
    'health.signal',
    `verdict=${r.verdict}`,
    `degraded=${r.degraded.length}`,
    `failing=${r.failing.length}`,
  ];
  if (r.degraded.length > 0) parts.push(`names=${r.degraded.join('|')}`);
  if (r.timeBound.length > 0) parts.push(`timeBound=${r.timeBound.join('|')}`);
  return parts.join(' ');
}

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

/**
 * `lib/health.ts` 의 `CheckName` 유니온과 `api/health/route.ts` 의 배선을 양방향 대조한다.
 *
 * 이 저장소에서 체크는 **한 줄씩 손으로 배선**된다(`checks.X = xCheck()`). 유니온에만 추가하고
 * 배선을 빼면 타입 오류가 나지 않는다(`Checks` 가 `Partial` 이다) — 그 체크는 **영원히 응답에
 * 나오지 않으면서 코드·테스트·문서는 전부 통과한다**. 가장 조용한 회귀다.
 */
export function auditCheckWiring(healthSrc: unknown, routeSrc: unknown): string[] {
  const h = String(healthSrc ?? '');
  const r = String(routeSrc ?? '');
  const problems: string[] = [];

  const union = h.match(/export\s+type\s+CheckName\s*=([\s\S]*?);/);
  if (!union) {
    problems.push('lib/health.ts 에서 CheckName 유니온을 찾지 못했다 — 타입 모양이 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const declared = [...union[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
  if (declared.length === 0) {
    problems.push('CheckName 유니온이 비었다');
    return problems;
  }

  const wired = new Set([...r.matchAll(/checks\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
  for (const name of declared) {
    if (!wired.has(name)) problems.push(`checks.${name} 가 라우트에 배선되지 않았다 — 응답에 영원히 나오지 않는다`);
  }
  for (const name of wired) {
    if (!declared.includes(name)) problems.push(`checks.${name} 가 CheckName 에 없다 — 이름이 어긋났다`);
  }
  return problems;
}

/**
 * 라우트가 **판정을 실제로 내보내는지** 점검한다 — 헤더·본문 둘 다.
 * 배선이 빠지면 상시 관측자가 다시 0 명이 되는데, 응답은 그대로 200 이라 사람 눈으로는 알 수 없다.
 */
export function auditHeaderWiring(routeSrc: unknown): string[] {
  const s = String(routeSrc ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/healthSignal['"]/.test(s)) problems.push('healthSignal 을 import 하지 않는다');
  if (!/signalHeaders\(/.test(s)) problems.push('signalHeaders() 를 호출하지 않는다 — degraded 가 헤더에 나오지 않는다');
  else if (!/headers:\s*\{[^}]*\.\.\.signalHeaders\(/.test(s)) {
    problems.push('signalHeaders() 결과를 응답 headers 에 펼치지 않는다(판정만 하고 버리는 꼴)');
  }
  if (!/withSignal\(/.test(s)) problems.push('withSignal() 을 호출하지 않는다 — 본문에 signal 요약이 빠진다');
  else if (!/NextResponse\.json\(\s*withSignal\(/.test(s)) {
    problems.push('withSignal() 결과를 응답 본문으로 내보내지 않는다');
  }
  // 상태 코드를 바꾸면 각 체크가 고른 required:false 결정이 무너진다(복구가 자기 자신을 막는다).
  if (!/status:\s*statusCode\(/.test(s)) problems.push('상태 코드가 statusCode() 경유가 아니다 — degraded 로 503 을 내면 복구가 막힌다');
  return problems;
}

/**
 * 시한부 체크 정본의 이름이 실제 `CheckName` 에 있는지 대조한다.
 * 체크 이름이 바뀌면 이 표는 조용히 **아무 체크도 가리키지 않게** 된다(`timeBound` 가 늘 빈 배열이 된다).
 */
export function auditTimeBoundNames(healthSrc: unknown): string[] {
  const h = String(healthSrc ?? '');
  const union = h.match(/export\s+type\s+CheckName\s*=([\s\S]*?);/);
  if (!union) return ['lib/health.ts 에서 CheckName 유니온을 찾지 못했다'];
  const declared = [...union[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
  return TIME_BOUND_CHECKS.filter((t) => !declared.includes(t.name)).map(
    (t) => `시한부 정본의 ${t.name} 이(가) CheckName 에 없다 — 표가 가리킬 곳을 잃었다`,
  );
}

/** RUNBOOK §2-2 가 사라지거나 헤더 이름이 문서에서 빠지면 감시자 설정 근거가 없어진다. */
export function auditRunbookSignal(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*2-2\./m.test(s)) problems.push('§2-2(판정의 도달) 절이 없다');
  if (!new RegExp(HEALTH_STATUS_HEADER).test(s)) problems.push(`${HEALTH_STATUS_HEADER} 가 문서에 없다 — 감시자에 걸 조건이 사라진다`);
  if (!new RegExp(HEALTH_DEGRADED_HEADER).test(s)) problems.push(`${HEALTH_DEGRADED_HEADER} 가 문서에 없다`);
  if (!/degraded[^\n]*200/.test(s)) problems.push('「degraded 는 200 이다」는 사실이 §2-2 에 없다');
  for (const o of OBSERVERS) {
    if (!s.includes(o.id)) problems.push(`관측자 ${o.id} 가 문서 표에 없다`);
  }
  return problems;
}
