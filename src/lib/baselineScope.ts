/**
 * baselineScope.ts — 기준치가 **어느 배포의 설정인가**. 2026-10-24
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * `lib/recoveryBaseline.ts` 는 기준 스냅샷이 **언제 기준인지**(낡음·날짜 없음)를 가린다.
 * 그 판정에는 전제가 하나 더 있는데 어디에도 적혀 있지 않았다 — **판정하는 배포와 그 값을
 * 공급하는 배포가 같은 배포인가.**
 *
 * RUNBOOK 은 두 스코프를 **번갈아** 쓴다.
 *  · §2 월 점검 3번: **운영 배포**에서 `/api/admin/recovery-verify` 를 호출해 `data.snapshot` 을
 *    `RECOVERY_DATA_BASELINE` 에 넣고, 5번에서 **운영** `/api/health` 의
 *    `checks.recovery.detail.baseline.status` 가 `ok` 인지 본다.
 *  · §3 4단계: **스테이징 배포**(§6-1 이 Preview 스코프로 쓰라고 적어 둔 그 배포)에서 같은
 *    엔드포인트를 호출한다. 그 배포는 **자기 스코프의** env 를 읽는다.
 *
 * Vercel env 는 스코프별로 갈리므로 두 값은 **다른 벌**이다. 그래서:
 *
 *  (1) **매월 확인한 신선도는 복구일에 쓰이는 값의 것이 아니다.** §2 5번이 매월 본 `ok` 는
 *      운영 스코프의 벌에 대한 보증이고, 4단계가 읽는 것은 스테이징 스코프의 벌이다.
 *  (2) **스테이징에 기준치가 없으면** 4단계는 `no_baseline` 에서 멈추고 `switchReady` 가 올라가지
 *      않는다. 그때 담당자가 가장 하기 쉬운 행동이 §3-2 의 **유일한 금기**(복구일 재스냅샷)다.
 *      게다가 그 재스냅샷은 스테이징 스코프에 들어가므로 **운영 `/api/health` 에는 아무 변화도
 *      보이지 않는다** — 기준치가 망가진 사실이 §2 5번에 끝까지 드러나지 않는다.
 *  (3) **스테이징에 사본을 두면 §2 가 그것을 갱신하지 않는다.** 그 사본은 조용히 낡는데, 같은
 *      스코프에 `RECOVERY_BASELINE_MAX_AGE_DAYS` 가 없으면 `assessBaselineAge` 가
 *      `unjudged`·`trusted: true` 로 **통과시킨다** — §3-2 가 막겠다고 적어 둔 바로 그 실패가
 *      (「낡은 수치는 유실된 DB 도 통과시킨다」) 스코프가 갈리는 순간 그대로 통과한다.
 *  (4) **응답은 어느 배포에서 판정했는지 말하지 않는다.** `identity` 는 「어느 **DB** 를 보는가」
 *      까지만 말한다. 운영에서 뜬 응답과 스테이징에서 뜬 응답은 **글자 하나 다르지 않다.**
 *
 * 이 모듈은 그 구분을 응답에 적는다 — **판정을 뒤집지 않는다.** 어느 스코프에 값을 두는 운용이
 * 맞는지는 코드가 알 수 없고(§3-12 가 지문에 대해 같은 결론을 낸 자리다), 여기서 `switchReady` 를
 * 내리면 복구일에 거짓 차단이 된다. 달라지는 것은 **다음에 할 일**이다.
 *
 * 원칙
 * - 순수 모듈: DB·next·fs·`process.env` 미접근. **신규 env 0 · 신규 조회·쓰기·DDL 0 ·
 *   신규 런타임 체크 0** — 이미 있는 플랫폼 키(`VERCEL_ENV`)의 판독을 재사용한다.
 * - **판독 방식을 복제하지 않는다** — 배포 역할은 `rehearsalScope.deploymentRole()` 정본을 쓴다.
 *   여기서 `VERCEL_ENV` 를 다시 읽으면 두 곳의 판독이 갈라지고, 갈라진 쪽은 아무 응답도 바꾸지
 *   않으므로 영구히 남는다(`auditRoleReader` 가 CI 로 잡는다).
 * - **임의 귀속 금지** — 역할을 모르면(`VERCEL_ENV` 없음) 「운영이다」도 「스테이징이다」도 아닌
 *   `scope_unknown` 으로 멈춘다. 다른 스코프의 env 는 **볼 수 없다** — 이 모듈이 말하는 것은
 *   언제나 **이 배포의 벌**에 대한 것이다.
 * - 값을 담지 않는다 — 스코프 이름·키 이름·판정뿐이다(행 수·지문·스냅샷 값 미포함).
 */
import { ENV_VARS } from './envRegistry.ts';
import { presenceOf } from './envPresence.ts';
import { deploymentRole, type DeploymentRole } from './rehearsalScope.ts';
import { BASELINE_MAX_AGE_ENV, type BaselineAgeStatus } from './recoveryBaseline.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const BASELINE_SCOPE_REF = 'RUNBOOK §3-13 · §3-2 · §2 3번';

/** 행 수 기준 스냅샷 키 */
export const DATA_BASELINE_ENV = 'RECOVERY_DATA_BASELINE';

/* ─────────────── 기준값이 어디서 공급되고 어디서 판정되는가(정본) ─────────────── */

/**
 * 한 기준값의 **공급처**와 **판정처**.
 *
 * `crossScope: true` 는 「공급하는 배포와 판정하는 배포가 다르다」는 뜻이고, 그 키는
 * **두 벌이 존재한다**. 두 벌이라는 사실 자체가 고장은 아니지만, 한쪽만 갱신되는 순간
 * 나머지 한쪽은 **아무 응답도 바꾸지 않으면서** 복구일 판정의 기준이 된다.
 */
export interface SupplyRoute {
  key: string;
  /** 누가 값을 넣는가(절) */
  suppliedIn: string;
  /** 그 작업을 하는 배포 */
  suppliedScope: DeploymentRole;
  /** 그 값으로 판정하는 절 */
  judgedIn: string;
  /** 그 판정을 수행하는 배포 */
  judgedScope: DeploymentRole;
  /** 신선도·존재 여부를 **사람이 보는** 곳 */
  seenIn: string;
  /** 공급처와 판정처가 다른가 */
  crossScope: boolean;
  /** 두 벌이 갈렸을 때 생기는 일 — 전부 「오류 없음」으로 진행된다 */
  whenSplit: string;
}

export const SUPPLY_ROUTES: readonly SupplyRoute[] = [
  {
    key: DATA_BASELINE_ENV,
    suppliedIn: '§2 월 점검 3번(운영 `/api/admin/recovery-verify` 의 `data.snapshot` 복사)',
    suppliedScope: 'production',
    judgedIn: '§3 4단계(행 수 대조 — `switchReady` 의 절반)',
    judgedScope: 'preview',
    seenIn: '§2 5번 — **운영** `/api/health` 의 `checks.recovery.detail.baseline.status`',
    crossScope: true,
    whenSplit:
      '스테이징에 없으면 4단계가 `no_baseline` 에서 멈추고(복구일 재스냅샷 = §3-2 의 유일한 금기로 밀린다), ' +
      '사본이 있으면 §2 가 그것을 갱신하지 않아 조용히 낡는다. **둘 다 운영 `/api/health` 에는 보이지 않는다**',
  },
  {
    key: BASELINE_MAX_AGE_ENV,
    suppliedIn: '§2(스냅샷과 **함께** 설정한다 — `ACTION_BASELINE_ABSENT` 가 적어 둔 한 벌)',
    suppliedScope: 'production',
    judgedIn: '§3 4단계(위 스냅샷의 낡음 판정)',
    judgedScope: 'preview',
    seenIn: '§2 5번 — `baseline.status` 가 `unjudged` 면 이 키가 없는 것이다',
    crossScope: true,
    whenSplit:
      '판정하는 배포에 없으면 낡음 판정이 **보류**된다(`unjudged` · `trusted: true`) — ' +
      '낡은 사본이 「기준치 이상」을 그대로 통과시키는데 그것이 `ok` 로 나간다',
  },
  {
    key: 'RECOVERY_EXPECTED_DB',
    suppliedIn: '§3 5단계(운영 스코프에 `DATABASE_URL` 과 함께 넣는다)',
    suppliedScope: 'production',
    judgedIn: '§3-4 전환 확인(운영 `/api/health` 의 `checks.dbIdentity`)',
    judgedScope: 'production',
    seenIn: '§2 4번 — 남겨 두는 운용에서는 매월 `match` 인지 본다',
    crossScope: false,
    whenSplit:
      '같은 스코프에서 넣고 같은 스코프에서 판정하므로 두 벌이 생기지 않는다. ' +
      '다만 4단계는 이 값을 **코드로 대조하지 않고** 담당자가 §3-4 산출값과 눈으로 맞춘다',
  },
  {
    key: 'RECOVERY_ENV_BASELINE',
    suppliedIn: '§2 월 점검 4번(운영 `/api/health` 의 `checks.envPresence.detail.snapshot` 복사)',
    suppliedScope: 'production',
    judgedIn: '§4-12 설정 복구 확인(운영 `/api/health`)',
    judgedScope: 'production',
    seenIn: '§2 4번 — `checks.envPresence.detail`',
    crossScope: false,
    whenSplit: '공급·판정·관측이 모두 운영 배포 한 곳이다 — 이 키에는 두 벌이 생기지 않는다',
  },
  {
    key: 'RECOVERY_PITR_RETENTION_HOURS',
    suppliedIn: '§2 월 점검 1번(Neon 콘솔에서 확인한 보존 창 길이)',
    suppliedScope: 'production',
    judgedIn: '§3-6 복구 시점 산출(§3 1·3단계)',
    judgedScope: 'production',
    seenIn: '§2 1번 — `checks.recoveryWindow.detail.retentionConfigured`',
    crossScope: false,
    whenSplit: '1단계 판정은 운영 배포에서 한다 — 같은 스코프다',
  },
  {
    key: 'RECOVERY_LAST_CHECK',
    suppliedIn: '§2 월 점검 7번(점검을 마친 날짜)',
    suppliedScope: 'production',
    judgedIn: '§2-1 날짜 없는 설정값의 신선도',
    judgedScope: 'production',
    seenIn: '§2-1 — `checks.periodicCheck.detail.verdict`',
    crossScope: false,
    whenSplit: '점검 날짜는 점검한 배포에 적는다 — 같은 스코프다',
  },
];

/** 공급처와 판정처가 **다른** 기준값의 키 이름 */
export function crossScopeKeys(): string[] {
  return SUPPLY_ROUTES.filter((r) => r.crossScope).map((r) => r.key);
}

export function supplyRouteFor(key: unknown): SupplyRoute | null {
  const k = String(key ?? '').trim();
  return SUPPLY_ROUTES.find((r) => r.key === k) ?? null;
}

/* ───────────────────────────── 거짓이 되는 판정 ───────────────────────────── */

/** 스코프를 보지 않으면 **거짓이 되는** 문장들. 전부 응답은 200 이다 */
export const SCOPE_MISREADS: readonly { claim: string; why: string }[] = [
  {
    claim: '§2 5번에서 `baseline.status: ok` 를 봤으니 복구일 4단계의 기준치도 최신이다',
    why: '그 `ok` 는 **운영 스코프의 벌**에 대한 것이다. 4단계는 스테이징 스코프의 벌을 읽는다',
  },
  {
    claim: '4단계가 `no_baseline` 이면 §2 3번이 밀린 것이다',
    why: '운영에 넣어 두었는데 스테이징 스코프에 없을 때도 같은 판정이 나온다 — 밀린 것과 갈린 것이 구분되지 않는다',
  },
  {
    claim: '`no_baseline` 이니 지금 응답의 `snapshot` 을 기준치로 넣으면 된다',
    why: '지금 세고 있는 DB 가 의심 대상이다(§3-2 의 유일한 금기). 그리고 그 값은 **스테이징 스코프**에 들어가므로 운영 `/api/health` 에는 보이지 않는다',
  },
  {
    claim: '`baseline.status` 가 `unjudged` 인 것은 기한을 안 정했을 뿐이고 수치는 멀쩡하다',
    why: '`unjudged` 는 `trusted: true` 라 행 수 판정을 `ok` 로 올린다 — 판정하는 배포에 기한 키가 없으면 낡은 사본이 그대로 통과한다',
  },
  {
    claim: '`identity.verdict: match` 니까 기준치도 맞는 벌이다',
    why: '지문은 「어느 **DB** 를 보는가」까지만 말한다. 기준치가 어느 **배포**의 env 에서 왔는지는 말하지 않는다',
  },
  {
    claim: '스코프가 `unknown` 이면 로컬이니 운영은 아니다',
    why: '`VERCEL_ENV` 를 못 읽었다는 뜻일 뿐이다 — 모르는 것과 안전한 것은 다르다(`deploymentRole` 과 같은 규율)',
  },
];

/** 두 벌이 갈리는 방향 — 어느 쪽도 오류를 내지 않는다 */
export const SCOPE_DRIFTS: readonly { drift: string; effect: string }[] = [
  {
    drift: '운영에만 있다(스테이징에 없다)',
    effect: '4단계가 `no_baseline` 로 멈춘다 — 복구일에 가장 하기 쉬운 복구책이 §3-2 의 금기다',
  },
  {
    drift: '스테이징에만 있다(운영에 없다)',
    effect: '§2 5번이 `absent` 로 뜨는데, 4단계는 통과한다 — 두 신호가 서로를 부정한다',
  },
  {
    drift: '양쪽에 있는데 값이 다르다',
    effect:
      '§2 가 갱신하는 것은 운영 쪽 한 벌뿐이다. 스테이징 사본은 **복사한 날에 멈춰 있고** 그 날짜를 ' +
      '아는 수단이 없다(`asOf` 는 스냅샷을 뜬 날이지 사본을 만든 날이 아니다)',
  },
];

/* ───────────────────────────── 판정 ───────────────────────────── */

/**
 * - `scope_unknown` : `VERCEL_ENV` 를 못 읽었다 → 공급·판정 짝을 말할 수 없다.
 * - `supplying`     : 기준치를 **공급하는** 배포에서 판정했다(= §2 월 점검 중).
 *                     이 배포의 벌은 복구일 4단계가 읽는 벌이 **아니다**.
 * - `judging`       : 기준치로 **판정하는** 배포에서 판정했다(= §3 4단계).
 *                     이 배포의 벌은 §2 가 갱신하지 않는 **다른 벌**이다.
 * - `other`         : 둘 중 어느 쪽도 아니다(로컬·개발 배포).
 */
export type ScopeVerdict = 'scope_unknown' | 'supplying' | 'judging' | 'other';

export interface BaselineScopeAssessment {
  verdict: ScopeVerdict;
  /** 이 배포의 역할. 못 읽으면 `unknown` */
  role: DeploymentRole;
  /** 역할을 읽은 키 이름. 못 읽으면 null */
  basis: string | null;
  /** 이 배포의 기준치가 §2 월 점검이 **갱신·확인하는** 그 벌인가 */
  corroborated: boolean;
  /** 복구일 §3 4단계가 **읽는** 벌인가 */
  usedOnRecoveryDay: boolean;
  /** 낡음 판정이 이 배포에서 성립하는가 — 기한 키가 **같은 스코프**에 있어야 한다 */
  ageJudgedHere: boolean;
  /** 이 배포에서 두 벌로 갈리는 기준값의 키 이름(값 없음) */
  splitKeys: string[];
  action: string | null;
  caveats: string[];
}

export const ACTION_SCOPE_UNKNOWN =
  '이 배포가 운영인지 스테이징인지 확인할 수 없다(`VERCEL_ENV` 없음) — 기준치가 어느 벌인지도 말할 수 없다. ' +
  `복구 검증이라면 §3 4단계를 수행하는 배포에서 다시 호출하고, 그 배포에 \`${DATA_BASELINE_ENV}\` 가 ` +
  '들어 있는지 **스코프를 지정해** 확인할 것(RUNBOOK §3-13)';

export const ACTION_SCOPE_SUPPLYING =
  '이 응답은 기준치를 **공급하는** 배포(운영)에서 나왔다 — §2 월 점검 중이라면 정상이다. ' +
  '다만 이 벌은 복구일 §3 4단계가 읽는 벌이 **아니다**: 스냅샷을 갱신했으면 ' +
  `§3 4단계를 수행할 스코프에도 **같은 값**을 복사해 둘 것(\`${DATA_BASELINE_ENV}\`·\`${BASELINE_MAX_AGE_ENV}\` 한 벌. RUNBOOK §3-13)`;

export const ACTION_SCOPE_JUDGING_ABSENT =
  '복구 검증을 수행하는 배포에 기준치가 없다 — **§2 가 운영 스코프에 넣어 둔 값을 그대로 이 스코프로 복사**한다. ' +
  '지금 DB 에서 다시 뜨지 말 것(복구 대상 DB 를 자기 자신과 비교하게 된다 — §3-2 의 유일한 금기). ' +
  '그 재스냅샷은 이 스코프에만 들어가므로 운영 `/api/health` 에는 **드러나지도 않는다**(RUNBOOK §3-13)';

export function actionScopeJudgingUnjudged(key: string): string {
  return (
    `이 배포의 기준치는 §2 가 갱신하지 않는 사본인데, 같은 스코프에 \`${key}\` 가 없어 **낡음 판정이 보류**됐다 — ` +
    '그 상태의 `trusted: true` 는 「낡지 않았다」가 아니라 「낡았는지 보지 않았다」다. ' +
    `\`${key}\` 를 이 스코프에도 넣어 판정이 성립하게 하거나, 사본의 복사 시점을 다른 근거로 확인할 것(RUNBOOK §3-13)`
  );
}

export const ACTION_SCOPE_JUDGING_OK =
  '복구 검증을 수행하는 배포에서 판정했다 — 이 기준치는 **이 스코프의 벌**이고 §2 월 점검이 갱신하는 벌과 다르다. ' +
  '§2 에서 스냅샷을 갱신한 뒤 이 스코프로 복사했는지 확인할 것(RUNBOOK §3-13)';

export const ACTION_SCOPE_OTHER =
  '이 배포는 §2 공급처도 §3 4단계 판정처도 아니다(로컬·개발) — 여기서 본 기준치는 복구 판정의 근거가 아니다';

export const CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE =
  '다른 스코프의 env 는 볼 수 없다 — 이 판정은 언제나 **이 배포의 벌**에 대한 것이고, 운영에 값이 있는지 여기서 말할 수 없다';

export const CAVEAT_SCOPE_FRESHNESS_ELSEWHERE =
  '§2 5번이 매월 보는 `baseline.status` 는 **운영 스코프의 벌**에 대한 판정이다 — 복구일 4단계가 읽는 벌의 신선도는 그 응답에 나타나지 않는다';

export const CAVEAT_SCOPE_COPY_UNDATED =
  '사본에는 **복사한 날짜가 적히지 않는다** — `asOf` 는 스냅샷을 뜬 날이므로, 사본이 몇 달 전에 복사된 것인지 판정할 수단이 없다';

export const CAVEAT_SCOPE_NO_GATE =
  '이 판정은 `switchReady` 를 내리지 않는다 — 어느 스코프에 기준치를 두는 운용이 맞는지는 코드가 알 수 없고, ' +
  '여기서 막으면 복구일에 거짓 차단이 된다. 달라지는 것은 **다음에 할 일**이다';

/**
 * 기준치가 **어느 배포의 벌인지** 판정한다.
 *
 * 입력은 이미 읽어 둔 것뿐이다 — 역할, 기준치 존재 여부, 기한 키 존재 여부, 신선도 판정.
 * **행 수·스냅샷 값·지문을 보지 않는다.**
 */
export function assessBaselineScope(args: {
  role: DeploymentRole;
  /** 역할을 읽은 키 이름(`deploymentRole().source`) */
  basis?: string | null;
  /** 이 배포에 기준 스냅샷이 들어 있는가 */
  baselineConfigured: boolean;
  /** 이 배포에 갱신 기한 키가 들어 있는가 */
  maxAgeConfigured: boolean;
  /** `assessBaselineAge` 의 판정(없으면 보지 않는다) */
  ageStatus?: BaselineAgeStatus | null;
}): BaselineScopeAssessment {
  const role: DeploymentRole = args.role;
  const basis = args.basis ?? null;
  const splitKeys = crossScopeKeys();
  const shell = { role, basis, splitKeys };

  if (role === 'unknown') {
    return {
      ...shell,
      verdict: 'scope_unknown',
      corroborated: false,
      usedOnRecoveryDay: false,
      ageJudgedHere: args.maxAgeConfigured,
      action: ACTION_SCOPE_UNKNOWN,
      caveats: [CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE, CAVEAT_SCOPE_NO_GATE],
    };
  }

  if (role === 'production') {
    return {
      ...shell,
      verdict: 'supplying',
      // 공급처에서는 §2 5번이 같은 벌의 신선도를 매월 본다 — 그 점에서만 corroborated 다.
      corroborated: true,
      usedOnRecoveryDay: false,
      ageJudgedHere: args.maxAgeConfigured,
      action: ACTION_SCOPE_SUPPLYING,
      caveats: [CAVEAT_SCOPE_FRESHNESS_ELSEWHERE, CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE, CAVEAT_SCOPE_NO_GATE],
    };
  }

  if (role === 'preview') {
    // 판정처의 벌은 §2 가 갱신하지 않는다 — 어떤 경우에도 corroborated 가 아니다.
    const caveats = [
      CAVEAT_SCOPE_COPY_UNDATED,
      CAVEAT_SCOPE_FRESHNESS_ELSEWHERE,
      CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE,
      CAVEAT_SCOPE_NO_GATE,
    ];
    let action = ACTION_SCOPE_JUDGING_OK;
    if (!args.baselineConfigured) action = ACTION_SCOPE_JUDGING_ABSENT;
    else if (!args.maxAgeConfigured || args.ageStatus === 'unjudged') {
      action = actionScopeJudgingUnjudged(BASELINE_MAX_AGE_ENV);
    }
    return {
      ...shell,
      verdict: 'judging',
      corroborated: false,
      usedOnRecoveryDay: true,
      ageJudgedHere: args.maxAgeConfigured,
      action,
      caveats,
    };
  }

  return {
    ...shell,
    verdict: 'other',
    corroborated: false,
    usedOnRecoveryDay: false,
    ageJudgedHere: args.maxAgeConfigured,
    action: ACTION_SCOPE_OTHER,
    caveats: [CAVEAT_SCOPE_OTHER_SCOPES_INVISIBLE, CAVEAT_SCOPE_NO_GATE],
  };
}

/** 보장하지 **못하는** 것 */
export const SCOPE_LIMITS: readonly string[] = [
  '다른 스코프의 env 를 볼 수 없다 — 운영에 기준치가 있는지, 값이 같은지 이 응답은 말하지 못한다',
  '사본의 **복사 시점**을 모른다 — `asOf` 는 스냅샷을 뜬 날이고, 사본이 언제 복사됐는지는 어디에도 적히지 않는다',
  '`VERCEL_ENV` 가 없는 환경에서는 역할이 `unknown` 이다 — 「운영이 아니다」로 올리지 않는다',
  '역할이 맞았다고 기준치가 맞는 벌이라는 뜻은 아니다 — 스코프는 「어느 배포의 env 를 읽었는가」까지만 말한다',
  '`switchReady` 를 내리지 않는다 — 스코프 운용 확정은 사람 몫이고, 막으면 복구일에 거짓 차단이 된다',
  '스테이징이 Preview 스코프라는 것은 §6-1 의 운용 약속이다 — 다른 스코프를 쓰기로 하면 이 판정의 `judging` 도 함께 바뀌어야 한다',
  '값을 담지 않는다 — 기준치가 **맞는 수치인지**는 이 판정의 범위가 아니다(§3-2·§3-11 이 본다)',
];

/* ───────────────────────────── 출력 ───────────────────────────── */

/** 로그 한 줄. 스코프 이름·판정·불리언만 — 값은 담지 않는다 */
export function baselineScopeLine(a: BaselineScopeAssessment): string {
  const parts = [
    `baseline_scope=${a.verdict}`,
    `role=${a.role}`,
    `baseline_corroborated=${a.corroborated}`,
    `age_judged_here=${a.ageJudgedHere}`,
  ];
  if (a.usedOnRecoveryDay) parts.push('recovery_day_copy=true');
  return parts.join(' ');
}

/** 사람이 읽는 한 줄 */
export function baselineScopeText(a: BaselineScopeAssessment): string {
  switch (a.verdict) {
    case 'scope_unknown':
      return '이 배포의 역할을 알 수 없어 기준치가 어느 벌인지 말하지 못한다';
    case 'supplying':
      return '기준치를 공급하는 배포(운영)에서 판정했다 — 복구일 4단계가 읽는 벌은 이것이 아니다';
    case 'judging':
      return '복구 검증을 수행하는 배포에서 판정했다 — 이 벌은 §2 월 점검이 갱신하지 않는다';
    default:
      return '공급처도 판정처도 아닌 배포다 — 복구 판정의 근거가 아니다';
  }
}

/** 공개 응답용 필터 — 스코프 이름·판정·키 이름만(값·행 수 미포함) */
export function publicBaselineScope(a: BaselineScopeAssessment): {
  verdict: ScopeVerdict;
  role: DeploymentRole;
  corroborated: boolean;
  usedOnRecoveryDay: boolean;
  ageJudgedHere: boolean;
  action: string | null;
} {
  return {
    verdict: a.verdict,
    role: a.role,
    corroborated: a.corroborated,
    usedOnRecoveryDay: a.usedOnRecoveryDay,
    ageJudgedHere: a.ageJudgedHere,
    action: a.action,
  };
}

/* ───────────────────────────── env 스냅샷 ───────────────────────────── */

/**
 * 이 배포의 스코프 판정 입력을 env 에서 모은다. **값은 돌려주지 않는다** —
 * 들어 있는지(`presenceOf`)와 역할뿐이다.
 */
export function baselineScopeFromEnv(
  env: Record<string, string | undefined>,
  ageStatus?: BaselineAgeStatus | null,
): BaselineScopeAssessment {
  const reading = deploymentRole(env);
  return assessBaselineScope({
    role: reading.role,
    basis: reading.source,
    baselineConfigured: presenceOf(env, DATA_BASELINE_ENV) === 'set',
    maxAgeConfigured: presenceOf(env, BASELINE_MAX_AGE_ENV) === 'set',
    ageStatus: ageStatus ?? null,
  });
}

/** 배선 상태 요약(문서·보고용) */
export function baselineScopeStatus(env: Record<string, string | undefined>): {
  role: DeploymentRole;
  splitKeys: number;
  note: string;
} {
  const a = baselineScopeFromEnv(env);
  return { role: a.role, splitKeys: a.splitKeys.length, note: baselineScopeText(a) };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/** 주석을 지운 원문. 「주석에 적어 둔 규율」과 「코드가 하는 일」을 섞지 않기 위한 것뿐이다 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** 정본 모양 — 등록된 키가 실제 env 레지스트리에 있고, 갈리는 키에는 설명이 붙어 있어야 한다 */
export function auditScopeRegistry(routes: readonly SupplyRoute[] = SUPPLY_ROUTES): string[] {
  const out: string[] = [];
  const known = new Set(ENV_VARS.map((v) => v.key));
  const seen = new Set<string>();
  for (const r of routes) {
    if (!known.has(r.key)) out.push(`유령 키: ${r.key} — envRegistry 에 없다`);
    if (seen.has(r.key)) out.push(`중복 등록: ${r.key}`);
    seen.add(r.key);
    for (const [field, v] of Object.entries({
      suppliedIn: r.suppliedIn, judgedIn: r.judgedIn, seenIn: r.seenIn, whenSplit: r.whenSplit,
    })) {
      if (!String(v).trim()) out.push(`${r.key}: ${field} 가 비어 있다`);
    }
    if (r.crossScope && r.suppliedScope === r.judgedScope) {
      out.push(`${r.key}: crossScope 인데 공급·판정 스코프가 같다`);
    }
    if (!r.crossScope && r.suppliedScope !== r.judgedScope) {
      out.push(`${r.key}: 공급·판정 스코프가 다른데 crossScope 가 false 다`);
    }
  }
  if (!routes.some((r) => r.crossScope)) out.push('갈리는 키가 하나도 없다 — 이 모듈이 다룰 대상이 사라졌다');
  return out;
}

/**
 * 이 모듈이 `VERCEL_ENV` 를 **직접** 읽으면 판독이 두 곳으로 갈라진다.
 * 역할 판독은 `rehearsalScope.deploymentRole()` 정본만 쓴다.
 */
export function auditRoleReader(src: string): string[] {
  const out: string[] = [];
  // 주석의 **언급**은 허용한다(이 모듈의 머리 주석이 규율을 적어 두는 자리다) — 코드만 본다.
  // 한계: 문자열 안의 `//` 를 주석으로 오인할 수 있다(그 줄의 뒷부분을 놓칠 뿐 거짓 경보는 아니다).
  const body = stripComments(String(src ?? ''));
  if (/env\s*(\.\s*VERCEL_ENV|\[\s*['"]VERCEL_ENV['"]\s*\])/.test(body)) {
    out.push('VERCEL_ENV 를 직접 읽는다 — deploymentRole() 정본을 쓸 것(판독이 갈라지면 영구히 남는다)');
  }
  if (!/deploymentRole\s*\(/.test(body)) out.push('deploymentRole() 을 쓰지 않는다 — 역할 판독 정본이 빠졌다');
  // 접근 **꼴**만 본다(뒤에 `.`·`[`·구분자가 붙는 자리) — 이 메시지 자신이 걸리지 않게.
  if (/process\s*\.\s*env\s*[.[)\],;}]/.test(body)) {
    out.push('process.env 에 접근한다 — 순수 모듈 규율 위반');
  }
  return out;
}

/**
 * 복구 검증 라우트가 이 판정을 **응답에 담는지**. 판정만 하고 버리는 꼴도 잡는다.
 */
export function auditVerifyWiring(src: string): string[] {
  const out: string[] = [];
  const body = String(src ?? '');
  if (!/baselineScopeFromEnv\s*\(/.test(body)) out.push('baselineScopeFromEnv() 를 호출하지 않는다');
  if (!/recoveryVerification\s*\([^)]*baselineScope/.test(body)) {
    out.push('판정을 응답에 담지 않는다 — recoveryVerification() 에 넘기지 않으면 판정만 하고 버리는 꼴이다');
  }
  if (!/baselineScope\s*:/.test(body)) out.push('감사 기록에 스코프 판정을 남기지 않는다');
  if (!/baselineScopeLine\s*\(/.test(body)) out.push('로그 한 줄을 남기지 않는다');
  return out;
}

/**
 * `/api/health` 는 **새 체크를 만들지 않고** 기존 `checks.recovery` 안에서 말한다.
 * 새 체크가 생기면 degraded 가 늘고 공개 응답의 모양이 바뀐다.
 */
export function auditNoNewHealthCheck(src: string): string[] {
  const body = String(src ?? '');
  return /checks\.baselineScope/.test(body)
    ? ['`/api/health` 에 새 체크(checks.baselineScope)가 생겼다 — 기존 checks.recovery 안에서 말할 것']
    : [];
}

/** RUNBOOK 이 이 구분을 절로 들고 있는지 */
export function auditRunbookScope(doc: string): string[] {
  const out: string[] = [];
  const body = String(doc ?? '');
  if (!/###\s*3-13\./.test(body)) out.push('§3-13 이 없다 — 스코프 구분의 근거 절이 사라졌다');
  for (const v of ['scope_unknown', 'supplying', 'judging', 'other']) {
    if (!body.includes(v)) out.push(`§3-13 판정 표에 ${v} 행이 없다`);
  }
  for (const k of crossScopeKeys()) {
    if (!body.includes(k)) out.push(`갈리는 키 ${k} 가 RUNBOOK 에 적혀 있지 않다`);
  }
  return out;
}
