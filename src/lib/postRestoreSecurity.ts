/**
 * postRestoreSecurity.ts — 복구가 **보안 대응까지 되돌린다**는 사실을 절차·응답으로 드러낸다. 2026-10-12
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 의 1~8단계와 §5(배포 롤백)는 모두 기계적으로 수행·확인할 수 있게 됐다. 그 전부가 다루는 것은
 * **업무 데이터의 유실**이다 — 행 수를 대조하고(4단계), 스키마를 확인하고(6단계), 유실 구간을
 * 고지한다(8단계). 그런데 시점 복구가 되돌리는 것은 업무 데이터만이 아니다.
 *
 * §3 1단계는 손상 시각 T 를 「감사로그로 **T 직전 관리 작업 이력**을 확인해」 특정하라고 지시한다 —
 * 즉 이 절차가 상정하는 사건에는 **계정·권한이 얽힌 경우**가 들어 있다(권한을 가진 누군가가, 또는
 * 그 자격을 손에 넣은 누군가가 한 작업). 그런 사건에서 담당자가 가장 먼저 하는 일은 정해져 있다 —
 * 세션을 끊고, 비밀번호를 바꾸고, 계정을 잠그고, 권한을 회수한다. 그리고 **그 조치는 전부
 * 복구 대상과 같은 DB 의 행**이다.
 *
 *  (1) **대응 조치가 전환과 함께 사라진다.** 로그아웃·세션 폐기는 `sessions` **행 삭제**이고
 *      (`lib/auth.ts` `destroySession`), 비밀번호 변경은 `users.password_hash` **갱신**이며
 *      (`/api/profile`·`/api/auth/password-reset/confirm`), 계정 잠금은 `users.is_active`,
 *      권한 회수는 `memberships` 다. 5단계 전환은 이 모든 행을 **T-ε 상태로** 되돌린다.
 *      그 결과 — 끊은 세션이 다시 유효해지고(쿠키의 토큰은 공격자 손에 그대로 있다), **유출된
 *      옛 비밀번호가 다시 통하고**(새로 정한 비밀번호는 통하지 않는다), 잠근 계정이 열리고,
 *      회수한 권한이 돌아온다.
 *
 *  (2) **어떤 검증도 이것을 잡지 못한다.** 4단계 행 수 대조(`lib/recoveryVerify.ts`)의 핵심
 *      테이블 정본에 `sessions`·`password_reset_tokens` 는 없고, 있었더라도 되돌아온 행은
 *      **기준치 이상**이라 `ok` 다. 6단계 `schema.verdict` 는 테이블 존재만 본다. 비밀번호가
 *      맞는지·세션이 누구 것인지는 아무도 검증하지 않는다. 그래서 `switchReady: true` →
 *      전환 → 7단계 해제까지 **전부 정상으로 보이고**, 8단계 고지는 「데이터 유실 구간」만 말한다.
 *      사건의 원인이 된 접근 수단이 **복구로 되살아난 채** 서비스가 다시 열린다.
 *
 *  (3) **쓰기 차단이 이 구멍을 덮지 못한다.** `lib/writeFreeze.ts` 의 예외 목록은 `login`·`logout`
 *      을 「세션은 복구 시 버려도 되는 일회성 데이터」라는 이유로 열어 두었다 — 맞는 말이지만
 *      **반대 방향**(차단 중 운영 DB 에서 끊은 세션이 버려지는 쪽)은 적혀 있지 않았다.
 *      차단 중의 대응 조치는 **버려지는 DB** 에 쌓이고, 복구 브랜치에는 반영되지 않는다.
 *
 * 그래서 이 모듈은
 *   · 복구가 되돌리는 보안 상태를 **정본 목록**으로 두고(`SECURITY_REVERTS` — 테이블·칼럼·되돌아가는
 *     조치·그래서 생기는 일·왜 오류가 안 나는가),
 *   · 되살아난 세션이 **언제까지** 유효한지 산출하고(`assessSessionCarryover` — 세션 수명은
 *     `lib/auth.ts` 의 값을 **그대로 비추고** 테스트가 매번 대조한다. 임의 수치를 두지 않는다),
 *   · 재적용을 **해제(7단계) 전에** 끝내도록 절차를 세우고(`REAPPLY_STEPS`),
 *   · 그 완료를 기록으로 승격해(`RECOVERY_SECURITY_REAPPLIED_AT`) 차단이 걸려 있는 동안 —
 *     **아직 되돌릴 수 있는 동안** — 미기록을 `/api/health` 로 드러내고(`securityReapplyCheck`),
 *   · 재적용이 보장하지 **못하는** 것을 `SECURITY_LIMITS` 로 함께 내보낸다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. env 는 명시 로더에서만 읽는다.
 * - **자동화가 재적용을 대신하지 않는다** — 세션 폐기·비밀번호 재적용은 운영 DB 쓰기이고,
 *   대상 목록은 §3-5 보존본에서 사람이 추린다. 이 모듈은 **무엇을·언제·어떤 순서로** 까지만 말한다.
 * - **새 거짓 ok 를 만들지 않는다**: 재적용을 기록했다는 것이 「되살아난 접근 수단이 없다」는 뜻이 아니다.
 */
import { assessPreservation, evidenceAvailability } from './evidencePreservation.ts';
import { parseInstant } from './incidentEvidence.ts';
import { assessTimeline, markerCorroboration } from './incidentTimeline.ts';
import { rollbackPhase, type RollbackPhase } from './deployRollback.ts';
import { FREEZE_EXEMPT, WRITE_FREEZE_ENV, writeFreezeEnabled } from './writeFreeze.ts';

const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

/** 재적용을 **마친 시각**을 적어 두는 키. 평상시 미설정이 정상이다 */
export const SECURITY_REAPPLIED_ENV = 'RECOVERY_SECURITY_REAPPLIED_AT';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const SECURITY_RUNBOOK_REF = 'RUNBOOK §3 6-1단계·§3-8';

/**
 * 세션 수명(일). **임의 수치가 아니라** `lib/auth.ts` 의 `SESSION_DAYS` 를 비춘 값이고,
 * `auditSessionTtl()` + 테스트가 실제 원문과 매번 대조한다(어긋나면 CI 실패).
 * 여기서 직접 `lib/auth.ts` 를 import 하지 않는 이유는 그 모듈이 `next/headers`·DB 를 끌고 오기 때문이다.
 */
export const SESSION_TTL_DAYS = 7;

/** 세션 수명의 정본이 있는 파일 — 대조 대상 */
export const SESSION_TTL_SOURCE = 'src/lib/auth.ts';

/* ───────────────────── 복구가 되돌리는 보안 상태(정본) ───────────────────── */

export interface SecurityRevert {
  key: string;
  table: string;
  /** 행 자체가 되돌아가는 경우 null */
  column: string | null;
  /** 복구가 **되돌려 버리는 조치** */
  undone: string;
  /** 전환 뒤 실제로 생기는 일 */
  effect: string;
  /** 전환 뒤 다시 해야 하는 일 */
  reapply: string;
  /** 왜 아무 검증에도 걸리지 않는가 */
  silent: string;
}

export const SECURITY_REVERTS: readonly SecurityRevert[] = [
  {
    key: 'session_revocation',
    table: 'sessions',
    column: null,
    undone: '로그아웃·세션 강제 폐기(행 삭제) — 탈취가 의심되는 접속을 끊은 조치',
    effect:
      '복구 시점 이전에 발급된 세션 토큰이 **다시 유효해진다**. 토큰은 사용자(또는 공격자)의 쿠키에 ' +
      '그대로 남아 있으므로 다시 로그인할 필요도 없다',
    reapply:
      '전환 뒤 `sessions` 행을 지워 전원 재로그인시킨다 — 어느 토큰이 공격자 것인지 모르는 상태에서 ' +
      '확실한 방법은 전원 폐기뿐이다(행 수로는 구분할 수 없다)',
    silent: '행이 늘어난 것뿐이라 4단계 행 수 대조는 「기준치 이상」으로 통과한다. 핵심 테이블 목록에 들어 있지도 않다',
  },
  {
    key: 'password_change',
    table: 'users',
    column: 'password_hash',
    undone: '비밀번호 변경·재설정(`/api/profile` PATCH · `/api/auth/password-reset/confirm` · 관리자 임시 비밀번호 발급)',
    effect:
      '**옛 해시가 돌아온다** — 유출된 비밀번호가 다시 통하고, 사용자가 대응 중 새로 정한 비밀번호는 ' +
      '통하지 않는다. 사용자에게는 「로그인이 안 된다」로만 보이고 지원팀도 원인을 알 수 없다',
    reapply:
      '대응 중 비밀번호를 바꾼 계정을 §3-5 보존본(감사 이벤트 `AUTH_PW_RESET`·관리 작업 이력)에서 추려 ' +
      '다시 바꾸게 한다 — 재설정 링크 재발급 또는 관리자 임시 비밀번호',
    silent: '행 수·스키마 모두 그대로다. 「해시가 옛 값인지」를 보는 검증은 어디에도 없다',
  },
  {
    key: 'reset_token_use',
    table: 'password_reset_tokens',
    column: 'used_at',
    undone: '재설정 토큰의 1회 소모 표시',
    effect:
      '만료 전이라면 **이미 사용한 재설정 링크가 다시 쓸 수 있는 상태**로 돌아온다 — 메일함·로그·' +
      '프록시 기록에 남은 링크가 되살아난다',
    reapply: '복구 시점 이후 발급된 토큰은 사용 여부와 무관하게 전부 무효 처리하고, 필요한 사람에게 새로 발급한다',
    silent: '토큰은 해시로만 저장돼 있어 **되살아난 링크를 목록으로 확인할 수 없다** — 세어 봐도 어느 것이 유효한지 모른다',
  },
  {
    key: 'account_deactivation',
    table: 'users',
    column: 'is_active',
    undone: '계정 비활성화(`/api/admin/users` PATCH `isActive:false`)',
    effect:
      '대응 중 잠근 계정이 **다시 활성**이 된다. 위 세션 되살아남과 겹치면 로그인 절차조차 거치지 않고 ' +
      '곧바로 쓸 수 있는 상태가 된다',
    reapply: '잠근 계정 목록을 보존본에서 추려 다시 비활성화한다 — 재적용 전까지는 잠겨 있다고 믿으면 안 된다',
    silent: '불리언 한 칸이라 행 수·스키마·화면 어디에도 드러나지 않는다',
  },
  {
    key: 'role_change',
    table: 'memberships',
    column: 'role·is_org_admin',
    undone: '권한 회수·강등(역할 변경·조직 관리자 해제·소속 삭제)',
    effect: '회수한 권한이 돌아온다 — 사용자 관리·감사 조회 같은 관리 경로에 다시 닿는다',
    reapply: '회수했던 역할·관리자 플래그·소속 삭제를 다시 적용한다',
    silent: 'RBAC(`lib/rbac.ts`)는 현재 값을 그대로 믿는다 — 되돌아온 권한과 정당한 권한을 구분하는 표시가 없다',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function revertFor(key: unknown): SecurityRevert | null {
  const k = String(key ?? '').trim();
  return SECURITY_REVERTS.find((r) => r.key === k) ?? null;
}

/** 되돌아가는 보안 상태가 걸쳐 있는 테이블(중복 제거) */
export function revertedTables(): string[] {
  return [...new Set(SECURITY_REVERTS.map((r) => r.table))].sort();
}

/* ─────────────────────── 재적용이 보장하지 못하는 것 ─────────────────────── */

export const SECURITY_LIMITS: readonly string[] = [
  '재적용은 **되돌아온 것**만 다룬다 — 공격자가 복구 시점 **이전에** 만들어 둔 계정·소속·토큰은 복구로 사라지지 않고 그대로 남는다. 그쪽은 §3-5 보존본으로 따로 찾아야 한다',
  '전원 재로그인은 **토큰만** 무효화한다 — 유출된 비밀번호 자체는 그대로이므로 다시 로그인당할 수 있다. 비밀번호 재적용은 별도 항목이다',
  '어느 계정이 대응 중 바뀌었는지는 **복구된 DB 안에 없다**(그 기록도 함께 되돌아갔다) — §3-5 로 밖에 보존한 감사 기록이 없으면 대상 목록을 재구성할 수 없다',
  '재적용 자체의 이력도 복구된 감사로그에 남는다 — 사건 조사의 근거는 보존본이지 이 DB 가 아니다',
  '2단계 쓰기 차단은 이 문제를 막지 못한다 — `login`·`logout` 은 예외 경로이고, 차단 중 운영 DB 에서 끊은 세션은 **버려지는 DB** 에 남는다',
  '기록(`' + SECURITY_REAPPLIED_ENV + '`)은 「했다고 적었다」는 뜻이다 — 무엇을 얼마나 했는지는 검증하지 않는다. 사후 대조는 보존본으로 한다',
];

/* ─────────────────────── 되살아난 세션의 수명 산출 ─────────────────────── */

export const CARRYOVER_VERDICTS = ['ok', 'invalid_restore_point', 'unknown_ttl'] as const;
export type CarryoverVerdict = (typeof CARRYOVER_VERDICTS)[number];

export const ACTION_CARRYOVER_OK =
  '전환 뒤 **7단계 해제 전에** 세션을 폐기한다 — 해제는 사용자와 되살아난 토큰을 동시에 들여보낸다. ' +
  '폐기 대상을 고르지 못하겠으면 전원 폐기한다(재로그인 안내가 비용의 전부다)';

export const ACTION_CARRYOVER_EXPIRED =
  '되살아난 세션의 유효 상한은 지났다 — 그래도 **세션 외의 되돌아감은 그대로다**(비밀번호·계정 잠금·권한). ' +
  '§3-8 의 2~4단계를 건너뛰지 않는다';

export const ACTION_CARRYOVER_INVALID_RESTORE_POINT =
  '복구 시점(T-ε)을 읽을 수 없어 되살아난 세션의 수명을 산출하지 못했다 — ' +
  '`2026-10-12T13:05:00+09:00` 처럼 **타임존을 붙인 ISO 시각**으로 다시 넣는다(§3-6 의 `restorePoint`). ' +
  '수명을 모른다고 해서 「만료됐다」로 보지 않는다';

export const ACTION_CARRYOVER_UNKNOWN_TTL =
  `세션 수명을 알 수 없다 — \`${SESSION_TTL_SOURCE}\` 의 값을 확인해 넣는다. 추정값으로 「이미 다 만료됐다」고 ` +
  '결론 내지 않는다';

export const CAVEAT_CARRYOVER_IS_UPPER_BOUND =
  '산출값은 **상한**이다 — 세션 수명은 발급 시점부터 세므로, 실제로는 복구 시점보다 먼저 발급된 만큼 더 일찍 끝난다. ' +
  '「이 시각까지는 되살아난 토큰이 있을 수 있다」로만 읽는다';

export const CAVEAT_CARRYOVER_COOKIE_IS_NOT_THE_RECORD =
  '쿠키 만료는 브라우저 쪽 값이라 공격자가 무시할 수 있다 — 정본은 `sessions` 행이고, 지워야 끝난다';

export const CAVEAT_CARRYOVER_NOT_ONLY_SESSIONS =
  '세션이 전부 만료된 뒤에도 비밀번호·계정 상태·권한의 되돌아감은 그대로 남는다 — 기다린다고 해결되지 않는다';

export interface SessionCarryover {
  verdict: CarryoverVerdict;
  /** 복구 시점(ISO). 못 읽으면 null */
  restorePoint: string | null;
  ttlDays: number | null;
  /** 되살아난 세션이 유효할 수 있는 **마지막** 시각(ISO) */
  latestExpiry: string | null;
  /** 지금부터 그때까지 남은 시간. 이미 지났으면 0 */
  remainingHours: number | null;
  /** 상한 시각이 이미 지났는가(= 되살아난 세션은 전부 만료) */
  expired: boolean;
  notice: string;
  action: string;
  caveats: string[];
}

/**
 * 되살아난 세션이 **언제까지** 유효할 수 있는가. 복구 시점 + 세션 수명이 상한이다.
 * 수명은 `lib/auth.ts` 를 비춘 `SESSION_TTL_DAYS` 를 기본으로 쓰고(테스트가 원문과 대조),
 * 호출부가 다른 값을 넘기면 그 값을 쓴다. 판독 불가는 **추정하지 않는다**.
 */
export function assessSessionCarryover(input: {
  restorePoint: unknown;
  ttlDays?: unknown;
  now?: Date;
}): SessionCarryover {
  const caveats = [
    CAVEAT_CARRYOVER_IS_UPPER_BOUND,
    CAVEAT_CARRYOVER_COOKIE_IS_NOT_THE_RECORD,
    CAVEAT_CARRYOVER_NOT_ONLY_SESSIONS,
  ];
  const rawTtl = input?.ttlDays === undefined ? SESSION_TTL_DAYS : Number(input.ttlDays);
  const ttlOk = Number.isFinite(rawTtl) && rawTtl > 0 && rawTtl <= 3650;
  const rp = parseInstant(input?.restorePoint);

  if (!rp) {
    return {
      verdict: 'invalid_restore_point',
      restorePoint: null,
      ttlDays: ttlOk ? rawTtl : null,
      latestExpiry: null,
      remainingHours: null,
      expired: false,
      notice: '되살아난 세션의 수명을 산출하지 못했습니다 — 복구 시점을 읽을 수 없습니다.',
      action: ACTION_CARRYOVER_INVALID_RESTORE_POINT,
      caveats,
    };
  }
  if (!ttlOk) {
    return {
      verdict: 'unknown_ttl',
      restorePoint: rp.toISOString(),
      ttlDays: null,
      latestExpiry: null,
      remainingHours: null,
      expired: false,
      notice: '되살아난 세션의 수명을 산출하지 못했습니다 — 세션 수명을 알 수 없습니다.',
      action: ACTION_CARRYOVER_UNKNOWN_TTL,
      caveats,
    };
  }

  const nowMs = (input?.now ?? new Date()).getTime();
  const last = new Date(rp.getTime() + rawTtl * MS_DAY);
  const remainMs = last.getTime() - nowMs;
  const expired = Number.isFinite(nowMs) ? remainMs <= 0 : false;
  return {
    verdict: 'ok',
    restorePoint: rp.toISOString(),
    ttlDays: rawTtl,
    latestExpiry: last.toISOString(),
    remainingHours: Number.isFinite(nowMs) ? Math.max(0, Math.ceil(remainMs / MS_HOUR)) : null,
    expired,
    notice: expired
      ? `복구 시점(${rp.toISOString()}) 이전에 발급된 세션의 상한(${last.toISOString()})은 이미 지났습니다 — ` +
        '되살아난 토큰 자체는 만료되었지만 비밀번호·계정 상태·권한의 되돌아감은 그대로입니다.'
      : `복구 시점(${rp.toISOString()}) 이전에 발급된 세션은 최대 ${last.toISOString()} 까지 유효할 수 있습니다 — ` +
        '전환 뒤 폐기하지 않으면 그때까지 되살아난 토큰으로 접근할 수 있습니다.',
    action: expired ? ACTION_CARRYOVER_EXPIRED : ACTION_CARRYOVER_OK,
    caveats,
  };
}

/* ─────────────────────── 재적용 절차(사람이 수행) ─────────────────────── */

export interface ReapplyStep {
  n: number;
  what: string;
  why: string;
  /** 대상 목록을 어디서 얻는가 */
  evidence: string;
}

/**
 * 전환(5단계)·스키마 정합(6단계) 뒤, **차단 해제(7단계) 전에** 끝내야 하는 재적용 절차.
 * 순서가 중요하다 — 해제는 사용자와 되살아난 접근 수단을 **동시에** 들여보낸다.
 * 실행(쓰기)은 사람이 한다. 자동화는 목록·순서까지만 말한다.
 */
export const REAPPLY_STEPS: readonly ReapplyStep[] = [
  {
    n: 1,
    what: '세션 전원 폐기 — 복구된 DB 의 `sessions` 를 비운다(재로그인 안내 포함)',
    why: '어느 토큰이 공격자 것인지 구분할 수단이 없다. 되살아난 토큰은 로그인 없이 바로 쓸 수 있다',
    evidence: '대상 선별이 불가능하므로 보존본 없이도 수행할 수 있는 유일한 단계다',
  },
  {
    n: 2,
    what: '대응 중 바꾼 비밀번호 재적용 — 해당 계정에 재설정 링크 재발급 또는 관리자 임시 비밀번호',
    why: '옛 해시가 돌아와 **유출된 비밀번호가 다시 통한다**. 사용자가 새로 정한 비밀번호는 통하지 않는다',
    evidence: '§3-5 보존본의 보안 이벤트(`AUTH_PW_RESET`)·관리 작업 이력에서 대상 계정을 추린다',
  },
  {
    n: 3,
    what: '복구 시점 이후 발급된 재설정 토큰 무효화(사용 여부와 무관)',
    why: '`used_at` 이 지워져 이미 쓴 링크가 다시 유효해질 수 있고, 토큰은 해시라 눈으로 확인할 수 없다',
    evidence: '발급 시각으로 거른다 — 토큰 값은 어디에도 평문으로 없다',
  },
  {
    n: 4,
    what: '잠근 계정·회수한 권한 재적용(`users.is_active`·`memberships`)',
    why: '대응 중 잠근 계정이 다시 활성이 되고 회수한 권한이 돌아온다 — 화면에는 정상으로 보인다',
    evidence: '§3-5 보존본의 관리 작업 이력(`/api/admin/users` PATCH 기록)',
  },
  {
    n: 5,
    what: `재적용을 마친 시각을 \`${SECURITY_REAPPLIED_ENV}\` 에 적는다 — 그 **뒤에** 7단계 해제`,
    why: '해제 전에 끝났다는 사실을 남겨 두지 않으면 사후에 「했는지」를 확인할 방법이 없다(기록도 함께 되돌아간 뒤다)',
    evidence: '값은 사람이 적는다 — 자동으로 채우면 「했다」가 거짓이 된다',
  },
];

export interface ReapplyPlan {
  carryover: SessionCarryover;
  reverts: readonly SecurityRevert[];
  steps: readonly ReapplyStep[];
  limits: readonly string[];
  /** 예외 경로라 차단 중에도 열려 있는 경로 수(세션이 그 사이에도 만들어진다) */
  exemptPaths: readonly string[];
  recordKey: string;
  runbook: string;
}

/** 응답·명령 출력용 — 판정 + 되돌아가는 목록 + 절차 + 사각지대를 **함께** 낸다 */
export function reapplyPlanFor(input: { restorePoint: unknown; ttlDays?: unknown; now?: Date }): ReapplyPlan {
  return {
    carryover: assessSessionCarryover(input),
    reverts: SECURITY_REVERTS,
    steps: REAPPLY_STEPS,
    limits: SECURITY_LIMITS,
    exemptPaths: FREEZE_EXEMPT.map((e) => e.path),
    recordKey: SECURITY_REAPPLIED_ENV,
    runbook: SECURITY_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§3-8 의 1줄 명령이 출력하는 것) */
export function reapplyText(plan: ReapplyPlan): string {
  const lines = [`[${plan.carryover.verdict}] ${plan.carryover.notice}`, `→ ${plan.carryover.action}`];
  for (const r of plan.reverts) lines.push(`· ${r.table}${r.column ? '.' + r.column : ''} — ${r.effect}`);
  for (const s of plan.steps) lines.push(`${s.n}) ${s.what}`);
  for (const c of plan.carryover.caveats) lines.push(`※ ${c}`);
  for (const l of plan.limits) lines.push(`· ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 판정·시각·수치만 — 계정·토큰·담당자는 담지 않는다 */
export function securityLogLine(plan: ReapplyPlan): string {
  const c = plan.carryover;
  const parts = [
    `carryover=${c.verdict}`,
    `restore=${c.restorePoint ?? '?'}`,
    `until=${c.latestExpiry ?? '?'}`,
    `expired=${c.expired}`,
    `reverts=${plan.reverts.length}`,
  ];
  return `[postRestoreSecurity] ${parts.join(' ')}`;
}

/* ─────────────────────────── env 로더 ─────────────────────────── */

/**
 * 재적용을 마친 시각. `RECOVERY_SECURITY_REAPPLIED_AT` 만 인정하고 **기본값을 만들지 않는다**.
 * 형식 밖·비실존 시각은 null — 못 읽는 값을 「기록됨」으로 올리지 않는다.
 */
export function reappliedAtFromEnv(env: Record<string, string | undefined> = process.env): {
  raw: string | null;
  at: string | null;
} {
  const raw = (env.RECOVERY_SECURITY_REAPPLIED_AT ?? '').trim();
  if (!raw) return { raw: null, at: null };
  const d = parseInstant(raw);
  return { raw, at: d ? d.toISOString() : null };
}

/* ─────────────────────────── /api/health 체크 ─────────────────────────── */

export const REAPPLY_STATES = ['normal', 'pending', 'recorded', 'invalid_record', 'stale_record'] as const;
export type ReapplyState = (typeof REAPPLY_STATES)[number];

const STATE_NOTE: Record<ReapplyState, string> = {
  normal: `평상시 — 차단 OFF, 재적용 기록 없음. ${SECURITY_REAPPLIED_ENV} 는 복구 중에만 들어 있는 값이다`,
  pending:
    `쓰기 차단 중인데 ${SECURITY_REAPPLIED_ENV} 가 비어 있다 — 전환이 끝났다면 **해제(7단계) 전에** 보안 상태를 ` +
    '재적용한다(세션 폐기·비밀번호·잠금·권한). 해제는 사용자와 되살아난 토큰을 동시에 들여보낸다(§3-8)',
  recorded: '차단 중이고 재적용 시각이 기록돼 있다 — 해제해도 「언제 재적용했는지」가 남는다(§3-8)',
  invalid_record: `${SECURITY_REAPPLIED_ENV} 값을 읽을 수 없다 — 타임존을 붙인 ISO 시각으로 다시 넣는다`,
  stale_record:
    `차단은 OFF 인데 ${SECURITY_REAPPLIED_ENV} 가 남아 있다 — 사건 기록(§3 8단계)을 마쳤으면 지운다. ` +
    '남겨 두면 다음 사건에서 **옛 시각이 「재적용했다」는 근거**로 쓰인다',
};

/**
 * 복구가 되돌린 보안 상태를 **다시 적용했는지** 공개 헬스체크에 드러낸다.
 *
 * 이 체크의 쓸모는 **시점**에 있다 — 차단이 걸려 있는 동안(= 아직 사용자도 공격자도 들어오지 못하는
 * 동안) 미기록을 알려 준다. 7단계 해제 뒤에는 되살아난 세션·비밀번호가 **이미 쓸 수 있는 상태**다.
 *
 * `ok` 의 뜻: 「재적용을 기록할 수 있는 상태인가」다 — **무엇을 얼마나 재적용했는지는 검증하지 않는다**
 * (`SECURITY_LIMITS` 참조). **required: false** 이므로 어느 경우에도 503 이 되지 않는다.
 * 계정·토큰·행 수는 담지 않고 상태·키 이름·시각만 담는다.
 */
export function securityReapplyCheck(args?: { env?: Record<string, string | undefined> }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const env = args?.env ?? process.env;
  const frozen = writeFreezeEnabled(env);
  const phase: RollbackPhase = rollbackPhase(env);
  const { raw, at } = reappliedAtFromEnv(env);

  let state: ReapplyState;
  if (raw && !at) state = 'invalid_record';
  else if (frozen) state = at ? 'recorded' : 'pending';
  else state = at ? 'stale_record' : 'normal';

  // 그 `recorded` 가 **이번 사건의 것인지**(§3-14). 위 세 줄은 값이 읽히는지만 보므로, 지난 복구에서
  // §3 8단계 4번(표지 삭제)을 거른 시각이 남아 있으면 평상시 `stale_record` 가 **차단을 켜는 순간**
  // `recorded` 로 뒤집혀 7단계 선행 조건이 몇 달 전 시각으로 통과한다. 판정 어휘(`state`)와 `ok` 는
  // 그대로 두고 — 타임존 누락으로 잘못 적힌 값과 「하지 않았다」를 코드가 구분할 수 없고 둘 다 고쳐야
  // 한다 — **다음에 할 일**만 달라지게 한다.
  const timeline = assessTimeline({ env });
  const corr = markerCorroboration(SECURITY_REAPPLIED_ENV, timeline);

  // 2번·3번의 **대상 목록은 §3-5 보존본에서만 나온다**(이 모듈의 머리말이 그렇게 적어 두었다).
  // 보존을 거르면 전환 뒤 그 목록을 만들 방법이 없는데 위 `state` 는 그래도 `recorded` 가 되고
  // §3-14 귀속까지 통과한다 — **할 수 없었던 단계가 수행된 것으로** 7단계 문을 연다. 그래서
  // 출처 유무를 같은 칸에서 함께 말한다(§3-15). `ok` 는 바꾸지 않는다.
  const evidence = evidenceAvailability(assessPreservation({ env }));

  return {
    ok: state === 'normal' || state === 'recorded',
    required: false,
    detail: {
      state,
      frozen,
      phase,
      recorded: Boolean(at),
      reappliedAt: at,
      /** 「이 시각이 **이번 사건**의 기록이라고 말할 수 있는가」 — 재적용을 했다는 뜻이 아니다(§3-14) */
      recordCorroborated: corr.corroborated,
      recordBasis: corr.basis,
      timelineVerdict: timeline.verdict,
      /**
       * 2·3번이 **대상을 추릴 출처**가 있는가(§3-15). `recorded` 는 「시각을 적었다」까지이고,
       * 적을 수 있었다는 사실이 **추릴 수 있었다**는 뜻은 아니다.
       */
      evidenceAvailable: evidence.availability,
      /** 되돌아가는 보안 상태의 개수 — 내용은 §3-8 에 있다(응답에 계정 정보를 담지 않는다) */
      revertCount: SECURITY_REVERTS.length,
      sessionTtlDays: SESSION_TTL_DAYS,
      switchKey: WRITE_FREEZE_ENV,
      recordKey: SECURITY_REAPPLIED_ENV,
      runbook: SECURITY_RUNBOOK_REF,
      // 귀속을 말할 수 없는 기록은 **같은 칸에서** 그 사실을 함께 말한다 — `state` 만 읽는
      // 담당자(체크리스트가 그렇게 지시한다)에게 닿지 않으면 판정이 응답에만 남는다.
      note: [
        STATE_NOTE[state],
        corr.basis === 'anchor' || corr.basis === 'absent' ? null : corr.note,
        evidence.availability === 'available' || evidence.availability === 'not_applicable' ? null : evidence.note,
      ]
        .filter((x) => x !== null)
        .join(' / '),
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function postRestoreSecurityStatus(env: Record<string, string | undefined> = process.env): {
  state: ReapplyState;
  recordKey: string;
  reverts: number;
  limits: number;
  note: string;
} {
  const c = securityReapplyCheck({ env });
  const state = c.detail.state as ReapplyState;
  return {
    state,
    recordKey: SECURITY_REAPPLIED_ENV,
    reverts: SECURITY_REVERTS.length,
    limits: SECURITY_LIMITS.length,
    note: STATE_NOTE[state],
  };
}

/* ─────────────────────────── 정적 점검 ─────────────────────────── */

/**
 * `src/lib/auth.ts` 원문 대조 — 세션 수명이 바뀌면 위 상한 산출이 **조용히 틀린 값**을 낸다.
 * (수명을 늘리면 되살아난 토큰이 더 오래 살아 있는데 문서·응답은 옛 수치를 말한다.)
 */
export function auditSessionTtl(src: unknown, assumed: number = SESSION_TTL_DAYS): string[] {
  const s = String(src ?? '');
  const m = s.match(/SESSION_DAYS\s*=\s*(\d+)/);
  if (!m) return [`${SESSION_TTL_SOURCE} 에서 SESSION_DAYS 를 찾지 못했다 — 세션 수명의 정본이 옮겨졌다`];
  const actual = Number(m[1]);
  if (actual !== assumed) {
    return [`세션 수명이 어긋난다 — ${SESSION_TTL_SOURCE} 는 ${actual}일, 이 모듈은 ${assumed}일로 산출한다`];
  }
  return [];
}

/**
 * 되돌아가는 보안 상태 목록이 **실제 코드와 같은 모양인지** 대조한다.
 * 예컨대 로그아웃이 행 삭제에서 「폐기 표시(soft delete)」로 바뀌면 복구가 되돌리는 방식도 달라지므로
 * 위 목록·절차를 함께 고쳐야 한다. 코드만 바뀌고 목록이 남으면 **틀린 안내가 조용히 유지된다**.
 */
export function auditRevocationShapes(src: {
  auth?: unknown;
  profile?: unknown;
  adminUsers?: unknown;
  resetConfirm?: unknown;
}): string[] {
  const problems: string[] = [];
  const auth = String(src?.auth ?? '');
  const profile = String(src?.profile ?? '');
  const admin = String(src?.adminUsers ?? '');
  const reset = String(src?.resetConfirm ?? '');

  if (!/delete\(sessions\)/.test(auth)) {
    problems.push('lib/auth.ts 가 더 이상 sessions 행을 삭제하지 않는다 — 세션 폐기 방식이 바뀌었다면 SECURITY_REVERTS 를 고칠 것');
  }
  if (!/update\(users\)[\s\S]{0,80}passwordHash/.test(profile)) {
    problems.push('api/profile 이 users.password_hash 를 갱신하지 않는다 — 비밀번호 변경 경로가 바뀌었다');
  }
  if (!/update\(users\)[\s\S]{0,80}isActive/.test(admin)) {
    problems.push('api/admin/users 가 users.is_active 를 갱신하지 않는다 — 계정 잠금 경로가 바뀌었다');
  }
  if (!/update\(passwordResetTokens\)[\s\S]{0,80}usedAt/.test(reset)) {
    problems.push('password-reset/confirm 이 used_at 을 기록하지 않는다 — 토큰 1회 소모 방식이 바뀌었다');
  }
  if (!/delete\(sessions\)/.test(reset)) {
    problems.push('password-reset/confirm 이 세션을 폐기하지 않는다 — 재설정의 대응 효과가 바뀌었다');
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 이 체크가 빠지면 「해제 전에 재적용했는가」를 알려 줄 유일한 장치가 사라지는데,
 * 응답은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/postRestoreSecurity['"]/.test(s)) problems.push('postRestoreSecurity 를 import 하지 않는다');
  if (!/securityReapplyCheck\(/.test(s)) problems.push('securityReapplyCheck() 를 호출하지 않는다');
  else if (!/checks\.postRestoreSecurity\s*=\s*securityReapplyCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.postRestoreSecurity 로 내보내지 않는다 — 판정만 하고 버린다');
  }
  return problems;
}

/**
 * `RUNBOOK.md` 원문 점검 — §3 에 재적용 단계가 없으면 이 모듈은 아무도 호출하지 않는 코드가 된다.
 * 특히 **7단계 해제 전**이라는 순서가 빠지면 절차가 있어도 소용이 없다(해제 뒤 재적용은 늦다).
 */
export function auditRunbookSecurity(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];

  if (!/^###\s*3-8\./m.test(s)) problems.push('§3-8(보안 상태 재적용) 절이 없다');
  if (!/reapplyPlanFor\(|assessSessionCarryover\(/.test(s)) problems.push('§3-8 에 재적용 산출 명령이 없다');
  if (!new RegExp(SECURITY_REAPPLIED_ENV).test(s)) problems.push(`${SECURITY_REAPPLIED_ENV} 가 문서에 없다 — 복구 시 조용히 유실된다`);

  const sec3 = s.match(/^##\s*3\.\s[\s\S]*?(?=^###\s*3-1\.)/m)?.[0] ?? '';
  if (!sec3) {
    problems.push('§3 본문을 찾지 못했다 — 문서 구조가 바뀌었으면 이 가드를 함께 볼 것');
    return problems;
  }
  const i61 = sec3.search(/^6-1\.\s/m);
  const step61 = i61 < 0 ? '' : sec3.slice(i61).split(/^7\.\s/m)[0];
  if (!step61) problems.push('§3 에 6-1단계(보안 상태 재적용)가 없다');
  else {
    if (!/세션/.test(step61)) problems.push('6-1단계가 세션 폐기를 지시하지 않는다');
    if (!/비밀번호/.test(step61)) problems.push('6-1단계가 비밀번호 재적용을 지시하지 않는다');
    if (!/3-8/.test(step61)) problems.push('6-1단계가 §3-8 로 유도하지 않는다');
    if (!new RegExp(SECURITY_REAPPLIED_ENV).test(step61)) {
      problems.push(`6-1단계가 ${SECURITY_REAPPLIED_ENV} 기록을 지시하지 않는다`);
    }
  }
  const i7 = sec3.search(/^7\.\s/m);
  const step7 = i7 < 0 ? '' : sec3.slice(i7).split(/^8\.\s/m)[0];
  if (!step7) problems.push('§3 7단계를 찾지 못했다');
  else if (!/6-1/.test(step7)) {
    problems.push('7단계(해제)가 6-1단계 완료를 선행 조건으로 걸지 않는다 — 해제 뒤 재적용은 늦다');
  }
  return problems;
}
