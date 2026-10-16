/**
 * rehearsalScope.ts — 리허설이 **어느 배포에 걸리는가**(RUNBOOK §6·§6-1). 2026-10-16
 *
 * ── 왜 필요한가 ───────────────────────────────────────────────────────────────
 * §3 1~8단계·§5·§2·§4·§1 은 모두 기계적으로 수행·확인할 수 있게 됐다. 그 장치들을 **실제로 돌려
 * 보는 자리**가 §6 리허설이고, 체크리스트는 30항목을 넘는다. 그런데 §6 머리말이 리허설의 전제를
 * 적어 둔 문장은 한 줄뿐이다 — 「리허설은 **운영 DB가 아닌 복구 브랜치**에서 수행한다」. 사람에게
 * 하는 말이고, **코드가 확인하는 것은 아무것도 없었다.**
 *
 *  (1) **체크리스트의 관측이 사고와 글자 그대로 같다.** 체크리스트는 「쓰기 차단 ON — `frozen` 이
 *      `true`」, 「`PATCH` 아무 자원 → `503` + `code: WRITE_FROZEN`」, 「`RECOVERY_EXPECTED_DB` 를
 *      넣고 재배포 후 `match` 인지 확인」, 「세션 폐기까지는 **실제로** 해 본다」를 지시한다. 이
 *      전부가 **환경변수 변경 + 응답 확인**인데, 그 변경이 리허설용 배포에 갔는지 운영 배포에 갔는지
 *      보는 장치가 없다. Vercel 스코프(Production/Preview)를 틀리기 쉽다는 사실은 §3-4 가 이미
 *      적어 두었고, `PRESENCE_LIMITS` 도 「이 배포의 env 만 본다 — 스코프를 틀린 입력은 알 수
 *      없다」고 적어 두었다. 틀렸을 때 나오는 응답은 **체크리스트가 요구하는 그 응답**이다.
 *
 *  (2) **틀린 쪽을 확인 장치가 보증해 준다.** `DATABASE_URL` 을 운영 스코프에 넣으면 운영이
 *      **버려질 복구 브랜치**에 쓰기를 쌓는다 — `checks.db` 는 `select 1` 이라 어느 DB 든 `ok`,
 *      지문은 체크리스트가 **기준값까지 같이 넣으라고** 지시하므로 `match` 다. 되돌리는 순간 그
 *      구간의 쓰기는 사라지고 **어디에도 기록이 남지 않는다**(복구와 달리 유실 구간을 산출할
 *      대상조차 없다).
 *
 *  (3) **사고로 집계되지 않는다.** 사용자는 저장 503·강제 로그아웃을 일시 장애로 보고, 담당자는
 *      체크리스트 통과로 본다. 그래서 §6 표에는 **`정상`** 으로 적히고 `rehearsalFreshness` 는
 *      `ok` 를 돌려준다 — 운영 장애를 낸 리허설이 「정상 리허설」로 남는다.
 *
 *  (4) **반대 방향도 조용하다.** 리허설 중에는 `checks.writeFreeze` 가 degraded, `incidentClosure`·
 *      `postRestoreSecurity`·`externalState` 가 `pending` 으로 보인다 — **실제 사건 대응과 구분되지
 *      않는다.** 그 기간에 겹친 진짜 사건은 「리허설 중이라서」로 읽히고, 선언을 지우지 않으면 다음
 *      사건까지 그 상태가 이어진다.
 *
 * 그래서 이 모듈은
 *   · 리허설이 건드리는 **파괴적 단계를 정본 목록**으로 두고(`DESTRUCTIVE_STEPS` — 대상 배포에서의
 *     효과 · 운영에 걸리면 생기는 일 · **왜 장치가 구분하지 못하는가**),
 *   · 「이 배포는 리허설 대상이다」를 **선언**으로 받고(`RECOVERY_REHEARSAL_ACTIVE`, 기본 OFF),
 *   · 배포 역할을 플랫폼 키에서 읽어(`deploymentRole` — **모르면 `unknown`**, 운영이 아니라고
 *     단정하지 않는다) 선언과 대조하고(`assessRehearsalScope`),
 *   · 그 상태를 `/api/health` 로 드러내고(`rehearsalScopeCheck` — 선언이 **운영 스코프에 들어가면
 *     운영 배포 자신이 그 사실을 보고한다**. 선언과 차단은 같은 재배포로 반영되므로 **선언이 실수를
 *     따라간다** — 그것이 이 장치의 작동 원리다),
 *   · 어긋남의 두 방향을 적고(`SCOPE_DRIFTS`), 보장하지 **못하는** 것을 `REHEARSAL_LIMITS` 로 함께
 *     내보내고, §6 머리말이 한 줄로 되돌아가면 **CI 에서 실패시킨다**(`auditRunbookRehearsal`).
 *
 * 원칙
 * - 순수 모듈: DB·next·fs 미접근, **신규 조회·쓰기·DDL 0**. 판정은 env 해석만으로 한다.
 * - **선언 없이는 구분할 수 없다** — 파괴적 설정이 켜져 있는데 선언이 없으면 그것은 실제 사건
 *   대응일 수 있으므로 **판정을 보류**하고(`undeclared_activity`) 각 전용 체크에 맡긴다(중복 보고 금지).
 * - **임의 안전 판정 금지** — 배포 역할을 모르면 `unknown_role` 로 멈추고 「운영이 아니다」로 올리지 않는다.
 * - 값을 담지 않는다 — 판정·역할·키 이름뿐이다.
 */
import { ENV_VARS } from './envRegistry.ts';
import { TRANSIENT_KEYS, isSwitchOn, presenceOf } from './envPresence.ts';

/** 응답·문서에서 근거 절을 찾을 수 있게 한다 */
export const REHEARSAL_RUNBOOK_REF = 'RUNBOOK §6 · §6-1';

/** 「이 배포는 리허설 대상이다」 선언 스위치. `'true'` 일 때만 ON — 평상시 미설정이 정상 */
export const REHEARSAL_ACTIVE_ENV = 'RECOVERY_REHEARSAL_ACTIVE';

/** 배포 역할을 판정할 때 보는 플랫폼 키(정본은 `lib/health.ts` 의 `buildInfo` 와 같다) */
export const ROLE_ENV_KEYS = ['VERCEL_ENV', 'NODE_ENV'] as const;

/* ─────────────────── 리허설이 건드리는 파괴적 단계(정본) ─────────────────── */

export interface DestructiveStep {
  key: string;
  /** 어느 단계인가 */
  step: string;
  /** 무엇을 하는가 */
  act: string;
  /** 그 행위가 쓰는 env 키 — 없으면 null(쓰기·플랫폼 조작) */
  envKey: string | null;
  /** 리허설 대상 배포에서의 효과(의도한 것) */
  onTarget: string;
  /** **운영 배포**에 걸리면 생기는 일 */
  onProduction: string;
  /** 왜 기존 장치가 둘을 구분하지 못하는가 */
  whyQuiet: string;
}

export const DESTRUCTIVE_STEPS: readonly DestructiveStep[] = [
  {
    key: 'write_freeze',
    step: '§3 2단계 (체크리스트 「쓰기 차단 ON」)',
    act: '`RECOVERY_WRITE_FREEZE` 를 켜고 `PATCH` 1건이 거절되는지 확인한다',
    envKey: 'RECOVERY_WRITE_FREEZE',
    onTarget: '리허설용 배포에서 쓰기가 503 으로 거절된다 — 사용자는 없다',
    onProduction: '**전 사용자의 저장이 503** 으로 거절된다(조회는 되므로 「저장만 안 되는」 장애로 보인다)',
    whyQuiet:
      '체크리스트가 요구하는 관측(`frozen: true` · `503` + `code: WRITE_FROZEN`)이 **성공과 글자 그대로 같다** — ' +
      '맞게 했을 때와 틀리게 했을 때의 응답이 구분되지 않는다',
  },
  {
    key: 'database_url',
    step: '§3 5단계 (전환 리허설)',
    act: '`DATABASE_URL` 을 복구 브랜치로 바꾸고 재배포한다',
    envKey: 'DATABASE_URL',
    onTarget: '리허설용 배포가 복구 브랜치를 본다 — 운영은 그대로다',
    onProduction:
      '운영이 **버려질 복구 브랜치**에 쓰기를 쌓는다. 되돌리는 순간 그 구간이 사라지고 **어디에도 기록이 남지 않는다** ' +
      '(복구와 달리 유실 구간을 산출할 대상조차 없다)',
    whyQuiet:
      '`checks.db` 는 `select 1` 이라 **어느 DB 든** `ok` 이고, 지문은 체크리스트가 기준값까지 같이 넣으라고 지시하므로 `match` 다',
  },
  {
    key: 'expected_db',
    step: '§3-4 (전환 확인)',
    act: '`RECOVERY_EXPECTED_DB` 에 복구 브랜치 지문을 넣고 `match` 인지 확인한다',
    envKey: 'RECOVERY_EXPECTED_DB',
    onTarget: '리허설용 배포의 연결 대상이 복구 브랜치인지 확인된다',
    onProduction:
      '운영의 기준 지문이 **복구 브랜치로 덮인다** — 전환 확인 수단 자체가 틀린 대상에 대해 `match` 를 내고, ' +
      '리허설이 끝난 뒤에도 그 기준이 남아 `mismatch` 를 내지 않는다',
    whyQuiet: '체크리스트가 「`match` 인지 확인」을 지시한다 — 기준값을 함께 넣었으므로 **무엇과 비교해도 맞는다**',
  },
  {
    key: 'session_purge',
    step: '§3 6-1단계 (체크리스트 「세션 폐기까지는 실제로 해 본다」)',
    act: '`sessions` 행을 지워 전원 재로그인을 만든다 — **DB 쓰기**다',
    envKey: null,
    onTarget: '복구 브랜치의 세션이 끊기고, 다시 로그인되는지가 점검 대상이 된다',
    onProduction: '**전 사용자가 강제 로그아웃**된다(작성 중이던 입력이 함께 사라진다)',
    whyQuiet: '로그아웃은 오류가 아니라 정상 동작이라 로그·에러 모니터링에 사고로 남지 않는다',
  },
  {
    key: 'baseline_overwrite',
    step: '§3-2 (기준 스냅샷)',
    act: '`recovery-verify` 응답의 `data.snapshot` 을 `RECOVERY_DATA_BASELINE` 에 넣는다',
    envKey: 'RECOVERY_DATA_BASELINE',
    onTarget: '**리허설 중에는 하지 않는다** — 체크리스트가 명시적으로 금지한다',
    onProduction:
      '리허설 DB 의 행 수가 운영 기준치가 되어 이후 모든 4단계 대조가 **자기 자신과의 비교**가 된다 ' +
      '(§3-2 `snapshotAdoption` 이 `forbidden` 으로 막아 둔 바로 그 상태)',
    whyQuiet: '이후 판정이 영구히 `ok` 다 — 기준치가 낮아진 것은 `stale` 로도 드러나지 않는다(날짜는 새것이다)',
  },
  {
    key: 'promote_rollback',
    step: '§5 (배포 롤백)',
    act: 'Vercel 에서 옛 배포를 Promote 한다',
    envKey: null,
    onTarget: '**리허설 중에는 쓰지 않는다** — 체크리스트가 금지한다',
    onProduction:
      '옛 배포는 **그 시점의 환경변수 스냅샷**으로 돌아 차단·DB 교체·기준 지문이 함께 되돌아간다(§5-1)',
    whyQuiet: '`frozen: false` 는 7단계 완료와 같은 모습이고, 기준 지문이 사라진 상태는 `unset` 이라 degraded 조차 아니다',
  },
];

/** 모르는 키는 null — 지어내지 않는다 */
export function stepFor(key: unknown): DestructiveStep | null {
  const k = String(key ?? '').trim();
  return DESTRUCTIVE_STEPS.find((s) => s.key === k) ?? null;
}

/* ───────────────────────── 어긋남의 두 방향 ───────────────────────── */

export interface ScopeDrift {
  key: string;
  when: string;
  /** 그래서 무슨 일이 생기는가 */
  effect: string;
  /** 누가 알아채는가 */
  noticedBy: string;
  fix: string;
}

export const SCOPE_DRIFTS: readonly ScopeDrift[] = [
  {
    key: 'rehearsal_hits_production',
    when: '리허설 설정이 **운영 스코프**에 들어간다(Vercel Production/Preview 혼동)',
    effect: '운영에서 저장 503·강제 로그아웃·버려질 DB 로의 쓰기가 일어나는데 체크리스트는 전부 통과한다',
    noticedBy:
      '**아무도 사고로 기록하지 않는다** — 사용자는 일시 장애로 보고 담당자는 통과로 본다. ' +
      '§6 표에는 `정상` 으로 적히고 리허설 신선도는 `ok` 가 된다',
    fix: '리허설 대상 배포에 `' + REHEARSAL_ACTIVE_ENV + '` 를 선언하고, 운영 응답의 `verdict` 가 `production_rehearsal` 이 아닌지 본다',
  },
  {
    key: 'incident_mistaken_for_rehearsal',
    when: '리허설 기간에 **실제 사건**이 겹친다',
    effect: '`writeFreeze` degraded 와 `pending` 들이 「리허설 중이라서」로 읽혀 대응이 늦어진다',
    noticedBy: '사용자 문의로만 드러난다 — 응답만 보면 리허설과 사건이 같은 모습이다',
    fix: '선언은 리허설 대상 배포에만 넣는다 — 운영 배포의 degraded 는 **언제나** 사건으로 다룬다',
  },
  {
    key: 'declaration_left_on',
    when: '리허설이 끝났는데 선언을 지우지 않는다',
    effect: '다음 사건에서 그 배포의 degraded 가 「리허설 중」으로 읽힌다',
    noticedBy: '선언이 살아 있는 동안 이 체크가 degraded 로 남는다 — 그것이 알림이다',
    fix: '체크리스트 마지막에서 `' + REHEARSAL_ACTIVE_ENV + '` 를 지우고 `verdict` 가 `normal` 로 돌아왔는지 본다',
  },
];

/* ───────────────────────────── 배포 역할 ───────────────────────────── */

export const DEPLOYMENT_ROLES = ['production', 'preview', 'development', 'unknown'] as const;
export type DeploymentRole = (typeof DEPLOYMENT_ROLES)[number];

export interface RoleReading {
  role: DeploymentRole;
  /** 어느 키에서 읽었는가 — 못 읽으면 null */
  source: string | null;
}

/**
 * 이 배포가 운영인지 판정한다.
 *
 * `VERCEL_ENV` 만이 운영/프리뷰를 구분한다 — `NODE_ENV` 는 Vercel 에서 **프리뷰 배포도
 * `production`** 이라 그것으로 판정하면 리허설용 배포가 영구히 `production_rehearsal` 이 되어
 * 장치가 쓸모를 잃는다. 그래서 `NODE_ENV` 는 **명시된 로컬 개발**만 알아보는 데 쓰고, 나머지는
 * `unknown` 으로 남긴다 — **「운영이 아니다」로 올리지 않는다**(모르는 것과 안전한 것은 다르다).
 */
export function deploymentRole(env: Record<string, string | undefined> = process.env): RoleReading {
  const vercel = String(env.VERCEL_ENV ?? '').trim().toLowerCase();
  if (vercel === 'production' || vercel === 'preview' || vercel === 'development') {
    return { role: vercel as DeploymentRole, source: 'VERCEL_ENV' };
  }
  if (!vercel) {
    const node = String(env.NODE_ENV ?? '').trim().toLowerCase();
    if (node === 'development' || node === 'test') return { role: 'development', source: 'NODE_ENV' };
  }
  return { role: 'unknown', source: null };
}

/** 파괴적 단계를 걸어도 되는 대상인가 — `unknown` 은 포함하지 않는다 */
export function isSafeTarget(role: DeploymentRole): boolean {
  return role === 'preview' || role === 'development';
}

/* ───────────────────────────── 선언 판독 ───────────────────────────── */

export const DECLARATION_STATES = ['off', 'on', 'malformed'] as const;
export type DeclarationState = (typeof DECLARATION_STATES)[number];

/**
 * 선언 판독. 실제 스위치 규율(`=== 'true'`)과 **글자 그대로 같게** 보고,
 * 값이 있는데 `'true'` 가 아닌 경우를 `malformed` 로 드러낸다 —
 * `1`·`yes`·공백은 OFF 로 읽히는데 대시보드에는 「넣어 두었다」로 보인다(조용히 보호가 없다).
 * **값은 돌려주지 않는다.**
 */
export function declarationOf(env: Record<string, string | undefined> = process.env): DeclarationState {
  if (isSwitchOn(env, REHEARSAL_ACTIVE_ENV)) return 'on';
  return presenceOf(env, REHEARSAL_ACTIVE_ENV) === 'absent' ? 'off' : 'malformed';
}

/** 지금 들어가 있는 파괴적 설정의 **키 이름**(값 없음). 쓰기·Promote 는 env 에 흔적이 없어 보이지 않는다 */
export function activeDestructiveKeys(env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  for (const s of DESTRUCTIVE_STEPS) {
    if (!s.envKey) continue;
    if (s.envKey === 'DATABASE_URL') continue; // 평상시에도 반드시 있다 — 교체 여부는 지문(§3-4)이 본다
    if (s.envKey === 'RECOVERY_WRITE_FREEZE') {
      if (isSwitchOn(env, s.envKey)) out.push(s.envKey);
      continue;
    }
    if (presenceOf(env, s.envKey) === 'set') out.push(s.envKey);
  }
  return out;
}

/* ──────────────────────────── 선행 조건 ──────────────────────────── */

export const REHEARSAL_SAFEGUARDS: readonly string[] = [
  '리허설 대상은 **별도 배포**다 — 운영 alias 와 같은 배포에서 차단·전환을 시험하지 않는다',
  `그 배포에만 \`${REHEARSAL_ACTIVE_ENV}=true\` 를 넣는다(Preview 스코프). 선언과 차단은 **같은 재배포로 반영**되므로, ` +
    '스코프를 틀리면 선언도 함께 틀린 배포로 간다 — 그래서 운영 배포가 그 사실을 스스로 보고한다',
  '환경변수는 **재배포 전까지 반영되지 않는다**(§3 5단계) — 선언을 먼저 넣고 `verdict` 를 확인한 뒤 파괴적 단계로 간다',
  '`RECOVERY_DATA_BASELINE`·`RECOVERY_ENV_BASELINE` 은 리허설 중에 **갱신하지 않는다**(기준치를 리허설 DB 로 덮는다)',
  '배포 롤백(Promote)은 리허설 중에 쓰지 않는다 — env 스냅샷이 함께 되돌아간다(§5-1)',
  '마치면 선언을 **지운다** — 남으면 다음 사건의 degraded 가 「리허설 중」으로 읽힌다',
];

/* ──────────────────────── 보장하지 못하는 것 ──────────────────────── */

export const CAVEAT_DECLARATION_IS_A_CLAIM =
  '선언은 「이 배포를 리허설 대상으로 적었다」는 뜻이다 — **DB 가 복구 브랜치인지는 말하지 않는다**(그쪽은 `checks.dbIdentity` 의 지문이 본다)';

export const REHEARSAL_LIMITS: readonly string[] = [
  CAVEAT_DECLARATION_IS_A_CLAIM,
  '**선언하지 않으면 리허설과 사건 대응을 구분할 수 없다** — 이 체크는 선언한 리허설만 본다(`undeclared_activity` 는 판정 보류이고 사고라는 뜻이 아니다)',
  '이 배포의 env 만 본다 — 같은 DB 를 쓰는 다른 배포에서 벌어지는 리허설은 여기서 보이지 않는다',
  '세션 폐기 같은 **DB 쓰기**와 Vercel Promote 는 env 에 흔적을 남기지 않는다 — 목록(`DESTRUCTIVE_STEPS`)으로만 말한다',
  '배포 역할은 플랫폼이 주입한 값을 읽은 것이다 — `VERCEL_ENV` 가 없는 환경에서는 `unknown` 이고, 운영이 아니라는 뜻이 아니다',
  '선언을 운영 스코프에 넣은 것을 **막지는 못한다** — 재배포 후 그 배포의 응답으로 드러낼 뿐이다',
];

/* ───────────────────────────── 판정 ───────────────────────────── */

export const SCOPE_VERDICTS = [
  'normal',
  'rehearsal',
  'production_rehearsal',
  'unknown_role',
  'invalid_declaration',
  'undeclared_activity',
] as const;
export type ScopeVerdict = (typeof SCOPE_VERDICTS)[number];

export const ACTION_NORMAL = '평상시 상태다 — 리허설을 시작할 때 대상 배포에만 선언을 넣는다(§6-1)';
export const ACTION_REHEARSAL =
  '리허설 대상으로 선언된 배포다. 체크리스트의 파괴적 단계를 여기서 수행하고, **마치면 선언을 지운다**(§6-1)';
export const ACTION_PRODUCTION_REHEARSAL =
  '**운영 배포에 리허설이 선언됐다** — Vercel 스코프를 틀렸을 가능성이 높다. 같은 재배포로 들어간 ' +
  '`RECOVERY_WRITE_FREEZE`·`DATABASE_URL`·`RECOVERY_EXPECTED_DB` 가 **운영에 걸려 있는지** 즉시 확인하고, ' +
  '먼저 차단을 풀어 저장을 되살린 뒤 선언을 지운다. 운영이 복구 브랜치를 보고 있었다면 그 구간의 쓰기는 ' +
  '되돌릴 수 없으므로 §3-7 과 같은 방식으로 구간을 적어 둔다(§6-1)';
export const ACTION_UNKNOWN_ROLE =
  '리허설이 선언됐는데 **이 배포가 운영인지 확인할 수 없다**(`VERCEL_ENV` 가 없다). 운영이 아니라고 ' +
  '단정하지 말고, 파괴적 단계 전에 대상 배포의 URL·지문(§3-4)으로 직접 확인한다(§6-1)';
export const ACTION_INVALID_DECLARATION =
  `\`${REHEARSAL_ACTIVE_ENV}\` 에 \`'true'\` 가 아닌 값이 들어 있다 — **선언은 꺼져 있다**(대시보드에는 ` +
  '「넣어 두었다」로 보인다). `true` 로 다시 적거나 키를 지운다(§6-1)';
export const ACTION_UNDECLARED_ACTIVITY =
  '파괴적 설정이 들어가 있는데 리허설 선언이 없다 — **실제 사건 대응이라면 정상이다.** 리허설이라면 ' +
  '대상 배포에 선언을 넣어 두 상태를 구분할 수 있게 한다(§6-1)';

export interface ScopeAssessment {
  verdict: ScopeVerdict;
  /** 선언 상태 — 값은 담지 않는다 */
  declaration: DeclarationState;
  declared: boolean;
  role: DeploymentRole;
  roleSource: string | null;
  /** 파괴적 단계를 걸어도 되는 대상인가 */
  safeTarget: boolean;
  /** 지금 들어가 있는 파괴적 설정의 키 이름 */
  activeKeys: readonly string[];
  action: string;
  caveats: readonly string[];
}

/**
 * 선언과 배포 역할을 대조한다.
 *
 * 판정 순서 — **선언이 유효한지가 먼저다**(고칠 대상이 다르다). 그 다음이 운영 여부이고,
 * 역할을 모르는 것은 `rehearsal` 로 올리지 않는다. 선언이 없으면 파괴적 설정이 있어도
 * **판정을 보류**한다 — 그것은 실제 사건 대응일 수 있고, 각 전용 체크가 이미 드러낸다.
 */
export function assessRehearsalScope(
  env: Record<string, string | undefined> = process.env,
): ScopeAssessment {
  const declaration = declarationOf(env);
  const { role, source } = deploymentRole(env);
  const activeKeys = activeDestructiveKeys(env);
  const base = {
    declaration,
    declared: declaration === 'on',
    role,
    roleSource: source,
    safeTarget: isSafeTarget(role),
    activeKeys,
    caveats: REHEARSAL_LIMITS,
  };
  if (declaration === 'malformed') return { ...base, verdict: 'invalid_declaration', action: ACTION_INVALID_DECLARATION };
  if (declaration === 'on') {
    if (role === 'production') return { ...base, verdict: 'production_rehearsal', action: ACTION_PRODUCTION_REHEARSAL };
    if (role === 'unknown') return { ...base, verdict: 'unknown_role', action: ACTION_UNKNOWN_ROLE };
    return { ...base, verdict: 'rehearsal', action: ACTION_REHEARSAL };
  }
  if (activeKeys.length) return { ...base, verdict: 'undeclared_activity', action: ACTION_UNDECLARED_ACTIVITY };
  return { ...base, verdict: 'normal', action: ACTION_NORMAL };
}

/* ───────────────────────── 출력(사람·로그) ───────────────────────── */

export interface RehearsalPlan {
  scope: ScopeAssessment;
  steps: readonly DestructiveStep[];
  drifts: readonly ScopeDrift[];
  safeguards: readonly string[];
  limits: readonly string[];
  runbook: string;
}

export function rehearsalPlanFor(env: Record<string, string | undefined> = process.env): RehearsalPlan {
  return {
    scope: assessRehearsalScope(env),
    steps: DESTRUCTIVE_STEPS,
    drifts: SCOPE_DRIFTS,
    safeguards: REHEARSAL_SAFEGUARDS,
    limits: REHEARSAL_LIMITS,
    runbook: REHEARSAL_RUNBOOK_REF,
  };
}

/** 사람이 읽는 요약(§6-1 의 1줄 명령이 출력하는 것) */
export function rehearsalScopeText(plan: RehearsalPlan): string {
  const s = plan.scope;
  const lines = [
    `[${s.verdict}] 배포 역할=${s.role}${s.roleSource ? `(${s.roleSource})` : '(판독 불가)'} · 선언=${s.declaration}`,
    `→ ${s.action}`,
    s.activeKeys.length ? `· 지금 들어가 있는 파괴적 설정: ${s.activeKeys.join(', ')}` : '· 파괴적 설정 없음',
  ];
  for (const st of plan.steps) lines.push(`· ${st.key}(${st.step}) — 운영에 걸리면: ${st.onProduction}`);
  for (const d of plan.drifts) lines.push(`· ${d.key}: ${d.effect} / 알아채는 쪽: ${d.noticedBy}`);
  for (const g of plan.safeguards) lines.push(`- ${g}`);
  for (const l of plan.limits) lines.push(`※ ${l}`);
  return lines.join('\n');
}

/** 로그 한 줄. 판정·역할·키 이름만 — 설정값·URL·호스트는 담지 않는다 */
export function rehearsalScopeLogLine(plan: RehearsalPlan): string {
  const s = plan.scope;
  return [
    '[rehearsalScope]',
    `verdict=${s.verdict}`,
    `role=${s.role}`,
    `declaration=${s.declaration}`,
    `safeTarget=${s.safeTarget}`,
    `activeKeys=${s.activeKeys.length ? s.activeKeys.join('|') : '-'}`,
  ].join(' ');
}

/* ───────────────────────── /api/health 체크 ───────────────────────── */

const VERDICT_NOTE: Record<ScopeVerdict, string> = {
  normal: '리허설 선언이 없고 파괴적 설정도 없다 — 평상시 상태다',
  rehearsal:
    '리허설 대상으로 선언된 배포다 — 평상시가 아니므로 degraded 로 둔다(선언을 지우지 않으면 이 상태가 남아 잊히지 않는다)',
  production_rehearsal:
    '**운영 배포에 리허설이 선언됐다** — 같은 재배포로 들어간 차단·DB 교체가 운영에 걸려 있을 수 있다(스코프 혼동)',
  unknown_role: '리허설이 선언됐으나 이 배포가 운영인지 확인할 수 없다 — 운영이 아니라고 단정하지 않는다',
  invalid_declaration: '선언 키에 `true` 가 아닌 값이 있다 — **보호 없이 리허설이 돌아간다**(대시보드에는 있어 보인다)',
  undeclared_activity:
    '파괴적 설정이 들어가 있으나 선언이 없다 — **실제 사건 대응과 구분되지 않는다**(판정 보류. 각 전용 체크가 본다)',
};

/**
 * 리허설이 **어느 배포에 걸려 있는가**를 공개 헬스체크에 드러낸다.
 *
 * 핵심은 **운영 배포 자신이 보고한다**는 점이다 — 선언과 파괴적 설정은 같은 재배포로 반영되므로
 * 스코프를 틀리면 선언도 함께 틀린 배포로 가고, 그 배포의 응답이 `production_rehearsal` 이 된다.
 * **required: false** 이므로 어느 경우에도 503 이 되지 않는다(리허설 상태로 서비스를 내리면
 * 복구·리허설 자신이 막힌다). 설정값·호스트·연결 문자열은 담지 않는다.
 */
export function rehearsalScopeCheck(args?: { env?: Record<string, string | undefined> }): {
  ok: boolean;
  required: false;
  detail: Record<string, unknown>;
} {
  const env = args?.env ?? process.env;
  const s = assessRehearsalScope(env);
  return {
    ok: s.verdict === 'normal' || s.verdict === 'undeclared_activity',
    required: false,
    detail: {
      verdict: s.verdict,
      declared: s.declared,
      declaration: s.declaration,
      declarationEnv: REHEARSAL_ACTIVE_ENV,
      role: s.role,
      roleSource: s.roleSource,
      safeTarget: s.safeTarget,
      /** 키 이름만 — 값은 담지 않는다 */
      activeKeys: s.activeKeys,
      steps: DESTRUCTIVE_STEPS.map((st) => st.key),
      drifts: SCOPE_DRIFTS.map((d) => d.key),
      action: s.action,
      runbook: REHEARSAL_RUNBOOK_REF,
      limits: REHEARSAL_LIMITS,
      note: VERDICT_NOTE[s.verdict],
    },
  };
}

/** 배선 상태 요약(문서·보고용) */
export function rehearsalScopeStatus(env: Record<string, string | undefined> = process.env): {
  verdict: ScopeVerdict;
  role: DeploymentRole;
  steps: number;
  drifts: number;
  limits: number;
  note: string;
} {
  const s = assessRehearsalScope(env);
  return {
    verdict: s.verdict,
    role: s.role,
    steps: DESTRUCTIVE_STEPS.length,
    drifts: SCOPE_DRIFTS.length,
    limits: REHEARSAL_LIMITS.length,
    note: VERDICT_NOTE[s.verdict],
  };
}

/* ───────────────────────────── 정적 점검 ───────────────────────────── */

/**
 * 정본 목록이 레지스트리와 어긋나지 않는지(유령 키 방지) + 선언 키가 **임시 키**로 등록돼 있는지.
 * 임시 키에서 빠지면 `checks.envPresence` 가 평상시 미설정을 「유실」로 중복 보고한다.
 */
export function auditStepSources(
  vars: readonly { key: string }[] = ENV_VARS,
  transient: readonly string[] = TRANSIENT_KEYS,
): string[] {
  const known = new Set(vars.map((v) => v.key));
  const problems: string[] = [];
  if (!known.has(REHEARSAL_ACTIVE_ENV)) problems.push(`선언 키 ${REHEARSAL_ACTIVE_ENV} 가 레지스트리에 없다`);
  if (!transient.includes(REHEARSAL_ACTIVE_ENV)) {
    problems.push(`선언 키 ${REHEARSAL_ACTIVE_ENV} 가 임시 키 목록에 없다 — 평상시 미설정이 유실로 중복 보고된다`);
  }
  for (const s of DESTRUCTIVE_STEPS) {
    if (s.envKey && !known.has(s.envKey)) problems.push(`단계 ${s.key} 의 ${s.envKey} 가 레지스트리에 없다`);
    if (!s.onProduction.trim() || !s.whyQuiet.trim()) problems.push(`단계 ${s.key} 에 운영 영향·사각지대 설명이 없다`);
  }
  return problems;
}

/**
 * 이 모듈이 선언을 **느슨하게 읽지 않는지** 원문으로 고정한다.
 * `Boolean(...)` 이나 「false 문자열과의 부정 비교」로 바뀌면 오설정(`0`·`off`)이 ON 으로 읽혀, 운영 배포가
 * 「리허설 중」으로 보이는 가장 조용한 회귀가 된다.
 */
export function auditSwitchDiscipline(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/isSwitchOn\(/.test(s)) problems.push('선언 판독이 isSwitchOn() 을 경유하지 않는다(스위치 규율 밖이다)');
  // 아래 비교식은 리터럴로 적지 않는다 — 적으면 이 함수가 자기 원문을 위반으로 잡는다.
  if (new RegExp("!==\\s*['\"]false['\"]").test(s)) {
    problems.push('느슨한 부정 비교(false 문자열과의 비교)가 있다 — 오설정을 ON 으로 읽는다');
  }
  if (new RegExp(`Boolean\\(\\s*env\\[?\\.?\\s*${REHEARSAL_ACTIVE_ENV}`).test(s)) {
    problems.push('Boolean() 으로 선언을 읽는다 — 빈 문자열 외 모든 값이 ON 이 된다');
  }
  return problems;
}

/**
 * `lib/health.ts` 원문 점검 — 배포 역할 판정의 **근거 키**가 그대로인지 본다.
 * `buildInfo` 가 다른 키로 옮겨 가면 응답의 `env` 와 이 판정이 어긋난 채 `unknown` 을 계속
 * 내게 되는데, 응답은 그대로 돌기 때문에 사람 눈으로는 알아챌 수 없다.
 */
export function auditBuildInfoSource(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  for (const k of ROLE_ENV_KEYS) {
    if (!s.includes(k)) problems.push(`lib/health.ts 가 ${k} 를 더 이상 보지 않는다 — 배포 역할 판정의 근거가 사라졌다`);
  }
  return problems;
}

/** RUNBOOK 에서 §6 절만 잘라낸다. 못 찾으면 빈 문자열 — 지어내지 않는다 */
export function runbookSection6(src: unknown): string {
  const s = String(src ?? '');
  const start = s.search(/^##\s*6\.\s/m);
  if (start < 0) return '';
  const rest = s.slice(start);
  const next = rest.search(/^##\s(?!\s*6\.)/m);
  return next > 0 ? rest.slice(0, next) : rest;
}

/**
 * 실제 `RUNBOOK.md` 점검 — §6 가 **확인되는 전제**로 남아 있는지.
 * 머리말의 「운영 DB가 아닌 복구 브랜치에서 수행한다」가 사람에게 하는 말 한 줄로 되돌아가거나
 * §6-1·선언 키·체크리스트의 선언/해제 항목이 사라지면 CI 를 실패시킨다.
 */
export function auditRunbookRehearsal(src: unknown): string[] {
  const s = String(src ?? '');
  const sec = runbookSection6(s);
  const problems: string[] = [];
  if (!sec) return ['RUNBOOK 에서 §6 절을 찾을 수 없다'];
  if (!/운영 DB가 아닌 복구 브랜치/.test(sec)) problems.push('§6 머리말에서 「운영 DB가 아닌 복구 브랜치」 전제가 사라졌다');
  if (!sec.includes(REHEARSAL_ACTIVE_ENV)) problems.push(`§6 에 선언 키 ${REHEARSAL_ACTIVE_ENV} 가 없다`);
  if (!/^###\s*6-1\./m.test(sec)) problems.push('§6-1 절이 사라졌다 — 리허설이 운영에 걸리는 경로를 적어 둔 유일한 자리다');
  if (!/checks\.rehearsalScope/.test(sec)) problems.push('§6 에 checks.rehearsalScope 확인 지시가 없다');
  if (!/production_rehearsal/.test(sec)) problems.push('§6-1 에 운영 배포 선언(production_rehearsal) 판정이 없다');
  for (const st of DESTRUCTIVE_STEPS) {
    if (!sec.includes(st.key)) problems.push(`§6-1 에 파괴적 단계 ${st.key} 가 없다`);
  }
  for (const d of SCOPE_DRIFTS) {
    if (!sec.includes(d.key)) problems.push(`§6-1 에 어긋남 방향 ${d.key} 가 없다`);
  }
  // 체크리스트: 선언을 넣는 항목과 **지우는** 항목이 둘 다 있어야 한다(남으면 다음 사건에서 오독된다).
  const at = sec.search(/^###\s*리허설 체크리스트/m);
  if (at < 0) {
    problems.push('§6 에 리허설 체크리스트가 없다');
  } else {
    const checklist = sec.slice(at);
    if (!/선언/.test(checklist)) problems.push('리허설 체크리스트에 선언 항목이 없다');
    if (!new RegExp(`${REHEARSAL_ACTIVE_ENV}[^\\n]*지웠다`).test(checklist)) {
      problems.push('리허설 체크리스트에 선언을 **지웠다**는 항목이 없다');
    }
  }
  return problems;
}

/**
 * `app/api/health/route.ts` 원문 점검 — 판정이 **응답에 실려 있는지**까지 본다.
 * 빠지면 운영 스코프에 들어간 리허설을 알려 줄 장치가 사라지는데, 응답은 그대로 돈다.
 */
export function auditHealthWiring(src: unknown): string[] {
  const s = String(src ?? '');
  const problems: string[] = [];
  if (!/from\s+['"]@\/lib\/rehearsalScope['"]/.test(s)) problems.push('rehearsalScope 를 import 하지 않는다');
  if (!/rehearsalScopeCheck\(/.test(s)) problems.push('rehearsalScopeCheck() 를 호출하지 않는다');
  if (!/checks\.rehearsalScope\s*=\s*rehearsalScopeCheck\(/.test(s)) {
    problems.push('판정 결과를 checks.rehearsalScope 에 싣지 않는다(판정만 하고 버리는 꼴)');
  }
  return problems;
}
