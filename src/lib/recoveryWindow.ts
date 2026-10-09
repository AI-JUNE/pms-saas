/**
 * recoveryWindow.ts — RUNBOOK §3 **3단계「복구 브랜치 생성」**을 수행·판정 가능하게 한다. 2026-10-09
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * 1·2·4·5·6·7단계를 기계화한 뒤 남은 3단계는 한 문장이다 —
 * 「Neon에서 시점 **T-ε** 로 새 브랜치를 만든다」. 그 한 문장에 세 가지가 빠져 있었다.
 *
 *  (1) **ε 가 정의되지 않았다.** 담당자가 그 자리에서 임의로 정한다. ε 가 너무 작으면 손상
 *      트랜잭션이 복구 브랜치에 **그대로 들어오는데**, 4단계 대조는 핵심 테이블의 **행 수**만
 *      보므로 손상이 삭제가 아니라 **변조·부분 삭제**인 경우 행 수는 기준치 이상이라 `ok` 가
 *      나오고 `switchReady: true` → 5단계 전환으로 간다. 즉 **손상을 복구로 고정**한다.
 *      반대로 ε 를 과하게 키우면 유실 구간(RPO)이 불필요하게 커진다. 어느 쪽도 오류를 내지 않는다.
 *  (2) **T 가 PITR 보존 창 안인지 확인하는 단계가 없었다.** 보존기간은 §1 에 `[확인 필요]` 로
 *      **비어 있고**, §2 월 점검은 「최신 복구 가능 시점 확인」만 지시하고 그 수치를 남기지 않는다.
 *      그래서 담당자는 1~2단계 — 그 2단계가 **쓰기 차단(전 사용자 저장 503)**이다 — 를 모두 수행한
 *      뒤 3단계에서야 「그 시점으로는 브랜치를 만들 수 없다」를 알게 된다. **복구는 불가능한데
 *      서비스는 멈춘 상태**이고, 그 시점에는 되돌릴 선택지도 남아 있지 않다.
 *  (3) **보존 창의 하한은 현재 시각과 함께 전진한다.** 1단계 조사(감사로그 페이징·§3-5 근거 보존)에
 *      쓴 시간만큼 T 가 창 밖으로 밀려난다 — 즉 **조사하는 사이에 복구 가능성이 사라질 수 있다**.
 *      「언제까지 결정해야 하는가」가 절차에 없었다.
 *
 * 이 모듈은 T 와 ε 를 받아 **Neon 콘솔에 넣을 복구 시점**과, 그 시점이 보존 창 안인지·언제까지
 * 유효한지·되돌아가지 못하는 구간이 얼마인지를 수치로 돌려준다.
 *
 * 원칙
 * - **임의 보존기간 금지**: 보존 창 길이는 `RECOVERY_PITR_RETENTION_HOURS` 설정값만 인정한다.
 *   Neon 플랜마다 다른 값을 코드가 추측하지 않는다 — 미설정이면 판정을 **보류**(`unknown_window`)하고
 *   「창 밖이다」로도 「안이다」로도 단정하지 않는다.
 * - **임의 ε 금지**: 기본 ε 를 만들지 않는다. 주지 않으면 `invalid_epsilon` 으로 멈추고 ε 를 근거
 *   있게 고르는 방법(`EPSILON_RULES`)을 함께 돌려준다.
 * - 판정은 입력 해석뿐 — DB·네트워크·파일시스템 미접근, 신규 조회·쓰기·DDL 0.
 */

import { parseInstant } from './incidentEvidence.ts';

/** 보존 창 길이(시간) 설정 키. 미설정이면 창 판정을 하지 않는다 */
export const PITR_RETENTION_ENV = 'RECOVERY_PITR_RETENTION_HOURS';

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;

/** 설정값 상한(365일)·ε 상한(7일)은 **오타 방어용 범위**이지 기본값이 아니다 */
const RETENTION_MAX_HOURS = 8760;
const EPSILON_MAX_MINUTES = 10080;

/**
 * - `ok`              : T-ε 가 보존 창 안이다. 그 시점으로 브랜치를 만들 수 있다(마감은 `deadline`).
 * - `expired`         : T-ε 가 **창 밖**이다 — 그 시점으로는 브랜치를 만들 수 없다.
 * - `future`          : T 가 현재보다 미래다(오타·시계 어긋남).
 * - `invalid_time`    : T 를 읽을 수 없다.
 * - `invalid_epsilon` : ε 가 없거나 범위 밖이다 — 임의 기본값을 쓰지 않는다.
 * - `unknown_window`  : 보존 창 길이를 몰라 창 안·밖을 판정하지 않았다(복구 시점 산출만).
 */
export const WINDOW_VERDICTS = [
  'ok',
  'expired',
  'future',
  'invalid_time',
  'invalid_epsilon',
  'unknown_window',
] as const;
export type WindowVerdict = (typeof WINDOW_VERDICTS)[number];

export interface RestorePointPlan {
  verdict: WindowVerdict;
  /** Neon 콘솔에 넣을 복구 시점 T-ε (ISO·UTC). 산출 불가면 null — 지어내지 않는다 */
  restorePoint: string | null;
  /** 정규화된 손상 시각 T(ISO·UTC). 판독 실패면 null */
  damageAt: string | null;
  /** 적용된 ε(분). 무효면 null */
  epsilonMinutes: number | null;
  /** 판정에 쓴 보존 창 길이(시간). 미설정이면 null → 창 판정 보류 */
  retentionHours: number | null;
  /** 보존 창의 하한(= 현재 - 보존기간). 모르면 null. **이 값은 시간과 함께 전진한다** */
  windowStart: string | null;
  /** 이 복구 시점으로 브랜치를 만들 수 있는 **마지막 시각**(= T-ε + 보존기간). 모르면 null */
  deadline: string | null;
  /** 마감까지 남은 시간(분). 모르면 null. 0 이하는 `expired` 로만 나온다 */
  remainingMinutes: number | null;
  /** 이 시점으로 되돌리면 사라지는 구간(= 현재 - T-ε, 분) = RPO. 산출 불가면 null */
  lossMinutes: number | null;
  /** T 에 타임존이 없어 **UTC 로 읽었는지**. true 면 KST 로 적었을 때 9시간 어긋난다 */
  zonelessInput: boolean;
  /** 사람이 해야 할 일 한 줄 */
  action: string | null;
  caveats: readonly string[];
}

/* ───────────────────────────── 조치·주의 문구 ───────────────────────────── */

export const ACTION_WINDOW_OK =
  '이 복구 시점으로 Neon 복구 브랜치를 만든다(운영 브랜치는 그대로 둔다). ' +
  '브랜치 생성 후 지문을 §3-4 명령으로 산출해 4단계 대조에 쓴다';

export function actionWindowExpired(windowStart: string, retention: number): string {
  return (
    `복구 시점이 보존 창(최근 ${retention}시간, ${windowStart} 이후) **밖**이다 — 그 시점으로는 브랜치를 만들 수 없다. ` +
    'Neon 콘솔의 「복구 가능 시점」을 정본으로 다시 확인하고, 창 안의 가장 이른 시점으로 복구할지(= 손상 구간이 ' +
    '일부 포함될 수 있다 → 4단계 대조로 판단) 또는 복구를 포기하고 다른 수단(§5 배포 롤백·수동 정정)을 쓸지 **사람이 결정**한다. ' +
    '2단계 쓰기 차단을 이미 걸었다면 그 결정 전에 해제 여부를 함께 판단한다(§3 7단계)'
  );
}

export const ACTION_WINDOW_FUTURE =
  '손상 시각 T 가 현재보다 미래다 — 오타이거나 타임존을 잘못 붙였다(KST 를 UTC 로 적으면 9시간 미래가 된다). ' +
  'T 를 다시 확인한다. 미래 시각으로는 복구 시점을 산출하지 않는다';

export const ACTION_WINDOW_INVALID_TIME =
  '손상 시각 T 를 읽을 수 없다 — `2026-10-09T13:05:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 적는다. ' +
  '§3 1단계의 감사로그에서 원인 작업의 시각을 가져온다';

export const ACTION_EPSILON_MISSING =
  'ε(여유분, 분 단위)이 지정되지 않았다 — 임의 기본값을 쓰지 않는다. ' +
  '§3 1단계에서 특정한 **원인 작업 직전** 감사 기록과 T 의 간격을 ε 로 쓴다(EPSILON_RULES 참고)';

export const ACTION_EPSILON_INVALID =
  `ε 가 범위 밖이다 — 1~${EPSILON_MAX_MINUTES}분(7일) 사이의 정수로 적는다. ` +
  '0 이하는 손상 트랜잭션을 복구 브랜치에 그대로 들여오고, 과한 값은 유실 구간만 키운다';

export const ACTION_WINDOW_UNKNOWN =
  `보존 창 길이(\`${PITR_RETENTION_ENV}\`)가 설정되지 않아 이 시점으로 브랜치를 만들 수 있는지 **판정하지 않았다** — ` +
  'Neon 콘솔의 「복구 가능 시점(History retention)」을 확인해 그 값을 환경변수로 넣고(§1·§4-7), ' +
  '이번 복구에서는 콘솔 표기를 정본으로 사람이 판단한다. 임의 기본 보존기간을 쓰지 않는다';

export const CAVEAT_ZONELESS =
  '손상 시각 T 에 타임존이 없어 **UTC 로 읽었다** — 한국시간으로 적었다면 실제보다 9시간 이른 시점이다. ' +
  '`+09:00` 을 붙여 다시 산출할 것';

export const CAVEAT_WINDOW_MOVES =
  '보존 창의 하한은 **현재 시각과 함께 전진한다** — 이 판정은 산출한 순간 기준이다. ' +
  '조사·승인에 시간을 쓰는 동안 같은 시점이 창 밖으로 밀려날 수 있다(위 deadline)';

export const CAVEAT_EPSILON_INCLUDES_DAMAGE =
  'ε 가 작으면 손상 트랜잭션이 복구 브랜치에 포함된다 — 4단계 대조는 **행 수**만 보므로 ' +
  '변조·부분 삭제는 「기준치 이상」을 그대로 통과한다(행 수가 줄지 않는다)';

export const CAVEAT_NOT_PROOF_OF_CLEAN =
  '보존 창 안이라는 것은 「그 시점으로 되돌릴 수 있다」까지만 뜻한다 — ' +
  '그 시점의 데이터가 **손상 전**이라는 보장은 아니다(T 특정이 틀렸으면 손상된 시점으로 복구한다)';

/** 보존 창 판정이 보장하지 **못하는** 것 — 응답·RUNBOOK 에 그대로 실어 보낸다 */
export const WINDOW_LIMITS: readonly string[] = [
  '보존기간은 **사람이 적은 설정값**이다 — 플랜 변경·보존 설정 변경을 코드가 알 수 없다. 정본은 Neon 콘솔의 「복구 가능 시점」이다',
  '보존 창은 **브랜치별로 다르다** — 자식 브랜치는 분기 시점보다 이전으로 갈 수 없고, 브랜치를 지우면 그 히스토리도 사라진다',
  '프로젝트·컴퓨트 삭제처럼 히스토리 자체가 없어진 경우는 창 계산과 무관하게 복구 불가다',
  '이 판정은 **시점의 가용성**만 본다 — 실제 브랜치 생성 성공·데이터 정합은 3단계 수행과 4단계 대조가 본다',
  '복구 시점 이후의 데이터는 유실된다(lossMinutes) — 그 구간의 고지는 절차에서 빠지지 않는다',
];

/** ε 를 **근거 있게** 고르는 방법. 수치를 주지 않고 근거를 준다 */
export const EPSILON_RULES: readonly string[] = [
  '§3 1단계 감사로그에서 **원인 작업의 직전 기록** 시각을 찾아 T 와의 간격을 ε 로 쓴다 — 가장 근거 있는 선택이다',
  '감사 조회가 `truncated` 로 남아 있으면 ε 를 정할 근거가 아직 없다 — §3-5 로 끝까지 받은 뒤 정한다',
  'ε 를 키우면 복구 가능성이 아니라 **유실 구간만** 커진다(lossMinutes) — 창 안에서 작게, 다만 원인 작업보다는 앞서게 잡는다',
  '원인 작업을 특정하지 못했다면 ε 를 추측하지 말고 손상 범위 특정(1단계)으로 되돌아간다',
];

/* ───────────────────────────── 설정 로더 ───────────────────────────── */

/**
 * PITR 보존 창 길이(시간). `RECOVERY_PITR_RETENTION_HOURS` 설정값만 인정한다.
 * 미설정·형식 밖·범위 밖은 null — Neon 무료/유료 플랜의 기본값(24시간 등)을 코드가 들고 오지 않는다.
 */
export function retentionHours(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.RECOVERY_PITR_RETENTION_HOURS ?? '').trim();
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= RETENTION_MAX_HOURS ? n : null;
}

function normalizeRetention(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= RETENTION_MAX_HOURS ? raw : null;
}

/** ε(분). 정수·범위 안만 인정하고 **기본값을 만들지 않는다** */
function normalizeEpsilon(raw: unknown): number | null {
  const n = typeof raw === 'string' && /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= 1 && n <= EPSILON_MAX_MINUTES ? n : null;
}

const ZONE_RE = /(?:Z|[+-]\d{2}:\d{2})$/;

/** 입력에 타임존 표기가 있었는지. 없으면 `parseInstant` 가 UTC 로 읽는다 */
export function hasTimezone(v: unknown): boolean {
  return ZONE_RE.test(String(v ?? '').trim());
}

/* ───────────────────────────── 판정 ───────────────────────────── */

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * 복구 시점 T-ε 산출 + 보존 창 판정.
 *
 * 판정 순서를 지킨다 — T 가 틀렸으면 창 계산은 의미가 없고(`invalid_time`/`future`),
 * ε 가 없으면 복구 시점 자체가 없고(`invalid_epsilon`), 보존기간을 모르면 창 안·밖을
 * **단정하지 않는다**(`unknown_window`). 그 다음에야 `expired`/`ok` 를 가른다.
 */
export function planRestorePoint(args: {
  damageAt: unknown;
  epsilonMinutes?: unknown;
  now?: Date;
  retentionHours?: number | null;
}): RestorePointPlan {
  const retention = normalizeRetention(args.retentionHours ?? null);
  const zonelessInput = !hasTimezone(args.damageAt);
  const shell = {
    restorePoint: null,
    damageAt: null,
    epsilonMinutes: null,
    retentionHours: retention,
    windowStart: null,
    deadline: null,
    remainingMinutes: null,
    lossMinutes: null,
    zonelessInput,
    caveats: [] as readonly string[],
  };

  const T = parseInstant(args.damageAt);
  if (!T) {
    return { ...shell, verdict: 'invalid_time', zonelessInput: false, action: ACTION_WINDOW_INVALID_TIME };
  }

  const nowMs = (args.now ?? new Date()).getTime();
  if (Number.isNaN(nowMs)) {
    // 현재 시각을 모르면 창의 하한도 마감도 계산할 수 없다 — 창 판정을 보류한다.
    return {
      ...shell,
      verdict: 'unknown_window',
      damageAt: T.toISOString(),
      action: '현재 시각을 읽을 수 없어 보존 창을 판정하지 못했다 — 서버 시계를 확인할 것',
      caveats: [CAVEAT_WINDOW_MOVES],
    };
  }

  const base = { ...shell, damageAt: T.toISOString() };
  if (T.getTime() > nowMs) {
    // 타임존 없는 입력은 미래 판정의 제1 용의자다 — 그 사실을 함께 돌려준다.
    return {
      ...base,
      verdict: 'future',
      action: ACTION_WINDOW_FUTURE,
      caveats: zonelessInput ? [CAVEAT_ZONELESS] : [],
    };
  }

  const eps = normalizeEpsilon(args.epsilonMinutes);
  if (eps === null) {
    const missing = args.epsilonMinutes === undefined || args.epsilonMinutes === null;
    return {
      ...base,
      verdict: 'invalid_epsilon',
      action: missing ? ACTION_EPSILON_MISSING : ACTION_EPSILON_INVALID,
      caveats: [CAVEAT_EPSILON_INCLUDES_DAMAGE],
    };
  }

  const rpMs = T.getTime() - eps * MS_MIN;
  const restorePoint = iso(rpMs);
  const lossMinutes = Math.ceil((nowMs - rpMs) / MS_MIN);
  const common = {
    ...base,
    restorePoint,
    epsilonMinutes: eps,
    lossMinutes,
  };
  const caveats = [CAVEAT_WINDOW_MOVES, CAVEAT_EPSILON_INCLUDES_DAMAGE, CAVEAT_NOT_PROOF_OF_CLEAN];
  if (zonelessInput) caveats.unshift(CAVEAT_ZONELESS);

  if (retention === null) {
    return { ...common, verdict: 'unknown_window', action: ACTION_WINDOW_UNKNOWN, caveats };
  }

  const windowStartMs = nowMs - retention * MS_HOUR;
  const deadlineMs = rpMs + retention * MS_HOUR;
  const withWindow = {
    ...common,
    windowStart: iso(windowStartMs),
    deadline: iso(deadlineMs),
    remainingMinutes: Math.floor((deadlineMs - nowMs) / MS_MIN),
    caveats,
  };

  if (rpMs < windowStartMs) {
    return {
      ...withWindow,
      verdict: 'expired',
      remainingMinutes: null, // 이미 지난 마감에 「남은 시간」을 적지 않는다
      action: actionWindowExpired(iso(windowStartMs), retention),
    };
  }
  return { ...withWindow, verdict: 'ok', action: ACTION_WINDOW_OK };
}

/** 라우트·명령 응답용 — 판정 + 사각지대 + ε 선택 규칙을 함께 내보낸다 */
export function restorePointStatus(args: {
  damageAt: unknown;
  epsilonMinutes?: unknown;
  now?: Date;
  env?: Record<string, string | undefined>;
}): RestorePointPlan & { limits: readonly string[]; epsilonRules: readonly string[] } {
  const plan = planRestorePoint({
    damageAt: args.damageAt,
    epsilonMinutes: args.epsilonMinutes,
    now: args.now,
    retentionHours: retentionHours(args.env ?? process.env),
  });
  return { ...plan, limits: WINDOW_LIMITS, epsilonRules: EPSILON_RULES };
}

/**
 * 사람이 읽을 요약 — 복구 시점·마감·유실 구간을 한 문단으로. 수치만 담는다(자격증명·행 수 없음).
 * RUNBOOK §3-6 의 1줄 명령이 이 문자열을 출력한다.
 */
export function restorePointText(plan: RestorePointPlan): string {
  if (!plan.restorePoint) {
    return `[복구 시점 산출 불가: ${plan.verdict}] ${plan.action ?? ''}`.trim();
  }
  const parts = [`복구 시점(T-ε) = ${plan.restorePoint}`];
  if (plan.lossMinutes !== null) {
    parts.push(`이 시점 이후 약 ${Math.ceil(plan.lossMinutes / 60)}시간분의 데이터는 유실됩니다(고지 대상)`);
  }
  if (plan.verdict === 'ok' && plan.deadline && plan.remainingMinutes !== null) {
    parts.push(`보존 창 마감 ${plan.deadline}(남은 ${Math.floor(plan.remainingMinutes / 60)}시간) — 그 전에 브랜치를 만들어야 합니다`);
  }
  if (plan.verdict === 'expired') parts.push('※ 이 시점은 보존 창 밖입니다 — 브랜치를 만들 수 없습니다');
  if (plan.verdict === 'unknown_window') parts.push('※ 보존 창 판정 보류 — Neon 콘솔의 「복구 가능 시점」을 정본으로 확인하세요');
  const text = `${parts.join('. ')}.`;
  return plan.action ? `${text}\n→ ${plan.action}` : text;
}

/** 로그 한 줄. 시각·수치·판정만 */
export function windowLogLine(plan: RestorePointPlan): string {
  const parts = [`verdict=${plan.verdict}`];
  if (plan.restorePoint) parts.push(`restore_point=${plan.restorePoint}`);
  if (plan.epsilonMinutes !== null) parts.push(`epsilon_min=${plan.epsilonMinutes}`);
  if (plan.retentionHours !== null) parts.push(`retention_h=${plan.retentionHours}`);
  if (plan.remainingMinutes !== null) parts.push(`remaining_min=${plan.remainingMinutes}`);
  if (plan.lossMinutes !== null) parts.push(`loss_min=${plan.lossMinutes}`);
  return `[recovery-window] ${parts.join(' ')}`;
}

/* ───────────────────────────── /api/health 체크 ───────────────────────────── */

/**
 * 보존 창 길이가 **평상시에** 설정돼 있는지 드러낸다 — §1 의 `[확인 필요]` 공백이 복구일에야
 * 발견되는 것을 막는 유일한 장치다. 손상 시각 T 는 사건마다 다르므로 여기서는 판정하지 않는다
 * (행 수·연결 문자열·호스트 등 민감값을 담지 않는다. 공개 엔드포인트다).
 *
 * **required: false** — 미설정은 degraded(200)로만 드러내고 503 을 만들지 않는다.
 */
export function pitrWindowCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const hours = retentionHours(args?.env ?? process.env);
  return {
    ok: hours !== null,
    required: false,
    detail: {
      retentionConfigured: hours !== null,
      retentionHours: hours,
      configKey: PITR_RETENTION_ENV,
      note:
        hours === null
          ? `${PITR_RETENTION_ENV} 미설정 — 복구 시점이 보존 창 안인지 기계적으로 판정할 수 없다(RUNBOOK §3-6). 임의 기본 보존기간을 쓰지 않는다`
          : `복구 시점이 최근 ${hours}시간 안인지 판정한다. 이 값은 사람이 Neon 콘솔에서 확인해 적은 값이다`,
      limits: WINDOW_LIMITS,
    },
  };
}

/* ───────────────────────────── 배선 정적 점검 ───────────────────────────── */

/** `/api/health` 가 보존 창 체크를 **응답에 실어** 보내는지 원문으로 고정한다 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/recoveryWindow['"]/.test(s)) problems.push('recoveryWindow 를 import 하지 않는다');
  if (!/pitrWindowCheck\(/.test(s)) problems.push('pitrWindowCheck() 를 호출하지 않는다 — 보존기간 미설정이 평상시에 드러나지 않는다');
  if (!/checks\.recoveryWindow\s*=\s*pitrWindowCheck\(/.test(s))
    problems.push('판정을 checks.recoveryWindow 로 내보내지 않는다(판정만 하고 버리는 꼴)');
  return problems;
}

/**
 * 실제 `RUNBOOK.md` 점검 — 3단계가 **산출·판정 가능한 문장**으로 남아 있는지.
 * 「T-ε 로 브랜치를 만든다」 한 문장으로 되돌아가면(ε 근거·보존 창 확인 없이) CI 를 실패시킨다.
 */
export function auditRunbookWindow(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!s.includes(PITR_RETENTION_ENV)) problems.push(`보존 창 설정 키(${PITR_RETENTION_ENV})가 문서에 없다`);
  if (!/###\s*3-6\./.test(s)) problems.push('§3-6(복구 시점 산출) 절이 없다');
  if (!/planRestorePoint\(|restorePointText\(/.test(s)) problems.push('§3-6 에 복구 시점 산출 명령이 없다');
  if (!s.includes('checks.recoveryWindow')) problems.push('평상시 확인 수단(checks.recoveryWindow)이 적혀 있지 않다');

  const sec3 = s.slice(s.indexOf('## 3. DB 복구 절차'), s.indexOf('### 3-1.'));
  if (!sec3) { problems.push('§3 본문을 찾을 수 없다'); return problems; }
  if (!sec3.includes('3-6')) problems.push('§3 단계 본문이 3-6 을 가리키지 않는다 — 담당자가 산출 절차에 닿지 못한다');
  if (!/보존 창|복구 가능 시점/.test(sec3)) problems.push('§3 본문에 보존 창(복구 가능 시점) 확인이 없다');
  return problems;
}

/** 설정 상태 요약(문서·보고용) */
export function windowStatus(env: Record<string, string | undefined> = process.env): {
  retentionConfigured: boolean;
  retentionHours: number | null;
  note: string;
} {
  const hours = retentionHours(env);
  return {
    retentionConfigured: hours !== null,
    retentionHours: hours,
    note:
      hours === null
        ? `${PITR_RETENTION_ENV} 미설정 — 보존 창 판정 보류(임의 기본 보존기간 없음)`
        : `복구 시점이 최근 ${hours}시간 밖이면 expired 로 판정한다`,
  };
}
