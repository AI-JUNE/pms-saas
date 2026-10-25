/**
 * externalReconcile.ts — 복구가 **되돌릴 수 없는 외부 상태**와의 대조(RUNBOOK §3 6-2단계·§3-9). 2026-10-15
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 1~8단계·§5·§2·§4 는 모두 기계적으로 수행·확인할 수 있게 됐다. 그 전부가 다루는 것은
 * **이 DB 안의 상태**다 — 행 수를 대조하고(4단계), 스키마를 확인하고(6단계), 되돌아간 보안
 * 조치를 다시 적용하고(6-1단계), 유실 구간을 고지한다(8단계). 그런데 시점 복구가 **되돌리지
 * 못하는** 상태가 있다: 이미 외부 시스템에서 일어난 일이다.
 *
 *  (1) **약속은 이미 적혀 있는데 수행 수단이 없었다.** `lib/writeFreeze.ts` 의 `FREEZE_LIMITS`
 *      마지막 줄은 「외부 웹훅(결제 등)도 차단되어 503 을 받는다 — 제공자 재시도에 의존하며,
 *      **재시도 만료분은 수동 대조가 필요하다**」고 스스로 적어 두었다. 그런데 §3 어디에도 그
 *      대조 단계가 없다 — **무엇과 무엇을**, **어느 구간을** 대조하는지도, 했다는 **기록**도 없다.
 *
 *  (2) **전환은 반영 결과만 되돌린다.** 결제가 플랜에 반영되는 경로는 하나다 —
 *      `api/billing/webhook` 이 `organizations.plan` 을 갱신하고 감사 이벤트
 *      `BILLING_PLAN_APPLIED` 를 남긴다. 5단계 전환은 그 **칼럼과 감사 행을 T-ε 로 되돌리고**,
 *      제공자(PortOne) 쪽 결제·구독·영수증은 그대로 남는다. 그래서 두 방향의 어긋남이 생긴다 —
 *      복구 시점 이후 결제한 조직은 **돈은 냈는데 플랜이 내려가고**(`ENTITLEMENTS_ENFORCE` 가
 *      ON 이면 좌석·기능이 즉시 잠긴다), 복구 시점 이후 해지·강등을 반영한 조직은 **유료 플랜이
 *      되살아난다**(과금 근거 없이 열린다. 이쪽은 아무도 신고하지 않는다).
 *
 *  (3) **어떤 검증도 이것을 잡지 못한다.** 4단계 핵심 테이블 목록에 `organizations` 는 있지만
 *      세는 것은 **행 수**다 — 전 조직의 `plan` 이 옛 값으로 돌아가도 행 수는 그대로이므로 `ok` 다.
 *      6단계 `schema.verdict` 는 테이블 존재만 본다. 그리고 차단 중의 503 은 **미들웨어**가 내므로
 *      라우트 로그에도 남지 않고, 제공자 쪽 재시도 실패 이력은 애초에 이 DB 에 없다.
 *
 *  (4) **대조의 근거가 복구와 함께 사라진다.** 반영 이력은 같은 DB 의 감사 행이라 전환이 되돌린다 —
 *      §3-5 로 **DB 밖에** 보존해 두지 않았으면 「누가 무엇을 결제해 어떤 플랜이 됐는지」를 복구된
 *      DB 안에서 재구성할 수 없다. 남는 정본은 **제공자 콘솔뿐**이다.
 *
 * 그래서 이 모듈은
 *   · 복구가 되돌리지 못하는 외부 상태를 **정본 목록**으로 두고(`EXTERNAL_SYSTEMS` — 무엇이 어디에
 *     있고, 복구가 되돌리는 쪽은 무엇이며, 왜 아무 검증에도 안 걸리는가),
 *   · 어긋남의 **두 방향**을 각각 적고(`DRIFT_DIRECTIONS` — 한 방향은 사용자가 신고하고 다른
 *     방향은 아무도 신고하지 않는다),
 *   · **대조 구간**을 산출하고(`assessReconcileWindow` — 끝은 차단 시각이 아니라 **해제 시각**이다.
 *     차단 중 거절된 웹훅까지 들어가야 하므로 §3-7 유실 구간보다 **넓다**),
 *   · 재적용과 같은 자리에서 **해제(7단계) 전에** 끝내도록 절차를 세우고(`RECONCILE_STEPS`),
 *   · 그 완료를 기록으로 승격해(`RECOVERY_EXTERNAL_RECONCILED_AT`) 차단이 걸려 있는 동안 —
 *     **아직 사용자가 들어오지 못하는 동안** — 미기록을 `/api/health` 로 드러내고(`externalStateCheck`),
 *   · 대조가 보장하지 **못하는** 것을 `EXTERNAL_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 명시 로더에서만 읽는다.
 * - **임의 수치 금지**: 제공자 재시도 창의 길이를 코드가 정하지 않는다(제공자 문서·콘솔이 정본이다).
 *   끝 시각이 없으면 §3-7 의 **차단 시각으로 좁히지 않는다** — 그러면 차단 구간이 조용히 빠진다.
 * - **자동화가 대조를 대신하지 않는다** — 제공자 조회·`plan` 재반영은 운영 DB 쓰기이고 사람이 한다.
 *   이 모듈은 **구간·대상·순서**까지만 말한다.
 * - **새 거짓 ok 를 만들지 않는다**: 기록했다는 것이 「어긋남이 없다」는 뜻이 아니다.
 */
import { parseInstant } from './incidentEvidence.ts';
import { FREEZE_AT_ENV, freezeAtFromEnv } from './incidentClosure.ts';
import { assessTimeline, markerCorroboration } from './incidentTimeline.ts';
import { FREEZE_EXEMPT, WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';
import { CORE_TABLE_ROLES } from './recoveryVerify.ts';

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;

/** 외부 대조를 **마친 시각**을 적어 두는 키. 평상시 미설정이 정상이다 */
export const EXTERNAL_RECONCILED_ENV = 'RECOVERY_EXTERNAL_RECONCILED_AT';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const EXTERNAL_RUNBOOK_REF = 'RUNBOOK §3 6-2단계·§3-9';

/** 결제 반영 게이트 — `lib/billingWebhook.ts` `decideWebhookAction` 이 보는 두 스위치와 같다 */
export const PAYMENTS_LIVE_SWITCH = 'PAYMENTS_LIVE';
export const BILLING_APPLY_SWITCH = 'BILLING_APPLY_LIVE';

/** 결제가 플랜에 반영되는 유일한 경로 — 차단 예외로 열려 있지 **않다**(그것이 의도다) */
export const BILLING_WEBHOOK_PATH = '/api/billing/webhook';

/** 복구가 되돌리는 쪽(= 반영 결과)이 들어 있는 칼럼 */
export const APPLIED_PLAN_COLUMN = 'organizations.plan';

/* ──────────────── 복구가 되돌리지 못하는 외부 상태(정본) ──────────────── */

export interface ExternalSystem {
  key: string;
  /** 상태의 정본이 있는 곳 */
  system: string;
  /** 거기에 남아 있는 것 */
  holds: string;
  /** 복구가 되돌려 버리는 **이쪽** 상태 */
  reverted: string;
  /** 복구가 되돌리지 못하는 **저쪽** 상태 */
  cannotRevert: string;
  /** 전환 뒤 실제로 생기는 일 */
  effect: string;
  /** 왜 아무 검증에도 걸리지 않는가 */
  silent: string;
  /** 지금(기본 설정)의 상태 — 과장하지 않는다 */
  today: string;
}

export const EXTERNAL_SYSTEMS: readonly ExternalSystem[] = [
  {
    key: 'payment_plan_apply',
    system: '결제 제공자(PortOne)',
    holds: '결제·구독·영수증. 플랜의 **근거**는 전부 이쪽에 있다',
    reverted: `${APPLIED_PLAN_COLUMN} 과 감사 이벤트 \`BILLING_PLAN_APPLIED\`(\`api/billing/webhook\` 이 남긴다)`,
    cannotRevert: '이미 승인된 결제·활성 구독·발행된 영수증 — 복구는 제공자를 건드리지 않는다',
    effect:
      '복구 시점 이후의 반영이 사라진다 — 결제한 조직은 옛 플랜으로 돌아가고, 해지·강등을 반영한 ' +
      '조직은 유료 플랜이 되살아난다. 두 방향 모두 오류를 내지 않는다',
    silent:
      '4단계 핵심 테이블에 `organizations` 는 있지만 세는 것은 **행 수**다 — 전 조직의 plan 이 옛 값으로 ' +
      '돌아가도 행 수는 그대로여서 `ok` 다. 6단계는 테이블 존재만 본다',
    today: `${BILLING_APPLY_SWITCH}·${PAYMENTS_LIVE_SWITCH} 기본 OFF — 반영이 없으므로 되돌아갈 것도 없다 [활성화 승인 필요]`,
  },
  {
    key: 'payment_webhook_ack',
    system: `결제 웹훅(\`${BILLING_WEBHOOK_PATH}\`)의 제공자측 재시도 창`,
    holds: '아직 ack 되지 않은 이벤트. 창이 지나면 **다시 오지 않는다**',
    reverted: '없다 — 차단 중에는 애초에 반영되지 않는다(503)',
    cannotRevert: '이미 끝난 재시도 — 되돌려 받을 수 없다',
    effect:
      '차단 구간에 도착한 결제 이벤트는 503 을 받고 제공자 재시도에 맡겨진다. 차단이 재시도 창보다 ' +
      '길면 그 결제는 **영구히 반영되지 않는다** — `FREEZE_LIMITS` 가 「재시도 만료분은 수동 대조가 ' +
      '필요하다」고 적어 둔 바로 그 구간이다',
    silent:
      '거절은 라우트가 아니라 **미들웨어**가 내므로 애플리케이션 로그에 결제 이벤트로 남지 않고, ' +
      '제공자 쪽 재시도 실패 이력은 이 DB 에 없다',
    today: `차단 예외(\`FREEZE_EXEMPT\`)에 **넣지 않았다** — 열면 차단 중 반영이 **버려지는 DB** 에 쌓여 전환에서 함께 사라진다(지금이 덜 나쁜 쪽이다)`,
  },
  {
    key: 'outbound_mail',
    system: '수신자 메일함(비밀번호 재설정·알림 발송)',
    holds: '이미 보낸 메일과 그 안의 링크',
    reverted: '`password_reset_tokens` 행(복구 시점 이후 발급분이 사라진다)',
    cannotRevert: '이미 도착한 메일 — 회수할 수 없다',
    effect:
      '복구 시점 이후 발급·발송된 재설정 링크는 토큰 행이 없어져 **「유효하지 않은 링크」**가 된다 — ' +
      '사용자에게는 원인 없는 실패로만 보인다(6-1단계 3번의 무효화와 **방향이 반대**다)',
    silent: '발송 이력도 같은 DB 에 있어 함께 되돌아간다 — 누구에게 보냈는지 복구된 DB 에서 알 수 없다',
    today: '`MAIL_PROVIDER` 미설정 = log 스텁이라 **실발송 0** — 지금은 발생하지 않는다 [활성화 승인 필요]',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function systemFor(key: unknown): ExternalSystem | null {
  const k = String(key ?? '').trim();
  return EXTERNAL_SYSTEMS.find((s) => s.key === k) ?? null;
}

/* ──────────────────────── 어긋남의 두 방향 ──────────────────────── */

export interface DriftDirection {
  key: string;
  when: string;
  /** 복구 후 DB 가 말하는 것 */
  dbSays: string;
  /** 제공자가 말하는 것 */
  providerSays: string;
  impact: string;
  fix: string;
  /** 누가 알려 주는가 — 한쪽은 아무도 알려 주지 않는다 */
  whoReports: string;
}

export const DRIFT_DIRECTIONS: readonly DriftDirection[] = [
  {
    key: 'paid_not_applied',
    when: '대조 구간에 결제가 일어나 플랜이 올라갔다(또는 올라갈 웹훅이 차단 중 거절됐다)',
    dbSays: '옛 플랜 — 대개 무료',
    providerSays: '결제 승인·구독 활성',
    impact:
      '돈은 받았는데 좌석·기능이 내려간다. `ENTITLEMENTS_ENFORCE` 가 ON 이면 관측이 아니라 **차단**으로 ' +
      '즉시 체감된다',
    fix:
      '제공자 콘솔의 결제 목록을 기준으로 plan 을 다시 반영한다 — **재결제를 요청하지 않는다**(이중 청구가 된다)',
    whoReports: '사용자가 문의로 알려 준다 — 다만 원인을 복구와 연결하지 못한다',
  },
  {
    key: 'revoked_but_restored',
    when: '대조 구간에 해지·강등·환불을 플랜에 반영했다',
    dbSays: '유료 플랜이 되살아나 있다',
    providerSays: '해지됨·환불됨',
    impact: '과금 근거 없이 유료 기능·좌석이 열린다. 다음 정산·매출 귀속이 함께 어긋난다',
    fix: '해지·환불 목록을 기준으로 plan 을 되돌린다',
    whoReports: '**아무도 알려 주지 않는다** — 쓰는 쪽에 불리하지 않으므로 신고되지 않는다',
  },
];

/** 모르는 키는 null */
export function driftFor(key: unknown): DriftDirection | null {
  const k = String(key ?? '').trim();
  return DRIFT_DIRECTIONS.find((d) => d.key === k) ?? null;
}

/* ─────────────────── 대조가 보장하지 못하는 것 ─────────────────── */

export const EXTERNAL_LIMITS: readonly string[] = [
  '대조의 정본은 **제공자 콘솔**이다 — 반영 이력(`BILLING_PLAN_APPLIED`)은 같은 DB 의 감사 행이라 전환과 함께 되돌아간다. §3-5 로 밖에 보존하지 않았으면 복구된 DB 안에서 대상을 재구성할 수 없다',
  '이 모듈은 **구간·대상·순서**까지만 말한다 — 제공자 조회와 plan 재반영은 운영 DB 쓰기이고 사람이 한다(자동화하지 않았다)',
  '§3-7 유실 구간과 **다른 구간**이다 — 그쪽 끝은 차단 시각이고 이쪽 끝은 **해제 시각**이다(차단 중 거절된 웹훅까지 들어가야 한다). 두 수치를 섞어 쓰지 않는다',
  '제공자가 재시도를 **언제까지** 하는지는 코드가 모른다 — 창 길이는 제공자 문서·콘솔에서 사람이 확인한다. 임의 수치를 두지 않으므로 「재시도로 알아서 들어왔다」고 단정할 수 없다',
  '구간 **밖**의 어긋남은 보지 않는다 — 복구와 무관하게 쌓인 미반영 결제(웹훅 유실·수동 계약·엔터프라이즈)는 평상시 대조 대상이다',
  `기록(\`${EXTERNAL_RECONCILED_ENV}\`)은 「했다고 적었다」는 뜻이다 — 몇 건을 어떻게 맞췄는지는 검증하지 않는다`,
  '어긋남을 고친 결과도 같은 DB 의 행이다 — **두 번째 복구**를 하면 다시 되돌아간다',
];

/* ────────────────────────── 대조 구간 산출 ────────────────────────── */

export const RECONCILE_VERDICTS = [
  'ok',
  'invalid_restore_point',
  'end_unrecorded',
  'invalid_end',
  'end_before_start',
  'future_end',
] as const;
export type ReconcileVerdict = (typeof RECONCILE_VERDICTS)[number];

export const ACTION_WINDOW_OK =
  '이 구간에 제공자 쪽에서 일어난 결제·해지·환불을 전부 뽑아 `' +
  APPLIED_PLAN_COLUMN +
  '` 과 **양방향으로** 대조한다 — 그 뒤 7단계 해제로 간다';

export const ACTION_WINDOW_INVALID_RESTORE_POINT =
  '복구 시점(T-ε)을 읽을 수 없어 대조 구간을 산출하지 못했다 — ' +
  '`2026-10-15T13:05:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 다시 넣는다(§3-6 의 `restorePoint`)';

export const ACTION_WINDOW_END_UNRECORDED =
  '구간의 끝(= 쓰기 차단을 **해제한** 시각)이 없다 — 7단계 해제 시각을 적어 넣는다. ' +
  `§3-7 의 끝(\`${FREEZE_AT_ENV}\` = 차단을 **건** 시각)으로 대신하지 않는다: ` +
  '그러면 차단 구간에 거절된 웹훅이 구간에서 조용히 빠진다';

export const ACTION_WINDOW_INVALID_END =
  '구간의 끝을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다. 못 읽는 값을 「없음」으로 덮지 않는다';

export const ACTION_WINDOW_END_BEFORE_START =
  '끝이 시작보다 앞이다 — 어느 쪽 시각이 잘못 적혔는지 확인한다. **음수를 0 으로 깎아 「대조할 것이 없다」로 만들지 않는다**';

export const ACTION_WINDOW_FUTURE_END =
  '끝이 미래다 — 아직 해제하지 않았다면 해제 후에 산출한다(지금 구간을 확정하면 그 뒤 거절되는 웹훅이 빠진다)';

export const CAVEAT_WIDER_THAN_LOSS_WINDOW =
  '이 구간은 §3-7 유실 구간보다 **넓다** — 유실 구간은 차단으로 끝나지만, 차단 중에도 제공자는 ' +
  '웹훅을 보내다 포기한다. 고지 수치로 이 값을 쓰지 않는다';

export const CAVEAT_WINDOW_IS_NOT_A_COUNT =
  '구간은 **시간 범위**일 뿐 몇 건이 어긋났는지는 말하지 않는다 — 건수는 제공자 콘솔에서 센다';

export const CAVEAT_PROVIDER_CLOCK =
  '제공자 쪽 시각은 자기 타임존·자기 시계로 기록된다 — 구간 경계의 건은 **양쪽 모두** 확인한다';

export interface ReconcileWindow {
  verdict: ReconcileVerdict;
  /** 구간의 시작 = 복구 시점(T-ε) */
  startsAt: string | null;
  /** 구간의 끝 = 쓰기 차단 해제 시각 */
  endsAt: string | null;
  endKind: 'release' | null;
  /** `ok` 일 때만 채운다 */
  minutes: number | null;
  hours: number | null;
  /** 참고용 — 차단을 건 시각(§3-7 유실 구간의 끝). 구간의 끝이 **아니다** */
  freezeAt: string | null;
  notice: string;
  action: string;
  caveats: string[];
}

/**
 * 대조 구간 = **복구 시점(T-ε) ~ 쓰기 차단 해제 시각**.
 *
 * 왜 해제 시각인가: 차단 중에도 제공자는 웹훅을 보내고 503 을 받는다. 그 구간을 빼면
 * 「재시도 만료분」이 대조 대상에서 조용히 사라진다. 그래서 §3-7 유실 구간(끝 = 차단 시각)보다 넓다.
 *
 * 못 읽는 값은 **추측하지 않는다** — 끝이 없으면 차단 시각으로 좁히지 않고 `end_unrecorded` 로 멈춘다.
 */
export function assessReconcileWindow(input: {
  restorePoint: unknown;
  releasedAt: unknown;
  freezeAt?: unknown;
  now?: Date;
}): ReconcileWindow {
  const caveats = [CAVEAT_WIDER_THAN_LOSS_WINDOW, CAVEAT_WINDOW_IS_NOT_A_COUNT, CAVEAT_PROVIDER_CLOCK];
  const rp = parseInstant(input?.restorePoint);
  const fz = input?.freezeAt === undefined ? null : parseInstant(input.freezeAt);
  const freezeAt = fz ? fz.toISOString() : null;

  const shell = {
    startsAt: rp ? rp.toISOString() : null,
    endsAt: null,
    endKind: null,
    minutes: null,
    hours: null,
    freezeAt,
    caveats,
  } as const;

  if (!rp) {
    return {
      ...shell,
      verdict: 'invalid_restore_point',
      notice: '대조 구간을 산출하지 못했습니다 — 복구 시점을 읽을 수 없습니다.',
      action: ACTION_WINDOW_INVALID_RESTORE_POINT,
    };
  }

  const rawEnd = String(input?.releasedAt ?? '').trim();
  if (!rawEnd) {
    return {
      ...shell,
      verdict: 'end_unrecorded',
      notice: '대조 구간의 끝(쓰기 차단 해제 시각)이 기록되지 않아 구간을 확정하지 못했습니다.',
      action: ACTION_WINDOW_END_UNRECORDED,
    };
  }
  const end = parseInstant(rawEnd);
  if (!end) {
    return {
      ...shell,
      verdict: 'invalid_end',
      notice: '대조 구간의 끝을 읽을 수 없습니다.',
      action: ACTION_WINDOW_INVALID_END,
    };
  }
  if (end.getTime() < rp.getTime()) {
    return {
      ...shell,
      verdict: 'end_before_start',
      endsAt: end.toISOString(),
      notice: '대조 구간의 끝이 복구 시점보다 앞섭니다 — 구간을 수치로 확정하지 않습니다.',
      action: ACTION_WINDOW_END_BEFORE_START,
    };
  }

  const nowMs = (input?.now ?? new Date()).getTime();
  if (Number.isFinite(nowMs) && end.getTime() > nowMs) {
    return {
      ...shell,
      verdict: 'future_end',
      endsAt: end.toISOString(),
      notice: '대조 구간의 끝이 미래입니다 — 아직 끝나지 않은 구간을 확정하지 않습니다.',
      action: ACTION_WINDOW_FUTURE_END,
    };
  }

  const ms = end.getTime() - rp.getTime();
  return {
    startsAt: rp.toISOString(),
    endsAt: end.toISOString(),
    endKind: 'release',
    verdict: 'ok',
    minutes: Math.round(ms / MS_MIN),
    hours: Math.round((ms / MS_HOUR) * 100) / 100,
    freezeAt,
    notice:
      `대조 구간은 ${rp.toISOString()} ~ ${end.toISOString()} 입니다 — 이 구간에 제공자 쪽에서 일어난 ` +
      '결제·해지·환불은 복구된 DB 에 반영되어 있지 않을 수 있습니다(양방향).',
    action: ACTION_WINDOW_OK,
    caveats,
  };
}

/* ────────────────────── 대조 절차(사람이 수행) ────────────────────── */

export interface ReconcileStep {
  n: number;
  what: string;
  why: string;
  /** 대조 근거를 어디서 얻는가 */
  evidence: string;
}

/**
 * 전환(5단계)·스키마 정합(6단계)·보안 재적용(6-1단계) 뒤, **차단 해제(7단계) 전에** 끝내는 절차.
 * 순서가 중요하다 — 해제하면 어긋난 플랜 그대로 사용자가 들어오고, 그때부터는 어느 변경이
 * 복구 탓인지 구분하기 어려워진다. 실행(제공자 조회·plan 쓰기)은 사람이 한다.
 */
export const RECONCILE_STEPS: readonly ReconcileStep[] = [
  {
    n: 1,
    what: '대조 구간을 산출한다 — **복구 시점 ~ 차단 해제 시각**(§3-9 의 1줄 명령)',
    why: '차단 시각으로 끝내면 차단 중 503 을 받은 웹훅이 구간에서 빠진다',
    evidence: `§3-6 의 \`restorePoint\` 와 7단계 해제 시각. \`${FREEZE_AT_ENV}\` 는 **참고용**이다`,
  },
  {
    n: 2,
    what: '제공자 콘솔에서 그 구간의 결제·해지·환불 목록을 받는다(조직 식별자 포함)',
    why: '복구된 DB 의 감사 이력은 전환과 함께 되돌아갔다 — 남은 정본은 제공자 쪽뿐이다',
    evidence: '제공자 콘솔. §3-5 보존본이 있으면 교차 확인한다',
  },
  {
    n: 3,
    what: `그 목록을 \`${APPLIED_PLAN_COLUMN}\` 과 **양방향으로** 대조한다(올라가야 할 것·내려가야 할 것)`,
    why: '한 방향만 보면 되살아난 유료 플랜은 끝까지 남는다 — 쓰는 쪽에 불리하지 않아 신고되지 않는다',
    evidence: `두 방향의 정의는 \`DRIFT_DIRECTIONS\``,
  },
  {
    n: 4,
    what: '어긋난 조직의 plan 을 제공자 기준으로 맞춘다 — **재결제를 요청하지 않는다**',
    why: '결제는 이미 승인돼 있다. 다시 요청하면 이중 청구가 된다',
    evidence: '제공자 콘솔의 승인 내역이 기준이다',
  },
  {
    n: 5,
    what: `마친 시각을 \`${EXTERNAL_RECONCILED_ENV}\` 에 적는다 — 그 **뒤에** 7단계 해제`,
    why: '해제 전에 끝냈다는 사실을 남겨 두지 않으면 사후에 「했는지」를 확인할 방법이 없다(그 기록도 함께 되돌아간 뒤다)',
    evidence: '값은 사람이 적는다 — 자동으로 채우면 「했다」가 거짓이 된다',
  },
];

export interface ReconcilePlan {
  window: ReconcileWindow;
  systems: readonly ExternalSystem[];
  drifts: readonly DriftDirection[];
  steps: readonly ReconcileStep[];
  limits: readonly string[];
  /** 차단 예외 경로 — 결제 웹훅이 여기 **없는** 것이 의도다 */
  exemptPaths: readonly string[];
  webhookPath: string;
  webhookExempt: boolean;
  recordKey: string;
  runbook: string;
}

/** 응답·명령 출력용 — 판정 + 외부 상태 목록 + 두 방향 + 절차 + 사각지대를 **함께** 낸다 */
export function reconcilePlanFor(input: {
  restorePoint: unknown;
  releasedAt: unknown;
  freezeAt?: unknown;
  now?: Date;
}): ReconcilePlan {
  return {
    window: assessReconcileWindow(input),
    systems: EXTERNAL_SYSTEMS,
    drifts: DRIFT_DIRECTIONS,
    steps: RECONCILE_STEPS,
    limits: EXTERNAL_LIMITS,
    exemptPaths: FREEZE_EXEMPT.map((e) => e.path),
    webhookPath: BILLING_WEBHOOK_PATH,
    webhookExempt: FREEZE_EXEMPT.some((e) => BILLING_WEBHOOK_PATH === e.path || BILLING_WEBHOOK_PATH.startsWith(`${e.path}/`)),
    recordKey: EXTERNAL_RECONCILED_ENV,
    runbook: EXTERNAL_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§3-9 의 1줄 명령이 출력하는 것) */
export function reconcileText(plan: ReconcilePlan): string {
  const lines = [`[${plan.window.verdict}] ${plan.window.notice}`, `→ ${plan.window.action}`];
  for (const s of plan.systems) lines.push(`· ${s.system} — ${s.effect}`);
  for (const d of plan.drifts) lines.push(`· ${d.key}: DB=${d.dbSays} / 제공자=${d.providerSays} → ${d.fix}`);
  for (const s of plan.steps) lines.push(`${s.n}) ${s.what}`);
  for (const c of plan.window.caveats) lines.push(`※ ${c}`);
  for (const l of plan.limits) lines.push(`· ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 판정·시각·수치만 — 조직·금액·결제 식별자는 담지 않는다 */
export function externalLogLine(plan: ReconcilePlan): string {
  const w = plan.window;
  const parts = [
    `window=${w.verdict}`,
    `from=${w.startsAt ?? '?'}`,
    `to=${w.endsAt ?? '?'}`,
    `hours=${w.hours ?? '?'}`,
    `systems=${plan.systems.length}`,
    `webhookExempt=${plan.webhookExempt}`,
  ];
  return `[externalReconcile] ${parts.join(' ')}`;
}

/* ───────────────────────────── env 로더 ───────────────────────────── */

/**
 * 외부 대조를 마친 시각. `RECOVERY_EXTERNAL_RECONCILED_AT` 만 인정하고 **기본값을 만들지 않는다**.
 * 형식 밖·비실존 시각은 null — 못 읽는 값을 「기록됨」으로 올리지 않는다.
 */
export function reconciledAtFromEnv(env: Record<string, string | undefined> = process.env): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_EXTERNAL_RECONCILED_AT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/**
 * 결제 반영이 실제로 켜져 있는가 — `decideWebhookAction` 의 두 게이트와 **글자 그대로 같게** 읽는다.
 * 느슨하게 읽으면(`Boolean()`·`!== 'false'`) 판정이 실제 동작과 어긋난다.
 */
export function planApplyActive(env: Record<string, string | undefined> = process.env): boolean {
  return env.BILLING_APPLY_LIVE === 'true' && env.PAYMENTS_LIVE === 'true';
}

/** 제공자 쪽에서 실결제가 일어나는가(반영과 별개다) */
export function paymentsLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.PAYMENTS_LIVE === 'true';
}

/* ───────────────────────── /api/health 체크 ───────────────────────── */

export const RECONCILE_STATES = [
  'not_applicable',
  'normal',
  'pending',
  'recorded',
  'invalid_record',
  'stale_record',
] as const;
export type ReconcileState = (typeof RECONCILE_STATES)[number];

const STATE_NOTE: Record<ReconcileState, string> = {
  not_applicable:
    `결제 반영이 OFF(${BILLING_APPLY_SWITCH}·${PAYMENTS_LIVE_SWITCH}) — 복구가 되돌릴 반영이 없다. ` +
    '제공자 쪽에 결제가 없다는 뜻은 아니다(테스트 모드). 반영을 켜면 이 체크가 복구 중 미대조를 드러낸다',
  normal: `평상시 — 차단 OFF, 대조 기록 없음. ${EXTERNAL_RECONCILED_ENV} 는 복구 중에만 들어 있는 값이다`,
  pending:
    `쓰기 차단 중인데 ${EXTERNAL_RECONCILED_ENV} 가 비어 있다 — 전환이 끝났다면 **해제(7단계) 전에** ` +
    '제공자 쪽 결제·해지와 플랜을 양방향으로 대조한다(§3-9). 해제하면 어긋난 플랜 그대로 사용자가 들어온다',
  recorded: '차단 중이고 대조 시각이 기록돼 있다 — 해제해도 「언제 대조했는지」가 남는다(§3-9)',
  invalid_record: `${EXTERNAL_RECONCILED_ENV} 값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다`,
  stale_record:
    `차단은 OFF 인데 ${EXTERNAL_RECONCILED_ENV} 가 남아 있다 — 사건 기록(§3 8단계)을 마쳤으면 지운다. ` +
    '남겨 두면 다음 사건에서 **옛 시각이 「대조했다」는 근거**로 쓰인다',
};

/**
 * 복구가 되돌리지 못하는 외부 상태와의 **대조를 했는지** 공개 헬스체크에 드러낸다.
 *
 * 이 체크의 쓸모는 **시점**에 있다 — 차단이 걸려 있는 동안(= 아직 사용자가 들어오지 못하는 동안)
 * 미대조를 알려 준다. 해제 뒤에는 어긋난 플랜 위로 쓰기가 쌓여 어느 것이 복구 탓인지 흐려진다.
 *
 * `ok` 의 뜻: 「대조를 기록할 수 있는 상태인가」다 — **몇 건이 어긋났는지는 검증하지 않는다**
 * (`EXTERNAL_LIMITS` 참조). **required: false** 이므로 어느 경우에도 503 이 되지 않는다.
 * 조직·금액·결제 식별자는 담지 않고 상태·키 이름·시각·개수만 담는다.
 */
export function externalStateCheck(args?: { env?: Record<string, string | undefined> }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const env = args?.env ?? process.env;
  const frozen = writeFreezeEnabled(env);
  const applying = planApplyActive(env);
  const { raw, at } = reconciledAtFromEnv(env);
  const freeze = freezeAtFromEnv(env);

  let state: ReconcileState;
  if (raw && !at) state = 'invalid_record';
  else if (!applying) state = at ? 'stale_record' : 'not_applicable';
  else if (frozen) state = at ? 'recorded' : 'pending';
  else state = at ? 'stale_record' : 'normal';

  // 그 `recorded` 가 **이번 사건의 것인지**(§3-14). 지난 복구가 남긴 시각이면 차단을 켜는 순간
  // `stale_record` 가 `recorded` 로 뒤집혀 7단계 선행 조건이 통과하고, 제공자와 어긋난 플랜 위로
  // 쓰기가 쌓인다. 판정 어휘(`state`)와 `ok` 는 그대로 두고 **다음에 할 일**만 달라지게 한다.
  const timeline = assessTimeline({ env });
  const corr = markerCorroboration(EXTERNAL_RECONCILED_ENV, timeline);

  return {
    ok: state === 'not_applicable' || state === 'normal' || state === 'recorded',
    required: false,
    detail: {
      state,
      frozen,
      /** 결제 반영 게이트 — 둘 다 ON 일 때만 복구가 되돌릴 반영이 존재한다 */
      planApplyActive: applying,
      paymentsLive: paymentsLive(env),
      recorded: Boolean(at),
      reconciledAt: at,
      /** 「이 시각이 **이번 사건**의 기록이라고 말할 수 있는가」 — 대조를 했다는 뜻이 아니다(§3-14) */
      recordCorroborated: corr.corroborated,
      recordBasis: corr.basis,
      timelineVerdict: timeline.verdict,
      /** 참고용 — §3-7 유실 구간의 끝. 대조 구간의 끝이 **아니다** */
      freezeAt: freeze.at,
      appliedColumn: APPLIED_PLAN_COLUMN,
      webhookPath: BILLING_WEBHOOK_PATH,
      /** 결제 웹훅이 차단 예외에 들어 있는가 — **false 가 의도된 값**이다 */
      webhookExempt: FREEZE_EXEMPT.some((e) => BILLING_WEBHOOK_PATH === e.path),
      systemCount: EXTERNAL_SYSTEMS.length,
      driftDirections: DRIFT_DIRECTIONS.map((d) => d.key),
      switchKey: WRITE_FREEZE_ENV,
      recordKey: EXTERNAL_RECONCILED_ENV,
      runbook: EXTERNAL_RUNBOOK_REF,
      limits: EXTERNAL_LIMITS,
      // 귀속을 말할 수 없는 기록은 **같은 칸에서** 그 사실을 함께 말한다(§3-14).
      note: corr.basis === 'anchor' || corr.basis === 'absent' ? STATE_NOTE[state] : `${STATE_NOTE[state]} / ${corr.note}`,
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function externalReconcileStatus(env: Record<string, string | undefined> = process.env): {
  state: ReconcileState;
  recordKey: string;
  systems: number;
  drifts: number;
  limits: number;
  note: string;
} {
  const c = externalStateCheck({ env });
  const state = c.detail.state as ReconcileState;
  return {
    state,
    recordKey: EXTERNAL_RECONCILED_ENV,
    systems: EXTERNAL_SYSTEMS.length,
    drifts: DRIFT_DIRECTIONS.length,
    limits: EXTERNAL_LIMITS.length,
    note: STATE_NOTE[state],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * `app/api/billing/webhook/route.ts` 원문 대조 — 반영 경로의 **모양**이 바뀌면 위 목록이 거짓이 된다.
 * 특히 반영 대상이 `organizations` 가 아니게 되거나 감사 이벤트가 사라지면, 복구가 되돌리는 것과
 * 대조할 근거가 달라지므로 §3-9 와 `EXTERNAL_SYSTEMS` 를 함께 고쳐야 한다.
 */
export function auditWebhookRoute(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/update\(organizations\)[\s\S]{0,120}plan/.test(s)) {
    problems.push(`웹훅이 ${APPLIED_PLAN_COLUMN} 을 갱신하지 않는다 — 결제 반영 경로가 바뀌었다면 EXTERNAL_SYSTEMS 를 고칠 것`);
  }
  if (!/BILLING_PLAN_APPLIED/.test(s)) {
    problems.push('웹훅이 BILLING_PLAN_APPLIED 감사 이벤트를 남기지 않는다 — 대조 근거의 이름이 바뀌었다');
  }
  if (!/decideWebhookAction\(/.test(s)) {
    problems.push('웹훅이 decideWebhookAction 게이트를 거치지 않는다 — 반영 조건이 바뀌었다');
  }
  return problems;
}

/**
 * 결제 웹훅이 **차단 예외에 들어가지 않았는지** 본다.
 * 예외로 열면 차단 중 반영이 **버려지는 DB** 에 쌓여 전환에서 함께 사라진다 — 503 을 받고
 * 제공자 재시도에 맡기는 쪽이 덜 나쁘다. 어느 쪽이든 대조는 필요하지만, 열면 **대조할 흔적조차**
 * 복구로 사라진다. 그래서 목록에 끼어드는 것을 CI 로 막는다.
 */
export function auditWebhookNotExempt(): string[] {
  const hit = FREEZE_EXEMPT.find(
    (e) => BILLING_WEBHOOK_PATH === e.path || BILLING_WEBHOOK_PATH.startsWith(`${e.path}/`),
  );
  if (!hit) return [];
  return [
    `${BILLING_WEBHOOK_PATH} 가 차단 예외(${hit.path})에 들어 있다 — 차단 중 반영이 버려지는 DB 에 쌓여 ` +
      '전환에서 함께 사라진다(대조할 흔적조차 남지 않는다)',
  ];
}

/**
 * 4단계 대조가 `organizations` 를 **행 수로만** 보는 사각지대가 그대로인지 확인한다.
 * 목록에서 빠지면 위 `silent` 설명이 낡고, 칼럼 값을 보는 검증이 생기면 이 절의 전제가 바뀐다.
 */
export function auditPlanColumnBlindSpot(): string[] {
  const has = CORE_TABLE_ROLES.some((r) => r.table === 'organizations');
  if (has) return [];
  return [
    '4단계 핵심 테이블에 organizations 가 없다 — 「행 수만 센다」는 설명의 전제가 바뀌었으니 ' +
      'EXTERNAL_SYSTEMS 의 silent 를 함께 고칠 것',
  ];
}

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 이 체크가 빠지면 「해제 전에 대조했는가」를 알려 줄 유일한 장치가 사라지는데,
 * 응답은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/externalReconcile['"]/.test(s)) problems.push('externalReconcile 을 import 하지 않는다');
  if (!/externalStateCheck\(/.test(s)) problems.push('externalStateCheck() 를 호출하지 않는다');
  else if (!/checks\.externalState\s*=\s*externalStateCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.externalState 로 내보내지 않는다 — 판정만 하고 버린다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 점검 — §3 에 대조 단계가 없으면 이 모듈은 아무도 호출하지 않는 코드가 된다.
 * 특히 **7단계 해제 전**이라는 순서와 **구간의 끝이 해제 시각**이라는 사실이 빠지면 절차가 있어도
 * 소용이 없다(차단 구간에 거절된 웹훅이 빠진 채 「대조했다」가 된다).
 */
export function auditRunbookExternal(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-9\./m.test(s)) problems.push('§3-9(외부 상태 대조) 절이 없다');
  if (!/reconcilePlanFor\(|assessReconcileWindow\(/.test(s)) problems.push('§3-9 에 대조 구간 산출 명령이 없다');
  if (!new RegExp(EXTERNAL_RECONCILED_ENV).test(s)) {
    problems.push(`${EXTERNAL_RECONCILED_ENV} 가 문서에 없다 — 복구 시 조용히 유실된다`);
  }

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i62 = sec3.search(/^6-2\.\s/m);
  const step62 = i62 < 0 ? '' : sec3.slice(i62).split(/^7\.\s/m)[0];
  if (!step62) problems.push('§3 에 6-2단계(외부 상태 대조)가 없다');
  else {
    if (!/제공자|PortOne/.test(step62)) problems.push('6-2단계가 제공자 쪽 대조를 지시하지 않는다');
    if (!/3-9/.test(step62)) problems.push('6-2단계가 §3-9 로 유도하지 않는다');
    if (!new RegExp(EXTERNAL_RECONCILED_ENV).test(step62)) {
      problems.push(`6-2단계가 ${EXTERNAL_RECONCILED_ENV} 기록을 지시하지 않는다`);
    }
  }
  const i7 = sec3.search(/^7\.\s/m);
  const step7 = i7 < 0 ? '' : sec3.slice(i7).split(/^8\.\s/m)[0];
  if (!step7) problems.push('§3 7단계를 찾지 못했다');
  else if (!/6-2/.test(step7)) {
    problems.push('7단계(해제)가 6-2단계 완료를 선행 조건으로 걸지 않는다 — 해제 뒤 대조는 늦다');
  }
  return problems;
}
