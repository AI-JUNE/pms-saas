// healthDisclosure.ts — 공개 `/api/health` 가 **복구 중 사건 상태를 공표한다**(RUNBOOK §2-3).
//
// ── 무엇이 문제인가 ─────────────────────────────────────────────────────────────
// §1~§6 을 기계화하며 체크 15건이 `GET /api/health` 로 모였고, 직전 배치(§2-2)는 그 판정이
// **도달하도록** 헤더 2개와 본문 `signal` 을 붙였다. 그런데 이 라우트는 **인증이 없다**
// (주석이 스스로 「공개 헬스체크: 인증 불필요」라고 적어 두었고, rate limit 은 업타임 모니터가
// 막히지 않게 분당 120 으로 넉넉하다). 각 배치는 「값은 담지 않는다 — 키 이름·판정만」을
// 개별적으로 지켰지만, **그 키 이름·판정 15건을 한 응답에 모아 무인증으로 내보낸 결과**는
// 아무도 점검하지 않았다. 지금 누구나 이 응답을 폴링하면 다음을 실시간으로 읽는다:
//
//   · `writeFreeze.detail.frozen: true`        → 지금 이 서비스는 **사건 복구 중**이다
//   · `writeFreeze.detail.exempt`              → 차단 중에도 **쓰기가 되는 경로 목록**
//   · `postRestoreSecurity.detail.state`       → `pending` = 되돌아온 세션·비밀번호를 **아직 폐기하지 않았다**
//   · `incidentClosure.detail.frozenAt`        → 차단을 건 **정확한 시각**(사건 타임라인)
//   · `envPresence.detail.missingKeys`         → 어느 설정이 **빠진 채** 돌고 있는지(키 이름)
//   · `dbIdentity`·`deployPin`·`rehearsalScope`→ 전환 반영 여부·돌고 있는 커밋·리허설 중인지
//
// 가장 날카로운 조합은 §3-8 이 막으려던 바로 그 공격이다. 복구는 끊은 세션과 바꾼 비밀번호를
// 되돌리므로, 6-1단계 재적용 전까지는 **사건의 접근 수단이 다시 통한다**. 그 구간의 시작과 끝을
// (`frozen: true` + `postRestoreSecurity: pending` → `recorded`) 이 응답이 **먼저 알려 준다** —
// 쿠키를 그대로 들고 있는 쪽에게 「지금 다시 쓸 수 있다」를 공표하는 셈이다.
// 게다가 각 배치의 테스트가 「/api/health 가 이 상태를 노출한다」를 **CI 로 고정**해 두었으므로,
// 이 공개는 실수가 아니라 **지켜지는 규약**이 되어 있다.
//
// ── 그래서 무엇을 하는가 ───────────────────────────────────────────────────────
// (가) 무엇이 공개되고 그것으로 무엇을 할 수 있는지 정본(`DISCLOSURES`)으로 적는다.
// (나) **사건 표지가 env 에 들어가 있는 동안만** 무인증 응답에서 상세를 가린다(`publicHealthView`).
//      평상시에는 응답이 한 글자도 바뀌지 않는다 — 가릴 사건이 없고, 바꾸면 §2 월 점검이 깨진다.
// (다) 가리면 복구 담당자도 못 보게 되므로(= **복구가 자기 자신을 막는다**, 이 저장소가 계속
//      피해 온 함정) 상세를 보는 경로를 남긴다 — `x-health-token` 헤더로 `HEALTH_DETAIL_TOKEN`.
// (라) 토큰이 없으면 **가리지 않는다.** 대신 그 사실(`exposed`)을 degraded 로 드러낸다 —
//      절차를 막는 대신, 지금 공표 중이라는 사실을 숨기지 않는다.
// (마) 가려도 `status`·`ok`·`x-health-status` 는 그대로 내보낸다. 그것까지 숨기면 §2-2 가 만든
//      도달 경로가 죽는다 — 「무엇이」는 가리고 「무언가 이상하다」는 남긴다.
//
// 판정은 입력 해석뿐이다 — DB·next·fs 미접근, 신규 조회·쓰기·DDL 0, 신규 env 1건.

import { isSwitchOn, presenceOf } from './envPresence.ts';
import { HEALTH_DEGRADED_HEADER } from './healthSignal.ts';
import { FREEZE_AT_ENV } from './incidentClosure.ts';
import { PRESERVED_AT_ENV } from './evidencePreservation.ts';
import { EXTERNAL_RECONCILED_ENV } from './externalReconcile.ts';
import { NOTICE_AT_ENV, RESTORE_POINT_ENV } from './lossNotice.ts';
import { SECURITY_REAPPLIED_ENV } from './postRestoreSecurity.ts';
import { REHEARSAL_ACTIVE_ENV } from './rehearsalScope.ts';
import { WRITE_FREEZE_ENV } from './writeFreeze.ts';

/** 상세 열람 토큰. **평상시 미설정이 정상**이고, 없으면 가리지 않는다(절차를 막지 않는다) */
export const DETAIL_TOKEN_ENV = 'HEALTH_DETAIL_TOKEN';

/**
 * 토큰을 받는 자리. **질의 문자열이 아니라 헤더다** — 질의 문자열은 CDN·프록시·업타임 모니터의
 * 요청 로그와 브라우저 이력에 그대로 남는다(헤더도 완전하지는 않다 — `DISCLOSURE_LIMITS` 참고).
 */
export const DETAIL_TOKEN_HEADER = 'x-health-token';

export const DISCLOSURE_RUNBOOK_REF =
  'RUNBOOK.md §2-3 (공개 헬스 응답의 상세 — 복구 중에는 사건 상태를 공표한다)';

/**
 * 토큰 길이 권고. **미달이어도 막지 않는다**(복구 중에 상세를 잠그는 쪽이 더 위험하다) —
 * 짧은 토큰은 「가린 척」이 되므로 `tokenWeak` 로 드러내기만 한다.
 */
export const TOKEN_MIN_LENGTH = 24;

/* ─────────────────────────── 무엇이 공개되는가(정본) ─────────────────────────── */

export interface Disclosure {
  /** `lib/health.ts` 의 `CheckName` */
  check: string;
  /** 무인증 응답에 실제로 나가는 `detail` 칸 */
  fields: readonly string[];
  /** 그것으로 읽는 쪽이 알게 되는 것 */
  learns: string;
  /** 알면 할 수 있게 되는 것 */
  enables: string;
  /** 왜 지금까지 걸리지 않았는가 */
  whyUnnoticed: string;
}

/**
 * **값**이 아니라 **판정과 키 이름**이 만드는 노출이다 — 그래서 각 배치의 「값 미포함」 점검을
 * 전부 통과했다. 목록은 전수가 아니라 **가장 날카로운 것들**이고, 가리는 범위는 이 목록이
 * 아니라 `visibilityOf()`(공개 허용 목록 밖은 전부 가린다)가 정한다.
 */
export const DISCLOSURES: readonly Disclosure[] = [
  {
    check: 'writeFreeze',
    fields: ['frozen', 'exempt', 'limits'],
    learns: '지금 이 서비스가 쓰기 차단(= 사건 복구) 중인지, 그리고 차단 중에도 **쓰기가 통하는 경로 목록**',
    enables: '사건 중이라는 사실을 외부에서 먼저 아는 것 · 차단을 우회하는 경로를 고르는 것',
    whyUnnoticed: '차단은 기능이고 `frozen` 은 2단계의 유일한 확인 수단이라, 공개가 **절차상 필요**로 보였다',
  },
  {
    check: 'postRestoreSecurity',
    fields: ['state', 'phase', 'frozen'],
    learns: '복구가 되돌린 세션·비밀번호·권한을 **아직 재적용하지 않았다**(`pending`)는 사실과, 끝난 시점(`recorded`)',
    enables: '되살아난 옛 세션 쿠키·유출된 옛 비밀번호가 **다시 통하는 구간**을 정확히 노리는 것',
    whyUnnoticed: '§3-8 은 그 구간을 **줄이려고** 이 신호를 만들었다 — 그 신호가 무인증이라는 점은 따로 보지 않았다',
  },
  {
    check: 'incidentClosure',
    fields: ['state', 'frozenAt'],
    learns: '차단을 건 정확한 시각 — 즉 사건 발생·대응 타임라인',
    enables: '고지 전에 사건을 외부에 알리는 것 · 유실 구간을 역산해 그 구간의 쓰기를 노리는 것',
    whyUnnoticed: '「시각은 값이 아니라 기록」으로 분류돼 PII·시크릿 점검을 통과했다',
  },
  {
    check: 'lossNotice',
    fields: ['state', 'windowVerdict', 'notified', 'noticedAt', 'blockers'],
    learns: '유실 구간을 **아직 고지하지 않았다**(`due`)는 사실과, 고지를 보낸 시각',
    enables: '고지 전 구간에 사건을 외부에 먼저 알리는 것 · 「아직 아무도 모른다」는 창을 아는 것',
    whyUnnoticed: '고지 수행 기록은 **이번에 처음 생긴 값**이다 — 구간 수치는 애초에 담지 않았다',
  },
  {
    check: 'envPresence',
    fields: ['missingKeys', 'blankedKeys', 'unknownKeys', 'ineffectiveSwitches'],
    learns: '어느 설정이 빠졌거나 공백인 채로 돌고 있는지(키 이름)',
    enables: '관측·알림이 꺼져 있는지, 어떤 보호가 미설정인지 고르는 것(정찰)',
    whyUnnoticed: '값을 담지 않는 규율을 지켰고 **키 이름만** 담았다 — 그 이름 자체가 상태를 말한다는 점은 보지 않았다',
  },
  {
    check: 'dbIdentity',
    fields: ['verdict', 'fingerprint', 'provider', 'pooled', 'region'],
    learns: '연결 대상이 바뀌었는지(`mismatch`) — 전환이 반영됐는지',
    enables: '복구 전환의 진행 단계를 외부에서 추적하는 것',
    whyUnnoticed: '호스트·자격증명을 지우고 지문만 남겼으므로 「민감정보 없음」으로 통과했다',
  },
  {
    check: 'rehearsalScope',
    fields: ['verdict', 'declared', 'role', 'activeKeys'],
    learns: '이 배포가 리허설 대상으로 선언돼 있는지, 어떤 파괴적 설정이 켜져 있는지(키 이름)',
    enables: '파괴적 설정이 켜진 창을 아는 것 · 운영 리허설(`production_rehearsal`) 중을 노리는 것',
    whyUnnoticed: '선언은 **드러내려고** 만든 값이라 공개가 목적과 일치해 보였다',
  },
  {
    check: 'deployPin',
    fields: ['verdict', 'pinned', 'actual', 'phase', 'atRisk'],
    learns: '롤백이 걸려 있는지·풀렸는지(`drifted`)와, 되돌아간 설정 키 이름',
    enables: '알려진 결함이 있는 옛 코드가 지금 돌고 있는 구간을 아는 것',
    whyUnnoticed: '커밋 해시는 §「/health 확장」이 **의도적으로** 공개한 값이라 같은 분류로 묶였다',
  },
];

export function disclosureFor(check: unknown): Disclosure | null {
  const name = String(check ?? '');
  return DISCLOSURES.find((d) => d.check === name) ?? null;
}

/* ─────────────────────────── 공개/운영자 구분 ─────────────────────────── */

export type Audience = 'public' | 'operator';

/**
 * 상세를 **가리지 않는** 체크. 사건과 무관한 상시 의존성 상태만 둔다.
 *
 * `monitoring` 은 여기에 **없다** — 알림 배선 여부는 「지금 아무도 보고 있지 않다」를 말한다.
 * 허용 목록 방식인 이유: 나중에 추가되는 체크는 **적지 않으면 가려진다**(보수적인 쪽으로 실패한다).
 */
export const PUBLIC_DETAIL_CHECKS: readonly string[] = ['db', 'billing'];

/** 허용 목록 밖은 전부 `operator` — 모르는 체크를 공개로 올리지 않는다 */
export function visibilityOf(check: unknown): Audience {
  return PUBLIC_DETAIL_CHECKS.includes(String(check ?? '')) ? 'public' : 'operator';
}

/* ─────────────────────────── 사건 표지 ─────────────────────────── */

export interface IncidentMarker {
  key: string;
  /** `switch` 는 `'true'` 만 ON(실제 읽는 쪽과 똑같이), `record` 는 값이 있으면 표지 */
  kind: 'switch' | 'record';
  means: string;
}

/**
 * 「지금 사건(또는 리허설) 중이다」를 뜻하는 env 표지. 전부 **평상시 미설정이 정상**이고
 * §3 8단계 4번이 지우라고 지시하는 키들이다 — 그래서 사건이 끝나면 표지도 사라진다.
 *
 * 스위치는 **느슨하게 읽지 않는다**(`RECOVERY_WRITE_FREEZE=1` 은 차단이 걸리지 않으므로
 * 공개될 사건 상태도 없다). 느슨하게 읽으면 판정이 실제 동작과 어긋난다.
 */
export const INCIDENT_MARKERS: readonly IncidentMarker[] = [
  { key: WRITE_FREEZE_ENV, kind: 'switch', means: '쓰기 차단(§3 2단계)이 걸려 있다 — 복구 중이다' },
  { key: FREEZE_AT_ENV, kind: 'record', means: '차단을 건 시각이 기록돼 있다(§3-7) — 사건 타임라인이 열려 있다' },
  { key: RESTORE_POINT_ENV, kind: 'record', means: '복구 시점(T-ε)이 기록돼 있다(§3-10) — 유실 구간의 **시작**이다' },
  { key: PRESERVED_AT_ENV, kind: 'record', means: '조사 근거 보존(§3-5)을 마친 시각이 기록돼 있다(§3-15)' },
  { key: NOTICE_AT_ENV, kind: 'record', means: '유실 구간 고지를 발신한 시각이 기록돼 있다(§3 8단계 2번)' },
  { key: SECURITY_REAPPLIED_ENV, kind: 'record', means: '보안 상태 재적용 시각이 기록돼 있다(§3 6-1단계)' },
  { key: EXTERNAL_RECONCILED_ENV, kind: 'record', means: '외부 상태 대조 시각이 기록돼 있다(§3 6-2단계)' },
  { key: REHEARSAL_ACTIVE_ENV, kind: 'switch', means: '이 배포가 리허설 대상으로 선언돼 있다(§6-1)' },
];

/** 지금 들어가 있는 사건 표지의 **키 이름**(값 없음) */
export function activeMarkers(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const m of INCIDENT_MARKERS) {
    const on = m.kind === 'switch' ? isSwitchOn(env, m.key) : presenceOf(env, m.key) === 'set';
    if (on) out.push(m.key);
  }
  return out;
}

export function markerFor(key: unknown): IncidentMarker | null {
  const k = String(key ?? '');
  return INCIDENT_MARKERS.find((m) => m.key === k) ?? null;
}

/* ─────────────────────────── 토큰 ─────────────────────────── */

/** 토큰 **값은 어디에도 돌려주지 않는다** — 존재와 길이 등급만 */
export function tokenState(env: Record<string, string | undefined> = process.env): {
  configured: boolean;
  weak: boolean;
} {
  const raw = (env.HEALTH_DETAIL_TOKEN ?? '').trim();
  if (!raw) return { configured: false, weak: false };
  return { configured: true, weak: raw.length < TOKEN_MIN_LENGTH };
}

/**
 * 길이·내용 비교 시간을 입력에 따라 달라지지 않게 맞춘다(타이밍 측정으로 앞자리를 맞춰 가는 것을
 * 막는다). 완전한 상수 시간 보장은 아니다 — 그 한계를 숨기지 않고 `DISCLOSURE_LIMITS` 에 적는다.
 */
export function safeEqual(a: unknown, b: unknown): boolean {
  const x = typeof a === 'string' ? a : '';
  const y = typeof b === 'string' ? b : '';
  if (!x || !y) return false;
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    diff |= (x.charCodeAt(i % x.length) || 0) ^ (y.charCodeAt(i % y.length) || 0);
  }
  return diff === 0;
}

/* ─────────────────────────── 판정 ─────────────────────────── */

export type DisclosureVerdict =
  /** 사건 표지 없음 + 토큰 없음 — 가릴 것이 없다(평상시) */
  | 'normal'
  /** 사건 표지 없음 + 토큰 있음 — 사건이 나면 그때 가려진다 */
  | 'ready'
  /** 사건 중 + 토큰 있음 — 무인증 응답에서 상세를 가린다 */
  | 'gated'
  /** 사건 중 + 토큰 없음 — **지금 공표 중이다**(가리지 않는다. 절차를 막지 않기 위해) */
  | 'exposed';

export const ACTION_NORMAL = '평상시 — 사건 표지가 없다. 가릴 사건 상태도 없다';
export const ACTION_READY =
  `사건 표지는 없고 ${DETAIL_TOKEN_ENV} 는 설정돼 있다 — 사건이 나면 무인증 응답에서 상세가 자동으로 가려진다`;
export const ACTION_GATED =
  `사건 중 — 무인증 응답은 요약만 내보낸다. 상세는 \`${DETAIL_TOKEN_HEADER}\` 헤더에 ${DETAIL_TOKEN_ENV} 값을 넣어 호출한다`;
export const ACTION_EXPOSED =
  `사건 중인데 ${DETAIL_TOKEN_ENV} 가 없다 — 이 응답이 **무인증으로** 차단 여부·보안 재적용 미완·사건 시각을 ` +
  `공표하고 있다. 같은 스코프에 토큰을 넣고 재배포하면 가려진다(상세 확인 경로는 헤더로 유지된다)`;

const ACTION: Record<DisclosureVerdict, string> = {
  normal: ACTION_NORMAL,
  ready: ACTION_READY,
  gated: ACTION_GATED,
  exposed: ACTION_EXPOSED,
};

export interface DisclosureGate {
  verdict: DisclosureVerdict;
  audience: Audience;
  /** 이 요청에서 상세를 가려야 하는가 */
  withhold: boolean;
  tokenConfigured: boolean;
  tokenWeak: boolean;
  tokenPresented: boolean;
  tokenMatched: boolean;
  /** 사건 표지 **키 이름**(값 없음) */
  markers: string[];
  action: string;
}

/**
 * 요청 1건의 판정. `token` 은 `x-health-token` 헤더 값(없으면 null).
 *
 * **가리는 조건은 하나뿐이다** — 사건 표지가 있고, 토큰이 설정돼 있고(= 상세를 볼 경로가
 * 존재하고), 이 요청이 그 토큰을 제시하지 않았을 때. 토큰이 없으면 가리지 않는다.
 */
export function disclosureGate(args?: {
  token?: string | null;
  env?: Record<string, string | undefined>;
}): DisclosureGate {
  const env = args?.env ?? process.env;
  const markers = activeMarkers(env);
  const tok = tokenState(env);
  const presented = typeof args?.token === 'string' && args.token.trim() !== '';
  const matched = presented && tok.configured && safeEqual(String(args?.token).trim(), (env.HEALTH_DETAIL_TOKEN ?? '').trim());

  const verdict: DisclosureVerdict =
    markers.length === 0 ? (tok.configured ? 'ready' : 'normal') : tok.configured ? 'gated' : 'exposed';
  const audience: Audience = matched ? 'operator' : 'public';

  return {
    verdict,
    audience,
    withhold: verdict === 'gated' && audience === 'public',
    tokenConfigured: tok.configured,
    tokenWeak: tok.weak,
    tokenPresented: presented,
    tokenMatched: matched,
    markers,
    action: ACTION[verdict],
  };
}

/* ─────────────────────────── 공개 응답 조립 ─────────────────────────── */

export const WITHHELD_REASON =
  '복구 중에는 체크 상세가 사건 상태(차단 여부·보안 재적용 미완·사건 시각·빠진 설정 키)를 말한다 — 무인증 응답에서는 가린다';
export const WITHHELD_HOW =
  `상세는 \`${DETAIL_TOKEN_HEADER}\` 헤더에 ${DETAIL_TOKEN_ENV} 값을 넣어 다시 호출한다(질의 문자열로 보내지 않는다 — 요청 로그에 남는다)`;
export const NOTE_UNREADABLE = '본문 모양을 읽을 수 없어 통째로 가렸다 — 모르는 모양을 공개로 올리지 않는다';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function withheldBlock(counts: { checks: number; notOk: number; unreadable: number }): Record<string, unknown> {
  return {
    audience: 'operator',
    checks: counts.checks,
    notOk: counts.notOk,
    unreadable: counts.unreadable,
    reason: WITHHELD_REASON,
    how: WITHHELD_HOW,
    tokenHeader: DETAIL_TOKEN_HEADER,
    runbook: DISCLOSURE_RUNBOOK_REF,
  };
}

/** `signal` 요약에서 **체크 이름**을 지우고 개수만 남긴다(이름 자체가 어느 단계인지 말한다) */
function publicSignal(signal: unknown): Record<string, unknown> | undefined {
  if (!isObj(signal)) return undefined;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : null);
  return {
    verdict: signal.verdict,
    degradedCount: count(signal.degraded),
    failingCount: count(signal.failing),
    timeBoundCount: count(signal.timeBound),
    visibleToStatusCode: signal.visibleToStatusCode,
    visibleToOkFlag: signal.visibleToOkFlag,
    withheld: true,
    runbook: signal.runbook,
  };
}

/**
 * 무인증 공개용 본문. `gated: false` 면 **손대지 않는다**(평상시 응답은 한 글자도 바뀌지 않는다).
 *
 * 가리는 것은 상세뿐이다 — `status`·`ok` 와 `signal.verdict` 는 남긴다(§2-2 의 도달 경로를
 * 죽이지 않는다). 가려진 체크는 **이름조차 담지 않는다**(이름이 복구 단계를 말한다).
 */
export function publicHealthView(body: unknown, args: { gated: boolean }): Record<string, unknown> {
  if (!args.gated) return (isObj(body) ? body : {}) as Record<string, unknown>;
  if (!isObj(body)) {
    return {
      ok: false,
      status: 'unreadable',
      note: NOTE_UNREADABLE,
      withheld: withheldBlock({ checks: 0, notOk: 0, unreadable: 0 }),
    };
  }

  const checks = isObj(body.checks) ? body.checks : {};
  const kept: Record<string, unknown> = {};
  const counts = { checks: 0, notOk: 0, unreadable: 0 };
  for (const [name, value] of Object.entries(checks)) {
    if (visibilityOf(name) === 'public') {
      kept[name] = value;
      continue;
    }
    counts.checks += 1;
    if (!isObj(value)) counts.unreadable += 1;
    else if (value.ok === false) counts.notOk += 1;
  }

  const out: Record<string, unknown> = {
    ok: body.ok,
    status: body.status,
    service: body.service,
    version: body.version,
    commit: body.commit,
    branch: body.branch,
    env: body.env,
    region: body.region,
    time: body.time,
    uptimeSec: body.uptimeSec,
    checks: kept,
    withheld: withheldBlock(counts),
  };
  const signal = publicSignal(body.signal);
  if (signal) out.signal = signal;
  return out;
}

/**
 * 응답 헤더에서 **degraded 체크 이름**을 지운다. `x-health-status` 는 남긴다 —
 * 그것이 §2-2 가 감시자에 걸라고 한 조건이고, 「무언가 이상하다」는 가릴 대상이 아니다.
 */
export function publicSignalHeaders(
  headers: Record<string, string>,
  args: { gated: boolean },
): Record<string, string> {
  const src = isObj(headers) ? (headers as Record<string, string>) : {};
  if (!args.gated) return { ...src };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k.toLowerCase() === HEALTH_DEGRADED_HEADER) continue;
    out[k] = v;
  }
  return out;
}

/* ─────────────────────────── 사각지대 ─────────────────────────── */

export const DISCLOSURE_LIMITS: readonly string[] = [
  '가리는 것은 **상세**뿐이다 — 상태 코드·`status`·`ok`·`x-health-status` 는 그대로 나간다(숨기면 §2-2 가 만든 도달 경로가 죽는다). 「복구 중 무언가 degraded 다」까지는 여전히 읽힌다',
  '`version`·`commit`·`branch` 는 이전부터 **의도적으로** 공개다 — 어느 코드가 돌고 있는지는 이 게이트가 가리지 않는다',
  '토큰은 「보유자는 운영자다」는 뜻뿐이다 — 공유·유출되면 가린 적이 없는 것과 같다(세션·역할 기반 인가가 아니다. 그래서 상세의 **값**은 여전히 시크릿을 담지 않는다)',
  '사건 표지는 **환경변수로만** 판정한다 — 표지를 넣지 않고 진행한 복구(차단을 걸지 않은 복구)는 가려지지 않는다',
  '이미 나간 응답은 되돌릴 수 없다 — CDN·프록시·업타임 모니터 로그에 남은 과거 응답은 이 게이트와 무관하다',
  '헤더로 받은 토큰도 **요청 로그에 남을 수 있다** — 질의 문자열을 쓰지 않는 이유가 그것이고, 헤더가 안전하다는 뜻은 아니다',
  '토큰 비교는 길이·내용 차이가 응답 시간에 덜 드러나게 맞춘 것뿐이다 — 상수 시간 보장이 아니다',
  '이 판정 자체도 **이 배포의 env** 만 본다 — 스코프를 틀려 넣은 토큰은 그 배포에서만 작동한다(§6-1 과 같은 함정)',
];

/* ─────────────────────────── 출력 ─────────────────────────── */

export interface DisclosureStatus {
  verdict: DisclosureVerdict;
  markers: string[];
  tokenConfigured: boolean;
  tokenWeak: boolean;
  tokenEnv: string;
  tokenHeader: string;
  publicDetailChecks: readonly string[];
  disclosedChecks: readonly string[];
  action: string;
  limits: readonly string[];
  runbook: string;
}

/** 공개 응답에 싣는 요약. 키 이름·판정만 담고 **토큰 값·설정값은 담지 않는다** */
export function disclosureStatus(env: Record<string, string | undefined> = process.env): DisclosureStatus {
  const g = disclosureGate({ env });
  return {
    verdict: g.verdict,
    markers: g.markers,
    tokenConfigured: g.tokenConfigured,
    tokenWeak: g.tokenWeak,
    tokenEnv: DETAIL_TOKEN_ENV,
    tokenHeader: DETAIL_TOKEN_HEADER,
    publicDetailChecks: PUBLIC_DETAIL_CHECKS,
    disclosedChecks: DISCLOSURES.map((d) => d.check),
    action: g.action,
    limits: DISCLOSURE_LIMITS,
    runbook: DISCLOSURE_RUNBOOK_REF,
  };
}

/**
 * `/api/health` 체크. **required: false** — 노출 상태로 서비스를 내리면 복구가 자기 자신을 막는다.
 * `exposed`(사건 중 공표)와 짧은 토큰(`가린 척`)만 degraded 로 내린다.
 */
export function disclosureCheck(args?: {
  env?: Record<string, string | undefined>;
}): { ok: boolean; required: false; detail: Record<string, unknown> } {
  const env = args?.env ?? process.env;
  const s = disclosureStatus(env);
  return {
    ok: s.verdict !== 'exposed' && !(s.tokenConfigured && s.tokenWeak),
    required: false,
    detail: { ...s },
  };
}

/** 사람이 읽는 요약(보고·문서용). 수치를 지어내지 않는다 */
export function disclosureText(env: Record<string, string | undefined> = process.env): string[] {
  const s = disclosureStatus(env);
  const lines = [`판정: ${s.verdict}`];
  if (s.markers.length > 0) lines.push(`사건 표지: ${s.markers.join(', ')}`);
  lines.push(`토큰(${s.tokenEnv}): ${s.tokenConfigured ? (s.tokenWeak ? `설정(${TOKEN_MIN_LENGTH}자 미만)` : '설정') : '미설정'}`);
  lines.push(`상세 공개 유지: ${s.publicDetailChecks.join(', ')}`);
  lines.push(`할 일: ${s.action}`);
  return lines;
}

/** 로그 한 줄. 판정·개수만 — 토큰·설정값·호스트를 담지 않는다 */
export function disclosureLogLine(env: Record<string, string | undefined> = process.env): string {
  const s = disclosureStatus(env);
  const parts = [
    'health.disclosure',
    `verdict=${s.verdict}`,
    `markers=${s.markers.length}`,
    `token=${s.tokenConfigured ? (s.tokenWeak ? 'weak' : 'set') : 'absent'}`,
  ];
  if (s.markers.length > 0) parts.push(`keys=${s.markers.join('|')}`);
  return parts.join(' ');
}

/* ─────────────────────────── 정적 점검(CI) ─────────────────────────── */

/**
 * 공개 허용 목록·노출 정본이 **실제 `CheckName` 을 가리키는지** 대조한다.
 * 이름이 어긋나면 허용 목록은 아무것도 가리키지 않게 되고(전건 가려져 §2 점검이 막힌다),
 * 노출 정본은 아무 체크도 설명하지 못한다. 반대로 위험한 체크가 **공개 목록에 올라오는** 변경도 막는다.
 */
export function auditVisibilityCoverage(healthSrc: unknown): string[] {
  const h = String(healthSrc ?? '');
  const problems: string[] = [];
  const union = h.match(/export\s+type\s+CheckName\s*=([\s\S]*?);/);
  if (!union) return ['lib/health.ts 에서 CheckName 유니온을 찾지 못했다 — 타입 모양이 바뀌었으면 이 가드를 함께 볼 것'];
  const declared = [...union[1].matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]);
  if (declared.length === 0) return ['CheckName 유니온이 비었다'];

  for (const name of PUBLIC_DETAIL_CHECKS) {
    if (!declared.includes(name)) problems.push(`공개 허용 목록의 ${name} 이(가) CheckName 에 없다 — 가리킬 곳을 잃었다`);
  }
  for (const d of DISCLOSURES) {
    if (!declared.includes(d.check)) problems.push(`노출 정본의 ${d.check} 이(가) CheckName 에 없다 — 표가 설명할 대상을 잃었다`);
  }
  // 사건 상태를 말하는 체크가 공개 목록으로 올라오면 이 모듈이 있는 이유가 사라진다.
  for (const d of DISCLOSURES) {
    if (PUBLIC_DETAIL_CHECKS.includes(d.check)) problems.push(`${d.check} 이(가) 공개 허용 목록에 있다 — 사건 상태가 그대로 나간다`);
  }
  return problems;
}

/**
 * 라우트가 게이트를 **실제로 적용하는지** 점검한다. 판정만 하고 분기하지 않거나, 토큰을 질의
 * 문자열에서 읽으면(요청 로그·브라우저 이력에 남는다) 실패시킨다. 응답은 그대로 200 이라
 * 사람 눈으로는 알아챌 수 없는 회귀다.
 */
export function auditRouteGating(routeSrc: unknown): string[] {
  const s = String(routeSrc ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/healthDisclosure['"]/.test(s)) problems.push('healthDisclosure 를 import 하지 않는다');
  if (!/disclosureGate\(/.test(s)) problems.push('disclosureGate() 를 호출하지 않는다 — 가릴지 판정하지 않는다');
  if (!/publicHealthView\(/.test(s)) problems.push('publicHealthView() 를 호출하지 않는다 — 상세가 그대로 나간다');
  else if (!/NextResponse\.json\(\s*publicHealthView\(/.test(s)) {
    problems.push('publicHealthView() 결과를 응답 본문으로 내보내지 않는다(판정만 하고 버리는 꼴)');
  }
  if (!/publicSignalHeaders\(/.test(s)) problems.push('publicSignalHeaders() 를 거치지 않는다 — degraded 체크 이름이 헤더로 나간다');
  if (!/\.withhold\b/.test(s)) problems.push('게이트 결과(withhold)로 분기하지 않는다');
  if (!new RegExp(`headers\\.get\\(\\s*(DETAIL_TOKEN_HEADER|['"]${DETAIL_TOKEN_HEADER}['"])`).test(s)) {
    problems.push(`토큰을 요청 헤더(${DETAIL_TOKEN_HEADER})에서 읽지 않는다`);
  }
  if (/searchParams\.get\(\s*['"][^'"]*token/i.test(s)) {
    problems.push('토큰을 질의 문자열에서 읽는다 — CDN·프록시·모니터 로그와 브라우저 이력에 남는다');
  }
  if (!/checks\.disclosure\s*=/.test(s)) problems.push('checks.disclosure 가 배선되지 않았다 — 공표 상태가 응답에 나오지 않는다');
  return problems;
}

/** RUNBOOK §2-3 이 사라지면 토큰을 넣는 방법·가려지는 범위의 근거가 없어진다 */
export function auditRunbookDisclosure(md: unknown): string[] {
  const s = String(md ?? '');
  const problems: string[] = [];
  if (!/^###\s*2-3\./m.test(s)) problems.push('§2-3(공개 헬스 응답의 상세) 절이 없다');
  if (!s.includes(DETAIL_TOKEN_ENV)) problems.push(`${DETAIL_TOKEN_ENV} 가 문서에 없다 — 가리는 방법이 사라진다`);
  if (!s.includes(DETAIL_TOKEN_HEADER)) problems.push(`${DETAIL_TOKEN_HEADER} 가 문서에 없다 — 상세를 보는 방법이 사라진다`);
  for (const v of ['exposed', 'gated'] as const) {
    if (!s.includes(v)) problems.push(`판정 ${v} 가 문서에 없다`);
  }
  if (!/평상시[^\n]*미설정/.test(s)) problems.push('「평상시 미설정이 정상」이 문서에 없다 — 토큰을 필수 키로 오해한다');
  if (!/상태 코드/.test(s)) problems.push('「상태 코드·ok 는 가리지 않는다」가 문서에 없다 — 감시자 설정이 흔들린다');
  for (const m of INCIDENT_MARKERS) {
    if (!s.includes(m.key)) problems.push(`사건 표지 ${m.key} 가 문서에 없다`);
  }
  return problems;
}
